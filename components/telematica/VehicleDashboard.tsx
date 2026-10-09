"use client";

// ─── Telemática · Recorridos — tablero de la unidad ─────────────────────────
// Lo más importante de una unidad en el rango elegido, calculado en el navegador
// con los mismos puntos que pinta el mapa:
//   cifras · km por día · uso por hora del día · alertas · estado del equipo.
//
// "En movimiento" no se basa solo en la velocidad reportada: hay equipos (Auto B
// del demo) que mandan velocidad 0 aunque se desplazan. Se cuenta movimiento si
// la velocidad pasa de 3 km/h o si el punto se movió más de 150 m respecto al
// anterior, con menos de 10 min entre ambos.

import { useMemo, useState } from "react";
import type { RecorridosTokens } from "./RecorridosTab";

export interface TP {
  ts: string; lat: number; lon: number; speed_kmh: number | null; heading: number | null;
  ignition: boolean | null; event_code: number | null; address: string | null;
  sats?: number | null; batt_gps_pct?: number | null; batt_vehicle_v?: number | null; odometer_m?: number | null;
}

export const SPEEDING_KMH = 80;
const NIGHT = [0, 5];                 // 00:00–04:59 cuenta como madrugada
const EV_IGN_ON = 13, EV_IGN_OFF = 14;

