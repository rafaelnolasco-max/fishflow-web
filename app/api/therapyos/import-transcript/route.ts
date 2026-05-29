import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── GraphQL query para obtener transcripción de Fireflies ────────────────────
const FIREFLIES_TRANSCRIPT_QUERY = `
  query GetTranscript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      participants
      sentences {
        index
        speaker_name
        raw_text
        start_time
        end_time
      }
    }
  }
`;

// ─── Convertir sentences[] a texto plano ──────────────────────────────────────
function sentencesToText(
  sentences: Array<{ speaker_name: string; raw_text: string }>
): string {
  let current = "";
  let currentSpeaker = "";
  const lines: string[] = [];

  for (const s of sentences) {
    if (s.speaker_name !== currentSpeaker) {
      if (current) lines.push(`${currentSpeaker}: ${current.trim()}`);
      currentSpeaker = s.speaker_name;
      current = s.raw_text + " ";
    } else {
      current += s.raw_text + " ";
    }
  }
  if (current) lines.push(`${currentSpeaker}: ${current.trim()}`);
  return lines.join("\n");
}

// ─── Extraer meeting ID desde URL o ID directo ────────────────────────────────
function parseMeetingId(input: string): string {
  const trimmed = input.trim();
  // URL tipo: https://app.fireflies.ai/view/titulo--MEETING_ID
  const urlMatch = trimmed.match(/--([a-zA-Z0-9_-]{10,})(?:\?|$)/);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { meeting_id_or_url, patient_id, session_date } = body as {
      meeting_id_or_url: string;
      patient_id: string;
      session_date: string;
    };

    if (!meeting_id_or_url || !patient_id || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos: meeting_id_or_url, patient_id, session_date" },
        { status: 400 }
      );
    }

    const apiKey = process.env.FIREFLIES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "FIREFLIES_API_KEY no configurada" },
        { status: 500 }
      );
    }

    // ── 1. Obtener transcripción de Fireflies ──────────────────────────────────
    const meetingId = parseMeetingId(meeting_id_or_url);

    const ffRes = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: FIREFLIES_TRANSCRIPT_QUERY,
        variables: { transcriptId: meetingId },
      }),
    });

    if (!ffRes.ok) {
      const text = await ffRes.text();
      return NextResponse.json(
        { error: "Error al consultar Fireflies API", detail: text },
        { status: 502 }
      );
    }

    const ffData = await ffRes.json() as {
      data?: {
        transcript?: {
          id: string;
          title: string;
          date: number;
          participants: string[];
          sentences: Array<{ speaker_name: string; raw_text: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (ffData.errors?.length) {
      return NextResponse.json(
        { error: "Fireflies GraphQL error", detail: ffData.errors[0].message },
        { status: 422 }
      );
    }

    const transcript = ffData.data?.transcript;
    if (!transcript) {
      return NextResponse.json(
        { error: `No se encontró la reunión con ID: ${meetingId}` },
        { status: 404 }
      );
    }

    if (!transcript.sentences?.length) {
      return NextResponse.json(
        { error: "La reunión existe pero no tiene transcripción aún. Intenta en unos minutos." },
        { status: 422 }
      );
    }

    const transcriptText = sentencesToText(transcript.sentences);

    // ── 2. Obtener patient + client_id ─────────────────────────────────────────
    const { data: patient, error: patientErr } = await supabaseAdmin
      .from("patients")
      .select("id, client_id, full_name")
      .eq("id", patient_id)
      .single();

    if (patientErr || !patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }

    // ── 3. Historial de sesiones anteriores ────────────────────────────────────
    const { data: history } = await supabaseAdmin
      .from("sessions")
      .select("session_number, session_date, session_title, clinical_summary, commitments, patterns_detected, briefing_next")
      .eq("patient_id", patient_id)
      .order("session_date", { ascending: false })
      .limit(3);

    // ── 4. Llamar a Claude ─────────────────────────────────────────────────────
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY no configurada" },
        { status: 500 }
      );
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system:
          "Eres un asistente clínico especializado en documentación psicoterapéutica. " +
          "Procesas transcripciones de sesiones y generas documentación estructurada. " +
          "Responde ÚNICAMENTE con JSON válido, sin markdown, sin explicaciones.",
        messages: [{ role: "user", content: buildClaudePrompt(transcriptText, history ?? []) }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json(
        { error: "Error al llamar a Claude API", detail: errText },
        { status: 502 }
      );
    }

    const claudeData = await claudeRes.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const rawText = claudeData.content?.[0]?.text ?? "";

    // ── 5. Parsear JSON ────────────────────────────────────────────────────────
    let parsed: Record<string, unknown>;
    try {
      const clean = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return NextResponse.json(
        { error: "Claude no devolvió JSON válido", raw: rawText.slice(0, 500) },
        { status: 422 }
      );
    }

    // ── 6. Insertar sesión en Supabase ─────────────────────────────────────────
    const sessionRecord = {
      patient_id,
      client_id: patient.client_id as string,
      session_date,
      session_number: 0,
      transcript: transcriptText,
      fireflies_meeting_id: meetingId,
      fireflies_title: transcript.title,
      raw_summary: claudeData,
      session_title:       parsed.session_title        as string | null ?? null,
      clinical_summary:    parsed.clinical_summary     as string | null ?? null,
      patient_summary:     parsed.patient_summary      as string | null ?? null,
      briefing_next:       parsed.briefing_next        as string | null ?? null,
      private_notes:       parsed.private_notes        as string | null ?? null,
      emotional_state:     parsed.emotional_state      as object | null ?? null,
      commitments:         parsed.commitments          as object[] | null ?? null,
      patterns_detected:   parsed.patterns_detected    as object[] | null ?? null,
      topics:              parsed.topics               as object[] | null ?? null,
      connections_to_prev: parsed.connections_to_prev  as object | null ?? null,
      ai_processed: true,
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("sessions")
      .insert(sessionRecord)
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: "Error al guardar sesión", detail: insertErr.message },
        { status: 500 }
      );
    }

    // ── 7. Log de auditoría ────────────────────────────────────────────────────
    await supabaseAdmin.from("session_log").insert({
      session_id: inserted.id,
      action:     "fireflies_import",
      snapshot:   {
        model:           "claude-sonnet-4-6",
        patient_name:    patient.full_name,
        fireflies_id:    meetingId,
        fireflies_title: transcript.title,
      },
    });

    return NextResponse.json(
      { session: inserted, fireflies_title: transcript.title, transcript_chars: transcriptText.length },
      { status: 201 }
    );

  } catch (err) {
    console.error("import-transcript unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// ─── Prompt clínico (mismo que process-session) ───────────────────────────────
function buildClaudePrompt(transcript: string, history: unknown[]): string {
  return `Transcripción de sesión:
${transcript}

Historial de sesiones anteriores del paciente (últimas 3):
${JSON.stringify(history, null, 2)}

Genera un JSON con exactamente estas claves:
{
  "clinical_summary": "string — resumen técnico para el terapeuta, máx 300 palabras",
  "patient_summary": "string — resumen cálido para el paciente, máx 150 palabras, tono empático, sin jerga clínica",
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
