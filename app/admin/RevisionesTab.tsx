"use client";

/**
 * Pestaña "Revisiones" del /admin — todas las ligas de Revisión en línea de
 * todos los clientes. Arriba las que tienen comentarios por resolver.
 * Cada tarjeta abre /admin/revisiones/<id>, donde se ven y se resuelven.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ADMIN_THEME as T } from "./PublicacionesTab";

interface Fila {
  id: string;
  cliente: string;
  titulo: string;
  token: string;
  status: "open" | "closed";
  vence: string;
  creada: string;
  piezas: number;
  aprobadas: number;
  pendientes: number;
  comentarios: number;
  ultimo: string | null;
}

const ORANGE = "#F26B17";
const GREEN = "#2E9B5C";

function corta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
}
function hace(iso: string | null) {
  if (!iso) return "sin comentarios";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(min, 1)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
function estado(f: Fila): { txt: string; color: string } {
  if (f.status === "closed") return { txt: "Cerrada", color: T.muted };
  if (new Date(f.vence).getTime() < Date.now()) return { txt: "Vencida", color: T.danger };
  if (f.piezas && f.aprobadas === f.piezas) return { txt: "Todo aprobado", color: GREEN };
  return { txt: "Abierta", color: T.accent };
}

export default function RevisionesTab() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState("");
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    fetch("/api/admin/revisiones/")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Error");
        setFilas(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"));
  }, []);

  const visibles = useMemo(() => {
    const base = (filas ?? []).filter((f) => todas || (f.status === "open" && new Date(f.vence).getTime() > Date.now()) || f.pendientes > 0);
    return base.sort(
      (a, b) =>
        b.pendientes - a.pendientes ||
        Number(b.status === "open") - Number(a.status === "open") ||
        (b.ultimo ?? b.creada).localeCompare(a.ultimo ?? a.creada),
    );
  }, [filas, todas]);

  const totalPend = (filas ?? []).reduce((s, f) => s + f.pendientes, 0);

  return (
    <div style={{ padding: "20px 24px 48px", background: T.bg, minHeight: "calc(100vh - 200px)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>📝 Revisiones de clientes</div>
            <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>
              Ligas de fishflow.mx/revision donde el cliente aprueba o pide cambios ·{" "}
              {totalPend ? <b style={{ color: ORANGE }}>{totalPend} comentario{totalPend === 1 ? "" : "s"} por resolver</b> : "nada pendiente"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { v: false, l: "Activas" },
              { v: true, l: "Todas" },
            ].map((o) => (
              <button
                key={o.l}
                onClick={() => setTodas(o.v)}
                style={{
                  background: todas === o.v ? T.accentSoft : "transparent",
                  color: todas === o.v ? T.accent : T.muted,
                  border: `1px solid ${todas === o.v ? T.accent : T.border}`,
                  borderRadius: 999,
                  padding: "6px 14px",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {error ? <div style={{ color: T.danger, fontSize: 14 }}>{error}</div> : null}
        {!filas && !error ? <div style={{ color: T.muted, fontSize: 14 }}>Cargando…</div> : null}
        {filas && !visibles.length ? (
          <div style={{ color: T.muted, fontSize: 14, padding: "40px 0", textAlign: "center" }}>
            No hay revisiones {todas ? "" : "activas"}. Pídele a Claude que arme una para el siguiente entregable.
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {visibles.map((f) => {
            const st = estado(f);
            const pct = f.piezas ? (f.aprobadas / f.piezas) * 100 : 0;
            return (
              <a
                key={f.id}
                href={`/admin/revisiones/${f.id}/`}
                style={{
                  display: "block",
                  textDecoration: "none",
                  background: T.surface,
                  border: `1px solid ${f.pendientes ? "rgba(242,107,23,.45)" : T.border}`,
                  borderRadius: 14,
                  padding: "16px 18px",
                  color: T.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: T.muted }}>{f.cliente}</div>
                  <span style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: st.color, whiteSpace: "nowrap" }}>● {st.txt}</span>
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 650, margin: "6px 0 12px", lineHeight: 1.3 }}>{f.titulo}</div>
                <div style={{ height: 5, borderRadius: 3, background: T.panel, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: GREEN }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12.5, color: T.muted }}>
                  <span>
                    {f.aprobadas}/{f.piezas} aprobadas
                  </span>
                  {f.pendientes ? (
                    <span style={{ background: ORANGE, color: "#fff", borderRadius: 999, padding: "1px 9px", fontWeight: 700 }}>
                      {f.pendientes} por resolver
                    </span>
                  ) : (
                    <span>{f.comentarios} comentarios</span>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: T.muted }}>
                  Último comentario {hace(f.ultimo)} · vence {corta(f.vence)}
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
