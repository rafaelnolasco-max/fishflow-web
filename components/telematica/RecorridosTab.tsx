"use client";

// ─── Telemática · Recorridos — carga de logs GPS ─────────────────────────────
// Tab del panel /app/lukon. Alex escoge la flotilla (cliente de Lukon), sube el
// export CSV/XLSX del Sistema de Monitoreo Vehicular y se guarda en
// telematica_points. El archivo se parsea aquí, en el navegador, y se manda en
// bloques de IMPORT_CHUNK puntos (el body de Vercel topa en 4.5 MB).

import { useCallback, useEffect, useState } from "react";
import { parseLukonRows, IMPORT_CHUNK, type ParsedExport } from "@/lib/telematica";

export interface RecorridosTokens {
  ink: string; ink3: string; paper: string; paper2: string; lineL: string;
  mutedL: string; signal: string; crimson: string; fBody: string; fMono: string;
}

interface Vehicle {
  id: string; device_id: string; plate: string | null; alias: string | null;
  points: number; ts_min: string | null; ts_max: string | null;
}
interface Fleet { id: string; name: string; slug: string; vehicles: Vehicle[] }

type Stage =
  | { kind: "idle" }
  | { kind: "parsing"; filename: string }
  | { kind: "ready"; filename: string; parsed: ParsedExport }
  | { kind: "uploading"; filename: string; parsed: ParsedExport; sent: number }
  | { kind: "done"; filename: string; read: number; inserted: number }
  | { kind: "error"; msg: string };

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
}
const nf = new Intl.NumberFormat("es-MX");

