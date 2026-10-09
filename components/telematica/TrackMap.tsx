"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Telemática · Recorridos — mapa con reproducción ─────────────────────────
// Escoges unidad y rango de días; se dibuja el recorrido y se puede reproducir
// (play, velocidad, barra para adelantar/regresar). Leaflet se carga desde
// cdnjs al abrir el mapa, igual que en la hoja de pedido de Los Aguachiles: sin
// dependencia nueva en package.json. Teselas de OpenStreetMap (sin llave)
// oscurecidas con CSS para que el trazo lima de Lukon se lea bien.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecorridosTokens } from "./RecorridosTab";
import VehicleDashboard, { isGap, SPEEDING_KMH, type TP } from "./VehicleDashboard";

interface VehicleOpt { id: string; alias: string | null; plate: string | null; device_id: string; points: number }

const SPEEDS = [
  { label: "Lento", pps: 8 },
  { label: "Normal", pps: 30 },
  { label: "Rápido", pps: 120 },
];
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";

/** Cortes del trazo: arreglos de [lat, lon] separados donde el equipo dejó de reportar. */
function segments(pts: TP[]) {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0 && isGap(pts[i - 1], p)) { if (cur.length) out.push(cur); cur = []; }
    cur.push([p.lat, p.lon]);
  });
  if (cur.length) out.push(cur);
  return out;
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (w.__leafletLoading) return w.__leafletLoading;
  w.__leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = LEAFLET + "leaflet.min.js";
    js.onload = () => resolve(w.L);
    js.onerror = () => reject(new Error("No se pudo cargar el mapa (Leaflet)."));
    document.head.appendChild(js);
  });
  return w.__leafletLoading;
}

