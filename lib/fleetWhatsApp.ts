// FishFlow — Telemática · WhatsApp de las flotillas (por ahora desde la línea FishFlow).
//
//  - Resumen del lunes: plantilla aprobada `resumen_flotilla_semanal` (Meta pide plantilla
//    para escribir primero) con botón "Ver detalle". Contactos en telematica_wa_contacts.
//  - Mensajes entrantes de esos contactos: los contesta el bot de la flotilla
//    (lib/fleetBot.ts), no el autorespondedor de la landing ni el aviso de "nueva conversación".
//  Cuando la línea de LUKON esté en la API, solo cambia el número que manda (decisión de Rafa).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { sendTemplate, sendText } from "@/lib/whatsapp";
import { askFleetBot, type ChatMsg } from "@/lib/fleetBot";
import { buildWeekly, type WeeklyReport } from "@/lib/fleetWeekly";

export const WEEKLY_TEMPLATE = "resumen_flotilla_semanal";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Contact { client_id: string; name: string | null; bot: boolean; weekly_summary: boolean; fleet: string }

export async function fleetContacts(waId: string): Promise<Contact[]> {
  const { data } = await db().from("telematica_wa_contacts")
    .select("client_id, name, bot, weekly_summary, clients(name)")
    .eq("phone", last10(waId)).eq("active", true);
  return (data ?? []).map(r => ({
    client_id: r.client_id, name: r.name, bot: r.bot, weekly_summary: r.weekly_summary,
    fleet: (r.clients as unknown as { name: string } | null)?.name ?? "Flotilla",
  }));
}

/** ¿El número es contacto de alguna flotilla? (para no mandar el aviso de "nueva conversación"). */
export async function isFleetContact(waId: string) {
  return (await fleetContacts(waId)).some(c => c.bot);
}

/** WhatsApp usa *negritas* con un asterisco. */
const toWa = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/^#+\s*/gm, "");

/** Flotilla de la que habla: la que nombra, si no la del último resumen que recibió. */
async function pickFleet(waId: string, text: string, cs: Contact[]) {
  if (cs.length === 1) return cs[0];
  const t = norm(text);
  const named = cs.filter(c => norm(c.fleet).split(/\s+/).filter(w => w.length > 2 && w !== "grupo").some(w => t.includes(w)));
  if (named.length === 1) return named[0];
  const { data } = await db().from("whatsapp_messages").select("ref")
    .eq("direction", "outbound").eq("template_name", WEEKLY_TEMPLATE).like("contact_wa_id", `%${last10(waId)}`)
    .in("ref", cs.map(c => c.client_id)).order("created_at", { ascending: false }).limit(1);
  return cs.find(c => c.client_id === data?.[0]?.ref) ?? null;
}

/** Conversación reciente (24 h) con el contacto, para que el bot tenga contexto. */
async function history(waId: string): Promise<ChatMsg[]> {
  const { data } = await db().from("whatsapp_messages")
    .select("direction, body, template_name, created_at").like("contact_wa_id", `%${last10(waId)}`)
    .gte("created_at", new Date(Date.now() - 864e5).toISOString())
    .order("created_at", { ascending: false }).limit(12);
  const msgs: ChatMsg[] = (data ?? []).reverse()
    .filter(m => m.body && !m.template_name)
    .map(m => ({ role: m.direction === "inbound" ? "user" : "assistant", content: String(m.body).slice(0, 1500) }));
  const merged: ChatMsg[] = [];
  for (const m of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${m.content}`; else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

/**
 * Mensaje entrante de un contacto de flotilla. Regresa false si el número no es
 * contacto de ninguna flotilla (sigue el flujo normal de la línea).
 * El mensaje ya está guardado en whatsapp_messages cuando llega aquí.
 */
export async function handleFleetInbound(waId: string, text: string): Promise<boolean> {
  const cs = (await fleetContacts(waId)).filter(c => c.bot);
  if (!cs.length) return false;
  const reply = (body: string, clientId?: string) => sendText({ to: waId, body, clientId: clientId ?? null, sentBy: "bot" });

  const fleet = await pickFleet(waId, text, cs);
  if (!fleet) {
    await reply(`¿De cuál flotilla me preguntas? ${cs.map(c => c.fleet).join(", ")}.`);
    return true;
  }

  if (/^\s*ver detalle\s*$/i.test(text)) {
    const r = await buildWeekly(db() as SupabaseClient, fleet.client_id);
    await reply(r?.hasData ? r.wa.texto : `No hay datos de ${fleet.fleet} de la semana pasada.`, fleet.client_id);
    return true;
  }

  const msgs = await history(waId);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: text });
  try {
    const answer = await askFleetBot(db() as SupabaseClient, fleet.client_id, msgs);
    await reply(toWa(answer), fleet.client_id);
  } catch (e) {
    console.error("[fleet-wa] bot", e);
    await reply("No pude revisar los datos en este momento. Intenta de nuevo en unos minutos.", fleet.client_id);
  }
  return true;
}

/** Plantilla del lunes a los contactos de cada flotilla con resumen. */
export async function sendWeeklyWhatsApp(sb: SupabaseClient, reports: WeeklyReport[]) {
  const sent: string[] = [], failed: string[] = [];
  for (const r of reports) {
    const { data: cs } = await sb.from("telematica_wa_contacts").select("phone, name")
      .eq("client_id", r.fleet.id).eq("active", true).eq("weekly_summary", true);
    for (const c of cs ?? []) {
      const res = await sendTemplate({
        to: `52${c.phone}`, name: WEEKLY_TEMPLATE, clientId: r.fleet.id, ref: r.fleet.id,
        params: [c.name?.split(" ")[0] || "equipo", r.fleet.name, r.wa.periodo, r.wa.km, r.wa.trabajando, String(r.wa.atender)],
      });
      ((res as { ok?: boolean })?.ok ? sent : failed).push(`${r.fleet.name} → ${c.name ?? c.phone}`);
    }
  }
  return { sent, failed };
}
