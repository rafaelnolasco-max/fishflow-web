// FishFlow — Motor de Programas · marcar una evaluación como invitada
// ─────────────────────────────────────────────────────────────────────────────
// Fase 0. Crea (o reusa) el `program_enrollment` de una persona que ya contestó
// la evaluación y lo deja en estado `invitado`.
//
// ⚠️ NO crea el paciente. `patient_id` se queda en NULL hasta que la persona
// acepte: dar de alta a alguien como paciente porque llenó un formulario web
// no es un atajo, es inventar un dato. Ver la sección 6 del plan.
//
// El envío del mensaje lo hace Mario a mano desde el panel (texto listo para
// copiar). Esta ruta solo registra que ya lo invitó y cuándo, y devuelve el
// link con el token que debe ir en ese mensaje.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs";

const CRITERIO_CLIENT_ID = "ea5266d5-cabb-44e2-a96a-0a0f40da07e7";
const PROGRAM_SLUG = "reconstruccion-mental";
const BASE_URL = "https://www.fishflow.mx";

/** 64 hex. Mismo formato que public.program_invite_token(). */
function nuevoToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function linkDe(token: string): string {
  return `${BASE_URL}/programa/aceptar?t=${token}`;
}

export async function POST(req: NextRequest) {
  // Candado de sesión antes de leer nada: el client_id no es credencial.
  const auth = await requireClientAccess(CRITERIO_CLIENT_ID);
  if (!auth.ok) return auth.response;

  let body: { assessment_id?: string; deshacer?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const assessmentId = body.assessment_id;
  if (!assessmentId) {
    return NextResponse.json({ error: "Falta assessment_id" }, { status: 400 });
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 1. La evaluación, verificando que sea de este cliente.
  const { data: ev, error: errEv } = await db
    .from("assessments")
    .select("id, client_id, lead_id, enrollment_id")
    .eq("id", assessmentId)
    .eq("client_id", CRITERIO_CLIENT_ID)
    .maybeSingle();

  if (errEv) return NextResponse.json({ error: errEv.message }, { status: 500 });
  if (!ev) return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 });
  if (!ev.lead_id) {
    return NextResponse.json(
      { error: "Esta evaluación no viene de un prospecto: no hay a quién invitar" },
      { status: 400 },
    );
  }

  // 2. El programa.
  const { data: prog, error: errProg } = await db
    .from("programs")
    .select("id")
    .eq("client_id", CRITERIO_CLIENT_ID)
    .eq("slug", PROGRAM_SLUG)
    .maybeSingle();

  if (errProg) return NextResponse.json({ error: errProg.message }, { status: 500 });
  if (!prog) {
    return NextResponse.json({ error: "El programa no está sembrado" }, { status: 500 });
  }

  // 3. ¿Ya existe la inscripción? El único parcial (program_id, lead_id) la
  //    hace irrepetible, así que aquí se reusa en vez de chocar.
  const { data: previa, error: errPrev } = await db
    .from("program_enrollments")
    .select("id, status, patient_id, invited_at")
    .eq("program_id", prog.id)
    .eq("lead_id", ev.lead_id)
    .maybeSingle();

  if (errPrev) return NextResponse.json({ error: errPrev.message }, { status: 500 });

  // Deshacer: regresa a `evaluado`. Solo si nadie ha aceptado todavía.
  if (body.deshacer) {
    if (!previa) return NextResponse.json({ ok: true, enrollment: null });
    if (previa.patient_id) {
      return NextResponse.json(
        { error: "Ya aceptó la invitación: no se puede deshacer desde aquí" },
        { status: 409 },
      );
    }
    const { data: vuelta, error: errU } = await db
      .from("program_enrollments")
      .update({ status: "evaluado", invited_at: null, invite_token: null })
      .eq("id", previa.id)
      .select("id, status, invited_at")
      .single();
    if (errU) return NextResponse.json({ error: errU.message }, { status: 500 });
    return NextResponse.json({ ok: true, enrollment: vuelta });
  }

  if (previa) {
    // Si ya está activa o más adelante, no la regresamos a `invitado`.
    if (previa.status !== "evaluado") {
      // Ya invitada: se devuelve su link, no se genera otro. Regenerar el token
      // invalidaría el mensaje que Mario ya mandó.
      const { data: conToken } = await db
        .from("program_enrollments")
        .select("id, status, invited_at, invite_token")
        .eq("id", previa.id)
        .single();
      return NextResponse.json({
        ok: true,
        enrollment: conToken,
        sinCambio: true,
        link: conToken?.invite_token ? linkDe(conToken.invite_token) : null,
      });
    }
    const token = nuevoToken();
    const { data: act, error: errU } = await db
      .from("program_enrollments")
      .update({ status: "invitado", invited_at: new Date().toISOString(), invite_token: token })
      .eq("id", previa.id)
      .select("id, status, invited_at")
      .single();
    if (errU) return NextResponse.json({ error: errU.message }, { status: 500 });
    return NextResponse.json({ ok: true, enrollment: act, link: linkDe(token) });
  }

  // 4. Alta nueva, sin paciente.
  const tokenNuevo = nuevoToken();
  const { data: nueva, error: errIns } = await db
    .from("program_enrollments")
    .insert({
      program_id: prog.id,
      client_id: CRITERIO_CLIENT_ID,
      lead_id: ev.lead_id,
      therapist_client_id: CRITERIO_CLIENT_ID,
      status: "invitado",
      current_step: 0,
      invited_at: new Date().toISOString(),
      invite_token: tokenNuevo,
    })
    .select("id, status, invited_at")
    .single();

  if (errIns) return NextResponse.json({ error: errIns.message }, { status: 500 });

  // Deja la evaluación colgada de la inscripción para que el paso 1 la reuse.
  await db
    .from("assessments")
    .update({ enrollment_id: nueva.id })
    .eq("id", ev.id);

  return NextResponse.json({ ok: true, enrollment: nueva, link: linkDe(tokenNuevo) });
}
