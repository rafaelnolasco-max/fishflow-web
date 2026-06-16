import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// HireFlow — match (IA)
// ════════════════════════════════════════════════════════════════════════════
// Recibe application_id → carga el CV del candidato y los requisitos de la vacante
// → Claude Sonnet evalúa el encaje → guarda match_score / match_summary /
// match_details (cumple/parcial/falta) en hiring_applications.
// Human-in-the-loop: RH revisa; el score es un apoyo, no una decisión.

export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const HIRING_MODEL = "claude-sonnet-4-6";

type ReqStruct = { must_have?: string[]; nice_to_have?: string[]; min_years?: number } | null;

function buildPrompt(ctx: {
  title: string; description: string | null; requirements: string | null;
  reqStruct: ReqStruct; candidateName: string; cvText: string;
}): string {
  const struct = ctx.reqStruct
    ? `Requisitos estructurados:
- Indispensables: ${(ctx.reqStruct.must_have ?? []).join("; ") || "—"}
- Deseables: ${(ctx.reqStruct.nice_to_have ?? []).join("; ") || "—"}
- Años mínimos de experiencia: ${ctx.reqStruct.min_years ?? "—"}`
    : "";

  return `Vacante: ${ctx.title}
${ctx.description ? `Descripción: ${ctx.description}` : ""}
${ctx.requirements ? `Requisitos (texto): ${ctx.requirements}` : ""}
${struct}

Candidato: ${ctx.candidateName}
Contenido del CV:
${ctx.cvText}

Evalúa qué tan bien encaja el candidato con la vacante y genera un JSON con EXACTAMENTE estas claves:
{
  "match_score": number,         // 0 a 100, entero. Pondera más los requisitos indispensables.
  "match_summary": "string",     // 1-2 frases claras sobre el encaje y el principal riesgo
  "cumple":  ["string"],         // requisitos que cumple claramente
  "parcial": ["string"],         // requisitos que cumple de forma parcial o no comprobada
  "falta":   ["string"]          // requisitos clave que NO cumple
}

Reglas: básate ÚNICAMENTE en el CV y los requisitos dados; no inventes experiencia que no aparezca. Si el CV es muy breve, sé conservador con el score. Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.`;
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
      .select("id, client_id, candidate:hiring_candidates(full_name, cv_text), position:hiring_positions(title, description, requirements, requirements_struct)")
      .eq("id", application_id)
      .single();

    if (aErr || !app) {
      return NextResponse.json({ error: "Postulación no encontrada" }, { status: 404 });
    }

    const cand = Array.isArray(app.candidate) ? app.candidate[0] : app.candidate;
    const pos = Array.isArray(app.position) ? app.position[0] : app.position;
    if (!cand?.cv_text?.trim()) {
      return NextResponse.json({ error: "El candidato no tiene texto de CV para analizar" }, { status: 422 });
    }
    if (!pos) {
      return NextResponse.json({ error: "La postulación no tiene vacante asociada" }, { status: 422 });
    }

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
          "Eres un reclutador técnico que evalúa con objetividad qué tan bien encaja un candidato " +
          "con una vacante. Respondes ÚNICAMENTE con JSON válido, sin markdown.",
        messages: [{ role: "user", content: buildPrompt({
          title: pos.title, description: pos.description, requirements: pos.requirements,
          reqStruct: (pos.requirements_struct ?? null) as ReqStruct,
          candidateName: cand.full_name, cvText: cand.cv_text,
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

    const rawScore = Number(parsed.match_score);
    const matchScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
    const matchDetails = {
      cumple: Array.isArray(parsed.cumple) ? parsed.cumple : [],
      parcial: Array.isArray(parsed.parcial) ? parsed.parcial : [],
      falta: Array.isArray(parsed.falta) ? parsed.falta : [],
    };

    // ── 3. Guardar en la postulación ──────────────────────────────────────────
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("hiring_applications")
      .update({
        match_score: matchScore,
        match_summary: (parsed.match_summary as string) ?? null,
        match_details: matchDetails,
        status: "screening",
      })
      .eq("id", application_id)
      .select()
      .single();

    if (uErr) {
      console.error("update application error:", uErr);
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ application: updated }, { status: 200 });
  } catch (err) {
    console.error("hireflow/match error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
