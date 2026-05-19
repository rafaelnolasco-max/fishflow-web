import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin client — bypasses RLS, usa service role key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Prompt de procesamiento clínico ──────────────────────────────────────────
function buildPrompt(transcript: string, history: unknown[]): string {
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

export async function POST(req: NextRequest) {
  try {
    // ── 1. Validar body ────────────────────────────────────────────────────────
    const body = await req.json();
    const { patient_id, transcript, session_date } = body as {
      patient_id: string;
      transcript: string;
      session_date: string;
    };

    if (!patient_id || !transcript?.trim() || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, transcript, session_date" },
        { status: 400 }
      );
    }

    // ── 2. Obtener patient + client_id ─────────────────────────────────────────
    const { data: patient, error: patientErr } = await supabaseAdmin
      .from("patients")
      .select("id, client_id, full_name")
      .eq("id", patient_id)
      .single();

    if (patientErr || !patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }

    // ── 3. Historial de últimas 3 sesiones ─────────────────────────────────────
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
        { error: "ANTHROPIC_API_KEY no configurada en variables de entorno" },
        { status: 500 }
      );
    }

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [
          {
            role: "user",
            content: buildPrompt(transcript, history ?? []),
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", errText);
      return NextResponse.json(
        { error: "Error al llamar a Claude API", detail: errText },
        { status: 502 }
      );
    }

    const claudeData = await claudeResponse.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const rawText = claudeData.content?.[0]?.text ?? "";

    // ── 5. Parsear JSON de Claude ──────────────────────────────────────────────
    let parsed: Record<string, unknown>;
    try {
      // Claude a veces incluye markdown fences — las removemos
      const clean = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("JSON parse error. Claude responded:", rawText.slice(0, 500));
      return NextResponse.json(
        { error: "Claude no devolvió JSON válido", raw: rawText.slice(0, 500) },
        { status: 422 }
      );
    }

    // ── 6. Construir registro de sesión ────────────────────────────────────────
    const sessionRecord = {
      patient_id,
      client_id: patient.client_id as string,
      session_date,
      session_number: 0,     // trigger SQL lo calcula automáticamente
      transcript,
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

    // ── 7. Insertar en Supabase ────────────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("sessions")
      .insert(sessionRecord)
      .select()
      .single();

    if (insertErr) {
      console.error("Supabase insert error:", insertErr);
      return NextResponse.json(
        { error: "Error al guardar sesión", detail: insertErr.message },
        { status: 500 }
      );
    }

    // ── 8. Log de auditoría ───────────────────────────────────────────────────
    await supabaseAdmin.from("session_log").insert({
      session_id:  inserted.id,
      action:      "ai_processed",
      snapshot:    { model: "claude-sonnet-4-6", patient_name: patient.full_name },
    });

    return NextResponse.json({ session: inserted }, { status: 201 });

  } catch (err) {
    console.error("process-session unexpected error:", err);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
