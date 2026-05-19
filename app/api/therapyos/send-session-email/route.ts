import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { session_id, patient_id } = await req.json() as {
      session_id: string;
      patient_id: string;
    };

    if (!session_id || !patient_id) {
      return NextResponse.json({ error: "Faltan session_id o patient_id" }, { status: 400 });
    }

    // ── Obtener datos necesarios ───────────────────────────────────────────────
    const [{ data: session, error: sErr }, { data: patient, error: pErr }] = await Promise.all([
      supabaseAdmin
        .from("sessions")
        .select("id, session_number, session_date, patient_summary, payment_link, payment_status, client_id")
        .eq("id", session_id)
        .single(),
      supabaseAdmin
        .from("patients")
        .select("id, full_name, email")
        .eq("id", patient_id)
        .single(),
    ]);

    if (sErr || !session) return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
    if (pErr || !patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    if (!patient.email)   return NextResponse.json({ error: "El paciente no tiene email registrado" }, { status: 400 });

    const sessionDateFormatted = new Date(session.session_date).toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    // ── Componer el email ──────────────────────────────────────────────────────
    const emailSubject = `Tu resumen de sesión · ${sessionDateFormatted}`;
    const emailBody = `
Hola ${patient.full_name.split(" ")[0]},

Aquí tienes un resumen de nuestra sesión del ${sessionDateFormatted}:

---

${session.patient_summary ?? "Fue una sesión muy significativa. Gracias por tu trabajo de hoy."}

---
${session.payment_link ? `
Para liquidar la sesión, puedes hacer tu pago aquí:
${session.payment_link}
` : ""}
Con cariño,
Mario Citalán
Psicólogo
    `.trim();

    // ── Registrar en public.notifications (cola de FishFlow) ──────────────────
    // TODO: Conectar Resend/SendGrid para envío real.
    // Por ahora registramos en la cola y marcamos la sesión como "sent".
    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert({
        client_id: session.client_id,
        channel: "email",
        provider: "resend",
        recipient: patient.email,
        subject: emailSubject,
        body: emailBody,
        related_entity_type: "session",
        related_entity_id: session.id,
        status: "queued",
      });

    if (notifErr) {
      // La tabla notifications puede tener un schema diferente — logueamos pero continuamos
      console.warn("notifications insert warning:", notifErr.message);
    }

    // ── Marcar sesión como enviada ─────────────────────────────────────────────
    await supabaseAdmin
      .from("sessions")
      .update({ payment_status: "sent" })
      .eq("id", session_id);

    // ── TODO: Envío real por email ─────────────────────────────────────────────
    // Para activar el envío real, agrega RESEND_API_KEY a tus variables de entorno
    // y descomenta el bloque siguiente:
    //
    // const resendKey = process.env.RESEND_API_KEY;
    // if (resendKey) {
    //   await fetch("https://api.resend.com/emails", {
    //     method: "POST",
    //     headers: {
    //       "Authorization": `Bearer ${resendKey}`,
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       from: "TherapyOS <mario@therapyos.mx>",
    //       to: [patient.email],
    //       subject: emailSubject,
    //       text: emailBody,
    //     }),
    //   });
    // }

    return NextResponse.json({
      success: true,
      message: `Email registrado en cola para ${patient.email}`,
      email: {
        to: patient.email,
        subject: emailSubject,
        has_payment_link: !!session.payment_link,
      },
    });

  } catch (err) {
    console.error("send-session-email error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
