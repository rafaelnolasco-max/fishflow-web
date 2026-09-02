// FishFlow — Motor de Programas · el paso actual y su cierre
// ─────────────────────────────────────────────────────────────────────────────
// GET  → todo lo que la app de la persona necesita pintar: su avance completo,
//        el contenido del paso en curso y las sesiones que colgó de él.
// POST → cierra el paso actual y abre el siguiente.
//
// ⚠️ Quien cierra el paso es LA PERSONA, contra el completion_criteria
//    (plan v3, sección 8.3). Si `programs.step_approval_required` está en true,
//    el paso queda cerrado pero el siguiente NO se abre hasta que el terapeuta
//    lo apruebe. Esa bandera está apagada por default a propósito: un motor que
//    corre a la velocidad del terapeuta no sirve para autoservicio.
//
// Nunca se salta un paso: solo se puede cerrar el que está `en_curso`.

import { NextRequest, NextResponse } from "next/server";
import { adminDb, getSesion, inscripcionDe } from "@/lib/programa";

export const runtime = "nodejs";

export async function GET() {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });

  const db = adminDb();
  const insc = await inscripcionDe(db, sesion.userId);
  if (!insc) return NextResponse.json({ inscripcion: null });

  const [{ data: prog }, { data: avance }, { data: pasos }] = await Promise.all([
    db.from("programs").select("name, subtitle, steps_count, step_approval_required")
      .eq("id", insc.program_id).maybeSingle(),
    db.from("program_step_progress")
      .select("step_number, status, started_at, completed_at, reflection, session_ids, therapist_note")
      .eq("enrollment_id", insc.id).order("step_number"),
    db.from("program_steps")
      .select("step_number, title, objective, content_md, exercise_md, completion_criteria")
      .eq("program_id", insc.program_id).eq("active", true).order("step_number"),
  ]);

  // Las sesiones que la persona grabó mientras trabajaba cada paso. Es lo que
  // convierte esto en un expediente y no en una lista de pendientes.
  const ids = (avance ?? []).flatMap((a) => (a.session_ids as string[] | null) ?? []);
  const { data: sesiones } = ids.length
    ? await db.from("sessions")
        .select("id, session_number, session_date, session_title, patient_summary")
        .in("id", ids)
    : { data: [] as unknown[] };

  return NextResponse.json({
    inscripcion: { id: insc.id, status: insc.status, current_step: insc.current_step },
    programa: prog ?? null,
    avance: avance ?? [],
    pasos: pasos ?? [],
    sesiones: sesiones ?? [],
  });
}

export async function POST(req: NextRequest) {
  const sesion = await getSesion();
  if (!sesion) return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });

  let body: { step_number?: number; reflection?: string; cerrar?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 }); }

  const db = adminDb();
  const insc = await inscripcionDe(db, sesion.userId);
  if (!insc) return NextResponse.json({ error: "No tienes una inscripción activa" }, { status: 404 });
  if (insc.status !== "activo") {
    return NextResponse.json({ error: "Tu programa no está activo" }, { status: 409 });
  }

  const paso = Number(body.step_number);
  if (!Number.isInteger(paso) || paso < 1) {
    return NextResponse.json({ error: "Paso inválido" }, { status: 400 });
  }

  const { data: renglon, error: errR } = await db
    .from("program_step_progress")
    .select("id, status, step_number")
    .eq("enrollment_id", insc.id)
    .eq("step_number", paso)
    .maybeSingle();

  if (errR) return NextResponse.json({ error: errR.message }, { status: 500 });
  if (!renglon) return NextResponse.json({ error: "Ese paso no existe en tu programa" }, { status: 404 });
  if (renglon.status === "bloqueado") {
    return NextResponse.json({ error: "Ese paso todavía no está abierto" }, { status: 409 });
  }

  // Guardar la reflexión no cierra nada: se puede escribir a lo largo del paso.
  const reflexion = typeof body.reflection === "string" ? body.reflection.slice(0, 20000) : undefined;
  if (reflexion !== undefined) {
    const { error } = await db.from("program_step_progress")
      .update({ reflection: reflexion }).eq("id", renglon.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!body.cerrar) return NextResponse.json({ ok: true, cerrado: false });

  if (renglon.status === "completado") {
    return NextResponse.json({ ok: true, cerrado: true, sinCambio: true });
  }

  const { data: prog } = await db.from("programs")
    .select("steps_count, step_approval_required").eq("id", insc.program_id).maybeSingle();
  const total = prog?.steps_count ?? 0;
  const requiereAprobacion = prog?.step_approval_required === true;

  const { error: errCierre } = await db.from("program_step_progress")
    .update({ status: "completado", completed_at: new Date().toISOString() })
    .eq("id", renglon.id);
  if (errCierre) return NextResponse.json({ error: errCierre.message }, { status: 500 });

  // Con aprobación activada el paso queda cerrado pero el siguiente no se abre:
  // lo destraba el terapeuta desde su panel.
  if (requiereAprobacion) {
    return NextResponse.json({ ok: true, cerrado: true, esperaAprobacion: true });
  }

  const siguiente = paso + 1;
  if (siguiente > total) {
    const { error } = await db.from("program_enrollments")
      .update({ status: "completado", completed_at: new Date().toISOString(), current_step: paso })
      .eq("id", insc.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, cerrado: true, programaCompletado: true });
  }

  const { error: errAbrir } = await db.from("program_step_progress")
    .update({ status: "en_curso", started_at: new Date().toISOString() })
    .eq("enrollment_id", insc.id)
    .eq("step_number", siguiente)
    .eq("status", "bloqueado");
  if (errAbrir) return NextResponse.json({ error: errAbrir.message }, { status: 500 });

  const { error: errAvance } = await db.from("program_enrollments")
    .update({ current_step: siguiente }).eq("id", insc.id);
  if (errAvance) return NextResponse.json({ error: errAvance.message }, { status: 500 });

  return NextResponse.json({ ok: true, cerrado: true, siguiente });
}
