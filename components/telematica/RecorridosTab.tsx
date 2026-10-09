"use client";

// ─── Telemática · Recorridos — carga de logs GPS ─────────────────────────────
// Tab del panel /app/lukon. Alex escoge la flotilla (cliente de Lukon), sube uno
// o varios exports CSV/XLSX del Sistema de Monitoreo Vehicular (uno por unidad,
// o un archivo con varias) y se guardan en telematica_points. El archivo se parsea aquí, en el navegador, y se manda en
// bloques de IMPORT_CHUNK puntos (el body de Vercel topa en 4.5 MB).

import { useCallback, useEffect, useState } from "react";
import { parseLukonRows, IMPORT_CHUNK, type TelematicaPoint } from "@/lib/telematica";
import TrackMap from "./TrackMap";

export interface RecorridosTokens {
  ink: string; ink3: string; paper: string; paper2: string; lineL: string;
  mutedL: string; signal: string; crimson: string; fBody: string; fMono: string;
}

interface Vehicle {
  id: string; device_id: string; plate: string | null; alias: string | null;
  points: number; ts_min: string | null; ts_max: string | null;
}
interface Fleet { id: string; name: string; slug: string; vehicles: Vehicle[] }

/** Una unidad lista para subir: un equipo de un archivo. */
interface Item {
  key: string;
  filename: string;
  device_id: string;
  points: TelematicaPoint[];
  ts_min: string | null;
  ts_max: string | null;
  skipped: number;
  status: "pendiente" | "subiendo" | "listo" | "error";
  sent: number;
  inserted: number;
  msg?: string;
}

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
}
const nf = new Intl.NumberFormat("es-MX");

