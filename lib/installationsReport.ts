// FishFlow — Lukon · correo del reporte de instalación (solo servidor).
// Sale desde instalaciones@gpslukon.com con la marca LUKON y no menciona a FishFlow.
// El botón lleva a /instalacion/[token]; la aceptación pide un clic en la página
// (no en la liga del correo) para que los antivirus que abren ligas no la acepten solos.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { emailUI, escHtml } from "@/lib/emailLayout";
import { SERVICE_LABEL, SITE, AUTO_ACCEPT_DAYS, LUKON_OPS_EMAIL, fmtCdmx, folioTxt, logEvent, type Service } from "@/lib/installations";

const LUKON_WA = "525513285555";

export type InstRow = {
  id: string; client_id: string; folio: number; customer_name: string; customer_email: string | null;
  vehicle_brand: string | null; vehicle_model: string | null; vehicle_year: number | null; vehicle_plate: string | null;
  service: Service; installer_no: number | null; started_at: string | null; finished_at: string | null; report_token: string;
};

export const vehicleTxt = (i: Pick<InstRow, "vehicle_brand" | "vehicle_model" | "vehicle_year">) =>
  [i.vehicle_brand, i.vehicle_model, i.vehicle_year].filter(Boolean).join(" ") || "—";

export async function sendInstallationReport(db: SupabaseClient, inst: InstRow, by: string | null, to?: string | null) {
  const dest = (to ?? inst.customer_email ?? "").trim();
  if (!dest) return { ok: false, error: "La orden no tiene correo del cliente" };

  const { data: owner } = await db.from("clients").select("email_reply_to").eq("id", inst.client_id).maybeSingle();
  const ui = emailUI("lukon");
  const url = `${SITE}/instalacion/${inst.report_token}`;
  const primer = inst.customer_name.trim().split(/\s+/)[0] || "";
  const html = ui.layout({
    audiencia: "externo",
    preheader: `Tu ${SERVICE_LABEL[inst.service]} quedó instalado. Revisa el reporte con fotos y confírmanos que todo está bien.`,
    etiqueta: `Reporte de instalación · ${folioTxt(inst.folio)}`,
    titulo: `Tu instalación está lista${primer ? ", " + escHtml(primer) : ""}`,
    cuerpo:
      ui.p("Terminamos la instalación en tu vehículo. Aquí tienes el resumen:") +
      ui.tabla([
        ["Folio", folioTxt(inst.folio)],
        ["Vehículo", vehicleTxt(inst)],
        ["Placa", inst.vehicle_plate || "—"],
        ["Servicio", SERVICE_LABEL[inst.service]],
        ["Inicio", fmtCdmx(inst.started_at)],
        ["Término", fmtCdmx(inst.finished_at)],
        ["Instalador", inst.installer_no ? `Instalador ${inst.installer_no}` : "—"],
      ]) +
      ui.p("En el reporte puedes ver las fotos de cómo recibimos y cómo entregamos tu vehículo. <strong>Si todo está bien, confírmalo con un clic.</strong>") +
      ui.botones([
        { texto: "Ver reporte y aceptar", href: url },
        { texto: "Tengo una duda", href: `https://wa.me/${LUKON_WA}?text=${encodeURIComponent(`Hola LUKON, tengo una duda sobre mi instalación ${folioTxt(inst.folio)}.`)}`, estilo: "secundario" },
      ]),
    nota: `Si no recibimos respuesta en ${AUTO_ACCEPT_DAYS} días, la instalación se da por aceptada. ¿Algo no quedó bien? Escríbenos por WhatsApp al 55 1328 5555 o responde este correo.`,
  });

  const r = await sendEmail({
    from: "lukonInstalaciones", to: dest, replyTo: owner?.email_reply_to ?? null,
    subject: `Reporte de tu instalación LUKON · ${folioTxt(inst.folio)}`, html, tag: "lukon/instalacion-reporte",
  });
  if (!r.ok) return { ok: false, error: "No se pudo enviar el correo" };

  await db.from("telematica_installations").update({ report_sent_at: new Date().toISOString(), report_sent_to: dest, updated_at: new Date().toISOString() }).eq("id", inst.id);
  await logEvent(db, inst, "reporte_enviado", `Reporte enviado a ${dest}`, by);
  return { ok: true };
}