export function km(a: TP, b: TP) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const mins = (a: TP, b: TP) => (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 60000;
export const isGap = (a: TP, b: TP) => mins(a, b) > 20 && km(a, b) > 0.8;

const local = (ts: string) => {
  const d = new Date(new Date(ts).getTime() - 6 * 3600e3);   // CDMX, UTC-6 fijo
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};
const fmtTs = (ts: string) => new Date(ts).toLocaleString("es-MX", {
  timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});
const fmtDayShort = (d: string) => new Date(d + "T12:00:00-06:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "America/Mexico_City" });
const nf1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;

export interface Stay {
  lat: number; lon: number; address: string | null;
  minutes: number;      // tiempo total detenido ahí en el rango
  visits: number;       // llegadas con al menos 10 min de estancia
  nights: number;       // noches distintas en que estuvo ahí a las 3 a.m.
}

/**
 * Lugares donde la unidad pasa más tiempo detenida. Entre dos reportes seguidos
 * que casi no se movieron (<300 m) y sin velocidad, el tiempo se suma al lugar
 * del primero, aunque el equipo haya dejado de reportar un rato (de noche suele
 * mandar un latido por hora). Los lugares a menos de 200 m se juntan en uno.
 */
export function stays(pts: TP[], top = 5): Stay[] {
  const R = 0.2;
  const cl: (Stay & { n: number; lastIdx: number; nightKeys: Set<string>; curStart: number })[] = [];
  const find = (p: TP) => cl.find(c => km(c as unknown as TP, p) < R);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = km(a, b), m = mins(a, b);
    if (d >= 0.3 || (b.speed_kmh ?? 0) > 3 || m <= 0 || m > 24 * 60) continue;
    let c = find(a);
    if (!c) {
      c = { lat: a.lat, lon: a.lon, address: a.address, minutes: 0, visits: 0, nights: 0, n: 0, lastIdx: -10, nightKeys: new Set(), curStart: 0 };
      cl.push(c);
    }
    // centroide móvil para que el lugar no se "arrastre"
    c.lat = (c.lat * c.n + a.lat) / (c.n + 1); c.lon = (c.lon * c.n + a.lon) / (c.n + 1); c.n++;
    if (!c.address && a.address) c.address = a.address;
    if (c.lastIdx !== i - 1) { if (c.curStart >= 10) c.visits++; c.curStart = 0; }
    c.curStart += m; c.minutes += m; c.lastIdx = i;
    // ¿cubre las 3 a.m. (hora CDMX)?
    const t0 = new Date(a.ts).getTime(), t1 = new Date(b.ts).getTime();
    for (let t = Math.ceil((t0 - 9 * 3600e3) / 86400e3) * 86400e3 + 9 * 3600e3; t <= t1; t += 86400e3) {
      if (t >= t0) c.nightKeys.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  for (const c of cl) { if (c.curStart >= 10) c.visits++; c.nights = c.nightKeys.size; }
  return cl.filter(c => c.minutes >= 15)
    .sort((x, y) => y.minutes - x.minutes).slice(0, top)
    .map(({ lat, lon, address, minutes, visits, nights }) => ({ lat, lon, address, minutes, visits: Math.max(1, visits), nights }));
}

function analyze(pts: TP[]) {
  let dist = 0, moving = 0, vmax = 0, vmaxAt: TP | null = null, trips = 0;
  const kmDay = new Map<string, number>();
  const minHour = new Array(24).fill(0);
  const excesos: TP[] = [];
  const nightStarts: TP[] = [];
  let inTrip = false, tripKm = 0, lastMoveIdx = -1;
  let hasIgnEvents = false, ignTrue = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const v = p.speed_kmh ?? 0;
    if (v > vmax) { vmax = v; vmaxAt = p; }
    if (v >= SPEEDING_KMH) excesos.push(p);
    if (p.event_code === EV_IGN_ON || p.event_code === EV_IGN_OFF) hasIgnEvents = true;
    if (p.ignition) ignTrue++;
    if (p.event_code === EV_IGN_ON) {
      const h = local(p.ts).hour;
      if (h >= NIGHT[0] && h < NIGHT[1]) nightStarts.push(p);
    }
    if (i === 0) continue;
    const a = pts[i - 1], d = km(a, p), m = mins(a, p);
    if (!isGap(a, p) && d < 5) {
      dist += d;
      const k = local(p.ts).day;
      kmDay.set(k, (kmDay.get(k) ?? 0) + d);
    }
    const isMoving = m < 10 && (v > 3 || d > 0.15);
    if (isMoving) {
      moving += m;
      minHour[local(p.ts).hour] += m;
      if (!inTrip) { inTrip = true; tripKm = 0; }
      tripKm += d; lastMoveIdx = i;
    } else if (inTrip && (m >= 10 || mins(pts[lastMoveIdx], p) >= 10)) {
      if (tripKm > 0.5) trips++;
      inTrip = false;
    }
  }
  if (inTrip && tripKm > 0.5) trips++;

  // Días del rango, incluso los que no tuvieron uso (barra en cero)
  const days: { day: string; km: number }[] = [];
  if (pts.length) {
    const first = local(pts[0].ts).day, last = local(pts[pts.length - 1].ts).day;
    for (let d = new Date(first + "T00:00:00Z"); d.toISOString().slice(0, 10) <= last; d = new Date(d.getTime() + 86400e3)) {
      const k = d.toISOString().slice(0, 10);
      days.push({ day: k, km: kmDay.get(k) ?? 0 });
    }
  }

  const odo = pts.map(p => p.odometer_m).filter((x): x is number => typeof x === "number" && x > 0);
  const odoFrozen = odo.length > 10 && Math.max(...odo) === Math.min(...odo) && dist > 5;
  const noIgnition = !hasIgnEvents && ignTrue === 0 && dist > 5;

  return {
    dist, moving, vmax, vmaxAt, trips, days, minHour, excesos, nightStarts,
    activeDays: days.filter(d => d.km > 0.5).length,
    avgMoving: moving > 0 ? dist / (moving / 60) : 0,
    odoFrozen, noIgnition,
  };
}

export default function VehicleDashboard({ pts, t }: { pts: TP[]; t: RecorridosTokens }) {
  const a = useMemo(() => analyze(pts), [pts]);
  const top = useMemo(() => stays(pts), [pts]);
  const last = pts[pts.length - 1];

  const card = { background: "#FBF9F3", border: `1px solid ${t.lineL}`, borderRadius: 10, padding: "16px 18px" };
  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const big = { fontFamily: t.fMono, fontSize: 22, fontWeight: 700, color: t.ink, marginTop: 6 };

  if (!pts.length) return null;

  const alerts: { tone: "alta" | "media"; title: string; detail: string }[] = [];
  if (a.excesos.length) alerts.push({
    tone: "alta", title: `${a.excesos.length} exceso${a.excesos.length > 1 ? "s" : ""} de velocidad (≥${SPEEDING_KMH} km/h)`,
    detail: a.excesos.slice(0, 3).map(p => `${p.speed_kmh} km/h · ${fmtTs(p.ts)}`).join("  ·  ") + (a.excesos.length > 3 ? "  ·  …" : ""),
  });
  if (a.nightStarts.length) alerts.push({
    tone: "media", title: `${a.nightStarts.length} encendido${a.nightStarts.length > 1 ? "s" : ""} de madrugada (00:00–05:00)`,
    detail: a.nightStarts.slice(0, 3).map(p => fmtTs(p.ts)).join("  ·  ") + (a.nightStarts.length > 3 ? "  ·  …" : ""),
  });
  if (a.noIgnition) alerts.push({ tone: "media", title: "El equipo no reporta ignición", detail: "La unidad se movió pero nunca marcó encendido. Revisar la conexión del cable de ignición." });
  if (a.odoFrozen) alerts.push({ tone: "media", title: "Odómetro sin cambio", detail: "El odómetro del equipo no avanzó en todo el periodo; los km se calculan con el GPS." });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
      {/* Cifras */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        {[
          ["Kilómetros", nf1.format(a.dist), "por GPS"],
          ["Viajes", String(a.trips), `${a.activeDays} de ${a.days.length} días con uso`],
          ["En movimiento", hm(a.moving), `prom. ${nf1.format(a.avgMoving)} km/h`],
          ["Vel. máxima", `${a.vmax} km/h`, a.vmaxAt ? fmtTs(a.vmaxAt.ts) : ""],
          ["Alertas", String(alerts.length), alerts.length ? "ver abajo" : "sin novedades"],
        ].map(([k, v, sub]) => (
          <div key={k} style={card}>
            <div style={label}>{k}</div>
            <div style={{ ...big, color: k === "Alertas" && alerts.length ? t.crimson : t.ink }}>{v}</div>
            <div style={{ fontFamily: t.fBody, fontSize: 12, color: t.mutedL, marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* Km por día */}
        <div style={card}>
          <div style={label}>Kilómetros por día</div>
          <Bars t={t} data={a.days.map(d => ({ key: d.day, label: fmtDayShort(d.day), value: d.km, tip: `${fmtDayShort(d.day)} · ${nf1.format(d.km)} km` }))}
            every={Math.ceil(a.days.length / 8)} />
        </div>
        {/* Uso por hora */}
        <div style={card}>
          <div style={label}>¿A qué hora se usa? · minutos en movimiento</div>
          <Bars t={t} data={a.minHour.map((m, h) => ({ key: String(h), label: `${h}h`, value: m, tip: `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59 · ${Math.round(m)} min`, night: h >= NIGHT[0] && h < NIGHT[1] }))}
            every={3} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* Alertas */}
        <div style={card}>
          <div style={label}>Alertas del periodo</div>
          {alerts.length === 0 && <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.ink, margin: "10px 0 0" }}>✓ Sin alertas en este rango.</p>}
          {alerts.map(al => (
            <div key={al.title} style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <span aria-hidden style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: 5, marginTop: 5, background: al.tone === "alta" ? t.crimson : "#F6A623" }} />
              <div>
                <div style={{ fontFamily: t.fBody, fontWeight: 600, fontSize: 14, color: t.ink }}>
                  <span style={{ fontFamily: t.fMono, fontSize: 10, letterSpacing: "0.12em", color: al.tone === "alta" ? t.crimson : "#B87500", marginRight: 8 }}>
                    {al.tone === "alta" ? "ALTA" : "REVISAR"}
                  </span>{al.title}
                </div>
                <div style={{ fontFamily: t.fBody, fontSize: 12, color: t.mutedL, marginTop: 3 }}>{al.detail}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Dónde se estaciona */}
        <div style={card}>
          <div style={label}>Dónde pasa más tiempo detenido</div>
          {!top.length && <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.mutedL, margin: "10px 0 0" }}>Sin paradas largas en este rango.</p>}
          <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
            {top.map((st, i) => (
              <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 11, background: t.ink, color: t.signal, fontFamily: t.fMono, fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center" }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: t.fBody, fontSize: 14, color: t.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {st.address?.split(",").slice(0, 2).join(",") ?? `${st.lat.toFixed(4)}, ${st.lon.toFixed(4)}`}
                  </div>
                  <div style={{ fontFamily: t.fMono, fontSize: 11, color: t.mutedL, marginTop: 2 }}>
                    {hm(st.minutes)} · {st.visits} {st.visits === 1 ? "visita" : "visitas"}{st.nights ? ` · ${st.nights} ${st.nights === 1 ? "noche" : "noches"}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        {/* Estado del equipo */}
        <div style={card}>
          <div style={label}>Estado del equipo · último reporte del rango</div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", margin: "12px 0 0", fontFamily: t.fBody, fontSize: 14 }}>
            <dt style={{ color: t.mutedL }}>Último reporte</dt><dd style={{ margin: 0, fontFamily: t.fMono }}>{fmtTs(last.ts)}</dd>
            <dt style={{ color: t.mutedL }}>Ubicación</dt><dd style={{ margin: 0 }}>{last.address ?? `${last.lat.toFixed(5)}, ${last.lon.toFixed(5)}`}</dd>
            <dt style={{ color: t.mutedL }}>Batería del vehículo</dt><dd style={{ margin: 0, fontFamily: t.fMono }}>{last.batt_vehicle_v != null ? `${last.batt_vehicle_v} V` : "—"}</dd>
            <dt style={{ color: t.mutedL }}>Batería del GPS</dt><dd style={{ margin: 0, fontFamily: t.fMono }}>{last.batt_gps_pct != null ? `${last.batt_gps_pct}%` : "—"}</dd>
            <dt style={{ color: t.mutedL }}>Satélites</dt><dd style={{ margin: 0, fontFamily: t.fMono }}>{last.sats ?? "sin dato"}</dd>
            <dt style={{ color: t.mutedL }}>Ignición</dt><dd style={{ margin: 0, fontFamily: t.fMono }}>{a.noIgnition ? "no reporta" : last.ignition ? "encendido" : "apagado"}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

/** Barras verticales de una sola serie, con tooltip al pasar el mouse. */
function Bars({ data, t, every }: {
  data: { key: string; label: string; value: number; tip: string; night?: boolean }[];
  t: RecorridosTokens; every: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 600, H = 150, pad = { t: 18, b: 22, l: 4, r: 4 };
  const max = Math.max(1, ...data.map(d => d.value));
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const h = (v: number) => (v / max) * (H - pad.t - pad.b);
  const peak = data.reduce((m, d) => (d.value > m.value ? d : m), data[0] ?? { key: "", value: 0 });
  const hov = data.find(d => d.key === hover);

  return (
    <div style={{ position: "relative", marginTop: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img"
        aria-label={data.map(d => d.tip).join("; ")} onMouseLeave={() => setHover(null)}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={t.lineL} strokeWidth={1} />
        {data.map((d, i) => {
          const x = pad.l + i * bw, bh = h(d.value), y = H - pad.b - bh;
          const w = Math.max(2, bw - 2);
          const r = Math.min(4, w / 2, bh);
          const fill = d.night ? "#6E6655" : t.ink;
          return (
            <g key={d.key} onMouseEnter={() => setHover(d.key)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {bh > 0 && (
                <path d={`M${x + 1},${H - pad.b} V${y + r} Q${x + 1},${y} ${x + 1 + r},${y} H${x + 1 + w - r} Q${x + 1 + w},${y} ${x + 1 + w},${y + r} V${H - pad.b} Z`}
                  fill={fill} opacity={hover && hover !== d.key ? 0.45 : 1} />
              )}
              {i % every === 0 && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={t.mutedL} fontFamily="ui-monospace, monospace">{d.label}</text>
              )}
            </g>
          );
        })}
        {peak && peak.value > 0 && !hover && (() => {
          const i = data.indexOf(peak);
          return <text x={pad.l + i * bw + bw / 2} y={H - pad.b - h(peak.value) - 5} textAnchor="middle" fontSize={11} fill={t.ink} fontFamily="ui-monospace, monospace">{Math.round(peak.value)}</text>;
        })()}
      </svg>
      {hov && (
        <div style={{ position: "absolute", top: -6, right: 0, background: t.ink, color: "#F2EEE6", borderRadius: 6, padding: "4px 8px", fontFamily: t.fMono, fontSize: 11, pointerEvents: "none" }}>
          {hov.tip}
        </div>
      )}
    </div>
  );
}
