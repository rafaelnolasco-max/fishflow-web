"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Telemática · Recorridos — mapa con reproducción ─────────────────────────
// Escoges unidad y rango de días; se dibuja el recorrido y se puede reproducir
// (play, velocidad, barra para adelantar/regresar).
//
// Mapa base: OpenFreeMap (tiles.openfreemap.org) — vectorial, gratis, sin llave
// y con uso comercial permitido. Estilos "dark" (Oscuro, default) y "positron"
// (Claro). Se dibuja con MapLibre GL, que se carga desde cdnjs al abrir el mapa:
// sin dependencia nueva en package.json. (Antes: Leaflet + teselas de
// tile.openstreetmap.org, cuya política no garantiza servicio a usos comerciales.)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecorridosTokens } from "./RecorridosTab";
import VehicleDashboard, { isGap, stays, SPEEDING_KMH, type TP } from "./VehicleDashboard";

interface VehicleOpt { id: string; alias: string | null; plate: string | null; device_id: string; points: number }

const SPEEDS = [
  { label: "Lento", pps: 8 },
  { label: "Normal", pps: 30 },
  { label: "Rápido", pps: 120 },
];
const MAPLIBRE = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/";
const BASEMAPS = {
  oscuro: "https://tiles.openfreemap.org/styles/dark",
  claro: "https://tiles.openfreemap.org/styles/positron",
} as const;
type Basemap = keyof typeof BASEMAPS;

/** Cortes del trazo en [lon, lat] (GeoJSON), separados donde el equipo dejó de reportar. */
function segments(pts: TP[]) {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  pts.forEach((p, i) => {
    if (i > 0 && isGap(pts[i - 1], p)) { if (cur.length > 1) out.push(cur); cur = []; }
    cur.push([p.lon, p.lat]);
  });
  if (cur.length > 1) out.push(cur);
  return out;
}
const lineFeature = (segs: [number, number][][]) => ({
  type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: segs },
});

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function loadMapLibre(): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (w.__maplibreLoading) return w.__maplibreLoading;
  w.__maplibreLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = MAPLIBRE + "maplibre-gl.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = MAPLIBRE + "maplibre-gl.js";
    js.onload = () => resolve(w.maplibregl);
    js.onerror = () => reject(new Error("No se pudo cargar el mapa (MapLibre)."));
    document.head.appendChild(js);
  });
  return w.__maplibreLoading;
}

