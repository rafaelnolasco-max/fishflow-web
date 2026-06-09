import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// SieckVet — record-visit
// ════════════════════════════════════════════════════════════════════════════
// Orquesta el flujo de la grabadora PWA para una consulta veterinaria:
//   1. invoca el Edge Function compartido `transcribe-audio` (Whisper)
//   2. pasa el texto a `process-visit` → genera el BORRADOR con Sonnet
//   3. marca el resumen con source_type='recorder' + transcription_id
// NO envía nada al dueño (eso es Fase 4, tras la aprobación del vet).

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Mismo guardia anti-alucinación que TherapyOS: Whisper inventa firmas de
// subtítulos sobre silencio. No generamos un resumen fantasma.
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
    const { appointment_id, storage_path, filename, duration_seconds } = (await req.json()) as {
      appointment_id: string;
      storage_path: string;
      filename?: string;
      duration_seconds?: number;
    };

    if (!appointment_id || !storage_path) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: appointment_id, storage_path" },
        { status: 400 },
      );
    }

    if (typeof duration_seconds === "number" && duration_seconds < 3) {
      return NextResponse.json(
        { error: "La grabación fue demasiado corta. Graba al menos unos segundos hablando." },
        { status: 422 },
      );
    }

    // ── 1. Cita → client_id ─────────────────────────────────────────────────────
    const { data: appt, error: aErr } = await supabaseAdmin
      .from("vet_appointments")
      .select("id, client_id")
      .eq("id", appointment_id)
      .single();
    if (aErr || !appt) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    // ── 2. Transcribir vía Edge Function compartido ────────────────────────────
    const txRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({
        client_id: appt.client_id,
        module: "vet_visit",
        ref_id: appointment_id,
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

    // ── 2b. Guardia anti-basura ────────────────────────────────────────────────
    if (looksEmpty(txData.transcript)) {
      if (txData.transcription_id) {
        await supabaseAdmin
          .from("transcriptions")
          .update({ status: "empty", error: "Sin voz detectada (probable silencio / micrófono sin captar)" })
          .eq("id", txData.transcription_id);
      }
      return NextResponse.json(
        {
          error: "No se detectó voz en la grabación. Revisa el permiso del micrófono e intenta de nuevo, hablando cerca del teléfono.",
          empty: true,
        },
        { status: 422 },
      );
    }

    // ── 3. Procesar con IA (reusa process-visit) → borrador ────────────────────
    const pvRes = await fetch(`${APP_URL}/api/sieckvet/process-visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id, transcript: txData.transcript, source_type: "recorder" }),
    });
    const pvData = await pvRes.json();
    if (!pvRes.ok || !pvData.summary) {
      return NextResponse.json(
        { error: `Error al procesar la consulta: ${pvData.error ?? "desconocido"}` },
        { status: 502 },
      );
    }

    // ── 4. Vincular transcripción compartida al resumen ────────────────────────
    const { data: updated } = await supabaseAdmin
      .from("vet_visit_summaries")
      .update({ transcription_id: txData.transcription_id ?? null })
      .eq("id", pvData.summary.id)
      .select()
      .single();

    return NextResponse.json(
      { summary: updated ?? pvData.summary, transcription_id: txData.transcription_id },
      { status: 201 },
    );
  } catch (err) {
    console.error("record-visit error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
