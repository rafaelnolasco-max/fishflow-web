"use client";

// ─── Telemática · Recorridos — reporte mensual (vista del jefe de flotilla) ──
// Primera vista de una flotilla con 3+ unidades. Responde, mes por mes, lo que
// revisa un jefe de flotilla: cuánto se trabajó, quién corre, quién usa la
// unidad fuera de horario o en domingo, cuánto motor encendido sin moverse
// (ralentí), qué unidades no se usaron y cómo va contra el mes anterior.
// Los números salen de telematica_monthly_report() (suma de
// telematica_daily_stats); la comparación contra el mes anterior es por día
// con datos, para que un mes incompleto no se vea como caída.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecorridosTokens } from "./RecorridosTab";
import { Bars } from "./VehicleDashboard";
import { horarioTxt } from "./FleetDashboard";

interface MV {
  vehicle_id: string; alias: string | null; plate: string | null; device_id: string; photo_url: string | null;
  kmpl: number; km: number; moving_h: number; idle_h: number; km_after_hours: number; speeding: number; vmax: number;
  active_days: number; liters: number; first_move_avg: string | null; last_move_avg: string | null; km_sunday: number | null;
}
interface Month {
  month: string; first_day: string; last_day: string; days_with_data: number; units_total: number; units_active: number;
  km: number; moving_h: number; idle_h: number; liters: number; cost_mxn: number | null; speeding: number; vmax: number;
  km_after_hours: number; vehicles: MV[];
}
interface Settings {
  fuel_price_mxn: number | null; default_km_per_l: number; work_start_hour: number; work_end_hour: number;
  work_days: number[]; sat_end_hour: number | null; speeding_kmh: number;
}
type SortKey = "km" | "active_days" | "moving_h" | "idle_h" | "speeding" | "vmax" | "km_after_hours" | "km_sunday" | "first_move_avg" | "last_move_avg" | "liters";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nf0 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const name = (v: MV) => v.alias || v.plate || `Equipo ${v.device_id}`;
const mIdx = (iso: string) => Number(iso.slice(5, 7)) - 1;
const dNum = (iso: string) => Number(iso.slice(8, 10));
const daysInMonth = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), mIdx(iso) + 1, 0)).getUTCDate();
const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
const per1000 = (m: { speeding: number; km: number }) => (m.km > 0 ? (m.speeding / m.km) * 1000 : 0);

/** "completo", "del 9 al 31", "1 al 6 · en curso" */
function coverage(m: Month) {
  const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 7);
  const full = dNum(m.first_day) === 1 && dNum(m.last_day) === daysInMonth(m.month);
  if (m.month.slice(0, 7) === today) return `del ${dNum(m.first_day)} al ${dNum(m.last_day)} · en curso`;
  return full ? "mes completo" : `del ${dNum(m.first_day)} al ${dNum(m.last_day)}`;
}

