// FishFlow — Enlace Integral · WhatsApp de prospectos (línea FishFlow +52 56 1059 7851).
//
//  - Resumen del lunes 9:00 CDMX (cron /api/cron/enlace-resumen-semanal): plantilla
//    aprobada `resumen_prospectos_semanal` a Edna e Ivonne, con los prospectos de la
//    semana anterior por campaña y cuántos siguen sin asignar. Botón "Ver detalle".
//  - Si Edna o Ivonne escriben, contesta un asistente de SOLO CONSULTA sobre los
//    prospectos de Enlace (no asigna, no cambia estatus, no borra). Decisión de Rafa,
//    22-nov-2026. Cualquier otro número sigue el flujo normal de la línea.
//
// La IA no ve la tabla ni escribe SQL: solo llama las consultas fijas de abajo, siempre
// amarradas al client_id de Enlace (lo pone el servidor, nunca el modelo).

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { sendTemplate, sendText } from "@/lib/whatsapp";

export const ENLACE_CLIENT_ID = "e8094119-0414-4d46-8506-6ee1a52e852c";
export const ENLACE_WEEKLY_TEMPLATE = "resumen_prospectos_semanal";
const BOT_MODEL = process.env.ENLACE_BOT_MODEL || "claude-haiku-4-5-20251001";
const MAX_ROUNDS = 5;

/**
 * Quién recibe el resumen. Números confirmados por Rafa (22-nov-2026); Rafa se agregó el 23-nov.
 * `exclusivo`: todo lo que escriba ese número lo contesta el asistente de Enlace.
 * Rafa NO es exclusivo: su número también es contacto del bot de flotillas de LUKON, así que
 * solo le contesta el de Enlace si toca "Ver detalle" de este resumen o menciona Enlace/prospectos.
 */
export const ENLACE_WA_CONTACTS = [
  { name: "Edna", phone: "5570475147", exclusivo: true },
  { name: "Ivonne", phone: "5516859769", exclusivo: true },
  { name: "Rafa", phone: "5514831644", exclusivo: false },
];

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const CDMX_MS = -6 * 3600e3; // CDMX sin horario de verano
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Lo atiende siempre el asistente de Enlace? (para no mandar el aviso de "nueva conversación"). */
export function isEnlaceContact(waId: string) {
  return ENLACE_WA_CONTACTS.some(c => c.exclusivo && c.phone === last10(waId));
}

/** ¿El último resumen que recibió este número fue el de Enlace? */
async function ultimoResumenEsEnlace(waId: string) {
  const { data } = await db().from("whatsapp_messages").select("template_name")
    .eq("direction", "outbound").not("template_name", "is", null).like("contact_wa_id", `%${last10(waId)}`)
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.template_name === ENLACE_WEEKLY_TEMPLATE;
}

// ─── Datos ────────────────────────────────────────────────────────────────────

interface LeadRow {
  id: string; name: string; email: string | null; phone: string | null; problem: string | null;
  ai_response: string | null; created_at: string; assigned_to: string | null; status: string | null;
  utm_content: string | null; source: string | null;
}

function campo(problem: string | null, clave: string) {
  for (const part of (problem ?? "").split(" · ")) {
    const i = part.indexOf(":");
    if (i > -1 && part.slice(0, i).trim().toLowerCase() === clave.toLowerCase()) return part.slice(i + 1).trim();
  }
  return "";
}

/** Campaña de donde vino: por la etiqueta del anuncio (utm_content). Sin etiqueta = orgánico. */
export function campana(l: Pick<LeadRow, "utm_content" | "problem">) {
  const u = (l.utm_content ?? "").toLowerCase();
  if (u.startsWith("auto") || campo(l.problem, "Objetivo") === "auto") return "Auto";
  if (u === "ahorro") return "Ahorro";
  if (u.startsWith("sat")) return "SAT";
  if (u) return `Anuncio ${l.utm_content}`;
  return "Orgánico";
}

const plan = (l: LeadRow) => campo(l.problem, "Plan") || (l.ai_response ?? "").replace(/^Plan recomendado:\s*/, "") || "—";
const fechaCdmx = (iso: string) => new Date(new Date(iso).getTime() + CDMX_MS).toISOString().slice(0, 16).replace("T", " ");
/** YYYY-MM-DD (día en CDMX) → límite UTC. */
const inicioDia = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - CDMX_MS).toISOString();

