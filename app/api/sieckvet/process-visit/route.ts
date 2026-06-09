import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// SieckVet — process-visit
// ════════════════════════════════════════════════════════════════════════════
// Recibe la transcripción/notas de una consulta veterinaria → Claude Sonnet
// genera el resumen estructurado + el mensaje para el dueño → guarda un BORRADOR
// en vet_visit_summaries (ai_processed=true, approved_at=null).
// NO envía nada al dueño. El vet revisa/edita/aprueba antes (human-in-the-loop).
// El envío (email/link) es la Fase 4.

export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Modelo configurable — Sonnet para el demo (calidad), bajar a Haiku al escalar.
const VET_MODEL = "claude-sonnet-4-6";

function buildPrompt(ctx: {
  petName: string; species: string; breed: string | null;
  ownerName: string; vetName: string | null; reason: string | null; transcript: string;
}): string {
  return `Datos de la consulta veterinaria:
- Mascota: ${ctx.petName} (${ctx.species}${ctx.breed ? `, ${ctx.breed}` : ""})
- Dueño: ${ctx.ownerName}
- Veterinario: ${ctx.vetName ?? "no especificado"}
- Motivo registrado: ${ctx.reason ?? "no especificado"}

Notas / transcripción de la consulta:
${ctx.transcript}

Genera un JSON con EXACTAMENTE estas claves:
{
  "motivo": "string — motivo de la consulta en una frase clara",
  "diagnostico": "string — diagnóstico u observaciones del veterinario, lenguaje claro para el dueño, sin jerga excesiva",
  "indicaciones": "string — tratamiento e indicaciones para casa, concretas y accionables",
  "proxima_cita": "string — recomendación de próxima cita o seguimiento (o 'No se requiere seguimiento' si aplica)",
  "owner_summary": "string — mensaje cálido dirigido al dueño en segunda persona. Empieza con 'Hola ${ctx.ownerName}, aquí el resumen de la consulta de ${ctx.petName}${ctx.vetName ? ` con ${ctx.vetName}` : ""}:' y luego, en líneas separadas con estos emojis: '🔍 Motivo: ...', '💊 Observaciones: ...', '📋 Indicaciones: ...', '📅 Próxima cita recomendada: ...'. Tono humano y tranquilizador."
}

Reglas: usa solo la información de las notas; no inventes diagnósticos ni medicamentos que no aparezcan. Si algo no está claro, escríbelo de forma general. Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones.`;
}

export async function POST(req: NextRequest) {
  try {
    const { appointment_id, transcript, source_type } = (await req.json()) as {
      appointment_id: string;
      transcript: string;
      source_type?: string;
    };

    if (!appointment_id || !transcript?.trim()) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: appointment_id, transcript" },
        { status: 400 },
      );
    }

    // ── 1. Cita + mascota + vet ─────────────────────────────────────────────────
    const { data: appt, error: aErr } = await supabaseAdmin
      .from("vet_appointments")
      .select("id, client_id, reason, pet:vet_pets(name, species, breed, owner_name), vet:vet_vets(name)")
      .eq("id", appointment_id)
      .single();

    if (aErr || !appt) {
      return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    }

    // Supabase devuelve los joins como objeto o arreglo según la relación; normalizamos.
    const pet = Array.isArray(appt.pet) ? appt.pet[0] : appt.pet;
    const vet = Array.isArray(appt.vet) ? appt.vet[0] : appt.vet;
    if (!pet) {
      return NextResponse.json({ error: "La cita no tiene mascota asociada" }, { status: 422 });
    }

    // ── 2. Claude Sonnet ────────────────────────────────────────────────────────
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
        model: VET_MODEL,
        max_tokens: 1500,
        system:
          "Eres un asistente veterinario que documenta consultas clínicas y redacta resúmenes " +
          "claros para los dueños de las mascotas. Respondes ÚNICAMENTE con JSON válido, sin markdown.",
        messages: [{ role: "user", content: buildPrompt({
          petName: pet.name, species: pet.species, breed: pet.breed,
          ownerName: pet.owner_name, vetName: vet?.name ?? null,
          reason: appt.reason, transcript,
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

    const rawSummary = {
      motivo: (parsed.motivo as string) ?? null,
      diagnostico: (parsed.diagnostico as string) ?? null,
      indicaciones: (parsed.indicaciones as string) ?? null,
      proxima_cita: (parsed.proxima_cita as string) ?? null,
    };
    const ownerSummary = (parsed.owner_summary as string) ?? null;

    // ── 3. Upsert del borrador (1 resumen por cita) ────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from("vet_visit_summaries")
      .select("id")
      .eq("appointment_id", appointment_id)
      .maybeSingle();

    const draft = {
      client_id: appt.client_id as string,
      appointment_id,
      source_type: source_type ?? "manual",
      transcript,
      raw_summary: rawSummary,
      owner_summary: ownerSummary,
      ai_processed: true,
      approved_at: null,   // regenerar resetea la aprobación (cambió el contenido)
      sent_at: null,
    };

    let summary;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("vet_visit_summaries").update(draft).eq("id", existing.id).select().single();
      if (error) { console.error("update summary error:", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
      summary = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("vet_visit_summaries").insert(draft).select().single();
      if (error) { console.error("insert summary error:", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
      summary = data;
    }

    // ── 4. Marcar la consulta como completada ──────────────────────────────────
    await supabaseAdmin
      .from("vet_appointments")
      .update({ status: "completed" })
      .eq("id", appointment_id);

    return NextResponse.json({ summary }, { status: 201 });
  } catch (err) {
    console.error("process-visit error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
