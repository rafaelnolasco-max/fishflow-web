// FishFlow — Telemática · resumen semanal de cada flotilla de LUKON por correo (lunes).
// Semana = lunes a domingo anteriores (hora CDMX), comparada con la semana previa.
// Por ahora va a Alex (LUKON) y a Rafa; cuando la línea de LUKON esté en la API de
// WhatsApp, se manda también por ahí (decisión de Rafa, 17-nov-2026).

import type { SupabaseClient } from "@supabase/supabase-js";
import { emailUI, escHtml } from "@/lib/emailLayout";
import { dailyStats, lastPositions, loadFleet, summarize, TZ, type FleetContext } from "@/lib/fleetData";

const nf = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** Lunes y domingo de la semana pasada (y de la anterior) en CDMX. */
export function lastWeek(ref = new Date()) {
  const today = ref.toLocaleDateString("en-CA", { timeZone: TZ });
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  const mon = new Date(d.getTime() - (dow + 7) * 864e5);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const add = (x: Date, n: number) => new Date(x.getTime() + n * 864e5);
  return { desde: iso(mon), hasta: iso(add(mon, 6)), prevDesde: iso(add(mon, -7)), prevHasta: iso(add(mon, -1)) };
}

const fmtCorta = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

function cambio(a: number, b: number) {
  if (!b) return "";
  const p = Math.round(((a - b) / b) * 100);
  return p === 0 ? " (igual que la semana anterior)" : ` (${p > 0 ? "+" : ""}${p}% vs. semana anterior)`;
}

export interface WeeklyReport {
  fleet: FleetContext; subject: string; html: string; hasData: boolean;
  /** Para WhatsApp: cifras de la plantilla y el detalle en texto. */
  wa: { desde: string; periodo: string; km: string; trabajando: string; atender: number; texto: string };
}