async function leadsEntre(desde: string, hasta: string): Promise<LeadRow[]> {
  const fin = new Date(new Date(inicioDia(hasta)).getTime() + 864e5).toISOString();
  const { data, error } = await db().from("leads")
    .select("id, name, email, phone, problem, ai_response, created_at, assigned_to, status, utm_content, source")
    .eq("client_id", ENLACE_CLIENT_ID).gte("created_at", inicioDia(desde)).lt("created_at", fin)
    .order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as LeadRow[];
}

function contar<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

function ficha(l: LeadRow) {
  const correo = l.email && !l.email.endsWith("@enlace.local") ? l.email : null;
  const auto = campo(l.problem, "Auto");
  return {
    fecha: fechaCdmx(l.created_at), nombre: l.name, whatsapp: l.phone || campo(l.problem, "WhatsApp") || null, correo,
    plan: plan(l), campana: campana(l), asignado_a: l.assigned_to ?? "sin asignar", estatus: l.status ?? "nuevo",
    ...(auto
      ? { auto, cp: campo(l.problem, "CP"), uso: campo(l.problem, "Uso"), seguro_actual_vence: campo(l.problem, "Vence") }
      : { edad: campo(l.problem, "Edad") || null, capacidad_mensual: campo(l.problem, "Capacidad") || null }),
  };
}

// ─── Resumen semanal ──────────────────────────────────────────────────────────

/** Semana anterior completa (lunes a domingo, CDMX) respecto a `now`. */
export function semanaAnterior(now = new Date()) {
  const hoy = new Date(now.getTime() + CDMX_MS);
  const dow = (hoy.getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - dow - 7));
  const domingo = new Date(lunes.getTime() + 6 * 864e5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const txt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
  return { desde: iso(lunes), hasta: iso(domingo), periodo: `${txt(lunes)} al ${txt(domingo)}` };
}

export async function buildEnlaceWeekly(now = new Date()) {
  const s = semanaAnterior(now);
  const rows = await leadsEntre(s.desde, s.hasta);
  const porCampana = contar(rows, campana);
  const sinAsignar = rows.filter(r => !r.assigned_to);
  const campanasTxt = Object.entries(porCampana).map(([k, v]) => `${k} ${v}`).join(", ") || "ninguno";
  const lineas = rows.slice().reverse().map(r =>
    `• ${fechaCdmx(r.created_at).slice(5, 10).split("-").reverse().join("/")} ${r.name} — ${campana(r)} · ${r.assigned_to ?? "*sin asignar*"}`);
  const detalle = [
    `*Prospectos de Enlace · ${s.periodo}*`,
    `Total: *${rows.length}* · Sin asignar: *${sinAsignar.length}*`,
    ...Object.entries(porCampana).map(([k, v]) => `- ${k}: ${v}`),
    "",
    ...(lineas.length > 40 ? [...lineas.slice(0, 40), `…y ${lineas.length - 40} más. Revisa el panel: fishflow.mx/app/enlace`] : lineas),
  ].join("\n");
  return { ...s, total: rows.length, sinAsignar: sinAsignar.length, porCampana, campanasTxt, detalle };
}

/** Plantilla del lunes a Edna e Ivonne. ref única por semana + contacto (evita duplicados si el cron se repite). */
export async function sendEnlaceWeekly(now = new Date()) {
  const r = await buildEnlaceWeekly(now);
  const sent: string[] = [], failed: string[] = [];
  for (const c of ENLACE_WA_CONTACTS) {
    const res = await sendTemplate({
      to: `52${c.phone}`, name: ENLACE_WEEKLY_TEMPLATE, clientId: ENLACE_CLIENT_ID,
      ref: `enlace-semanal:${r.desde}:${c.phone}`,
      params: [c.name, r.periodo, String(r.total), r.campanasTxt, String(r.sinAsignar)],
    });
    (res.ok ? sent : failed).push(c.name);
  }
  return { ...r, sent, failed };
}

