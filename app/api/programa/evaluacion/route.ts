// FishFlow — Motor de Programas · aplicar la evaluación dentro del programa
// ─────────────────────────────────────────────────────────────────────────────
// El mismo instrumento del sitio público, pero aplicado VARIAS veces a lo largo
// del proceso. Eso es lo que convierte una foto en una película: sin `milestone`
// la evaluación es un lead magnet; con él, es la gráfica de antes/después.
//
// El `milestone` lo decide el SERVIDOR a partir del paso en que va la persona,
// no el navegador: si el cliente pudiera mandarlo, una recarga podría inventar
// un "cierre" a media proceso y ensuciar la comparación.

import { NextRequest, NextResponse } from "next/server";
import { adminDb, getSesion, inscripcionDe } from "@/lib/programa";
import {
  DIMENSIONES, REACTIVOS, ESCALA, perfilPara,
  CRITERIO_MAX, CRITERIO_MIN, CRITERIO_MAX_DIMENSION, INSTRUMENTO_CRITERIO,
} from "@/lib/instrumentoCriterio";

export const runtime = "nodejs";

/** Primer paso = inicio, mitad = medio, último = cierre. Lo demás, seguimiento. */
function milestonePara(paso: number, total: number): string {
  if (paso <= 1) return "inicio";
  if (total > 0 && paso >= total) return "cierre";
  if (total > 0 && paso === Math.ceil(total / 2)) return "medio";
  return "seguimiento";
}

export async function POST(req: NextRequest) {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });

  let body: { respuestas?: number[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 }); }

  const r = body.respuestas;
  if (!Array.isArray(r) || r.length !== REACTIVOS.length) {
    return NextResponse.json(
      { error: `Faltan respuestas: se esperaban ${REACTIVOS.length}` },
      { status: 400 },
    );
  }
  // Cada reactivo va de 1 a 5. Un valor fuera de rango corrompería la línea base.
  if (!r.every((v) => Number.isInteger(v) && v >= 1 && v <= ESCALA.length)) {
    return NextResponse.json({ error: "Respuestas fuera de escala" }, { status: 400 });
  }

  const db = adminDb();
  const insc = await inscripcionDe(db, sesion.userId);
  if (!insc) return NextResponse.json({ error: "No tienes una inscripción activa" }, { status: 404 });

  const { data: prog } = await db.from("programs")
    .select("steps_count").eq("id", insc.program_id).maybeSingle();
  const total = prog?.steps_count ?? 0;
  const milestone = milestonePara(insc.current_step, total);

  // Puntaje y subtotales, con el mismo formato que ya usa el backfill.
  const total_score = r.reduce((a, b) => a + b, 0);
  const dimensions: Record<string, { score: number; max: number }> = {};
  const answers: Record<string, string> = {};
  let i = 0;
  for (const d of DIMENSIONES) {
    let suma = 0;
    for (const item of d.items) {
      const v = r[i];
      suma += v;
      answers[`${i + 1}. ${item}`] = `${ESCALA[v - 1]} (${v})`;
      i++;
    }
    dimensions[d.nombre] = { score: suma, max: CRITERIO_MAX_DIMENSION };
  }
  answers["_puntaje_total"] = String(total_score);

  const perfil = perfilPara(total_score);

  const { data: creada, error } = await db.from("assessments").insert({
    client_id: insc.client_id,
    patient_id: insc.patient_id,
    enrollment_id: insc.id,
    lead_id: insc.lead_id,
    instrument: INSTRUMENTO_CRITERIO,
    milestone,
    taken_at: new Date().toISOString(),
    total_score,
    max_score: CRITERIO_MAX,
    profile: perfil?.nombre ?? null,
    dimensions,
    answers,
    source: "programa_app",
  }).select("id, milestone, total_score, profile, dimensions, taken_at").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Si esto era el paso 1, ya quedó hecho: la evaluación ES el paso 1.
  let avanzo = false;
  if (milestone === "inicio" && insc.current_step === 1) {
    const ahora = new Date().toISOString();
    await db.from("program_step_progress")
      .update({ status: "completado", completed_at: ahora })
      .eq("enrollment_id", insc.id).eq("step_number", 1);
    if (total > 1) {
      await db.from("program_step_progress")
        .update({ status: "en_curso", started_at: ahora })
        .eq("enrollment_id", insc.id).eq("step_number", 2).eq("status", "bloqueado");
      await db.from("program_enrollments").update({ current_step: 2 }).eq("id", insc.id);
      avanzo = true;
    }
  }

  return NextResponse.json({
    ok: true,
    evaluacion: creada,
    minimo: CRITERIO_MIN,
    avanzo,
  });
}

/** Las mediciones anteriores, para comparar. */
export async function GET() {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });

  const db = adminDb();
  const insc = await inscripcionDe(db, sesion.userId);
  if (!insc) return NextResponse.json({ mediciones: [] });

  // Incluye la que hizo en el sitio público antes de inscribirse: esa es su
  // línea base real, y es la razón de que no la vuelva a contestar.
  const { data, error } = await db
    .from("assessments")
    .select("id, milestone, taken_at, total_score, max_score, profile, dimensions")
    .eq("instrument", INSTRUMENTO_CRITERIO)
    .not("total_score", "is", null)
    .or(`enrollment_id.eq.${insc.id}${insc.lead_id ? `,lead_id.eq.${insc.lead_id}` : ""}`)
    .order("taken_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mediciones: data ?? [] });
}
