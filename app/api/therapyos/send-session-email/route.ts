import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { SENDERS } from "@/lib/email";

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — send-session-email  ("Aprobar y enviar")
// ════════════════════════════════════════════════════════════════════════════
// El click del terapeuta ES la aprobación: estampa approved_at + sent_at y envía
// el resumen al paciente vía Resend (dominio verificado fishflow.mx). Nada se
// envía automáticamente; este endpoint solo corre cuando el terapeuta aprueba.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const { session_id, patient_id } = (await req.json()) as {
      session_id: string;
      patient_id: string;
    };

    if (!session_id || !patient_id) {
      return NextResponse.json({ error: "Faltan session_id o patient_id" }, { status: 400 });
    }

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

    // Sin email del paciente → enviamos a Rafa para revisión. Con email → copia a Rafa.
    const FALLBACK_EMAIL = "raf@fishflow.mx";
    const recipient = patient.email ?? FALLBACK_EMAIL;
    const bcc = recipient === FALLBACK_EMAIL ? undefined : FALLBACK_EMAIL;
    const noPatientEmail = !patient.email;

    const sessionDateFormatted = new Date(session.session_date).toLocaleDateString("es-MX", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const firstName = patient.full_name.split(" ")[0];
    const summary = session.patient_summary ?? "Fue una sesión muy significativa. Gracias por tu trabajo de hoy.";
    const subject = `Tu resumen de sesión · ${sessionDateFormatted}`;

    const text = `Hola ${firstName},

Aquí tienes un resumen de nuestra sesión del ${sessionDateFormatted}:

${summary}
${session.payment_link ? `
Para liquidar la sesión, puedes hacer tu pago aquí:
${session.payment_link}
` : ""}
Con cariño,
Mario Citalán
Psicólogo`.trim();

    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#2C2C2C;line-height:1.6;max-width:560px;margin:0 auto">
  <p>Hola ${firstName},</p>
  <p>Aquí tienes un resumen de nuestra sesión del ${sessionDateFormatted}:</p>
  <blockquote style="border-left:3px solid #7A9E7E;margin:16px 0;padding:10px 16px;background:#F7FAF7">${summary.replace(/\n/g, "<br>")}</blockquote>
  ${session.payment_link ? `<p>Para liquidar la sesión, puedes hacer tu pago aquí:<br><a href="${session.payment_link}" style="color:#4A6B4E">${session.payment_link}</a></p>` : ""}
  <p style="margin-top:24px">Con cariño,<br><strong>Mario Citalán</strong><br>Psicólogo</p>
</div>`;

    // ── Envío real por Resend ───────────────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY;
    let delivery: "sent" | "queued" = "queued";
    let deliveryError: string | null = null;

    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const adminNote = noPatientEmail
          ? `<p style="background:#FFF3CD;padding:8px 12px;border-radius:6px;font-size:12px;color:#7A5B00">Nota interna: el paciente no tiene email registrado; este resumen se envió a Rafa para revisión.</p>`
          : "";
        const { error: rErr } = await resend.emails.send({
          from: SENDERS.therapyos,
          to: [recipient],
          ...(bcc ? { bcc: [bcc] } : {}),
          subject,
          text,
          html: adminNote + html,
        });
        if (rErr) deliveryError = rErr.message;
        else delivery = "sent";
      } catch (e) {
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    } else {
      deliveryError = "RESEND_API_KEY no configurada — el email quedó en cola, no se envió.";
    }

    // ── Cola de notificaciones (registro) ───────────────────────────────────────
    const { error: notifErr } = await supabaseAdmin.from("notifications").insert({
      client_id: session.client_id,
      channel: "email",
      provider: "resend",
      recipient,
      subject,
      body: text,
      related_entity_type: "session",
      related_entity_id: session.id,
      status: delivery,
    });
    if (notifErr) console.warn("notifications insert warning:", notifErr.message);

    // ── Estampar aprobación + envío en la sesión ────────────────────────────────
    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("sessions")
      .update({
        approved_at: nowIso,
        sent_at: delivery === "sent" ? nowIso : null,
        payment_status: "sent",
      })
      .eq("id", session_id);
    if (updErr) console.error("sessions update error:", updErr.message);

    if (delivery !== "sent") {
      return NextResponse.json(
        { success: false, queued: true, approved_at: nowIso, error: deliveryError },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      approved_at: nowIso,
      sent_at: nowIso,
      email: { to: patient.email, subject },
    });
  } catch (err) {
    console.error("send-session-email error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
