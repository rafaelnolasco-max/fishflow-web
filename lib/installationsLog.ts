// FishFlow — Lukon · Instalaciones: línea de tiempo + bitácora en Slack (#cli-lukon). Solo servidor.
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifySlack, slackEscape } from "@/lib/slack";
import { SERVICE_LABEL, SITE, fmtCdmx, folioTxt, type Service } from "@/lib/installations";

export async function logEvent(db: SupabaseClient, inst: { id: string; client_id: string }, type: string, detail: string | null, by: string | null) {
  await db.from("telematica_installation_events").insert({ installation_id: inst.id, client_id: inst.client_id, type, detail, by });
  if (SLACK_EVENTS[type]) await slackEvent(db, inst.id, type, detail, by);
}

// ── Bitácora en Slack (#cli-lukon) ── 12-nov-2026
// Cada cambio importante de una orden se registra en el canal del equipo (Rafa, Alex, Al).
// Solo equipo: puede llevar datos internos, pero nunca la ubicación escondida del equipo.
const SLACK_EVENTS: Record<string, string> = {
  creada: "🆕 Nueva orden", reprogramada: "🗓️ Reprogramada", inicio: "▶️ Instalador en sitio",
  fin: "✅ Instalación terminada", reporte_enviado: "📧 Reporte enviado al cliente",
  aceptada_cliente: "👍 El cliente aceptó", aceptada_lukon: "👍 Marcada como aceptada", cancelada: "❌ Orden cancelada",
};

async function slackEvent(db: SupabaseClient, id: string, type: string, detail: string | null, by: string | null) {
  try {
    const { data: i } = await db.from("telematica_installations").select("*").eq("id", id).maybeSingle();
    if (!i) return;
    const veh = [i.vehicle_brand, i.vehicle_model, i.vehicle_year].filter(Boolean).join(" ") || "Vehículo sin datos";
    const lines = [
      `*${slackEscape(i.customer_name)}* · ${slackEscape(veh)}${i.vehicle_plate ? ` · ${slackEscape(i.vehicle_plate)}` : ""} · ${SERVICE_LABEL[i.service as Service] ?? i.service}`,
    ];
    if (["creada", "reprogramada"].includes(type)) {
      lines.push(`Cita: ${fmtCdmx(i.scheduled_at)} · ${i.installer_no ? `Instalador ${i.installer_no}` : "sin instalador asignado"}`);
      if (i.address) lines.push(`Dirección: ${slackEscape(i.address)}`);
    }
    if (type === "fin") {
      const min = i.started_at && i.finished_at ? Math.round((+new Date(i.finished_at) - +new Date(i.started_at)) / 60000) : null;
      lines.push(`${i.installer_no ? `Instalador ${i.installer_no}` : "Sin instalador"}${min != null ? ` · ${Math.floor(min / 60) ? `${Math.floor(min / 60)} h ` : ""}${min % 60} min en sitio` : ""}`);
      if (i.device_imei) lines.push(`IMEI ${slackEscape(i.device_imei)}${i.remote_cutoff_test ? ` · Apagado remoto: ${i.remote_cutoff_test === "exitosa" ? "exitoso" : "no aplica"}` : ""}`);
      if (!i.customer_email) lines.push("⚠️ Sin correo del cliente: el reporte no se envió");
    }
    if (type === "inicio" && i.installer_no) lines.push(`Instalador ${i.installer_no}`);
    if (detail && !["inicio", "fin", "creada"].includes(type)) lines.push(slackEscape(detail));
    if (by && !["aceptada_cliente"].includes(type)) lines.push(`_por ${slackEscape(by)}_`);
    await notifySlack("lukon", {
      text: `${SLACK_EVENTS[type]} · ${folioTxt(i.folio)}`,
      body: lines.join("\n"),
      button: { label: "Abrir la orden", url: `${SITE}/app/lukon/?tab=instalaciones&orden=${i.id}` },
    });
  } catch (e) { console.error("slackEvent", e); }
}
