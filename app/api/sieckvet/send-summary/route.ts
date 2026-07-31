import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { SENDERS } from "@/lib/email";

// ════════════════════════════════════════════════════════════════════════════
// SieckVet — send-summary  (Fase 4: entrega al dueño)
// ════════════════════════════════════════════════════════════════════════════
// Envía el resumen al dueño por email (Resend, dominio fishflow.mx verificado)
// con un link a la página pública /resumen/[token]. SOLO corre si el resumen ya
// fue APROBADO por el veterinario (human-in-the-loop). Estampa sent_at.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://fishflow.mx";
const FALLBACK_EMAIL = "raf@fishflow.mx";

export async function POST(req: NextRequest) {
  try {
    const { summary_id } = (await req.json()) as { summary_id: string };
    if (!summary_id) {
      return NextResponse.json({ error: "Falta summary_id" }, { status: 400 });
    }

    const { data: s, error: sErr } = await supabaseAdmin
      .from("vet_visit_summaries")
      .select("id, client_id, public_token, owner_summary, approved_at, appointment:vet_appointments(reason, pet:vet_pets(name, owner_name, owner_email), vet:vet_vets(name))")
      .eq("id", summary_id)
      .single();

    if (sErr || !s) return NextResponse.json({ error: "Resumen no encontrado" }, { status: 404 });

    // Human-in-the-loop: no se envía nada sin aprobación del veterinario.
    if (!s.approved_at) {
      return NextResponse.json(
        { error: "El resumen debe ser aprobado por el veterinario antes de enviarlo." },
        { status: 422 },
      );
    }

    const appt = Array.isArray(s.appointment) ? s.appointment[0] : s.appointment;
    const pet = appt ? (Array.isArray(appt.pet) ? appt.pet[0] : appt.pet) : null;
    const vet = appt ? (Array.isArray(appt.vet) ? appt.vet[0] : appt.vet) : null;

    const petName = pet?.name ?? "tu mascota";
    const ownerFirst = (pet?.owner_name ?? "").split(" ")[0];
    const recipient = pet?.owner_email ?? FALLBACK_EMAIL;
    const noOwnerEmail = !pet?.owner_email;
    const bcc = recipient === FALLBACK_EMAIL ? undefined : FALLBACK_EMAIL;

    const link = `${APP_URL}/resumen/${s.public_token}`;
    const subject = `Resumen de la consulta de ${petName} · SieckVet`;
    const ownerMsg = s.owner_summary ?? `Aquí el resumen de la consulta de ${petName}.`;

    const text = `Hola ${ownerFirst || pet?.owner_name || ""},

${ownerMsg}

Puedes ver el resumen completo aquí:
${link}

SieckVet`.trim();

    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#1F2A2A;line-height:1.6;max-width:560px;margin:0 auto">
  <p>Hola ${ownerFirst || pet?.owner_name || ""},</p>
  <blockquote style="border-left:3px solid #0E7C7B;margin:16px 0;padding:10px 16px;background:#E6F4F3;white-space:pre-wrap">${(ownerMsg).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</blockquote>
  <p style="margin:22px 0">
    <a href="${link}" style="display:inline-block;background:#0E7C7B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-weight:600">Ver resumen completo</a>
  </p>
  <p style="font-size:12px;color:#6B7A79">${vet?.name ? `Atendió: ${vet.name}.<br>` : ""}Este es un resumen para tu referencia; el expediente oficial lo conserva la clínica.</p>
  <p style="margin-top:18px"><strong>SieckVet</strong></p>
</div>`;

    // ── Envío por Resend ────────────────────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY;
    let delivery: "sent" | "queued" = "queued";
    let deliveryError: string | null = null;

    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        const adminNote = noOwnerEmail
          ? `<p style="background:#FFF3CD;padding:8px 12px;border-radius:6px;font-size:12px;color:#7A5B00">Nota interna: el dueño no tiene email registrado; este resumen se envió a Rafa para revisión.</p>`
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

    // ── Registro en notifications ───────────────────────────────────────────────
    const { error: notifErr } = await supabaseAdmin.from("notifications").insert({
      client_id: s.client_id,
      channel: "email",
      provider: "resend",
      recipient,
      subject,
      body: text,
      related_entity_type: "vet_visit_summary",
      related_entity_id: s.id,
      status: delivery,
    });
    if (notifErr) console.warn("notifications insert warning:", notifErr.message);

    // ── Estampar envío ──────────────────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    if (delivery === "sent") {
      const { error: updErr } = await supabaseAdmin
        .from("vet_visit_summaries").update({ sent_at: nowIso }).eq("id", summary_id);
      if (updErr) console.error("summary update error:", updErr.message);
    }

    if (delivery !== "sent") {
      return NextResponse.json({ success: false, queued: true, error: deliveryError }, { status: 502 });
    }

    return NextResponse.json({ success: true, sent_at: nowIso, link, recipient });
  } catch (err) {
    console.error("send-summary error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
