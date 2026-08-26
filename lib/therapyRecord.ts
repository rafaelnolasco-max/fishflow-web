// FishFlow — TherapyOS · pipeline de audio → sesión
// ─────────────────────────────────────────────────────────────────────────────
// Un solo camino para el audio que ya vive en Storage: transcribir (Whisper) y
// crear el borrador de sesión. Lo usan /api/therapyos/record-session (grabadora
// y "Subir audio") y /api/therapyos/reprocess-audio (botón de reintentar).
//
// 26-ago-2026: antes reprocess-audio llamaba a record-session por HTTP
// reenviando la cookie del navegador. Cuando esa sesión no viajaba, el
// reintento moría en 401 sin siquiera llegar a Whisper — justo cuando más
// falta hacía. Ahora ambas rutas validan el acceso y llaman a esta función en
// proceso: sin salto HTTP, sin cookies, sin APP_URL de por medio.

import { createClient } from "@supabase/supabase-js";
import { transcribeStoredAudio } from "@/lib/sessionPipeline";
import { processAndInsertSession } from "@/lib/therapySession";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type RecordSessionResult =
  | {
      ok: true;
      session: Record<string, unknown> & { id: string };
      transcriptionId: string | null;
      warning?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** true = no se detectó voz; reintentar daría lo mismo. */
      empty?: boolean;
      detail?: unknown;
    };

export async function runRecordSession(input: {
  patientId: string;
  clientId: string;
  storagePath: string;
  sessionDate: string;
  sourceType: "recorder" | "upload";
}): Promise<RecordSessionResult> {
  const { patientId, clientId, storagePath, sessionDate, sourceType } = input;

  // ── 1. Transcribir (descarga por streaming + transcode en una pasada) ──────
  const tx = await transcribeStoredAudio({
    clientId,
    module: "therapy_session",
    refId: patientId,
    storagePath,
    sourceType,
    language: "es",
  });

  if (!tx.ok) {
    if (tx.reason === "empty") {
      return {
        ok: false,
        status: 422,
        empty: true,
        error:
          sourceType === "upload"
            ? "No se detectó voz en el archivo. Revisa que sea la grabación correcta de la sesión y no un audio en blanco."
            : "No se detectó voz en la grabación. Suele ser que el micrófono no captó audio. Si grabaste en paralelo con Notas de Voz, el navegador se queda sin micrófono: usa \"Subir audio\" con ese archivo.",
      };
    }
    return { ok: false, status: 502, error: `Error al transcribir: ${tx.message}` };
  }

  // ── 2. Analizar y guardar. Si la IA falla, la sesión se crea igual con la
  //      transcripción (ai_processed=false) y se reprocesa desde la UI. ───────
  const result = await processAndInsertSession({
    patientId,
    transcript: tx.transcript,
    sessionDate,
  });

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error, detail: result.detail };
  }

  // ── 3. Marcar el origen del audio en la sesión ─────────────────────────────
  const { data: updated } = await supabaseAdmin
    .from("sessions")
    .update({
      source_type: sourceType,
      audio_path: storagePath,
      transcription_id: tx.transcriptionId ?? null,
    })
    .eq("id", result.session.id)
    .select()
    .single();

  return {
    ok: true,
    session: updated ?? result.session,
    transcriptionId: tx.transcriptionId,
    warning: result.warning,
  };
}