function markerEl(html: string, title?: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  if (title) el.title = title;
  return el;
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
  const [base, setBase] = useState<Basemap>("oscuro");
  const [styleVersion, setStyleVersion] = useState(0);   // sube cada vez que el estilo termina de cargar

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<{ head?: any; others: any[] }>({ others: [] });
  const fittedFor = useRef<TP[] | null>(null);
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

  // Colores del trazo según el mapa base: lima sobre oscuro, tinta sobre claro
  const pal = base === "oscuro"
    ? { trail: t.signal, full: t.signal, fullOp: 0.3, ring: "#0B0F14" }
    : { trail: t.ink, full: t.ink, fullOp: 0.22, ring: "#FFFFFF" };

  // Crear el mapa una vez
  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then(ml => {
      if (cancelled || !mapEl.current || map.current) return;
      const m = new ml.Map({
        container: mapEl.current, style: BASEMAPS.oscuro,
        center: [-99.14, 19.38], zoom: 10.5, attributionControl: { compact: true },
      });
      m.addControl(new ml.NavigationControl({ showCompass: false }), "top-left");
      m.on("style.load", () => setStyleVersion(v => v + 1));
      // Ventanita con velocidad y hora al pasar sobre un exceso
      const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      m.on("mouseenter", "lk-excesos", (e: any) => {
        m.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (f) popup.setLngLat(f.geometry.coordinates).setText(f.properties.label).addTo(m);
      });
      m.on("mouseleave", "lk-excesos", () => { m.getCanvas().style.cursor = ""; popup.remove(); });
      map.current = m;
    }).catch(e => setErr((e as Error).message));
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  // Cambiar mapa base: setStyle borra las capas propias; se vuelven a poner en style.load
  useEffect(() => {
    const m = map.current;
    // diff:false fuerza recarga completa para que dispare "style.load" (con diff,
    // MapLibre aplica el cambio sin ese evento y las capas propias no regresan)
    if (m && styleVersion > 0) m.setStyle(BASEMAPS[base], { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Dibujar recorrido, excesos y marcadores
  useEffect(() => {
    const m = map.current, ml = (window as any).maplibregl;
    if (!m || !ml || styleVersion === 0) return;

    for (const id of ["lk-done", "lk-full", "lk-excesos"]) if (m.getLayer(id)) m.removeLayer(id);
    for (const id of ["lk-done", "lk-full", "lk-excesos"]) if (m.getSource(id)) m.removeSource(id);
    markers.current.head?.remove();
    markers.current.others.forEach(mk => mk.remove());
    markers.current = { others: [] };
    if (!pts.length) return;

    const segs = segments(pts);
    m.addSource("lk-full", { type: "geojson", data: lineFeature(segs) });
    m.addSource("lk-done", { type: "geojson", data: lineFeature([]) });
    m.addSource("lk-excesos", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: pts.filter(p => (p.speed_kmh ?? 0) >= SPEEDING_KMH).map(p => ({
          type: "Feature", properties: { label: `${p.speed_kmh} km/h · ${fmtTs(p.ts)}` },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        })),
      },
    });
    const lineLayout = { "line-join": "round", "line-cap": "round" };
    m.addLayer({ id: "lk-full", type: "line", source: "lk-full", layout: lineLayout, paint: { "line-color": pal.full, "line-width": 3, "line-opacity": pal.fullOp } });
    m.addLayer({ id: "lk-done", type: "line", source: "lk-done", layout: lineLayout, paint: { "line-color": pal.trail, "line-width": 4 } });
    m.addLayer({ id: "lk-excesos", type: "circle", source: "lk-excesos", paint: { "circle-radius": 6, "circle-color": t.crimson, "circle-stroke-color": pal.ring, "circle-stroke-width": 2 } });

    // Lugares donde más tiempo se queda detenido, numerados como en el tablero
    stays(pts).forEach((st, i) => {
      const el = markerEl(
        `<div style="width:24px;height:24px;border-radius:12px;background:#0B0F14;border:2px solid ${t.signal};color:${t.signal};font:700 12px ui-monospace,monospace;display:grid;place-items:center">${i + 1}</div>`,
        `${i + 1}. ${(st.address ?? "").split(",").slice(0, 2).join(",")} · ${Math.round(st.minutes / 60)} h detenido`,
      );
      markers.current.others.push(new ml.Marker({ element: el }).setLngLat([st.lon, st.lat]).addTo(m));
    });
    const startEl = markerEl(`<div style="width:12px;height:12px;border-radius:6px;background:#0B0F14;border:3px solid #F2EEE6"></div>`, "Inicio · " + fmtTs(pts[0].ts));
    markers.current.others.push(new ml.Marker({ element: startEl }).setLngLat([pts[0].lon, pts[0].lat]).addTo(m));
    const headEl = markerEl(`<div style="width:18px;height:18px;border-radius:9px;background:${t.signal};border:3px solid #0B0F14;box-shadow:0 0 0 6px rgba(200,255,61,.25)"></div>`);
    markers.current.head = new ml.Marker({ element: headEl }).setLngLat([pts[0].lon, pts[0].lat]).addTo(m);

    // Encuadrar solo cuando cambian los puntos, no al cambiar de mapa base
    if (fittedFor.current !== pts) {
      fittedFor.current = pts;
      let w = 180, e = -180, so = 90, n = -90;
      for (const p of pts) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); so = Math.min(so, p.lat); n = Math.max(n, p.lat); }
      m.resize();
      m.fitBounds([[w, so], [e, n]], { padding: 40, duration: 0, maxZoom: 16 });
    }
    drawTo(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, styleVersion]);

  const drawTo = useCallback((i: number) => {
    const m = map.current;
    const src = m?.getSource?.("lk-done");
    if (!src || !pts.length) return;
    const k = Math.max(0, Math.min(pts.length - 1, Math.floor(i)));
    src.setData(lineFeature(segments(pts.slice(0, k + 1))));
    markers.current.head?.setLngLat([pts[k].lon, pts[k].lat]);
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
      <div style={{ position: "relative", isolation: "isolate", borderRadius: 10, overflow: "hidden", border: `1px solid ${t.ink}` }}>
        <div ref={mapEl} style={{ height: "min(62vh, 560px)", minHeight: 320, background: base === "oscuro" ? t.ink : "#F2F2F0" }} />
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2, display: "flex", background: "#0B0F14", borderRadius: 6, padding: 3, gap: 2 }}>
          {(["oscuro", "claro"] as Basemap[]).map(b => (
            <button key={b} onClick={() => setBase(b)} aria-pressed={base === b} style={{
              background: base === b ? t.signal : "transparent", color: base === b ? t.ink : "#F2EEE6",
              border: "none", borderRadius: 4, padding: "5px 10px", fontFamily: t.fMono, fontSize: 11, cursor: "pointer",
            }}>{b === "oscuro" ? "Oscuro" : "Claro"}</button>
          ))}
        </div>
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
