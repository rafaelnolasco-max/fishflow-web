import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// HireFlow — summarize-interview (IA)
// ════════════════════════════════════════════════════════════════════════════
// Recibe la transcripción de una ronda de entrevista (de Fireflies o pegada a
// mano) → Claude Sonnet genera el resumen para RH + fortalezas/debilidades +
// recomendación + score → inserta/actualiza la ronda en hiring_interviews.
// Es la pieza que conecta Fireflies con el pipeline de HireFlow.

export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const HIRING_MODEL = "claude-sonnet-4-6";

function buildPrompt(ctx: {
  title: string; requirements: string | null; candidateName: string;
  stageName: string; interviewerRole: string | null; transcript: string;
}): string {
  return `Vacante: ${ctx.title}
${ctx.requirements ? `Requisitos: ${ctx.requirements}` : ""}
Candidato: ${ctx.candidateName}
Ronda: ${ctx.stageName}${ctx.interviewerRole ? ` (entrevistador: ${ctx.interviewerRole})` : ""}

Transcripción de la entrevista:
${ctx.transcript}

Resume esta ronda para el equipo de Recursos Humanos y genera un JSON con EXACTAMENTE estas claves:
{
  "ai_summary": "string — 2-4 frases: qué se evaluó, cómo respondió el candidato y la conclusión de la ronda. Claro y accionable para RH.",
  "fortalezas": ["string"],     // 1-3 fortalezas mostradas en esta entrevista
  "debilidades": ["string"],    // 0-3 debilidades o dudas surgidas
  "recomendacion": "advance" | "hold" | "reject",  // recomendación para esta ronda
  "score": number               // 0 a 10, desempeño global en esta ronda
}

Reglas: básate ÚNICAMENTE en la transcripción; no inventes. Si la transcripción es parcial, sé prudente. Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      application_id?: string; interview_id?: string;
      stage_order?: number; stage_name?: string;
      interviewer_name?: string; interviewer_role?: string;
      source_type?: string; scheduled_at?: string; transcript?: string;
    };
    const { application_id, interview_id, transcript } = body;

    if (!application_id || !transcript?.trim()) {
      return NextResponse.json({ error: "Faltan campos: application_id, transcript" }, { status: 400 });
    }

    // ── 1. Postulación + candidato + vacante ──────────────────────────────────
    const { data: app, error: aErr } = await supabaseAdmin
      .from("hiring_applications")
      .select("id, client_id, candidate:hiring_candidates(full_name), position:hiring_positions(title, requirements)")
      .eq("id", application_id)
      .single();

    if (aErr || !app) {
      return NextResponse.json({ error: "Postulación no encontrada" }, { status: 404 });
    }
    const cand = Array.isArray(app.candidate) ? app.candidate[0] : app.candidate;
    const pos = Array.isArray(app.position) ? app.position[0] : app.position;
    if (!pos) {
      return NextResponse.json({ error: "La postulación no tiene vacante asociada" }, { status: 422 });
    }

    // Orden de ronda: el dado, o el siguiente disponible
    let stageOrder = body.stage_order;
    if (stageOrder == null) {
      const { count } = await supabaseAdmin
        .from("hiring_interviews")
        .select("id", { count: "exact", head: true })
        .eq("application_id", application_id);
      stageOrder = (count ?? 0) + 1;
    }
    const stageName = body.stage_name ?? `Ronda ${stageOrder}`;

    // ── 2. Claude Sonnet ──────────────────────────────────────────────────────
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HIRING_MODEL,
        max_tokens: 1200,
        system:
          "Eres un reclutador que documenta entrevistas y redacta resúmenes claros y objetivos para el equipo de RH. " +
          "Respondes ÚNICAMENTE con JSON válido, sin markdown.",
        messages: [{ role: "user", content: buildPrompt({
          title: pos.title, requirements: pos.requirements,
          candidateName: cand?.full_name ?? "Candidato",
          stageName, interviewerRole: body.interviewer_role ?? null, transcript,
        }) }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", errText);
      return NextResponse.json({ error: "Error al llamar a Claude API", detail: errText }, { status: 502 });
    }

    const claudeData = (await claudeResponse.json()) as { content: Array<{ type: string; text: string }> };
    const rawText = claudeData.content?.[0]?.text ?? "";

    let parsed: Record<string, unknown>;
    try {
      const clean = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("JSON parse error. Claude respondió:", rawText.slice(0, 500));
      return NextResponse.json({ error: "Claude no devolvió JSON válido", raw: rawText.slice(0, 500) }, { status: 422 });
    }

    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(10, Math.round(rawScore * 10) / 10)) : null;
    const recRaw = typeof parsed.recommendation === "string" ? parsed.recommendation : null;
    const recommendation = recRaw && ["advance", "hold", "reject"].includes(recRaw) ? recRaw : null;
    const rawSummary = {
      fortalezas: Array.isArray(parsed.fortalezas) ? parsed.fortalezas : [],
      debilidades: Array.isArray(parsed.debilidades) ? parsed.debilidades : [],
      recomendacion: recommendation,
    };

    const record = {
      client_id: app.client_id as string,
      application_id,
      stage_order: stageOrder,
      stage_name: stageName,
      interviewer_name: body.interviewer_name ?? null,
      interviewer_role: body.interviewer_role ?? null,
      scheduled_at: body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null,
      completed_at: new Date().toISOString(),
      status: "completed" as const,
      source_type: body.source_type ?? "fireflies",
      transcript,
      ai_summary: (parsed.ai_summary as string) ?? null,
      raw_summary: rawSummary,
      ai_processed: true,
      score,
      recommendation,
    };

    // ── 3. Insert o update de la ronda ────────────────────────────────────────
    let interview;
    if (interview_id) {
      const { data, error } = await supabaseAdmin
        .from("hiring_interviews").update(record).eq("id", interview_id).select().single();
      if (error) { console.error("update interview error:", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
      interview = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("hiring_interviews").insert(record).select().single();
      if (error) { console.error("insert interview error:", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
      interview = data;
    }

    // ── 4. Avanzar la postulación ─────────────────────────────────────────────
    await supabaseAdmin
      .from("hiring_applications")
      .update({ status: "interviewing", current_stage: stageOrder })
      .eq("id", application_id)
      .in("status", ["new", "screening", "interviewing"]);

    return NextResponse.json({ interview }, { status: 200 });
  } catch (err) {
    console.error("hireflow/summarize-interview error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