export default function MonthlyReport({ clientId, fleetName, t, onOpenVehicle }: {
  clientId: string; fleetName: string; t: RecorridosTokens; onOpenVehicle: (vehicleId: string) => void;
}) {
  const [months, setMonths] = useState<Month[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sel, setSel] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "km", dir: -1 });

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch(`/api/telematica/monthly-report?client_id=${clientId}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo cargar el reporte");
      const ms: Month[] = (d.months ?? []).map((m: Month) => ({ ...m, vehicles: m.vehicles ?? [] }));
      setMonths(ms); setSettings(d.settings);
      // Abre en el último mes completo; si solo hay uno, ese
      const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 7);
      const closed = ms.filter(m => m.month.slice(0, 7) !== today);
      setSel(prev => prev || (closed[closed.length - 1] ?? ms[ms.length - 1])?.month || "");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const i = months.findIndex(m => m.month === sel);
  const m = i >= 0 ? months[i] : null;
  const prev = i > 0 ? months[i - 1] : null;
  const vlim = settings?.speeding_kmh ?? 80;

  const rows = useMemo(() => {
    const vs = m?.vehicles ?? [];
    const val = (v: MV) => {
      const x = (v as unknown as Record<string, unknown>)[sort.key];
      if (sort.key === "first_move_avg" || sort.key === "last_move_avg") return x ? Number(String(x).replace(":", "")) : -1;
      return Number(x ?? 0);
    };
    return [...vs].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [m, sort]);

  // Hallazgos del mes, en lenguaje de jefe de flotilla
  const insights = useMemo(() => {
    const out: { tone: "info" | "warn" | "bad"; text: string; vehicleId?: string }[] = [];
    if (!m || m.km <= 0) return out;
    const vs = m.vehicles;
    const working = vs.filter(v => v.km >= 50);

    // Velocidad
    const totalSp = vs.reduce((a, v) => a + v.speeding, 0);
    if (totalSp > 0) {
      const bySp = [...vs].sort((a, b) => b.speeding - a.speeding).filter(v => v.speeding > 0);
      const top3 = bySp.slice(0, 3);
      const share = top3.reduce((a, v) => a + v.speeding, 0) / totalSp;
      out.push({ tone: "bad", vehicleId: top3[0].vehicle_id, text:
        `${nf0.format(totalSp)} excesos de ${vlim} km/h o más (${nf1.format(per1000(m))} por cada 1,000 km). ` +
        `${list(top3.map(v => `${name(v)} (${v.speeding})`))} ${top3.length > 1 ? "concentran" : "concentra"} el ${nf0.format(share * 100)}%: habla con sus choferes.` });
    }
    const fastest = [...vs].sort((a, b) => b.vmax - a.vmax)[0];
    if (fastest && fastest.vmax >= 120) out.push({ tone: "bad", vehicleId: fastest.vehicle_id, text: `${name(fastest)} llegó a ${fastest.vmax} km/h, la velocidad más alta del mes.` });

    // Fuera de horario y domingo
    const ah = working.filter(v => v.km >= 200 && v.km_after_hours / v.km > 0.3).sort((a, b) => b.km_after_hours / b.km - a.km_after_hours / a.km);
    if (ah.length) out.push({ tone: "warn", vehicleId: ah[0].vehicle_id, text:
      `${list(ah.slice(0, 3).map(v => `${name(v)} (${nf0.format((v.km_after_hours / v.km) * 100)}%)`))} ${ah.length > 1 ? "hicieron" : "hizo"} buena parte de sus km fuera de horario. ¿Son viajes autorizados?` });
    const sunday = vs.filter(v => (v.km_sunday ?? 0) >= 20).sort((a, b) => (b.km_sunday ?? 0) - (a.km_sunday ?? 0));
    if (sunday.length) out.push({ tone: "warn", vehicleId: sunday[0].vehicle_id, text:
      `Se manejaron ${nf0.format(sunday.reduce((a, v) => a + (v.km_sunday ?? 0), 0))} km en domingo: ${list(sunday.slice(0, 4).map(v => `${name(v)} (${nf0.format(v.km_sunday ?? 0)} km)`))}${sunday.length > 4 ? " y otras" : ""}.` });

    // Ralentí: motor encendido sin moverse
    const idle = working.filter(v => v.idle_h >= 5 && v.idle_h / (v.idle_h + v.moving_h) > 0.2).sort((a, b) => b.idle_h - a.idle_h);
    if (idle.length) out.push({ tone: "warn", vehicleId: idle[0].vehicle_id, text:
      `${list(idle.slice(0, 3).map(v => `${name(v)} (${nf0.format(v.idle_h)} h)`))} ${idle.length > 1 ? "pasaron" : "pasó"} mucho tiempo con el motor encendido sin moverse. Es gasolina que se quema sin trabajar.` });

    // Sin uso
    const unused = vs.filter(v => v.km < 50);
    const missing = m.units_total - vs.length;
    if (unused.length || missing > 0) out.push({ tone: "warn", text:
      `${unused.length + Math.max(0, missing)} de ${m.units_total} unidades casi no se usaron (menos de 50 km)${unused.length ? `: ${list(unused.map(name))}` : ""}. ¿Están en taller, sin chofer o sobran?` });

    // Contra el mes anterior (por día con datos)
    if (prev && prev.km > 0) {
      const r = (m.km / m.days_with_data) / (prev.km / prev.days_with_data) - 1;
      if (Math.abs(r) >= 0.1) out.push({ tone: "info", text: `La flotilla recorrió ${r > 0 ? "más" : "menos"} que en ${MESES[mIdx(prev.month)].toLowerCase()}: ${r > 0 ? "▲" : "▼"} ${nf0.format(Math.abs(r) * 100)}% por día.` });
      const drops = vs.map(v => {
        const pv = prev.vehicles.find(x => x.vehicle_id === v.vehicle_id);
        return pv && pv.km >= 500 ? { v, r: (v.km / m.days_with_data) / (pv.km / prev.days_with_data) - 1 } : null;
      }).filter((x): x is { v: MV; r: number } => !!x && x.r <= -0.5).sort((a, b) => a.r - b.r);
      if (drops.length) out.push({ tone: "warn", vehicleId: drops[0].v.vehicle_id, text:
        `Bajaron a la mitad o menos contra el mes anterior: ${list(drops.slice(0, 3).map(d => `${name(d.v)} (▼ ${nf0.format(Math.abs(d.r) * 100)}%)`))}.` });
    }

    // Horarios de salida y regreso
    const early = working.filter(v => v.first_move_avg && v.first_move_avg < "05:30");
    if (early.length) out.push({ tone: "info", text: `Salen muy temprano (promedio entre semana): ${list(early.slice(0, 4).map(v => `${name(v)} ${v.first_move_avg}`))}.` });
    const late = working.filter(v => v.last_move_avg && v.last_move_avg > "20:00");
    if (late.length) out.push({ tone: "info", text: `Regresan tarde (promedio entre semana): ${list(late.slice(0, 4).map(v => `${name(v)} ${v.last_move_avg}`))}.` });

    // La que más trabaja
    const top = [...vs].sort((a, b) => b.km - a.km)[0];
    if (top) out.push({ tone: "info", vehicleId: top.vehicle_id, text: `${name(top)} fue la que más trabajó: ${nf0.format(top.km)} km en ${top.active_days} días.` });
    return out;
  }, [m, prev, vlim]);

  const card = { background: "#FFFFFF", border: `1px solid ${t.lineL}`, borderRadius: 10, padding: "16px 18px" };
  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const ghost = { background: "transparent", color: t.ink, border: `1px solid ${t.lineL}`, borderRadius: 6, padding: "6px 10px", fontFamily: t.fBody, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" as const };

  /** ▲ 12% por día contra el mes anterior (verde/rojo según si subir es bueno) */
  const delta = (cur: number, before: number | null, goodUp: boolean) => {
    if (before == null || before <= 0) return null;
    const r = cur / before - 1;
    if (!Number.isFinite(r) || Math.abs(r) < 0.005) return <span style={{ color: t.mutedL }}>igual que el mes anterior</span>;
    const good = r > 0 === goodUp;
    return <span style={{ color: good ? "#2E7D32" : t.crimson, fontWeight: 600 }}>{r > 0 ? "▲" : "▼"} {nf0.format(Math.abs(r) * 100)}% vs mes anterior</span>;
  };
  const perDay = (x: Month | null, f: (mm: Month) => number) => (x && x.days_with_data ? f(x) / x.days_with_data : null);

  const th = (k: SortKey | null, txt: string, align: "left" | "right" = "right") => (
    <th style={{ ...label, textAlign: align, padding: "8px 10px", fontWeight: 500, cursor: k ? "pointer" : "default", whiteSpace: "nowrap" }}
      onClick={() => k && setSort(p => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : -1 }))}
      aria-sort={k && sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {txt}{k && sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  if (err) return <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.crimson }}>{err}</p>;
  if (loading && !months.length) return <p style={{ fontFamily: t.fMono, fontSize: 12, color: t.mutedL }}>Armando el reporte…</p>;
  if (!months.length) return <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.mutedL }}>Todavía no hay datos para el reporte mensual de esta flotilla.</p>;

  const maxKm = Math.max(1, ...rows.map(r => r.km));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Encabezado */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={label}>Reporte mensual de la flotilla</div>
          <div style={{ fontFamily: t.fBody, fontWeight: 800, fontSize: 22, color: t.ink, marginTop: 4 }}>{fleetName}</div>
        </div>
        {settings && (
          <div style={{ fontFamily: t.fMono, fontSize: 11, color: t.mutedL, textAlign: "right", lineHeight: 1.6 }}>
            Horario: {horarioTxt(settings)}<br />Exceso: {vlim} km/h o más · rendimiento {nf1.format(Number(settings.default_km_per_l))} km/l
          </div>
        )}
      </div>

      {/* Meses */}
      <div role="tablist" aria-label="Meses" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {months.map(mm => {
          const on = mm.month === sel;
          return (
            <button key={mm.month} role="tab" aria-selected={on} onClick={() => setSel(mm.month)} style={{
              flex: "0 0 auto", minWidth: 132, textAlign: "left", cursor: "pointer", borderRadius: 10, padding: "12px 14px",
              background: on ? t.ink : "#FFFFFF", color: on ? "#F6F9FE" : t.ink, border: `1px solid ${on ? t.ink : t.lineL}`,
            }}>
              <div style={{ fontFamily: t.fBody, fontWeight: 800, fontSize: 15, color: on ? t.signal : t.ink }}>{MESES[mIdx(mm.month)]} <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.7 }}>{mm.month.slice(0, 4)}</span></div>
              <div style={{ fontFamily: t.fMono, fontSize: 18, fontWeight: 700, marginTop: 4 }}>{nf0.format(mm.km)} <span style={{ fontSize: 11, fontWeight: 400 }}>km</span></div>
              <div style={{ fontFamily: t.fMono, fontSize: 10, marginTop: 3, color: on ? "#C9D3E6" : t.mutedL }}>{nf0.format(mm.speeding)} excesos · {coverage(mm)}</div>
            </button>
          );
        })}
      </div>

      {m && (<>
        {/* Cifras del mes */}
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          {([
            ["Unidades trabajando", `${m.units_active} de ${m.units_total}`, <>con 50 km o más · {coverage(m)}</>],
            ["Kilómetros", nf0.format(m.km), <>{nf0.format(m.km / m.days_with_data)} km por día · {delta(perDay(m, x => x.km)!, perDay(prev, x => x.km), true) ?? "primer mes con datos"}</>],
            ["En movimiento", `${nf0.format(m.moving_h)} h`, <>{nf1.format(m.moving_h / Math.max(1, m.units_active))} h por unidad trabajando</>],
            ["Ralentí", `${nf0.format(m.idle_h)} h`, <>motor encendido sin moverse · {nf0.format((m.idle_h / Math.max(1, m.idle_h + m.moving_h)) * 100)}% del tiempo encendido</>],
            ["Combustible (est.)", `${nf0.format(m.liters)} L`, <>{m.cost_mxn != null ? `≈ ${mxn.format(m.cost_mxn)}` : "precio por litro: defínelo en Flotilla → Ajustes"}</>],
            [`Excesos ≥${vlim}`, nf0.format(m.speeding), <>{nf1.format(per1000(m))} por cada 1,000 km · {delta(per1000(m), prev ? per1000(prev) : null, false) ?? ""}</>],
            ["Velocidad máxima", `${m.vmax} km/h`, <>{(() => { const f = [...m.vehicles].sort((a, b) => b.vmax - a.vmax)[0]; return f ? name(f) : ""; })()}</>],
            ["Fuera de horario", `${nf0.format(m.km ? (m.km_after_hours / m.km) * 100 : 0)}%`, <>{nf0.format(m.km_after_hours)} km fuera de horario</>],
          ] as [string, string, React.ReactNode][]).map(([k, v, sub]) => (
            <div key={k} style={card}>
              <div style={label}>{k}</div>
              <div style={{ fontFamily: t.fMono, fontSize: 22, fontWeight: 700, color: k.startsWith("Excesos") && m.speeding ? t.crimson : t.ink, marginTop: 6 }}>{v}</div>
              <div style={{ fontFamily: t.fBody, fontSize: 12, color: t.mutedL, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Hallazgos */}
        {insights.length > 0 && (
          <div style={{ ...card, background: t.ink, border: "none", color: "#F6F9FE" }}>
            <div style={{ ...label, color: t.signal }}>Para atender · {MESES[mIdx(m.month)].toLowerCase()}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
              {insights.map((x, k) => (
                <li key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span aria-hidden style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: 4, marginTop: 7, background: x.tone === "bad" ? "#E04E2A" : x.tone === "warn" ? "#F6A623" : t.signal }} />
                  <span style={{ fontFamily: t.fBody, fontSize: 14, lineHeight: 1.45 }}>
                    {x.text}
                    {x.vehicleId && (
                      <button onClick={() => onOpenVehicle(x.vehicleId!)} style={{ marginLeft: 8, background: "none", border: "none", color: t.signal, fontFamily: t.fMono, fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                        ver recorrido
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Unidades del mes */}
        <div style={card}>
          <div style={label}>Unidades en {MESES[mIdx(m.month)].toLowerCase()} · toca un encabezado para ordenar</div>
          <div className="lk-tablewrap" style={{ marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: t.fBody, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.lineL}` }}>
                  {th(null, "Unidad", "left")}
                  {th("km", "Km")}
                  {th("active_days", "Días")}
                  {th("moving_h", "En mov.")}
                  {th("idle_h", "Ralentí")}
                  {th("speeding", "Excesos")}
                  {th("vmax", "Vel. máx")}
                  {th("km_after_hours", "Fuera de horario")}
                  {th("km_sunday", "Domingo")}
                  {th("first_move_avg", "Sale")}
                  {th("last_move_avg", "Regresa")}
                  {th("liters", "Litros est.")}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const unused = r.km < 50;
                  const pctAH = r.km ? (r.km_after_hours / r.km) * 100 : 0;
                  return (
                    <tr key={r.vehicle_id} style={{ borderBottom: `1px solid ${t.paper2}`, opacity: unused ? 0.6 : 1 }}>
                      <td style={{ padding: 10, minWidth: 150 }}>
                        <div style={{ fontWeight: 700, color: t.ink, whiteSpace: "nowrap" }}>{name(r)}{r.alias && r.plate ? <span style={{ fontWeight: 400, color: t.mutedL }}> · {r.plate}</span> : null}</div>
                        <div style={{ fontFamily: t.fMono, fontSize: 10, color: t.mutedL, marginTop: 2 }}>{r.device_id}{unused ? " · sin uso" : ""}</div>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", minWidth: 100 }}>
                        <div style={{ fontFamily: t.fMono, fontWeight: 700 }}>{nf0.format(r.km)}</div>
                        <div style={{ height: 4, background: t.paper2, borderRadius: 2, marginTop: 4 }}>
                          <div style={{ height: 4, width: `${(r.km / maxKm) * 100}%`, background: unused ? "#B8AE98" : t.ink, borderRadius: 2, marginLeft: "auto" }} />
                        </div>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{r.active_days}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{nf0.format(r.moving_h)} h</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.idle_h >= 5 && r.idle_h / (r.idle_h + r.moving_h) > 0.2 ? "#B87500" : t.ink }}>{nf0.format(r.idle_h)} h</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.speeding ? t.crimson : t.ink, fontWeight: r.speeding ? 700 : 400 }}>{nf0.format(r.speeding)}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.vmax >= 120 ? t.crimson : t.ink }}>{r.vmax}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.km >= 200 && pctAH > 30 ? "#B87500" : t.ink, whiteSpace: "nowrap" }}>
                        {nf0.format(r.km_after_hours)} km <span style={{ color: t.mutedL }}>({nf0.format(pctAH)}%)</span>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: (r.km_sunday ?? 0) >= 20 ? "#B87500" : t.ink }}>{r.km_sunday ? `${nf0.format(r.km_sunday)} km` : "—"}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{r.first_move_avg ?? "—"}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{r.last_move_avg ?? "—"}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{nf0.format(r.liters)} L</td>
                      <td style={{ padding: 10, textAlign: "right" }}>
                        <button onClick={() => onOpenVehicle(r.vehicle_id)} style={ghost}>Ver recorrido</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontFamily: t.fBody, fontSize: 11, color: t.mutedL, margin: "10px 0 0", lineHeight: 1.5 }}>
            Sale / Regresa: hora promedio del primer y último movimiento en días hábiles. Ralentí: motor encendido sin moverse.
            Litros estimados: km ÷ rendimiento de cada unidad. Las comparaciones contra el mes anterior son por día con datos.
          </p>
        </div>

        {/* Tendencia */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          <div style={card}>
            <div style={label}>Kilómetros por día, mes a mes</div>
            <Bars t={t} every={1} data={months.map(mm => ({
              key: mm.month, label: MESES[mIdx(mm.month)].slice(0, 3), value: mm.km / mm.days_with_data,
              tip: `${MESES[mIdx(mm.month)]} · ${nf0.format(mm.km / mm.days_with_data)} km por día`,
            }))} />
          </div>
          <div style={card}>
            <div style={label}>Excesos por cada 1,000 km, mes a mes</div>
            <Bars t={t} every={1} data={months.map(mm => ({
              key: mm.month, label: MESES[mIdx(mm.month)].slice(0, 3), value: per1000(mm),
              tip: `${MESES[mIdx(mm.month)]} · ${nf1.format(per1000(mm))} excesos por cada 1,000 km`,
            }))} />
          </div>
        </div>
      </>)}
    </div>
  );
}
