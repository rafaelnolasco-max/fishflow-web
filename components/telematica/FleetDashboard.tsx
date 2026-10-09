"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Telemática · Recorridos — tablero de flotilla (vista del dueño) ────────
// Aparece cuando una flotilla tiene 3 o más unidades con datos. Responde lo que
// pregunta un dueño de flotilla: qué unidad trabaja más y cuál está ociosa,
// cuánto combustible se va (estimado), quién usa la unidad fuera de horario,
// quién corre y qué equipo dejó de reportar. Los números salen de la función
// SQL telematica_fleet_summary (mismos criterios que el tablero por unidad).
//
// Combustible: sin sensor, litros = km ÷ rendimiento (km/l) de cada unidad, o
// el de la flotilla si la unidad no tiene uno. Todo editable y marcado como
// estimado.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecorridosTokens } from "./RecorridosTab";
import { Bars } from "./VehicleDashboard";
import { BASEMAPS, loadMapLibre } from "./maplibre";

interface FV {
  id: string; device_id: string; alias: string | null; plate: string | null; fuel_km_per_l: number | null;
  km: number; moving_min: number; active_days: number; vmax: number; speeding: number;
  km_after_hours: number; night_starts: number; ign_reported: boolean; speed_reported: boolean; odo_frozen: boolean;
  last_ts: string | null; last_lat: number | null; last_lon: number | null; last_address: string | null;
}
interface Settings {
  fuel_price_mxn: number | null; default_km_per_l: number; work_start_hour: number; work_end_hour: number;
  work_days: number[]; speeding_kmh: number;
}
interface Summary { from: string | null; to: string | null; vehicles: FV[]; daily: { day: string; km: number }[]; settings: Settings }

type SortKey = "km" | "moving_min" | "active_days" | "km_after_hours" | "speeding" | "vmax" | "liters" | "last_ts";

