// FishFlow — Motor de Programas · aceptar la invitación
// ─────────────────────────────────────────────────────────────────────────────
// Aquí es donde alguien se vuelve paciente. Antes de este punto NO existe:
// haber contestado un formulario en internet no da de alta a nadie.
//
// Exige sesión: la persona ya creó su cuenta en /programa/aceptar. Y exige que
// el correo de esa sesión sea el mismo al que se le mandó la invitación —
// si no, un token que se reenvió por WhatsApp lo podría consumir cualquiera.

import { NextRequest, NextResponse } from "next/server";
import { adminDb, getSesion, mismoCorreo, PROGRAMA_CLIENT_ID } from "@/lib/programa";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sesion = await getSesion();
  if (!sesion) {
    return NextResponse.json({ error: "Necesitas iniciar sesión" }, { status: 401 });
  }

  let body: { token?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 }); }

  const token = (body.token ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return NextResponse.json({ error: "Invitación no válida" }, { status: 400 });
  }

  const db = adminDb();

  const { data: enr, error } = await db
    .from("program_enrollments")
    .select("id, status, lead_id, client_id, patient_id")
    .eq("invite_token", token)
    .eq("client_id", PROGRAMA_CLIENT_ID)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!enr || enr.status !== "invitado") {
    return NextResponse.json({ error: "Esta invitación ya no está disponible" }, { status: 404 });
  }

  const { data: lead } = await db
    .from("leads")
    .select("name, email, phone")
    .eq("id", enr.lead_id ?? "")
    .maybeSingle();

  if (!mismoCorreo(sesion.email, lead?.email)) {
    return NextResponse.json(
      { error: "Esta invitación es para otro correo. Inicia sesión con el correo al que te llegó." },
      { status: 403 },
    );
  }

  // El expediente. `self_managed` en false: hay un profesional acompañando,
  // a diferencia de Therapy Flow donde la persona va sola.
  let patientId = enr.patient_id;
  if (!patientId) {
    const { data: pac, error: errPac } = await db
      .from("patients")
      .insert({
        client_id: PROGRAMA_CLIENT_ID,
        full_name: (lead?.name ?? sesion.email).trim(),
        email: sesion.email,
        phone: lead?.phone ?? null,
        active: true,
        self_managed: false,
        therapist_name: "Dr. Mario Citalán",
        started_at: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (errPac) return NextResponse.json({ error: errPac.message }, { status: 500 });
    patientId = pac.id;
  }

  // Su cuenta queda amarrada ANTES de provisionar: si la RPC fallara, el
  // siguiente intento la encuentra y no crea un segundo expediente.
  const { error: errUser } = await db
    .from("program_enrollments")
    .update({ user_id: sesion.userId })
    .eq("id", enr.id);
  if (errUser) return NextResponse.json({ error: errUser.message }, { status: 500 });

  const { data: activa, error: errRpc } = await db.rpc("provision_program_enrollment", {
    p_enrollment_id: enr.id,
    p_patient_id: patientId,
  });
  if (errRpc) return NextResponse.json({ error: errRpc.message }, { status: 500 });

  return NextResponse.json({ ok: true, enrollment: activa });
}
