// FishFlow — Therapy Flow · prompt del paciente
// ─────────────────────────────────────────────────────────────────────────────
// NO es el prompt de TherapyOS. El de allá le pide al modelo escribir "como si
// fueras el terapeuta hablándole al paciente" y firmarlo a su nombre: aquí eso
// sería suplantar a un profesional que ni sabe que existimos.
//
// Reglas duras de este prompt:
//   • Voz neutra en segunda persona. Nunca "tu terapeuta piensa que…".
//   • La lectura técnica se escribe en lenguaje de hipótesis, nunca de
//     diagnóstico. Prohibido nombrar trastornos, etiquetas DSM/CIE o sugerir
//     medicación: no hay clínico en el circuito.
//   • Si aparece riesgo (ideación suicida, autolesión, violencia, consumo de
//     riesgo) se marca en risk_flags para que la UI muestre contención.

export type TherapyFlowHistory = {
  session_number?: number;
  session_date?: string;
  session_title?: string | null;
  clinical_read?: string | null;
  commitments?: unknown;
  patterns_detected?: unknown;
  session_prep?: string | null;
};

export const THERAPY_FLOW_SYSTEM =
  "Eres un asistente que ayuda a una persona a entender su propio proceso de terapia. " +
  "No eres su terapeuta, no lo sustituyes y no emites diagnósticos. " +
  "Escribes en español de México, con calidez y sin jerga innecesaria. " +
  "Responde ÚNICAMENTE con JSON válido, sin markdown, sin explicaciones.";

export function buildTherapyFlowPrompt(
  transcript: string,
  history: TherapyFlowHistory[],
): string {
  return `Esta es la transcripción de una sesión de terapia, grabada por el propio paciente para uso personal. El paciente es quien va a leer lo que escribas.

Transcripción:
${transcript}

Sus sesiones anteriores (las últimas 3, para dar continuidad):
${JSON.stringify(history, null, 2)}

Genera un JSON con exactamente estas claves:
{
  "session_title": "string — título corto y humano de la sesión, máx 8 palabras",

  "patient_summary": "string — máx 180 palabras. Qué trabajaste hoy, dirigido a la persona de 'tú', en voz neutra y cálida. NO hables en nombre del terapeuta: nada de 'tu terapeuta piensa', 'te dije' ni 'te propuse'. Lo que dijo el terapeuta se refiere como 'en la sesión se habló de' o 'salió el tema de'. Describe, no interpretes de más.",

  "clinical_read": "string — máx 200 palabras. La lectura técnica de la sesión, traducida para que la entienda quien no es clínico: qué patrón se observa, con qué se conecta, qué valdría la pena mirar. ESCRIBE EN LENGUAJE DE HIPÓTESIS ('parece que', 'podría estar relacionado con', 'llama la atención que'). PROHIBIDO: nombrar trastornos o cuadros clínicos, usar etiquetas de DSM o CIE, decir que la persona 'tiene' algo, sugerir medicación o afirmar causas con certeza. Si no hay material suficiente para una lectura, dilo con honestidad en una línea en vez de inventar.",

  "session_prep": "string — máx 120 palabras. Tres cosas concretas que valdría la pena llevar a la próxima sesión, en formato de lista con guiones. Preguntas abiertas o temas que quedaron colgando, no tareas asignadas.",

  "emotional_state": {
    "animo": "Alto|Medio|Bajo",
    "ansiedad": "Alta|Moderada|Baja",
    "energia_vital": "Alta|Media|Baja",
    "apertura": "Alta|Media|Baja",
    "notas_emocionales": "string — una o dos frases sobre el tono emocional de la sesión"
  },

  "commitments": [
    {"texto": "string — algo que la persona dijo que iba a hacer o intentar", "quien": "paciente", "completado": false}
  ],

  "patterns_detected": [
    {"emoji": "string", "es_nuevo": true, "descripcion": "string — patrón que se repite o que aparece por primera vez"}
  ],

  "topics": [
    {"label": "string", "tipo": "principal|insight|familiar|laboral|relacional", "descripcion": "string — máx 80 palabras"}
  ],

  "connections_to_prev": {
    "hay_conexion": true,
    "descripcion": "string — cómo conecta esta sesión con las anteriores",
    "evolucion": "string — qué cambió o avanzó"
  },

  "risk_flags": [
    {"tipo": "ideacion_suicida|autolesion|violencia_recibida|violencia_ejercida|consumo_riesgo", "evidencia": "string — la frase o el momento concreto de la sesión que lo sugiere"}
  ]
}

Sobre risk_flags: déjalo como arreglo vacío si no hay nada. No lo llenes por precaución ni por interpretación amplia — solo cuando en la transcripción haya algo concreto. Cuando sí lo llenes, escribe patient_summary y clinical_read con especial cuidado: sin dramatizar, sin alarmar y sin analizar el riesgo, porque nadie con formación clínica va a revisar ese texto antes de que la persona lo lea.`;
}
