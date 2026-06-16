import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// HireFlow — verdict (IA)
// ════════════════════════════════════════════════════════════════════════════
// Recibe application_id → carga el CV + el análisis de match + TODAS las rondas
// de entrevista (con sus resúmenes y recomendaciones) → Claude Sonnet sintetiza
// el proceso completo y emite un veredicto de contratación → guarda
// final_verdict / final_verdict_details en hiring_applications.
// Human-in-the-loop: RH revisa/edita; la decisión final es de RH.

export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const HIRING_MODEL = "claude-sonnet-4-6";

type IvRow = {
  stage_order: number | null; stage_name: string | null;
  interviewer_name: string | null; interviewer_role: string | null;
  status: string; score: number | null; recommendation: string | null;
  ai_summary: string | null;
};

function buildPrompt(ctx: {
  title: string; requirements: string | null; candidateName: string;
  cvText: string | null; matchScore: number | null; matchSummary: string | null;
  interviews: IvRow[];
}): string {
  const rounds = ctx.interviews
    .filter((iv) => iv.status === "completed")
    .sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0))
    .map((iv, i) => `Ronda ${iv.stage_order ?? i + 1} — ${iv.stage_name ?? "Entrevista"} (${iv.interviewer_role ?? iv.interviewer_name ?? "entrevistador"}):
  Score: ${iv.score ?? "—"}/10 · Recomendación: ${iv.recommendation ?? "—"}
  Resumen: ${iv.ai_summary ?? "sin resumen"}`)
    .join("\n\n");

  return `Vacante: ${ctx.title}
${ctx.requirements ? `Requisitos: ${ctx.requirements}` : ""}

Candidato: ${ctx.candidateName}
Match del CV: ${ctx.matchScore ?? "—"}/100${ctx.matchSummary ? ` — ${ctx.matchSummary}` : ""}
${ctx.cvText ? `CV: ${ctx.cvText}` : ""}

Entrevistas realizadas (en orden):
${rounds || "Aún no hay entrevistas completadas."}

Sintetiza TODO el proceso (CV + cada ronda) y emite un veredicto de contratación para el equipo. Conecta la evidencia entre rondas (consistencia, evolución, banderas rojas). Genera un JSON con EXACTAMENTE estas claves:
{
  "final_verdict": "string — 1 párrafo: recomendación clara (extender oferta / mantener en proceso / descartar) fundamentada en el CV y las rondas, mencionando cómo se conectan",
  "fortalezas": ["string"],   // 2-4 fortalezas observadas a lo largo del proceso
  "riesgos":    ["string"]    // 1-3 riesgos o puntos a validar
}

Reglas: básate ÚNICAMENTE en la información dada; no inventes. Si faltan rondas, dilo y sé prudente. Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.`;
}

export async function POST(req: NextRequest) {
  try {
    const { application_id } = (await req.json()) as { application_id?: string };
    if (!application_id) {
      return NextResponse.json({ error: "Falta application_id" }, { status: 400 });
    }

    // ── 1. Postulación + candidato + vacante ──────────────────────────────────
    const { data: app, error: aErr } = await supabaseAdmin
      .from("hiring_applications")
      .select("id, client_id, match_score, match_summary, candidate:hiring_candidates(full_name, cv_text), position:hiring_positions(title, requirements)")
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

    // ── 2. Entrevistas ────────────────────────────────────────────────────────
    const { data: ivs } = await supabaseAdmin
      .from("hiring_interviews")
      .select("stage_order, stage_name, interviewer_name, interviewer_role, status, score, recommendation, ai_summary")
      .eq("application_id", application_id)
      .order("stage_order", { ascending: true });

    const interviews = (ivs ?? []) as IvRow[];
    if (!interviews.some((iv) => iv.status === "completed")) {
      return NextResponse.json({ error: "No hay entrevistas completadas para sintetizar" }, { status: 422 });
    }

    // ── 3. Claude Sonnet ──────────────────────────────────────────────────────
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
        max_tokens: 1500,
        system:
          "Eres un reclutador senior que sintetiza el proceso completo de entrevistas de un candidato " +
          "y emite una recomendación de contratación accionable para el equipo. Respondes ÚNICAMENTE con JSON válido, sin markdown.",
        messages: [{ role: "user", content: buildPrompt({
          title: pos.title, requirements: pos.requirements,
          candidateName: cand?.full_name ?? "Candidato", cvText: cand?.cv_text ?? null,
          matchScore: (app.match_score as number) ?? null, matchSummary: (app.match_summary as string) ?? null,
          interviews,
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

    const details = {
      fortalezas: Array.isArray(parsed.fortalezas) ? parsed.fortalezas : [],
      riesgos: Array.isArray(parsed.riesgos) ? parsed.riesgos : [],
    };

    // ── 4. Guardar veredicto ──────────────────────────────────────────────────
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("hiring_applications")
      .update({
        final_verdict: (parsed.final_verdict as string) ?? null,
        final_verdict_details: details,
        status: "finalist",
        decided_at: new Date().toISOString(),
      })
      .eq("id", application_id)
      .select()
      .single();

    if (uErr) {
      console.error("update verdict error:", uErr);
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ application: updated }, { status: 200 });
  } catch (err) {
    console.error("hireflow/verdict error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