/** Aviso interno a Lukon cuando el cliente acepta. */
export async function notifyAccepted(db: SupabaseClient, inst: InstRow) {
  const { data: owner } = await db.from("clients").select("email_reply_to").eq("id", inst.client_id).maybeSingle();
  if (!owner?.email_reply_to) return;
  const ui = emailUI("lukon");
  await sendEmail({
    from: "lukonInstalaciones", to: owner.email_reply_to,
    subject: `${folioTxt(inst.folio)} aceptada por ${inst.customer_name}`,
    html: ui.layout({
      audiencia: "interno", preheader: `${inst.customer_name} aceptó la instalación ${folioTxt(inst.folio)}.`,
      etiqueta: "Instalación aceptada", titulo: `${inst.customer_name} aceptó la instalación`,
      cuerpo: ui.tabla([["Folio", folioTxt(inst.folio)], ["Vehículo", vehicleTxt(inst)], ["Placa", inst.vehicle_plate || "—"],
        ["Instalador", inst.installer_no ? `Instalador ${inst.installer_no}` : "—"]]) +
        ui.botones([{ texto: "Ver en el panel", href: `${SITE}/app/lukon/?tab=instalaciones` }]),
    }),
    tag: "lukon/instalacion-aceptada",
  });
}

/** Aviso interno a Alex cuando se crea, reprograma o cancela una orden. Nunca truena la operación. */
export async function notifyOps(
  inst: InstRow & { address?: string | null; scheduled_at?: string | null; notes?: string | null; customer_phone?: string | null; cancel_reason?: string | null },
  kind: "nueva" | "reprogramada" | "cancelada",
) {
  try {
    const ui = emailUI("lukon");
    const maps = (inst.notes ?? "").match(/https?:\/\/\S+/)?.[0]
      ?? (inst.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inst.address)}` : null);
    const cita = fmtCdmx(inst.scheduled_at ?? null);
    const titulo = kind === "nueva" ? "Nueva orden de instalación" : kind === "reprogramada" ? "Orden reprogramada" : "Orden cancelada";
    const filas: [string, string][] = [
      ["Folio", folioTxt(inst.folio)],
      ["Cita", cita],
      ["Cliente", inst.customer_name + (inst.customer_phone ? ` · ${inst.customer_phone}` : "")],
      ["Vehículo", vehicleTxt(inst) + (inst.vehicle_plate ? ` · ${inst.vehicle_plate}` : "")],
      ["Servicio", SERVICE_LABEL[inst.service]],
      ["Instalador", inst.installer_no ? `Instalador ${inst.installer_no}` : "Sin asignar"],
      ["Dirección", inst.address || "—"],
      ...(inst.notes ? [["Notas", inst.notes] as [string, string]] : []),
      ...(kind === "cancelada" && inst.cancel_reason ? [["Motivo", inst.cancel_reason] as [string, string]] : []),
    ];
    await sendEmail({
      from: "lukonInstalaciones", to: LUKON_OPS_EMAIL,
      subject: `${titulo} · ${folioTxt(inst.folio)} · ${cita} · ${inst.customer_name}`,
      html: ui.layout({
        audiencia: "interno",
        preheader: `${vehicleTxt(inst)} · ${cita} · ${inst.address ?? ""}`,
        etiqueta: titulo, titulo: `${folioTxt(inst.folio)} · ${escHtml(inst.customer_name)}`,
        cuerpo: ui.tabla(filas) +
          ui.botones([
            { texto: "Abrir la orden", href: `${SITE}/app/lukon/?tab=instalaciones&orden=${inst.id}` },
            ...(maps && kind !== "cancelada" ? [{ texto: "Cómo llegar", href: maps, estilo: "secundario" as const }] : []),
          ]),
      }),
      tag: `lukon/instalacion-${kind}`,
    });
  } catch (e) { console.error("notifyOps", e); }
}
