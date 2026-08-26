// FishFlow — TherapyOS · motor de IA de sesiones
// ─────────────────────────────────────────────────────────────────────────────
// Antes vivía dentro de /api/therapyos/process-session. Se extrajo el 26-ago-2026
// después de que la sesión #8 de un paciente se perdiera: la transcripción de
// 50 minutos salió bien, pero el JSON del modelo se cortó contra el tope de
// `max_tokens` y `JSON.parse` tronó, así que la ruta devolvió 422 y no guardó
// nada. El historial de salidas venía subiendo sesión con sesión (3,275 → 3,964
// tokens contra un tope de 4,096): era cuestión de tiempo.
//
// Tres cosas cambian respecto a la versión original:
//   1. `max_tokens` amplio (16k) — el costo real lo fija lo que el modelo
//      escribe, no el tope.
//   2. Si aun así se corta, se reintenta UNA vez pidiendo salida más compacta.
//   3. El fallo se reporta con motivo, para que quien llame decida qué hacer
//      (hoy: guardar la sesión con la transcripción y marcarla sin procesar).

export const SESSION_AI_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;

const SYSTEM_PROMPT =
  "Eres un asistente clínico especializado en documentación psicoterapéutica. " +
  "Procesas transcripciones de sesiones y generas documentación estructurada. " +
  "Responde ÚNICAMENTE con JSON válido, sin markdown, sin explicaciones.";

// ─── Prompt de procesamiento clínico ──────────────────────────────────────────
export function buildSessionPrompt(transcript: string, history: unknown[]): string {
  return `Transcripción de sesión:
${transcript}

Historial de sesiones anteriores del paciente (últimas 3):
${JSON.stringify(history, null, 2)}

Genera un JSON con exactamente estas claves:
{
  "clinical_summary": "string — resumen técnico para el terapeuta, máx 300 palabras",
  "patient_summary": "string — resumen cálido dirigido al paciente, máx 150 palabras, tono empático, sin jerga clínica. ESCRÍBELO EN PRIMERA PERSONA, como si fueras el terapeuta hablándole directamente al paciente de 'tú' (este texto se le envía al paciente firmado por el terapeuta). NUNCA menciones al terapeuta en tercera persona ni por su nombre: lo que el terapeuta dijo o señaló se expresa como 'hoy te compartí', 'te propuse', 'trabajamos juntos'. La transcripción está narrada por el paciente y nombra al terapeuta en tercera persona — NO copies esa perspectiva.",
  "briefing_next": "string — briefing pre-sesión para el terapeuta, máx 200 palabras, incluye hilo conductor, tareas pendientes y preguntas sugeridas. Usa formato: **Label:** contenido, uno por línea",
  "private_notes": "string — observaciones clínicas privadas, máx 200 palabras",
  "emotional_state": {
    "sobriedad": "Estable|En riesgo|No aplica",
    "madurez_emocional": "Alta|Media|Baja|En proceso",
    "ansiedad": "Alta|Moderada|Baja",
    "energia_vital": "Alta|Media|Baja",
    "notas_emocionales": "string"
  },
  "commitments": [
    {"texto": "string", "quien": "paciente|terapeuta", "completado": false}
  ],
  "patterns_detected": [
    {"emoji": "string", "es_nuevo": true, "descripcion": "string"}
  ],
  "topics": [
    {
      "label": "string",
      "tipo": "principal|insight|familiar|laboral|clinico",
      "descripcion": "string — máx 100 palabras"
    }
  ],
  "connections_to_prev": {
    "hay_conexion": true,
    "descripcion": "string — cómo conecta esta sesión con la anterior",
    "evolucion": "string — qué cambió o progresó"
  },
  "session_title": "string — título corto descriptivo de la sesión (máx 8 palabras)"
}`;
}

type AnthropicResponse = {
  content?: Array<{ type: string; text: string }>;
  stop_reason?: string;
};

export type SessionAIResult =
  | { ok: true; parsed: Record<string, unknown>; raw: AnthropicResponse }
  | {
      ok: false;
      /** no_key: falta ANTHROPIC_API_KEY · api: el modelo respondió error ·
       *  truncated: la respuesta se cortó por longitud · parse: JSON inválido */
      reason: "no_key" | "api" | "truncated" | "parse";
      message: string;
      raw?: unknown;
    };

async function callClaude(
  key: string,
  prompt: string,
): Promise<{ ok: true; data: AnthropicResponse } | { ok: false; message: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SESSION_AI_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, message: errText.slice(0, 500) };
  }
  return { ok: true, data: (await res.json()) as AnthropicResponse };
}

/** Quita las fences de markdown que el modelo a veces agrega. */
function stripFences(text: string): string {
  return text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
}

/**
 * Corre el análisis clínico sobre una transcripción. No toca la base de datos.
 */
export async function runSessionAI(
  transcript: string,
  history: unknown[],
): Promise<SessionAIResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ok: false, reason: "no_key", message: "ANTHROPIC_API_KEY no configurada" };
  }

  const basePrompt = buildSessionPrompt(transcript, history);
  // Segundo intento: mismo contenido, salida más apretada. Sesiones muy largas
  // pueden generar diez temas de 100 palabras y desbordar cualquier tope.
  const tighterPrompt =
    basePrompt +
    `

IMPORTANTE: tu respuesta anterior se cortó por longitud. Devuelve el MISMO JSON
completo pero más compacto: máximo 5 temas, máximo 5 compromisos, máximo 4
patrones, y respeta estrictamente los límites de palabras de cada campo.`;

  for (const prompt of [basePrompt, tighterPrompt]) {
    const call = await callClaude(key, prompt);
    if (!call.ok) {
      return { ok: false, reason: "api", message: call.message };
    }

    const data = call.data;
    if (data.stop_reason === "max_tokens") {
      continue; // reintenta pidiendo salida compacta
    }

    const rawText = data.content?.[0]?.text ?? "";
    try {
      return { ok: true, parsed: JSON.parse(stripFences(rawText)), raw: data };
    } catch {
      return {
        ok: false,
        reason: "parse",
        message: "El modelo no devolvió JSON válido",
        raw: rawText.slice(0, 500),
      };
    }
  }

  return {
    ok: false,
    reason: "truncated",
    message: `La respuesta del modelo se cortó por longitud incluso con ${MAX_TOKENS} tokens de tope.`,
  };
}

/** Campos de `sessions` que salen del análisis de IA. */
export function sessionFieldsFromAI(parsed: Record<string, unknown>) {
  return {
    session_title:       (parsed.session_title       as string | null) ?? null,
    clinical_summary:    (parsed.clinical_summary    as string | null) ?? null,
    patient_summary:     (parsed.patient_summary     as string | null) ?? null,
    briefing_next:       (parsed.briefing_next       as string | null) ?? null,
    private_notes:       (parsed.private_notes       as string | null) ?? null,
    emotional_state:     (parsed.emotional_state     as object | null) ?? null,
    commitments:         (parsed.commitments         as object[] | null) ?? null,
    patterns_detected:   (parsed.patterns_detected   as object[] | null) ?? null,
    topics:              (parsed.topics              as object[] | null) ?? null,
    connections_to_prev: (parsed.connections_to_prev as object | null) ?? null,
  };
}