export async function buildWeekly(db: SupabaseClient, clientId: string, opts: { link?: string | null; ref?: Date } = {}): Promise<WeeklyReport | null> {
  const fleet = await loadFleet(db, clientId);
  if (!fleet || !fleet.vehicles.length) return null;
  const w = lastWeek(opts.ref);
  const [rows, prevRows, last] = await Promise.all([
    dailyStats(db, clientId, w.desde, w.hasta),
    dailyStats(db, clientId, w.prevDesde, w.prevHasta),
    lastPositions(db, fleet),
  ]);
  const cur = summarize(fleet, rows), prev = summarize(fleet, prevRows);
  const T = cur.total, P = prev.total;
  const periodo = `${fmtCorta(w.desde)} al ${fmtCorta(w.hasta)}`;
  const subject = `${fleet.name} · resumen de la semana ${periodo}`;
  const ui = emailUI("lukon");

  // ── Para atender ───────────────────────────────────────────────────────────
  const atender: string[] = [];
  const used = cur.units.filter(u => u.km >= 1);
  const silent = last.filter(l => l.sin_reportar_24h);
  if (silent.length) atender.push(`Sin reportar 24 h o más: ${silent.map(l => `${l.unidad}${l.ultimo_reporte ? ` (último: ${l.ultimo_reporte})` : ""}`).join("; ")}. Revisar GPS o corriente.`);
  const parked = cur.units.filter(u => u.km < 1 && !silent.some(s => s.unidad === u.unidad));
  if (parked.length) atender.push(`No se movieron en toda la semana: ${parked.map(u => u.unidad).join(", ")}.`);
  const fast = [...used].filter(u => u.excesos_velocidad > 0).sort((a, b) => b.excesos_velocidad - a.excesos_velocidad).slice(0, 3);
  if (fast.length) atender.push(`Más excesos de velocidad (> ${fleet.settings.speeding_kmh} km/h): ${fast.map(u => `${u.unidad} ${nf.format(u.excesos_velocidad)}${u.vel_max_kmh ? `, máx. ${u.vel_max_kmh} km/h` : ""}`).join("; ")}.`);
  const rated = used.filter(u => u.eventos_bruscos_por_100km != null);
  if (rated.length >= 3) {
    const sorted = rated.map(u => u.eventos_bruscos_por_100km!).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const rough = rated.filter(u => med > 0 && u.eventos_bruscos_por_100km! >= med * 1.5).sort((a, b) => b.eventos_bruscos_por_100km! - a.eventos_bruscos_por_100km!).slice(0, 3);
    if (rough.length) atender.push(`Manejo más brusco que el resto (aceleraciones y frenadas bruscas por km recorrido): ${rough.map(u => `${u.unidad} ${nf1.format(u.eventos_bruscos_por_100km! / med)} veces la mediana de la flotilla`).join("; ")}.`);
  }
  const idle = used.filter(u => u.pct_ralenti >= 30 && u.horas_ralenti >= 2).sort((a, b) => b.horas_ralenti - a.horas_ralenti).slice(0, 3);
  if (idle.length) atender.push(`Mucho ralentí (motor encendido sin moverse): ${idle.map(u => `${u.unidad} ${nf1.format(u.horas_ralenti)} h (${u.pct_ralenti}%)`).join("; ")}.`);
  const night = used.filter(u => u.km_de_noche >= 50).sort((a, b) => b.km_de_noche - a.km_de_noche).slice(0, 3);
  if (night.length) atender.push(`Manejo de noche (22:00–5:00): ${night.map(u => `${u.unidad} ${nf.format(u.km_de_noche)} km`).join("; ")}.`);
  const batt = cur.units.filter(u => u.dias_sin_corriente >= 2 || u.dias_bateria_baja >= 3);
  if (batt.length) atender.push(`Batería: ${batt.map(u => u.dias_sin_corriente >= 2 ? `${u.unidad} sin corriente ${u.dias_sin_corriente} días` : `${u.unidad} baja ${u.dias_bateria_baja} días (mín. ${nf1.format(u.bateria_reposo_min_v ?? 0)} V)`).join("; ")}.`);

  const top = [...used].sort((a, b) => b.km - a.km).slice(0, 5);
  const litros = `${nf.format(T.litros_estimados)} L estimados${T.costo_combustible_mxn ? ` (≈ $${nf.format(T.costo_combustible_mxn)})` : ""}`;

  const cuerpo = !rows.length
    ? ui.p(`No hay datos de la flotilla para la semana del ${escHtml(periodo)}. Si las unidades sí trabajaron, revisa que la descarga del GPS esté corriendo.`)
    : [
        ui.dato("Kilómetros de la semana", `${nf.format(T.km)} km${cambio(T.km, P.km)}`),
        ui.tabla([
          ["Unidades trabajando", `${T.unidades_con_uso} de ${T.unidades}`],
          ["Horas en movimiento", `${nf.format(T.horas_en_movimiento)} h`],
          ["Ralentí", `${nf.format(T.horas_ralenti)} h${cambio(T.horas_ralenti, P.horas_ralenti)}`],
          ["Km fuera de horario", `${nf.format(T.km_fuera_de_horario)} km`],
          ["Km de noche", `${nf.format(T.km_de_noche)} km`],
          ["Excesos de velocidad", `${nf.format(T.excesos_velocidad)}${cambio(T.excesos_velocidad, P.excesos_velocidad)}`],
          ["Velocidad máxima", T.vel_max_kmh ? `${T.vel_max_kmh} km/h` : "—"],
          ["Combustible", litros],
        ]),
        ui.rotulo("Para atender"),
        atender.length ? ui.bloque(ui.lista(atender), "aviso") : ui.p("Nada fuera de lo normal esta semana."),
        ui.rotulo("Las que más recorrieron"),
        ui.lista(top.map(u => `${u.unidad}: ${nf.format(u.km)} km en ${u.dias_con_uso} día${u.dias_con_uso === 1 ? "" : "s"}`)),
        opts.link ? ui.botones([{ texto: "Ver reporte completo", href: opts.link }]) : "",
      ].join("");

  const html = ui.layout({
    audiencia: "interno",
    preheader: rows.length ? `${nf.format(T.km)} km · ${T.unidades_con_uso} de ${T.unidades} unidades · ${atender.length} punto${atender.length === 1 ? "" : "s"} para atender` : "Sin datos esta semana",
    etiqueta: "Resumen semanal de flotilla",
    titulo: fleet.name,
    subtitulo: `Semana del ${periodo} (lunes a domingo)`,
    cuerpo,
    nota: "Litros y costo son estimados con el rendimiento de cada unidad. Puedes hacerle preguntas a tu flotilla desde el reporte, en la pestaña Preguntar.",
  });
  const texto = [
    `*${fleet.name}* · semana del ${periodo}`,
    `${nf.format(T.km)} km${cambio(T.km, P.km)} · ${T.unidades_con_uso} de ${T.unidades} unidades trabajando`,
    `Ralentí ${nf.format(T.horas_ralenti)} h · Excesos ${nf.format(T.excesos_velocidad)} · Fuera de horario ${nf.format(T.km_fuera_de_horario)} km · ${litros}`,
    "",
    "*Para atender*",
    ...(atender.length ? atender.map(a => `• ${a}`) : ["Nada fuera de lo normal esta semana."]),
    "",
    "*Las que más recorrieron*",
    ...top.map(u => `• ${u.unidad}: ${nf.format(u.km)} km`),
    "",
    "Pregúntame lo que quieras de tus unidades, por ejemplo: ¿quién manejó de noche?",
  ].join("\n");
  return {
    fleet, subject, html, hasData: rows.length > 0,
    wa: { desde: w.desde, periodo, km: nf.format(T.km), trabajando: `${T.unidades_con_uso} de ${T.unidades}`, atender: atender.length, texto },
  };
}

/**
 * Manda el resumen de cada flotilla de LUKON con datos esa semana.
 * La usan el cron de los lunes y el envío de prueba del admin.
 */
export async function sendWeeklyAll(db: SupabaseClient, opts: { to: string[]; subjectPrefix?: string; link: string }) {
  const { sendEmail, REPLY_TO } = await import("@/lib/email");
  const { LUKON_ID } = await import("@/lib/installations");
  const { data: fleets, error } = await db.from("clients").select("id, name").eq("parent_client_id", LUKON_ID).order("name");
  if (error) throw new Error(error.message);
  const sent: string[] = [], skipped: string[] = [], failed: string[] = [];
  const reports: WeeklyReport[] = [];
  for (const f of fleets ?? []) {
    const r = await buildWeekly(db, f.id, { link: opts.link });
    if (!r || !r.hasData) { skipped.push(f.name); continue; }
    reports.push(r);
    const res = await sendEmail({
      from: "lukonReportes", to: opts.to, subject: `${opts.subjectPrefix ?? ""}${r.subject}`,
      html: r.html, replyTo: REPLY_TO, tag: "lukon-resumen-semanal",
    });
    (res.ok ? sent : failed).push(f.name);
  }
  return { sent, skipped, failed, reports };
}
