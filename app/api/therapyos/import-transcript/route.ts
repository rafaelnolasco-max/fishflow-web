import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processAndInsertSession } from "@/lib/therapySession";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs";
// El análisis clínico de una sesión larga puede pasar del minuto.
export const maxDuration = 800;

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
  // URL tipo: https://app.fireflies.ai/view/titulo::MEETING_ID
  const colonMatch = trimmed.match(/::([A-Z0-9]{10,})(?:\?|$)/);
  if (colonMatch) return colonMatch[1];
  // URL tipo: https://app.fireflies.ai/view/titulo--MEETING_ID (fallback)
  const dashMatch = trimmed.match(/--([a-zA-Z0-9_-]{10,})(?:\?|$)/);
  if (dashMatch) return dashMatch[1];
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

    // ── 2. Analizar y guardar (lib compartida con record-session) ─────────────
    // Candado: gasta créditos del modelo y escribe notas clínicas.
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
      transcript: transcriptText,
      sessionDate: session_date,
      extraFields: {
        fireflies_meeting_id: meetingId,
        fireflies_title: transcript.title,
      },
      logAction: "fireflies_import",
      logSnapshot: { fireflies_id: meetingId, fireflies_title: transcript.title },
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        session: result.session,
        fireflies_title: transcript.title,
        transcript_chars: transcriptText.length,
        warning: result.warning,
      },
      { status: 201 },
    );

  } catch (err) {
    console.error("import-transcript unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