// ─── Asistente de consulta ────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: "resumen_prospectos",
    description: "Conteos de prospectos de Enlace en un periodo: total, por campaña (Ahorro, SAT, Auto, Orgánico…), por plan, por agente asignado, por estatus y cuántos siguen sin asignar.",
    input_schema: { type: "object", properties: {
      desde: { type: "string", description: "YYYY-MM-DD inclusive (hora CDMX)" },
      hasta: { type: "string", description: "YYYY-MM-DD inclusive" },
    }, required: ["desde", "hasta"] },
  },
  {
    name: "listar_prospectos",
    description: "Lista de prospectos de un periodo con nombre, fecha, WhatsApp, plan, campaña, agente y estatus (máximo 30, los más recientes primero). Filtros opcionales.",
    input_schema: { type: "object", properties: {
      desde: { type: "string", description: "YYYY-MM-DD" },
      hasta: { type: "string", description: "YYYY-MM-DD" },
      campana: { type: "string", description: "Opcional: Ahorro, SAT, Auto u Orgánico" },
      agente: { type: "string", description: "Opcional: nombre (o parte) del agente asignado" },
      solo_sin_asignar: { type: "boolean", description: "Opcional: solo los que no tienen agente" },
    }, required: ["desde", "hasta"] },
  },
  {
    name: "buscar_prospecto",
    description: "Busca un prospecto por nombre (o parte) o por teléfono, en todo el historial. Regresa hasta 8 con su ficha completa.",
    input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function runTool(name: string, input: Record<string, unknown>) {
  if (name === "buscar_prospecto") {
    const t = String(input.texto ?? "").trim();
    if (t.length < 3) return { error: "Escribe al menos 3 letras o dígitos" };
    const digits = t.replace(/\D/g, "");
    let q = db().from("leads")
      .select("id, name, email, phone, problem, ai_response, created_at, assigned_to, status, utm_content, source")
      .eq("client_id", ENLACE_CLIENT_ID).order("created_at", { ascending: false }).limit(8);
    q = digits.length >= 4 ? q.ilike("phone", `%${digits.slice(-10)}%`) : q.ilike("name", `%${t.replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { encontrados: (data ?? []).map(r => ficha(r as LeadRow)) };
  }

  const desde = String(input.desde ?? ""), hasta = String(input.hasta ?? "");
  if (!DATE_RE.test(desde) || !DATE_RE.test(hasta) || desde > hasta) return { error: "Fechas inválidas: YYYY-MM-DD y desde ≤ hasta" };
  if ((new Date(hasta).getTime() - new Date(desde).getTime()) / 864e5 > 400) return { error: "Periodo máximo de 400 días" };
  const rows = await leadsEntre(desde, hasta);

  if (name === "resumen_prospectos") {
    return {
      periodo: { desde, hasta }, total: rows.length, sin_asignar: rows.filter(r => !r.assigned_to).length,
      por_campana: contar(rows, campana), por_plan: contar(rows, plan),
      por_agente: contar(rows, r => r.assigned_to ?? "sin asignar"), por_estatus: contar(rows, r => r.status ?? "nuevo"),
    };
  }
  if (name === "listar_prospectos") {
    let xs = rows;
    if (input.campana) xs = xs.filter(r => norm(campana(r)).startsWith(norm(String(input.campana))));
    if (input.agente) xs = xs.filter(r => norm(r.assigned_to ?? "").includes(norm(String(input.agente))));
    if (input.solo_sin_asignar) xs = xs.filter(r => !r.assigned_to);
    return { periodo: { desde, hasta }, total_que_cumplen: xs.length, prospectos: xs.slice(0, 30).map(ficha) };
  }
  return { error: "Herramienta desconocida" };
}

function systemPrompt(nombre: string) {
  const hoy = new Date(Date.now() + CDMX_MS);
  const dia = hoy.toLocaleDateString("es-MX", { weekday: "long", timeZone: "UTC" });
  return `Eres el asistente de prospectos de Enlace Integral Seguros (promotoría Allianz) en WhatsApp. Hablas con ${nombre}, de la dirección de Enlace. Contestas preguntas sobre los prospectos que llegan de la página y de las campañas de Facebook/Instagram.

Hoy es ${dia} ${hoy.toISOString().slice(0, 10)} (hora de Ciudad de México).

Campañas: "Ahorro" (anuncio de ahorro, la principal), "SAT" (deducción antes del 31 de diciembre), "Auto" (seguro de auto) y "Orgánico" (llegó sin anuncio: búsqueda, Instagram, recomendación).

Reglas:
- Usa SIEMPRE las herramientas para cualquier dato. Nunca inventes nombres ni cifras.
- Eres de SOLO CONSULTA: no puedes asignar, cambiar estatus ni borrar. Si te lo piden, di que eso se hace en el panel (fishflow.mx/app/enlace) y que al asignar le llega un correo al agente.
- Fechas relativas desde hoy: "esta semana" = lunes a hoy; "la semana pasada" = lunes a domingo anteriores; "hoy", "ayer", "este mes" = del día 1 a hoy.
- Español de México, de tú, directo y breve (máximo ~120 palabras). Listas cortas con guiones, nunca tablas. Puedes usar *negritas* con un solo asterisco.
- Menciona el periodo que usaste. Si hay más resultados de los que muestras, dilo.
- Solo hablas de prospectos de Enlace. Para otra cosa, contesta en una línea que solo ves prospectos.
- No hables de herramientas, bases de datos ni de cómo funcionas. No menciones a FishFlow.`;
}

type ChatMsg = { role: "user" | "assistant"; content: string };

async function history(waId: string): Promise<ChatMsg[]> {
  const { data } = await db().from("whatsapp_messages")
    .select("direction, body, template_name").like("contact_wa_id", `%${last10(waId)}`)
    .gte("created_at", new Date(Date.now() - 864e5).toISOString())
    .order("created_at", { ascending: false }).limit(12);
  const msgs: ChatMsg[] = (data ?? []).reverse().filter(m => m.body && !m.template_name)
    .map(m => ({ role: m.direction === "inbound" ? "user" : "assistant", content: String(m.body).slice(0, 1500) }));
  const merged: ChatMsg[] = [];
  for (const m of msgs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${m.content}`; else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
}

export async function askEnlaceBot(nombre: string, messages: ChatMsg[]) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: 30_000 });
  const convo: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await anthropic.messages.create({ model: BOT_MODEL, max_tokens: 900, system: systemPrompt(nombre), tools, messages: convo });
    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !uses.length) {
      return resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("").trim()
        || "No encontré una respuesta. ¿Me lo preguntas de otra forma?";
    }
    convo.push({ role: "assistant", content: resp.content });
    const results = await Promise.all(uses.map(async u => {
      let out: unknown;
      try { out = await runTool(u.name, u.input as Record<string, unknown>); } catch (e) { out = { error: (e as Error).message }; }
      return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out) };
    }));
    convo.push({ role: "user", content: results });
  }
  return "Esa pregunta necesitó demasiadas consultas. Prueba con algo más específico (un periodo o una campaña).";
}

const toWa = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/^#+\s*/gm, "");

/** Mensaje entrante. false si el número no es de Edna ni de Ivonne (sigue el flujo normal). */
export async function handleEnlaceInbound(waId: string, text: string): Promise<boolean> {
  const c = ENLACE_WA_CONTACTS.find(x => x.phone === last10(waId));
  if (!c) return false;
  const verDetalle = /^\s*ver detalle\s*$/i.test(text);
  if (!c.exclusivo) {
    const deEnlace = verDetalle ? await ultimoResumenEsEnlace(waId) : /enlace|prospect/i.test(text);
    if (!deEnlace) return false;
  }
  const reply = (body: string) => sendText({ to: waId, body, clientId: ENLACE_CLIENT_ID, sentBy: "bot" });

  if (verDetalle) {
    const r = await buildEnlaceWeekly();
    await reply(r.total ? r.detalle : `No llegaron prospectos del ${r.periodo}.`);
    return true;
  }
  const msgs = await history(waId);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: text });
  try {
    await reply(toWa(await askEnlaceBot(c.name, msgs)));
  } catch (e) {
    console.error("[enlace-wa] bot", e);
    await reply("No pude revisar los prospectos en este momento. Intenta de nuevo en unos minutos.");
  }
  return true;
}