export default function RecorridosTab({ parentId, t }: { parentId: string; t: RecorridosTokens }) {
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [fleetId, setFleetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<"" | "leyendo" | "subiendo">("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"mapa" | "cargar">("mapa");
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telematica/fleets?parent=${parentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar flotillas");
      setFleets(data.fleets ?? []);
      setFleetId(prev => prev || data.fleets?.[0]?.id || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { load(); }, [load]);

  async function onFiles(files: File[]) {
    setBusy("leyendo"); setError("");
    const XLSX = await import("xlsx");
    const next: Item[] = [];
    const errs: string[] = [];
    for (const file of files) {
      try {
        // CSV: se lee como texto UTF-8 (leerlo como binario rompe acentos: "Odómetro").
        // raw:true conserva "0560024837" como texto (sin perder el cero inicial).
        const wb = /\.csv$/i.test(file.name)
          ? XLSX.read(await file.text(), { type: "string", raw: true })
          : XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
        const parsed = parseLukonRows(rows);
        if (!parsed.groups.length) throw new Error("no trae puntos con coordenadas válidas");
        for (const g of parsed.groups) {
          next.push({
            key: `${file.name}·${g.device_id}·${file.lastModified}`, filename: file.name,
            device_id: g.device_id, points: g.points, ts_min: g.ts_min, ts_max: g.ts_max,
            skipped: parsed.groups.length === 1 ? parsed.skipped : 0,
            status: "pendiente", sent: 0, inserted: 0,
          });
        }
      } catch (e) {
        errs.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    // Un archivo repetido reemplaza al anterior en la lista, no se suma
    setItems(prev => [...prev.filter(p => p.status !== "pendiente" || !next.some(n => n.key === p.key)), ...next]);
    if (errs.length) setError(errs.join(" · "));
    setBusy("");
  }

  const patch = (key: string, p: Partial<Item>) =>
    setItems(prev => prev.map(it => (it.key === key ? { ...it, ...p } : it)));

  async function uploadAll() {
    if (!fleetId) return;
    setBusy("subiendo"); setError("");
    for (const it of items.filter(i => i.status === "pendiente" || i.status === "error")) {
      let importId: string | undefined;
      let inserted = 0;
      try {
        for (let i = 0; i < it.points.length; i += IMPORT_CHUNK) {
          patch(it.key, { status: "subiendo", sent: i });
          const res = await fetch("/api/telematica/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: fleetId, device_id: it.device_id, filename: it.filename,
              points: it.points.slice(i, i + IMPORT_CHUNK), import_id: importId,
              done: i + IMPORT_CHUNK >= it.points.length,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? `Error en el bloque ${i / IMPORT_CHUNK + 1}`);
          importId = data.import_id;
          inserted += data.inserted ?? 0;
        }
        patch(it.key, { status: "listo", sent: it.points.length, inserted });
      } catch (e) {
        patch(it.key, { status: "error", msg: (e as Error).message });
      }
    }
    setBusy("");
    load();
  }

  const fleet = fleets.find(f => f.id === fleetId);
  const h2 = { fontFamily: t.fMono, fontSize: 13, fontWeight: 500, color: t.mutedL, letterSpacing: "0.2em", textTransform: "uppercase" as const, margin: "0 0 28px" };
  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const btn = { background: t.ink, color: t.signal, border: "none", borderRadius: 6, padding: "12px 22px", fontFamily: t.fBody, fontWeight: 700, fontSize: 14, cursor: "pointer" };

  return (
    <div>
      <h2 style={h2}>— Recorridos</h2>

      {/* Flotilla */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        <span style={label}>Flotilla (cliente)</span>
        <select value={fleetId} onChange={e => setFleetId(e.target.value)} disabled={loading || !fleets.length}
          style={{ padding: "12px 14px", border: `1px solid ${t.lineL}`, borderRadius: 6, background: "#FBF9F3", fontFamily: t.fBody, fontSize: 15, color: t.ink }}>
          {!fleets.length && <option value="">{loading ? "Cargando…" : "Sin flotillas dadas de alta"}</option>}
          {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {/* Vista */}
      <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
        {(["mapa", "cargar"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            background: view === v ? t.ink : "transparent", color: view === v ? t.signal : t.mutedL,
            border: `1px solid ${view === v ? t.ink : t.lineL}`, borderRadius: 6, padding: "8px 16px",
            fontFamily: t.fBody, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>{v === "mapa" ? "Mapa" : "Cargar datos"}</button>
        ))}
      </div>

      {view === "mapa" && fleet && <TrackMap key={fleet.id} vehicles={fleet.vehicles} t={t} />}

      {view === "cargar" && (<>
      {/* Archivos */}
      <label
        onDragOver={e => { e.preventDefault(); if (fleetId && !busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          if (!fleetId || busy) return;
          const fs = Array.from(e.dataTransfer.files).filter(f => /\.(csv|xlsx|xls)$/i.test(f.name));
          if (fs.length) onFiles(fs);
          else setError("Arrastra archivos .csv o .xlsx del Sistema de Monitoreo Vehicular.");
        }}
        style={{
          display: "block", border: `1.5px dashed ${dragOver ? t.ink : t.lineL}`, borderRadius: 10, padding: "36px 20px",
          textAlign: "center", cursor: fleetId && !busy ? "pointer" : "not-allowed",
          background: dragOver ? t.paper2 : "#FBF9F3", marginBottom: 20, opacity: fleetId ? 1 : 0.5,
          transition: "background .15s, border-color .15s",
        }}>
        <input type="file" accept=".csv,.xlsx,.xls" multiple disabled={!fleetId || !!busy}
          style={{ display: "none" }}
          onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
        <div style={{ fontFamily: t.fBody, fontWeight: 600, fontSize: 15, color: t.ink }}>{dragOver ? "Suelta los archivos aquí" : "Arrastra aquí los exports CSV o XLSX, o haz clic para escogerlos"}</div>
        <div style={{ fontFamily: t.fBody, fontSize: 13, color: t.mutedL, marginTop: 6 }}>
          Todos los archivos de la flotilla de un jalón; cada unidad se separa sola. Volver a subir un archivo no duplica datos.
        </div>
      </label>

      {busy === "leyendo" && <p style={{ fontFamily: t.fMono, fontSize: 12, color: t.mutedL }}>Leyendo archivos…</p>}

      {items.length > 0 && (
        <div style={{ border: `1px solid ${t.lineL}`, borderRadius: 10, padding: 20, marginBottom: 24, background: "#FBF9F3" }}>
          <div className="lk-tablewrap">
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: t.fBody, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.lineL}` }}>
                  {["Archivo", "Equipo", "Registros", "Periodo", "Estado"].map(h => (
                    <th key={h} style={{ ...label, textAlign: "left", padding: "6px 10px", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.key} style={{ borderBottom: `1px solid ${t.paper2}` }}>
                    <td style={{ padding: 10, color: t.ink3, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.filename}</td>
                    <td style={{ padding: 10, fontFamily: t.fMono, fontSize: 11 }}>{it.device_id}</td>
                    <td style={{ padding: 10, fontFamily: t.fMono }}>{nf.format(it.points.length)}</td>
                    <td style={{ padding: 10, fontFamily: t.fMono, fontSize: 11, color: t.mutedL }}>{fmtDay(it.ts_min)} – {fmtDay(it.ts_max)}</td>
                    <td style={{ padding: 10, fontFamily: t.fMono, fontSize: 11, color: it.status === "error" ? t.crimson : t.ink }}>
                      {it.status === "pendiente" && "Por subir"}
                      {it.status === "subiendo" && `${Math.round((it.sent / it.points.length) * 100)}%`}
                      {it.status === "listo" && `${nf.format(it.inserted)} nuevos`}
                      {it.status === "error" && (it.msg ?? "Error")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy || !items.some(i => i.status === "pendiente" || i.status === "error")} onClick={uploadAll}>
              {busy === "subiendo" ? "Guardando…" : `Guardar ${items.filter(i => i.status === "pendiente" || i.status === "error").length} unidad(es) en ${fleet?.name ?? "la flotilla"}`}
            </button>
            {!busy && (
              <button onClick={() => setItems([])} style={{ background: "none", border: "none", color: t.mutedL, fontFamily: t.fBody, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                Limpiar lista
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.crimson, border: `1px solid ${t.crimson}44`, borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
          {error}
        </p>
      )}

      {/* Unidades de la flotilla */}
      <div style={{ ...label, margin: "8px 0 10px" }}>Unidades de {fleet?.name ?? "la flotilla"}</div>
      <div className="lk-tablewrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: t.fBody, fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${t.lineL}` }}>
              {["Unidad", "Equipo", "Registros", "Desde", "Hasta"].map(h => (
                <th key={h} style={{ ...label, textAlign: "left", padding: "8px 12px", fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(fleet?.vehicles ?? []).map(v => (
              <tr key={v.id} style={{ borderBottom: `1px solid ${t.paper2}` }}>
                <td style={{ padding: 12, fontWeight: 600, color: t.ink }}>{v.alias ?? "—"}{v.plate ? ` · ${v.plate}` : ""}</td>
                <td style={{ padding: 12, fontFamily: t.fMono, fontSize: 11, color: t.ink3 }}>{v.device_id}</td>
                <td style={{ padding: 12, fontFamily: t.fMono, fontWeight: 600 }}>{nf.format(v.points)}</td>
                <td style={{ padding: 12, fontFamily: t.fMono, fontSize: 11, color: t.mutedL }}>{fmtDay(v.ts_min)}</td>
                <td style={{ padding: 12, fontFamily: t.fMono, fontSize: 11, color: t.mutedL }}>{fmtDay(v.ts_max)}</td>
              </tr>
            ))}
            {!fleet?.vehicles?.length && (
              <tr><td colSpan={5} style={{ padding: 16, color: t.mutedL }}>Sin unidades todavía. Se crean solas al subir su primer archivo.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}
