import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Trufa (B2C) — provisión / reclamo de invitaciones ────────────────────────
// Una mascota puede tener varios dueños (vet_pet_owners). Cuando el titular
// invita a alguien por correo, la fila se crea con user_id NULL. Al entrar esa
// persona por primera vez, esta ruta amarra su user_id a las invitaciones que
// coincidan con su correo. La RLS ya la deja ver la mascota antes de esto
// (user_owns_pet compara contra el correo del JWT), pero sin el amarre la
// invitación queda sin aceptar y no sabemos quién entró.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user?.email) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: claimed, error } = await supabaseAdmin
      .from("vet_pet_owners")
      .update({ user_id: user.id, accepted_at: new Date().toISOString() })
      .is("user_id", null)
      .ilike("email", user.email)
      .select("pet_id");

    if (error) {
      console.error("trufa provision:", error);
      return NextResponse.json({ error: "Error al vincular" }, { status: 500 });
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("slug", "trufa")
      .maybeSingle();

    return NextResponse.json({ claimed: claimed?.length ?? 0, client_id: client?.id ?? null });
  } catch (e) {
    console.error("trufa provision:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
