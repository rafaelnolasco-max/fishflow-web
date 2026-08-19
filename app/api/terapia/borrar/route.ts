import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Therapy Flow — borrar mi proceso ─────────────────────────────────────────
// Borra el expediente completo del usuario: audios, transcripciones, sesiones,
// paciente, config, acceso y su `client`. NO borra la cuenta de auth: el mismo
// correo puede estar usando FishFlow Finanzas u otro panel.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // Solo el cliente B2C de terapia de ESTE usuario.
    const { data: rows } = await supabaseAdmin
      .from("user_client_access")
      .select("client_id, clients!inner(id, vertical)")
      .eq("user_id", user.id)
      .eq("clients.vertical", "therapy_self");

    const clientId = (rows?.[0] as { client_id?: string } | undefined)?.client_id;
    if (!clientId) return NextResponse.json({ ok: true, nada: true });

    // 1. Audios que sigan en Storage
    const { data: files } = await supabaseAdmin.storage
      .from("audio")
      .list(`${clientId}/therapy_self`, { limit: 1000 });
    if (files?.length) {
      await supabaseAdmin.storage.from("audio").remove(
        files.map((f) => `${clientId}/therapy_self/${f.name}`),
      );
    }

    // 2. Filas. `sessions` y `patients` caen por ON DELETE CASCADE al borrar el
    //    client, pero las borramos explícitamente para no depender de eso.
    await supabaseAdmin.from("sessions").delete().eq("client_id", clientId);
    await supabaseAdmin.from("transcriptions").delete().eq("client_id", clientId);
    await supabaseAdmin.from("patients").delete().eq("client_id", clientId);
    await supabaseAdmin.from("therapy_self_config").delete().eq("client_id", clientId);
    await supabaseAdmin.from("user_client_access").delete().eq("client_id", clientId);
    await supabaseAdmin.from("clients").delete().eq("id", clientId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("terapia borrar:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
