import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ─── Therapy Flow (B2C) — provisión self-service ──────────────────────────────
// Crea (una sola vez) el cliente + acceso + paciente + config para un usuario
// registrado. Toda la lógica vive en la función de BD
// provision_therapy_client(), que usa pg_advisory_xact_lock para serializar
// llamadas concurrentes del mismo usuario — sin eso se repite el bug de
// Finanzas (2026-07-08), donde dos llamadas simultáneas creaban clientes
// duplicados.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data, error } = await supabaseAdmin.rpc("provision_therapy_client", {
      p_user_id: user.id,
      p_email: user.email,
    });
    if (error || !data?.length) {
      console.error("terapia provision rpc:", error);
      return NextResponse.json({ error: "Error al crear cuenta" }, { status: 500 });
    }

    const row = data[0] as { client_id: string; patient_id: string; created: boolean };
    return NextResponse.json({
      client_id: row.client_id,
      patient_id: row.patient_id,
      created: row.created,
    });
  } catch (e) {
    console.error("terapia provision:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
