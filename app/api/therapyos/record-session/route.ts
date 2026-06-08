import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — record-session
// ════════════════════════════════════════════════════════════════════════════
// Orquesta el flujo de la grabadora para TherapyOS (primer consumidor del
// servicio de transcripción compartido):
//   1. invoca el Edge Function genérico `transcribe-audio` (Whisper)
//   2. pasa el texto al `process-session` existente (sin tocarlo) → crea BORRADOR
//   3. marca la sesión con source_type='recorder' + audio_path + transcription_id
// NO envía nada al paciente. El envío (email/WhatsApp) es un paso manual aparte
// ("aprobar antes de enviar").

export const maxDuration = 300; // transcripción + IA pueden tardar

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

export async function POST(req: NextRequest) {
  try {
    const { patient_id, storage_path, filename, session_date } = (await req.json()) as {
      patient_id: string;
      storage_path: string;
      filename?: string;
      session_date: string;
    };

    if (!patient_id || !storage_path || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, storage_path, session_date" },
        { status: 400 },
      );
    }

    // ── 1. Paciente → client_id ────────────────────────────────────────────────
    const { data: patient, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, client_id")
      .eq("id", patient_id)
      .single();
    if (pErr || !patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }

    // ── 2. Transcribir vía Edge Function compartido ────────────────────────────
    const txRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        client_id: patient.client_id,
        module: "therapy_session",
        ref_id: patient_id,
        storage_path,
        filename,
      }),
    });
    const txData = await txRes.json();
    if (!txRes.ok || !txData.transcript) {
      return NextResponse.json(
        { error: `Error al transcribir: ${txData.error ?? "sin transcripción"}` },
        { status: 502 },
      );
    }

    // ── 3. Procesar con IA (reusa process-session, sin tocarlo) → borrador ──────
    const psRes = await fetch(`${APP_URL}/api/therapyos/process-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id, transcript: txData.transcript, session_date }),
    });
    const psData = await psRes.json();
    if (!psRes.ok || !psData.session) {
      return NextResponse.json(
        { error: `Error al procesar la sesión: ${psData.error ?? "desconocido"}` },
        { status: 502 },
      );
    }

    // ── 4. Marcar la sesión como originada por grabadora ───────────────────────
    const { data: updated } = await supabaseAdmin
      .from("sessions")
      .update({
        source_type: "recorder",
        audio_path: storage_path,
        transcription_id: txData.transcription_id ?? null,
      })
      .eq("id", psData.session.id)
      .select()
      .single();

    return NextResponse.json(
      { session: updated ?? psData.session, transcription_id: txData.transcription_id },
      { status: 201 },
    );
  } catch (err) {
    console.error("record-session error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
