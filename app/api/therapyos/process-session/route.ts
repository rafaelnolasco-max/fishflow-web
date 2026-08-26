import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processAndInsertSession } from "@/lib/therapySession";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs";
// El análisis de una sesión de 50 min con historial puede pasar del minuto.
export const maxDuration = 800;

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — process-session
// ════════════════════════════════════════════════════════════════════════════
// Toma una transcripción (pegada a mano en el modal) y crea el borrador de
// sesión. El análisis clínico y el guardado viven en `lib/therapySession`,
// compartidos con record-session y reprocess-session.
//
// 26-ago-2026: si la IA falla, la sesión se guarda igual con la transcripción y
// `ai_processed = false` (respuesta 201 con `warning`). Antes se devolvía 422 y
// se perdía la transcripción completa.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patient_id, transcript, session_date } = body as {
      patient_id: string;
      transcript: string;
      session_date: string;
    };

    if (!patient_id || !transcript?.trim() || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, transcript, session_date" },
        { status: 400 },
      );
    }

    // Candado: esta ruta gasta créditos del modelo y escribe notas clínicas.
    const { data: patient } = await supabaseAdmin
      .from("patients")
      .select("id, client_id")
      .eq("id", patient_id)
      .single();
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }
    const auth = await requireClientAccess(patient.client_id);
    if (!auth.ok) return auth.response;

    const result = await processAndInsertSession({
      patientId: patient_id,
      transcript,
      sessionDate: session_date,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status },
      );
    }

    return NextResponse.json(
      { session: result.session, warning: result.warning },
      { status: 201 },
    );
  } catch (err) {
    console.error("process-session unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
