// FishFlow / Trufa — nota de consulta veterinaria para el DUEÑO
// ─────────────────────────────────────────────────────────────────────────────
// Prima hermana de lib/notaClinica.ts, pero con otro trabajo. Aquella redacta
// un documento clínico conforme a la NOM-004, escrito por el médico. Esta parte
// de una grabación que hizo el DUEÑO con su teléfono, del otro lado del
// escritorio, y produce lo que él necesita recordar el martes en la noche:
// qué le dijeron, qué tiene que darle, cada cuándo y hasta cuándo.
//
// Por eso NO es un expediente y no debe parecerlo. Dos reglas cargan el peso:
//
//   1. Nunca inventar una dosis. Es lo único aquí que puede lastimar al animal.
//      Si el audio no la deja clara, el campo se marca como "no se entendió" y
//      sube a `preguntas`, que es justo lo que el dueño debe volver a preguntar.
//   2. Nada de diagnósticos nuevos. El modelo reporta lo que dijo el médico;
//      no concluye por su cuenta ni agrega padecimientos que no se oyeron.

export const NOTA_VET_MODEL = "claude-sonnet-4-6";

/** Un pendiente concreto que el dueño tiene que ejecutar en casa. */
export interface IndicacionVet {
  /** Qué hay que hacer. "Dar Cytopoint", "Bañar con shampoo medicado". */
  que: string;
  /** Medicamento o producto, si se nombró. */
  producto: string | null;
  /** Dosis tal como se escuchó. `null` si no quedó clara — NUNCA se estima. */
  dosis: string | null;
  /** "cada 12 horas", "una vez al mes". `null` si no se dijo. */
  frecuencia: string | null;
  /** "por 7 días", "hasta la siguiente cita". `null` si no se dijo. */
  duracion: string | null;
}

export interface NotaVeterinaria {
  motivo: string | null;
  /** Lo que observó o dijo el veterinario. Reporte, no conclusión propia. */
  hallazgos: string | null;
  indicaciones: IndicacionVet[];
  /** Fecha o plazo del seguimiento, en las palabras que se usaron. */
  proxima_cita: string | null;
  /** Lo que quedó a medias en el audio y conviene volver a preguntar. */
  preguntas: string[];
  /** El resumen en segunda persona que ve el dueño en la app. */
  resumen: string | null;
}

export const NOTA_VET_SYSTEM_PROMPT =
  "Eres un asistente que ayuda a dueños de mascotas a no olvidar lo que les dijo el veterinario. " +
  "Trabajas sobre la grabación que el dueño hizo durante la consulta, así que el audio es imperfecto: " +
  "hay ruido, el médico se aleja del micrófono y a veces habla otra persona. " +
  "Reportas lo que se dijo; no diagnosticas, no corriges al veterinario y no completas lo que falta. " +
  "Respondes ÚNICAMENTE con JSON válido, sin markdown.";

export function buildNotaVetPrompt(input: {
  petName: string;
  species: string;
  breed: string | null;
  ownerName: string;
  padecimientos: string[];
  motivo: string | null;
  transcript: string;
}): string {
  const contexto = input.padecimientos.length
    ? `- Padecimientos ya registrados en su carnet: ${input.padecimientos.join(", ")}`
    : "- Sin padecimientos registrados en su carnet";

  return `Grabación de una consulta veterinaria, hecha por el dueño con su teléfono.

- Mascota: ${input.petName} (${input.species}${input.breed ? `, ${input.breed}` : ""})
- Dueño: ${input.ownerName}
${contexto}
- Motivo que anotó el dueño: ${input.motivo ?? "no especificado"}

Transcripción:
${input.transcript}

Devuelve un JSON con EXACTAMENTE estas claves:
{
  "motivo": "string|null — por qué fueron, en una frase",
  "hallazgos": "string|null — lo que dijo u observó el veterinario, en lenguaje claro, sin jerga",
  "indicaciones": [
    {
      "que": "string — la acción concreta",
      "producto": "string|null",
      "dosis": "string|null",
      "frecuencia": "string|null",
      "duracion": "string|null"
    }
  ],
  "proxima_cita": "string|null — cuándo regresar, con las palabras que se usaron",
  "preguntas": ["string — algo que quedó confuso en el audio y conviene volver a preguntar"],
  "resumen": "string — dirigido a ${input.ownerName} en segunda persona, cálido y breve, empezando por lo que tiene que hacer"
}

Reglas, en orden de importancia:

1. NUNCA inventes una dosis, una frecuencia ni una duración. Si no se escucha con claridad, pon null en ese campo y agrega la pregunta correspondiente a "preguntas" (por ejemplo: "No se entendió cada cuántas horas dar el antibiótico"). Un número inventado aquí puede dañar al animal: es preferible un null honesto.
2. No agregues diagnósticos, padecimientos ni medicamentos que no aparezcan en la transcripción, aunque encajen con los padecimientos del carnet.
3. Si la grabación está demasiado incompleta para sacar algo útil, deja "hallazgos" en null, "indicaciones" en [] y explica en "resumen" que el audio no alcanzó.
4. No escribas que esto es un documento clínico ni lo redactes como expediente: es la memoria del dueño.

Responde ÚNICAMENTE con JSON válido.`;
}

/** Parsea la respuesta del modelo. Devuelve null si no es utilizable. */
export function parseNotaVet(raw: string): NotaVeterinaria | null {
  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const p = JSON.parse(clean) as Record<string, unknown>;

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const indicaciones: IndicacionVet[] = Array.isArray(p.indicaciones)
      ? (p.indicaciones as Record<string, unknown>[])
          .filter((i) => i && typeof i === "object" && str(i.que))
          .map((i) => ({
            que: str(i.que) as string,
            producto: str(i.producto),
            dosis: str(i.dosis),
            frecuencia: str(i.frecuencia),
            duracion: str(i.duracion),
          }))
      : [];

    const preguntas: string[] = Array.isArray(p.preguntas)
      ? (p.preguntas as unknown[]).map(str).filter((q): q is string => !!q)
      : [];

    return {
      motivo: str(p.motivo),
      hallazgos: str(p.hallazgos),
      indicaciones,
      proxima_cita: str(p.proxima_cita),
      preguntas,
      resumen: str(p.resumen),
    };
  } catch {
    return null;
  }
}

/**
 * Whisper alucina créditos de subtítulos cuando el audio es silencio. Mismo
 * guardia que TherapyOS y SieckVet: sin esto se genera una nota fantasma sobre
 * una consulta que nunca se grabó.
 */
const PATRONES_ALUCINACION = [
  /amara\.org/i,
  /subt[íi]tulos?\s+(realizados|por|hechos|creados)/i,
  /gracias por ver/i,
  /thanks for watching/i,
  /subscribe/i,
  /www\.[a-z]/i,
];

export function transcripcionVacia(t: string): boolean {
  const clean = (t ?? "").trim();
  if (clean.length < 20) return true;
  if (clean.length < 140 && PATRONES_ALUCINACION.some((re) => re.test(clean))) return true;
  let stripped = clean;
  for (const re of PATRONES_ALUCINACION) stripped = stripped.replace(re, "");
  if (stripped.replace(/[^a-záéíóúñ0-9]/gi, "").length < 15) return true;
  return false;
}
