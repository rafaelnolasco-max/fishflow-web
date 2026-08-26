// FishFlow — TherapyOS · alta y reproceso de sesiones
// ─────────────────────────────────────────────────────────────────────────────
// Lógica compartida entre /api/therapyos/process-session (transcripción pegada
// a mano), record-session (grabadora / audio subido) y reprocess-session
// (re-correr la IA sobre una transcripción que ya está guardada).
//
// Regla de oro (26-ago-2026): la transcripción NUNCA se tira. Si el paso de IA
// falla, la sesión se guarda igual con el texto y `ai_processed = false`, y se
// reprocesa después sin volver a pagar Whisper. Antes, un fallo del modelo
// borraba 50 minutos de sesión ya transcritos.

import { createClient } from "@supabase/supabase-js";
import { runSessionAI, sessionFieldsFromAI, SESSION_AI_MODEL } from "@/lib/therapySessionAI";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const HISTORY_FIELDS =
  "session_number, session_date, session_title, clinical_summary, commitments, patterns_detected, briefing_next";

export type SessionWriteResult =
  | {
      ok: true;
      session: Record<string, unknown> & { id: string };
      /** Presente cuando la sesión se guardó pero la IA no pudo procesarla. */
      warning?: string;
    }
  | { ok: false; status: number; error: string; detail?: unknown };

/** Últimas 3 sesiones del paciente, para dar continuidad clínica al análisis. */
async function loadHistory(patientId: string, excludeSessionId?: string) {
  let q = supabaseAdmin
    .from("sessions")
    .select(HISTORY_FIELDS)
    .eq("patient_id", patientId);
  if (excludeSessionId) q = q.neq("id", excludeSessionId);
  const { data } = await q.order("session_date", { ascending: false }).limit(3);
  return data ?? [];
}

/**
 * Analiza una transcripción y crea la sesión. Si la IA falla, la sesión se crea
 * igual (sin resúmenes, `ai_processed = false`) y el motivo viaja en `warning`.
 */
export async function processAndInsertSession(input: {
  patientId: string;
  transcript: string;
  sessionDate: string;
  /** Columnas extra de `sessions` para casos particulares. */
  extraFields?: Record<string, unknown>;
  /** Acción a registrar en `session_log` cuando la IA sí procesó. */
  logAction?: string;
  logSnapshot?: Record<string, unknown>;
}): Promise<SessionWriteResult> {
  const { patientId, transcript, sessionDate, extraFields, logAction, logSnapshot } = input;

  const { data: patient, error: patientErr } = await supabaseAdmin
    .from("patients")
    .select("id, client_id, full_name")
    .eq("id", patientId)
    .single();
  if (patientErr || !patient) {
    return { ok: false, status: 404, error: "Paciente no encontrado" };
  }

  const history = await loadHistory(patientId);
  const ai = await runSessionAI(transcript, history);

  if (!ai.ok) {
    console.error("TherapyOS · IA falló:", ai.reason, ai.message);
  }

  const record = {
    patient_id: patientId,
    client_id: patient.client_id as string,
    session_date: sessionDate,
    session_number: 0, // el trigger SQL lo calcula
    transcript,
    raw_summary: ai.ok ? ai.raw : null,
    ...(ai.ok
      ? sessionFieldsFromAI(ai.parsed)
      : {
          session_title: null, clinical_summary: null, patient_summary: null,
          briefing_next: null, private_notes: null, emotional_state: null,
          commitments: null, patterns_detected: null, topics: null,
          connections_to_prev: null,
        }),
    ai_processed: ai.ok,
    ...(extraFields ?? {}),
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("sessions")
    .insert(record)
    .select()
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      status: 500,
      error: "Error al guardar sesión",
      detail: insertErr?.message,
    };
  }

  await supabaseAdmin.from("session_log").insert({
    session_id: inserted.id,
    action: ai.ok ? (logAction ?? "ai_processed") : "created",
    snapshot: {
      model: SESSION_AI_MODEL,
      patient_name: patient.full_name,
      ...(logSnapshot ?? {}),
      ...(ai.ok ? {} : { ai_error: ai.reason, ai_message: ai.message }),
    },
  });

  return ai.ok
    ? { ok: true, session: inserted }
    : {
        ok: true,
        session: inserted,
        warning:
          `La transcripción quedó guardada, pero el análisis con IA falló (${ai.reason}). ` +
          `Usa "Reprocesar con IA" en la sesión: no vuelve a transcribir el audio.`,
      };
}

/**
 * Re-corre la IA sobre una sesión que ya existe, usando su transcripción
 * guardada. No toca Whisper ni Storage.
 */
export async function reprocessSessionAI(sessionId: string): Promise<SessionWriteResult> {
  const { data: session, error: sErr } = await supabaseAdmin
    .from("sessions")
    .select("id, patient_id, client_id, transcript")
    .eq("id", sessionId)
    .single();
  if (sErr || !session) {
    return { ok: false, status: 404, error: "Sesión no encontrada" };
  }
  if (!session.transcript?.trim()) {
    return {
      ok: false,
      status: 422,
      error: "Esta sesión no tiene transcripción guardada: hay que reprocesar el audio.",
    };
  }

  const history = await loadHistory(session.patient_id as string, session.id as string);
  const ai = await runSessionAI(session.transcript as string, history);
  if (!ai.ok) {
    return { ok: false, status: 502, error: `No se pudo procesar con IA: ${ai.message}` };
  }

  const { data: updated, error: upErr } = await supabaseAdmin
    .from("sessions")
    .update({
      ...sessionFieldsFromAI(ai.parsed),
      raw_summary: ai.raw,
      ai_processed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (upErr || !updated) {
    return { ok: false, status: 500, error: "Error al guardar el reproceso", detail: upErr?.message };
  }

  await supabaseAdmin.from("session_log").insert({
    session_id: sessionId,
    action: "ai_processed",
    snapshot: { model: SESSION_AI_MODEL, reprocessed: true },
  });

  return { ok: true, session: updated };
}