export default function RecorridosTab({ parentId, t }: { parentId: string; t: RecorridosTokens }) {
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [fleetId, setFleetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telematica/fleets?parent=${parentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar flotillas");
      setFleets(data.fleets ?? []);
      setFleetId(prev => prev || data.fleets?.[0]?.id || "");
    } catch (e) {
      setStage({ kind: "error", msg: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => { load(); }, [load]);

  async function onFile(file: File) {
    setStage({ kind: "parsing", filename: file.name });
    try {
      const XLSX = await import("xlsx");
      // CSV: se lee como texto UTF-8 (leerlo como binario rompe acentos: "Odómetro").
      // raw:true conserva "0560024837" como texto (sin perder el cero inicial).
      const isCsv = /\.csv$/i.test(file.name);
      const wb = isCsv
        ? XLSX.read(await file.text(), { type: "string", raw: true })
        : XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
      const parsed = parseLukonRows(rows);
      if (parsed.devices.length > 1) throw new Error(`El archivo trae ${parsed.devices.length} equipos (${parsed.devices.join(", ")}). Sube un archivo por unidad.`);
      if (!parsed.points.length) throw new Error("El archivo no trae puntos con coordenadas válidas.");
      setStage({ kind: "ready", filename: file.name, parsed });
    } catch (e) {
      setStage({ kind: "error", msg: (e as Error).message });
    }
  }

  async function upload() {
    if (stage.kind !== "ready" || !fleetId) return;
    const { parsed, filename } = stage;
    let importId: string | undefined;
    let inserted = 0;
    try {
      for (let i = 0; i < parsed.points.length; i += IMPORT_CHUNK) {
        setStage({ kind: "uploading", filename, parsed, sent: i });
        const chunk = parsed.points.slice(i, i + IMPORT_CHUNK);
        const res = await fetch("/api/telematica/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: fleetId, device_id: parsed.device_id, filename,
            points: chunk, import_id: importId,
            done: i + IMPORT_CHUNK >= parsed.points.length,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Error en el bloque ${i / IMPORT_CHUNK + 1}`);
        importId = data.import_id;
        inserted += data.inserted ?? 0;
      }
      setStage({ kind: "done", filename, read: parsed.points.length, inserted });
      load();
    } catch (e) {
      setStage({ kind: "error", msg: (e as Error).message });
    }
  }

  const fleet = fleets.find(f => f.id === fleetId);
  const h2 = { fontFamily: t.fMono, fontSize: 13, fontWeight: 500, color: t.mutedL, letterSpacing: "0.2em", textTransform: "uppercase" as const, margin: "0 0 28px" };
  const label = { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const };
  const btn = { background: t.ink, color: t.signal, border: "none", borderRadius: 6, padding: "12px 22px", fontFamily: t.fBody, fontWeight: 700, fontSize: 14, cursor: "pointer" };

  return (
    <div>
      <h2 style={h2}>— Recorridos · carga de logs GPS</h2>

      {/* Flotilla */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        <span style={label}>Flotilla (cliente)</span>
        <select value={fleetId} onChange={e => setFleetId(e.target.value)} disabled={loading || !fleets.length}
          style={{ padding: "12px 14px", border: `1px solid ${t.lineL}`, borderRadius: 6, background: "#FBF9F3", fontFamily: t.fBody, fontSize: 15, color: t.ink }}>
          {!fleets.length && <option value="">{loading ? "Cargando…" : "Sin flotillas dadas de alta"}</option>}
          {fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {/* Archivo */}
      <label style={{
        display: "block", border: `1.5px dashed ${t.lineL}`, borderRadius: 10, padding: "28px 20px",
        textAlign: "center", cursor: fleetId ? "pointer" : "not-allowed", background: "#FBF9F3", marginBottom: 20,
        opacity: fleetId ? 1 : 0.5,
      }}>
        <input type="file" accept=".csv,.xlsx,.xls" disabled={!fleetId || stage.kind === "uploading"}
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <div style={{ fontFamily: t.fBody, fontWeight: 600, fontSize: 15, color: t.ink }}>Subir export CSV o XLSX</div>
        <div style={{ fontFamily: t.fBody, fontSize: 13, color: t.mutedL, marginTop: 6 }}>
          Un archivo por unidad, tal como sale del Sistema de Monitoreo Vehicular. Volver a subirlo no duplica datos.
        </div>
      </label>

      {stage.kind === "parsing" && <p style={{ fontFamily: t.fMono, fontSize: 12, color: t.mutedL }}>Leyendo {stage.filename}…</p>}

      {(stage.kind === "ready" || stage.kind === "uploading") && (
        <div style={{ border: `1px solid ${t.lineL}`, borderRadius: 10, padding: 20, marginBottom: 24, background: "#FBF9F3" }}>
          <div className="lk-grid-3" style={{ marginBottom: 18 }}>
            <Stat t={t} k="Equipo" v={stage.parsed.device_id} />
            <Stat t={t} k="Registros" v={nf.format(stage.parsed.points.length)} />
            <Stat t={t} k="Periodo" v={`${fmtDay(stage.parsed.ts_min)} – ${fmtDay(stage.parsed.ts_max)}`} />
          </div>
          {stage.parsed.skipped > 0 && (
            <p style={{ fontFamily: t.fBody, fontSize: 13, color: t.mutedL, margin: "0 0 14px" }}>
              {nf.format(stage.parsed.skipped)} filas sin fecha o coordenadas se omiten.
            </p>
          )}
          {stage.kind === "ready" ? (
            <button style={btn} onClick={upload}>Guardar en {fleet?.name ?? "la flotilla"}</button>
          ) : (
            <div>
              <div style={{ height: 6, borderRadius: 3, background: t.paper2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round((stage.sent / stage.parsed.points.length) * 100)}%`, background: t.ink }} />
              </div>
              <p style={{ fontFamily: t.fMono, fontSize: 11, color: t.mutedL, marginTop: 8 }}>
                Guardando… {nf.format(stage.sent)} / {nf.format(stage.parsed.points.length)}
              </p>
            </div>
          )}
        </div>
      )}

      {stage.kind === "done" && (
        <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.ink, background: t.paper2, borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
          {stage.filename}: {nf.format(stage.inserted)} registros nuevos de {nf.format(stage.read)}
          {stage.inserted < stage.read ? " (el resto ya estaba cargado)." : "."}
        </p>
      )}
      {stage.kind === "error" && (
        <p style={{ fontFamily: t.fBody, fontSize: 14, color: t.crimson, border: `1px solid ${t.crimson}44`, borderRadius: 8, padding: "12px 16px", marginBottom: 24 }}>
          {stage.msg}
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
    </div>
  );
}

function Stat({ t, k, v }: { t: RecorridosTokens; k: string; v: string }) {
  return (
    <div>
      <div style={{ fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontFamily: t.fMono, fontSize: 16, fontWeight: 600, color: t.ink, marginTop: 6 }}>{v}</div>
    </div>
  );
}