export default function TrackMap({ vehicles, t }: { vehicles: VehicleOpt[]; t: RecorridosTokens }) {
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pts, setPts] = useState<TP[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layers = useRef<any>({});
  const idxRef = useRef(0);

  const withData = useMemo(() => vehicles.filter(v => v.points > 0), [vehicles]);
  useEffect(() => {
    if (!withData.some(v => v.id === vehicleId)) setVehicleId(withData[0]?.id ?? "");
  }, [withData, vehicleId]);

  const fetchTrack = useCallback(async (vid: string, f?: string, tt?: string) => {
    if (!vid) return;
    setLoading(true); setErr(""); setPlaying(false);
    try {
      const q = new URLSearchParams({ vehicle_id: vid });
      if (f && tt) { q.set("from", f); q.set("to", tt); }
      const res = await fetch(`/api/telematica/track?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el recorrido");
      setPts(data.points ?? []);
      if (data.from) setFrom(data.from);
      if (data.to) setTo(data.to);
      const last = Math.max(0, (data.points?.length ?? 1) - 1);
      idxRef.current = last; setIdx(last);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Al cambiar de unidad: últimos 7 días con datos
  useEffect(() => { if (vehicleId) fetchTrack(vehicleId); }, [vehicleId, fetchTrack]);

  // Crear el mapa una vez
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !mapEl.current || map.current) return;
      map.current = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([19.38, -99.14], 11);
      // Teselas estándar de OpenStreetMap (sin llave), oscurecidas con un filtro CSS
      // (.lk-darktiles) para que el trazo lima se lea. CARTO pide llave desde 2026.
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, className: "lk-darktiles",
        attribution: "© OpenStreetMap",
      }).addTo(map.current);
      setTimeout(() => map.current?.invalidateSize(), 50);
    }).catch(e => setErr((e as Error).message));
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  // Dibujar el recorrido completo cuando llegan puntos
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !map.current) {
      if (pts.length) { const id = setTimeout(() => setPts(p => [...p]), 300); return () => clearTimeout(id); }
      return;
    }
    const m = map.current, ly = layers.current;
    Object.values(ly).forEach((l: any) => l && m.removeLayer(l));
    layers.current = {};
    if (!pts.length) return;

    const segs = segments(pts);
    const lime = t.signal;
    layers.current.full = L.polyline(segs, { color: lime, weight: 3, opacity: 0.28 }).addTo(m);
    layers.current.done = L.polyline([], { color: lime, weight: 4, opacity: 0.95 }).addTo(m);
    layers.current.excesos = L.layerGroup(
      pts.filter(p => (p.speed_kmh ?? 0) >= SPEEDING_KMH).map(p =>
        L.circleMarker([p.lat, p.lon], { radius: 6, color: t.crimson, fillColor: t.crimson, fillOpacity: 0.9, weight: 2 })
          .bindTooltip(`${p.speed_kmh} km/h · ${fmtTs(p.ts)}`)),
    ).addTo(m);
    layers.current.start = L.circleMarker([pts[0].lat, pts[0].lon], { radius: 6, color: "#F2EEE6", fillColor: "#0B0F14", fillOpacity: 1, weight: 3 })
      .bindTooltip("Inicio · " + fmtTs(pts[0].ts)).addTo(m);
    layers.current.head = L.circleMarker([pts[0].lat, pts[0].lon], { radius: 9, color: "#0B0F14", fillColor: lime, fillOpacity: 1, weight: 3 }).addTo(m);
    // El tablero de arriba cambia de alto al llegar los datos: recalcular el tamaño
    // del mapa antes de encuadrar, o quedan teselas sin cargar (cuadros negros).
    m.invalidateSize();
    m.fitBounds(layers.current.full.getBounds(), { padding: [30, 30] });
    setTimeout(() => m.invalidateSize(), 250);
    drawTo(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts]);

  const drawTo = useCallback((i: number) => {
    const ly = layers.current;
    if (!ly.done || !pts.length) return;
    const k = Math.max(0, Math.min(pts.length - 1, Math.floor(i)));
    ly.done.setLatLngs(segments(pts.slice(0, k + 1)));
    ly.head.setLatLng([pts[k].lat, pts[k].lon]);
  }, [pts]);

  // Reproducción
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      let next = idxRef.current + dt * SPEEDS[speed].pps;
      if (next >= pts.length - 1) { next = pts.length - 1; setPlaying(false); }
      idxRef.current = next;
      const k = Math.floor(next);
      setIdx(prev => (prev === k ? prev : k));
      drawTo(next);
      if (next < pts.length - 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pts, drawTo]);

  const play = () => {
    if (!pts.length) return;
    if (idxRef.current >= pts.length - 1) { idxRef.current = 0; setIdx(0); drawTo(0); }
    setPlaying(p => !p);
  };

  const cur = pts[idx];

  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const input = { padding: "10px 12px", border: `1px solid ${t.lineL}`, borderRadius: 6, background: "#FBF9F3", fontFamily: t.fBody, fontSize: 14, color: t.ink };
  const btn = { background: t.ink, color: t.signal, border: "none", borderRadius: 6, padding: "10px 18px", fontFamily: t.fBody, fontWeight: 700, fontSize: 14, cursor: "pointer" };

  if (!withData.length) {
    return <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.mutedL }}>Esta flotilla todavía no tiene recorridos. Sube sus archivos en “Cargar datos”.</p>;
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
          <span style={label}>Unidad</span>
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={input}>
            {withData.map(v => <option key={v.id} value={v.id}>{v.alias ?? v.device_id}{v.plate ? ` · ${v.plate}` : ""}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Desde</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Hasta</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} />
        </label>
        <button style={{ ...btn, opacity: loading ? 0.6 : 1 }} disabled={loading || !from || !to || from > to}
          onClick={() => fetchTrack(vehicleId, from, to)}>
          {loading ? "Cargando…" : "Ver recorrido"}
        </button>
      </div>

      {err && <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.crimson, marginBottom: 14 }}>{err}</p>}

      {/* Tablero de la unidad */}
      {loading ? null : <VehicleDashboard pts={pts} t={t} />}

      {/* Mapa */}
      <style>{`.lk-darktiles{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6)}`}</style>
      <div style={{ position: "relative", isolation: "isolate", borderRadius: 10, overflow: "hidden", border: `1px solid ${t.ink}` }}>
        <div ref={mapEl} style={{ height: "min(62vh, 560px)", minHeight: 320, background: t.ink }} />
        {!pts.length && !loading && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#F2EEE6", fontFamily: t.fBody, fontSize: 14, zIndex: 500, pointerEvents: "none" }}>
            Sin puntos en ese rango
          </div>
        )}
      </div>

      {/* Reproducción */}
      <div style={{ background: t.ink, color: "#F2EEE6", borderRadius: 10, padding: "14px 16px", marginTop: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={play} disabled={!pts.length} aria-label={playing ? "Pausar" : "Reproducir"}
            style={{ ...btn, background: t.signal, color: t.ink, padding: "8px 16px", minWidth: 96 }}>
            {playing ? "❚❚ Pausa" : "▶ Play"}
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            {SPEEDS.map((sp, i) => (
              <button key={sp.label} onClick={() => setSpeed(i)} style={{
                background: i === speed ? "#1C232C" : "transparent", color: i === speed ? t.signal : "#8A98A6",
                border: `1px solid ${i === speed ? t.signal : "#2A323D"}`, borderRadius: 6, padding: "6px 10px",
                fontFamily: t.fMono, fontSize: 11, cursor: "pointer",
              }}>{sp.label}</button>
            ))}
          </div>
          <div style={{ fontFamily: t.fMono, fontSize: 13, marginLeft: "auto" }}>
            {cur ? `${fmtTs(cur.ts)} · ${cur.speed_kmh ?? 0} km/h` : "—"}
          </div>
        </div>
        <input type="range" min={0} max={Math.max(0, pts.length - 1)} value={idx} disabled={!pts.length}
          onChange={e => { const v = Number(e.target.value); setPlaying(false); idxRef.current = v; setIdx(v); drawTo(v); }}
          aria-label="Posición en el recorrido"
          style={{ width: "100%", marginTop: 12, accentColor: t.signal }} />
        <div style={{ fontFamily: t.fBody, fontSize: 12, color: "#8A98A6", marginTop: 4, minHeight: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cur?.address ?? ""}
        </div>
      </div>
    </div>
  );
}