const nf0 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const DIAS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const hrs = (m: number) => `${nf0.format(Math.floor(m / 60))} h`;
const name = (v: FV) => v.alias || v.plate || `Equipo ${v.device_id}`;
const fmtDayShort = (d: string) => new Date(d + "T12:00:00-06:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: "America/Mexico_City" });
function ago(ts: string | null) {
  if (!ts) return { txt: "nunca", h: Infinity };
  const h = (Date.now() - new Date(ts).getTime()) / 3600e3;
  if (h < 1) return { txt: "hace minutos", h };
  if (h < 24) return { txt: `hace ${Math.floor(h)} h`, h };
  return { txt: `hace ${Math.floor(h / 24)} d`, h };
}

export default function FleetDashboard({ clientId, fleetName, t, onOpenVehicle }: {
  clientId: string; fleetName: string; t: RecorridosTokens; onOpenVehicle: (vehicleId: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "km", dir: -1 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { alias: string; plate: string; kml: string }>>({});
  const [cfgDraft, setCfgDraft] = useState({ price: "", kml: "", vlim: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (f?: string, tt?: string) => {
    setLoading(true); setErr("");
    try {
      const q = new URLSearchParams({ client_id: clientId });
      if (f && tt) { q.set("from", f); q.set("to", tt); }
      const res = await fetch(`/api/telematica/fleet-summary?${q}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "No se pudo cargar el resumen");
      setData(d);
      if (d.from) setFrom(d.from);
      if (d.to) setTo(d.to);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const s = data?.settings;
  const kmlOf = useCallback((v: FV) => Number(v.fuel_km_per_l ?? s?.default_km_per_l ?? 8), [s]);

  const rows = useMemo(() => {
    const vs = (data?.vehicles ?? []).map(v => {
      const liters = v.km / kmlOf(v);
      return { ...v, liters, cost: s?.fuel_price_mxn ? liters * Number(s.fuel_price_mxn) : null };
    });
    const val = (r: typeof vs[number]) => sort.key === "last_ts" ? (r.last_ts ? new Date(r.last_ts).getTime() : 0) : Number((r as any)[sort.key] ?? 0);
    return [...vs].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [data, sort, kmlOf, s]);

  const tot = useMemo(() => {
    const vs = rows;
    const km = vs.reduce((a, v) => a + v.km, 0);
    const kmAH = vs.reduce((a, v) => a + v.km_after_hours, 0);
    const liters = vs.reduce((a, v) => a + v.liters, 0);
    return {
      units: vs.length, active: vs.filter(v => v.km > 5).length, km, kmAH,
      moving: vs.reduce((a, v) => a + v.moving_min, 0), liters,
      cost: s?.fuel_price_mxn ? liters * Number(s.fuel_price_mxn) : null,
      speeding: vs.reduce((a, v) => a + v.speeding, 0),
      avgKm: vs.length ? km / vs.length : 0,
    };
  }, [rows, s]);

  // Hallazgos para el dueño, en lenguaje llano
  const insights = useMemo(() => {
    const out: { tone: "info" | "warn" | "bad"; text: string; vehicleId?: string }[] = [];
    if (!rows.length || tot.km <= 0) return out;
    const byKm = [...rows].sort((a, b) => b.km - a.km);
    const top = byKm[0];
    out.push({ tone: "info", vehicleId: top.id, text: `${name(top)} es la que más trabaja: ${nf0.format(top.km)} km, el ${nf0.format((top.km / tot.km) * 100)}% de toda la flotilla.` });
    const idle = byKm.filter(v => v.km < tot.avgKm * 0.4);
    if (idle.length) out.push({ tone: "warn", vehicleId: idle[idle.length - 1].id, text: `${idle.length === 1 ? name(idle[0]) + " casi no se usa" : idle.length + " unidades casi no se usan"}: menos del 40% del promedio (${nf0.format(tot.avgKm)} km). ¿Se puede reasignar, rentar o vender?` });
    const ah = [...rows].filter(v => v.km > 20).sort((a, b) => b.km_after_hours / b.km - a.km_after_hours / a.km)[0];
    if (ah && ah.km_after_hours / ah.km > 0.25) out.push({ tone: "warn", vehicleId: ah.id, text: `${name(ah)} hizo el ${nf0.format((ah.km_after_hours / ah.km) * 100)}% de sus km fuera de horario (${nf0.format(ah.km_after_hours)} km). Vale la pena preguntar para qué.` });
    const sp = [...rows].sort((a, b) => b.speeding - a.speeding)[0];
    if (sp && sp.speeding > 0) out.push({ tone: "bad", vehicleId: sp.id, text: `${name(sp)} acumula ${nf0.format(sp.speeding)} excesos de ${s?.speeding_kmh ?? 80} km/h o más (máx. ${sp.vmax} km/h).` });
    const silent = rows.filter(v => ago(v.last_ts).h > 24);
    if (silent.length) out.push({ tone: "bad", text: `${silent.length === 1 ? name(silent[0]) + " no reporta" : silent.length + " unidades no reportan"} desde hace más de 24 horas: revisar equipo o batería.` });
    const faults = rows.filter(v => !v.ign_reported || v.odo_frozen);
    if (faults.length) out.push({ tone: "warn", text: `${faults.map(name).join(", ")}: el equipo no reporta ${faults.every(f => !f.ign_reported) ? "ignición" : "ignición u odómetro"}. Agendar revisión con Lukon.` });
    return out;
  }, [rows, tot, s]);

  async function saveEdits() {
    setSaving(true); setErr("");
    try {
      const body: Record<string, unknown> = { client_id: clientId };
      if (cfgDraft.price !== "") body.fuel_price_mxn = cfgDraft.price;
      if (cfgDraft.kml !== "") body.default_km_per_l = cfgDraft.kml;
      if (cfgDraft.vlim !== "") body.speeding_kmh = cfgDraft.vlim;
      body.vehicles = Object.entries(draft).map(([id, d]) => ({ id, alias: d.alias, plate: d.plate, fuel_km_per_l: d.kml }));
      const res = await fetch("/api/telematica/fleet-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error ?? "No se pudo guardar");
      setEditing(false); setDraft({}); setCfgDraft({ price: "", kml: "", vlim: "" });
      await load(from, to);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function startEdit() {
    const d: typeof draft = {};
    for (const v of data?.vehicles ?? []) d[v.id] = { alias: v.alias ?? "", plate: v.plate ?? "", kml: v.fuel_km_per_l != null ? String(v.fuel_km_per_l) : "" };
    setDraft(d);
    setCfgDraft({ price: s?.fuel_price_mxn != null ? String(s.fuel_price_mxn) : "", kml: String(s?.default_km_per_l ?? 8), vlim: String(s?.speeding_kmh ?? 80) });
    setEditing(true);
  }

  const card = { background: "#FBF9F3", border: `1px solid ${t.lineL}`, borderRadius: 10, padding: "16px 18px" };
  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const input = { padding: "8px 10px", border: `1px solid ${t.lineL}`, borderRadius: 6, background: "#fff", fontFamily: t.fBody, fontSize: 14, color: t.ink };
  const btn = { background: t.ink, color: t.signal, border: "none", borderRadius: 6, padding: "10px 18px", fontFamily: t.fBody, fontWeight: 700, fontSize: 14, cursor: "pointer" };
  const ghost = { background: "transparent", color: t.ink, border: `1px solid ${t.lineL}`, borderRadius: 6, padding: "9px 14px", fontFamily: t.fBody, fontWeight: 600, fontSize: 13, cursor: "pointer" };
  const maxKm = Math.max(1, ...rows.map(r => r.km));
  const horario = s ? `${s.work_days.map(d => DIAS[d]).join(" ")} · ${s.work_start_hour}:00–${s.work_end_hour}:00` : "";

  const th = (k: SortKey | null, txt: string, align: "left" | "right" = "right") => (
    <th style={{ ...label, textAlign: align, padding: "8px 10px", fontWeight: 500, cursor: k ? "pointer" : "default", whiteSpace: "nowrap" }}
      onClick={() => k && setSort(p => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : -1 }))}
      aria-sort={k && sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {txt}{k && sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Encabezado y rango */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 240px" }}>
          <div style={label}>Resumen de la flotilla</div>
          <div style={{ fontFamily: t.fBody, fontWeight: 800, fontSize: 22, color: t.ink, marginTop: 4 }}>{fleetName}</div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Desde</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Hasta</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} />
        </label>
        <button style={{ ...btn, opacity: loading ? 0.6 : 1 }} disabled={loading || !from || !to || from > to} onClick={() => load(from, to)}>
          {loading ? "Calculando…" : "Actualizar"}
        </button>
      </div>

      {err && <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.crimson, margin: 0 }}>{err}</p>}
      {!data && loading && <p style={{ fontFamily: t.fMono, fontSize: 12, color: t.mutedL }}>Calculando la flotilla…</p>}

      {data && (<>
        {/* Cifras */}
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[
            ["Unidades activas", `${tot.active} de ${tot.units}`, "con más de 5 km en el periodo"],
            ["Kilómetros", nf0.format(tot.km), `prom. ${nf0.format(tot.avgKm)} km por unidad`],
            ["En movimiento", hrs(tot.moving), "suma de toda la flotilla"],
            ["Combustible (est.)", `${nf0.format(tot.liters)} L`, tot.cost != null ? `≈ ${mxn.format(tot.cost)}` : "define el precio por litro en Ajustes"],
            ["Fuera de horario", `${nf0.format(tot.km ? (tot.kmAH / tot.km) * 100 : 0)}%`, `${nf0.format(tot.kmAH)} km · ${horario}`],
            [`Excesos ≥${s?.speeding_kmh ?? 80}`, nf0.format(tot.speeding), "episodios en el periodo"],
          ].map(([k, v, sub]) => (
            <div key={k} style={card}>
              <div style={label}>{k}</div>
              <div style={{ fontFamily: t.fMono, fontSize: 22, fontWeight: 700, color: k.startsWith("Excesos") && tot.speeding ? t.crimson : t.ink, marginTop: 6 }}>{v}</div>
              <div style={{ fontFamily: t.fBody, fontSize: 12, color: t.mutedL, marginTop: 4 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Hallazgos */}
        {insights.length > 0 && (
          <div style={{ ...card, background: t.ink, border: "none", color: "#F2EEE6" }}>
            <div style={{ ...label, color: t.signal }}>Lo que hay que saber</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
              {insights.map((i, k) => (
                <li key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span aria-hidden style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: 4, marginTop: 7, background: i.tone === "bad" ? "#E04E2A" : i.tone === "warn" ? "#F6A623" : t.signal }} />
                  <span style={{ fontFamily: t.fBody, fontSize: 14, lineHeight: 1.45 }}>
                    {i.text}
                    {i.vehicleId && (
                      <button onClick={() => onOpenVehicle(i.vehicleId!)} style={{ marginLeft: 8, background: "none", border: "none", color: t.signal, fontFamily: t.fMono, fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                        ver recorrido
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ranking */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={label}>Ranking de unidades · toca un encabezado para ordenar</div>
            {!editing
              ? <button style={ghost} onClick={startEdit}>Ajustes y nombres</button>
              : <div style={{ display: "flex", gap: 8 }}>
                  <button style={ghost} onClick={() => setEditing(false)} disabled={saving}>Cancelar</button>
                  <button style={btn} onClick={saveEdits} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
                </div>}
          </div>

          {editing && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "14px 0 4px", padding: 12, background: t.paper2, borderRadius: 8 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>Precio por litro (MXN)</span>
                <input type="number" step="0.01" min="1" placeholder="p. ej. 24.50" value={cfgDraft.price} onChange={e => setCfgDraft(c => ({ ...c, price: e.target.value }))} style={{ ...input, width: 140 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>Rendimiento por defecto (km/l)</span>
                <input type="number" step="0.1" min="0.5" value={cfgDraft.kml} onChange={e => setCfgDraft(c => ({ ...c, kml: e.target.value }))} style={{ ...input, width: 140 }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={label}>Límite de velocidad (km/h)</span>
                <input type="number" step="1" min="30" max="160" value={cfgDraft.vlim} onChange={e => setCfgDraft(c => ({ ...c, vlim: e.target.value }))} style={{ ...input, width: 140 }} />
              </label>
            </div>
          )}

          <div className="lk-tablewrap" style={{ marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: t.fBody, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.lineL}` }}>
                  {th(null, "Unidad", "left")}
                  {th("km", "Km")}
                  {th("moving_min", "En mov.")}
                  {th("active_days", "Días")}
                  {th("km_after_hours", "Fuera de horario")}
                  {th("speeding", "Excesos")}
                  {th("vmax", "Vel. máx")}
                  {th("liters", editing ? "km/l" : "Litros est.")}
                  {th("last_ts", "Último reporte")}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const a = ago(r.last_ts);
                  const d = draft[r.id];
                  const idle = r.km < tot.avgKm * 0.4;
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${t.paper2}` }}>
                      <td style={{ padding: "10px", minWidth: 180 }}>
                        {editing && d ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <input aria-label="Nombre" placeholder="Nombre" value={d.alias} onChange={e => setDraft(p => ({ ...p, [r.id]: { ...d, alias: e.target.value } }))} style={{ ...input, width: 120, padding: "6px 8px" }} />
                            <input aria-label="Placa" placeholder="Placa" value={d.plate} onChange={e => setDraft(p => ({ ...p, [r.id]: { ...d, plate: e.target.value } }))} style={{ ...input, width: 90, padding: "6px 8px" }} />
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700, color: t.ink }}>{name(r)}{r.alias && r.plate ? <span style={{ fontWeight: 400, color: t.mutedL }}> · {r.plate}</span> : null}</div>
                            <div style={{ fontFamily: t.fMono, fontSize: 10, color: t.mutedL, marginTop: 2 }}>
                              {r.device_id}{idle ? " · poco uso" : ""}{!r.ign_reported ? " · sin ignición" : ""}{!r.speed_reported ? " · vel. calculada" : ""}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ padding: 10, textAlign: "right", minWidth: 120 }}>
                        <div style={{ fontFamily: t.fMono, fontWeight: 700 }}>{nf0.format(r.km)}</div>
                        <div style={{ height: 4, background: t.paper2, borderRadius: 2, marginTop: 4 }}>
                          <div style={{ height: 4, width: `${(r.km / maxKm) * 100}%`, background: idle ? "#B8AE98" : t.ink, borderRadius: 2, marginLeft: "auto" }} />
                        </div>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{hrs(r.moving_min)}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{r.active_days}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.km && r.km_after_hours / r.km > 0.25 ? "#B87500" : t.ink }}>
                        {nf0.format(r.km_after_hours)} km <span style={{ color: t.mutedL }}>({nf0.format(r.km ? (r.km_after_hours / r.km) * 100 : 0)}%)</span>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, color: r.speeding ? t.crimson : t.ink, fontWeight: r.speeding ? 700 : 400 }}>{nf0.format(r.speeding)}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>{r.vmax}</td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono }}>
                        {editing && d ? (
                          <input aria-label="Rendimiento km/l" type="number" step="0.1" placeholder={String(s?.default_km_per_l ?? 8)} value={d.kml}
                            onChange={e => setDraft(p => ({ ...p, [r.id]: { ...d, kml: e.target.value } }))} style={{ ...input, width: 70, padding: "6px 8px", textAlign: "right" }} />
                        ) : (
                          <>
                            <div>{nf0.format(r.liters)} L</div>
                            <div style={{ fontSize: 10, color: t.mutedL }}>{r.cost != null ? mxn.format(r.cost) + " · " : ""}{nf1.format(kmlOf(r))} km/l{r.fuel_km_per_l == null ? "*" : ""}</div>
                          </>
                        )}
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontFamily: t.fMono, fontSize: 12, color: a.h > 24 ? t.crimson : t.ink, whiteSpace: "nowrap" }}>{a.txt}</td>
                      <td style={{ padding: 10, textAlign: "right" }}>
                        <button onClick={() => onOpenVehicle(r.id)} style={{ ...ghost, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Ver recorrido</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontFamily: t.fBody, fontSize: 11, color: t.mutedL, margin: "10px 0 0" }}>
            Combustible estimado: km ÷ rendimiento de cada unidad (* = rendimiento por defecto de la flotilla). Fuera de horario: fuera de {horario}.
            “Vel. calculada”: el equipo no manda velocidad y se estima con la distancia entre reportes.
          </p>
        </div>

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div style={card}>
            <div style={label}>Kilómetros por día · toda la flotilla</div>
            <Bars t={t} every={Math.max(1, Math.ceil(data.daily.length / 8))}
              data={data.daily.map(d => ({ key: d.day, label: fmtDayShort(d.day), value: Number(d.km), tip: `${fmtDayShort(d.day)} · ${nf0.format(Number(d.km))} km` }))} />
          </div>
          <div style={card}>
            <div style={label}>¿Dónde están? · último reporte de cada unidad</div>
            <LastPositions rows={rows} t={t} onOpen={onOpenVehicle} />
          </div>
        </div>
      </>)}
    </div>
  );
}

/** Mapa con la última posición de cada unidad (OpenFreeMap, estilo claro). */
function LastPositions({ rows, t, onOpen }: { rows: FV[]; t: RecorridosTokens; onOpen: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marks = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then(ml => {
      if (cancelled || !el.current || map.current) return;
      const m = new ml.Map({ container: el.current, style: BASEMAPS.claro, center: [-99.14, 19.4], zoom: 8, attributionControl: { compact: true } });
      m.addControl(new ml.NavigationControl({ showCompass: false }), "top-left");
      m.on("load", () => setReady(true));
      map.current = m;
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, ml = (window as any).maplibregl;
    if (!ready || !m || !ml) return;
    marks.current.forEach(x => x.remove()); marks.current = [];
    const pts = rows.filter(r => r.last_lat != null && r.last_lon != null);
    pts.forEach(r => {
      const stale = r.last_ts ? (Date.now() - new Date(r.last_ts).getTime()) / 3600e3 > 24 : true;
      const div = document.createElement("button");
      div.type = "button";
      div.title = `${name(r)} · ${r.last_address ?? ""}`;
      div.textContent = name(r);
      div.style.cssText = `background:${stale ? "#E04E2A" : "#0B0F14"};color:${stale ? "#fff" : t.signal};border:2px solid #fff;border-radius:12px;padding:3px 8px;font:700 11px ui-monospace,monospace;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.25)`;
      div.onclick = () => onOpen(r.id);
      marks.current.push(new ml.Marker({ element: div }).setLngLat([r.last_lon, r.last_lat]).addTo(m));
    });
    if (pts.length) {
      let w = 180, e = -180, so = 90, n = -90;
      for (const p of pts) { w = Math.min(w, p.last_lon!); e = Math.max(e, p.last_lon!); so = Math.min(so, p.last_lat!); n = Math.max(n, p.last_lat!); }
      m.resize();
      m.fitBounds([[w, so], [e, n]], { padding: 50, duration: 0, maxZoom: 13 });
    }
  }, [rows, ready, t, onOpen]);

  return <div ref={el} style={{ height: 300, borderRadius: 8, overflow: "hidden", marginTop: 10, background: "#F2F2F0", isolation: "isolate" }} />;
}
