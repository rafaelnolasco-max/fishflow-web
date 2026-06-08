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

// Whisper alucina firmas de subtítulos cuando el audio está en silencio o sin voz
// (ej. "Subtítulos realizados por la comunidad de Amara.org"). Detectamos esa
// basura para NO generar una sesión clínica fantasma.
const HALLUCINATION_PATTERNS = [
  /amara\.org/i,
  /subt[íi]tulos?\s+(realizados|por|hechos|creados)/i,
  /gracias por ver/i,
  /thanks for watching/i,
  /subscribe/i,
  /www\.[a-z]/i,
];

function looksEmpty(t: string): boolean {
  const clean = (t ?? "").trim();
  if (clean.length < 20) return true;
  if (clean.length < 140 && HALLUCINATION_PATTERNS.some((re) => re.test(clean))) return true;
  let stripped = clean;
  for (const re of HALLUCINATION_PATTERNS) stripped = stripped.replace(re, "");
  if (stripped.replace(/[^a-záéíóúñ0-9]/gi, "").length < 15) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { patient_id, storage_path, filename, session_date, duration_seconds } = (await req.json()) as {
      patient_id: string;
      storage_path: string;
      filename?: string;
      session_date: string;
      duration_seconds?: number;
    };

    if (!patient_id || !storage_path || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, storage_path, session_date" },
        { status: 400 },
      );
    }

    if (typeof duration_seconds === "number" && duration_seconds < 3) {
      return NextResponse.json(
        { error: "La grabación fue demasiado corta. Graba al menos unos segundos hablando." },
        { status: 422 },
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

    // ── 2b. Guardia anti-basura: si Whisper alucinó sobre silencio, NO crear sesión ─
    if (looksEmpty(txData.transcript)) {
      if (txData.transcription_id) {
        await supabaseAdmin
          .from("transcriptions")
          .update({ status: "empty", error: "Sin voz detectada (probable silencio / micrófono sin captar)" })
          .eq("id", txData.transcription_id);
      }
      return NextResponse.json(
        {
          error: "No se detectó voz en la grabación. Suele ser que el micrófono no captó audio. Revisa el permiso del micrófono e intenta de nuevo, hablando cerca del teléfono.",
          empty: true,
        },
        { status: 422 },
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
