import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { SENDERS } from "@/lib/email";

// ════════════════════════════════════════════════════════════════════════════
// SieckVet — send-confirmation  (Fase 5: confirmación de citas)
// ════════════════════════════════════════════════════════════════════════════
// Envía al dueño un email con la cita agendada + un link a /cita/[token] donde
// puede Confirmar o Pedir reagendar (sin login). Estampa confirmation_sent_at.
// Canal = email (WhatsApp diferido). El link queda listo para WhatsApp después.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://fishflow.mx";
const FALLBACK_EMAIL = "raf@fishflow.mx";

function fmtFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export async function POST(req: NextRequest) {
  try {
    const { appointment_id } = (await req.json()) as { appointment_id: string };
    if (!appointment_id) {
      return NextResponse.json({ error: "Falta appointment_id" }, { status: 400 });
    }

    const { data: a, error: aErr } = await supabaseAdmin
      .from("vet_appointments")
      .select("id, client_id, public_token, scheduled_at, reason, status, pet:vet_pets(name, owner_name, owner_email), vet:vet_vets(name)")
      .eq("id", appointment_id)
      .single();

    if (aErr || !a) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
    if (a.status === "cancelled" || a.status === "completed") {
      return NextResponse.json({ error: "La cita ya no está activa." }, { status: 422 });
    }

    const pet = Array.isArray(a.pet) ? a.pet[0] : a.pet;
    const vet = Array.isArray(a.vet) ? a.vet[0] : a.vet;

    const petName = pet?.name ?? "tu mascota";
    const ownerFirst = (pet?.owner_name ?? "").split(" ")[0];
    const recipient = pet?.owner_email ?? FALLBACK_EMAIL;
    const noOwnerEmail = !pet?.owner_email;
    const bcc = recipient === FALLBACK_EMAIL ? undefined : FALLBACK_EMAIL;

    const link = `${APP_URL}/cita/${a.public_token}`;
    const fecha = fmtFecha(a.scheduled_at);
    const subject = `Confirma la cita de ${petName} · SieckVet`;

    const text = `Hola ${ownerFirst || pet?.owner_name || ""},

Te recordamos la cita de ${petName} en SieckVet:

📅 ${fecha}${vet?.name ? `\n🩺 ${vet.name}` : ""}${a.reason ? `\n📝 ${a.reason}` : ""}

Por favor confírmala o pide reagendar aquí:
${link}

SieckVet`.trim();

    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1F2A2A;line-height:1.6;max-width:560px;margin:0 auto">
  <p>Hola ${ownerFirst || pet?.owner_name || ""},</p>
  <p>Te recordamos la cita de <strong>${petName}</strong> en SieckVet:</p>
  <div style="border-left:3px solid #0E7C7B;margin:16px 0;padding:12px 16px;background:#E6F4F3">
    📅 ${fecha}${vet?.name ? `<br>🩺 ${vet.name}` : ""}${a.reason ? `<br>📝 ${a.reason}` : ""}
  </div>
  <p style="margin:22px 0">
    <a href="${link}" style="display:inline-block;background:#0E7C7B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:600">Confirmar o reagendar</a>
  </p>
  <p style="font-size:12px;color:#6B7A79">Si el botón no abre, copia este enlace:<br>${link}</p>
  <p style="margin-top:18px"><strong>SieckVet</strong></p>
</div>`;

    const resendKey = process.env.RESEND_API_KEY;
    let delivery: "sent" | "queued" = "queued";
    let deliveryError: string | null = null;

    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const adminNote = noOwnerEmail
          ? `<p style="background:#FFF3CD;padding:8px 12px;border-radius:6px;font-size:12px;color:#7A5B00">Nota interna: el dueño no tiene email registrado; esta confirmación se envió a Rafa.</p>`
          : "";
        const { error: rErr } = await resend.emails.send({
          from: SENDERS.sieckvet,
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

    await supabaseAdmin.from("notifications").insert({
      client_id: a.client_id,
      channel: "email",
      provider: "resend",
      recipient,
      subject,
      body: text,
      related_entity_type: "vet_appointment",
      related_entity_id: a.id,
      status: delivery,
    });

    const nowIso = new Date().toISOString();
    if (delivery === "sent") {
      await supabaseAdmin
        .from("vet_appointments").update({ confirmation_sent_at: nowIso }).eq("id", appointment_id);
    }

    if (delivery !== "sent") {
      return NextResponse.json({ success: false, queued: true, error: deliveryError }, { status: 502 });
    }
    return NextResponse.json({ success: true, sent_at: nowIso, link, recipient });
  } catch (err) {
    console.error("send-confirmation error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
