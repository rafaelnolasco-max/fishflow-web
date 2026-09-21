"use client";

/**
 * Utilidades compartidas de Cartera y Cobranza (SPARC).
 *
 * Colores de datos validados con el validador de dataviz (21-sep-2026):
 *  - Rampa ordinal heredado/generado: #7AAFD6 -> #0065A1 (pasa, 2.35:1 el claro)
 *  - Divergente liquidez: #0065A1 (positivo) / #D03B3B (negativo), CVD dE 16
 *  - Estatus: bueno #2C9A42 (verde SPARC), vigilar #B7791F, atender #D03B3B.
 *    Siempre con icono + etiqueta, nunca color solo.
 */

import { useState } from "react";
import { SPARC } from "./SparcHeader";

export const COLOR = {
  heredado: "#0065A1",
  generado: "#7AAFD6",
  positivo: "#0065A1",
  negativo: "#D03B3B",
  bueno: "#2C9A42",
  vigilar: "#B7791F",
  atender: "#D03B3B",
  grid: "#E1E9F0",
  track: "#EDF2F6",
  muted: "#8698A5",
} as const;

export const n = (v: number | string | null | undefined) => Number(v ?? 0);

/** Vivook guarda nombres en mayúsculas o mixtos; se muestran parejos y sin prefijo. */
export function nombre(s: string) {
  const menores = new Set(["de", "del", "la", "las", "los", "y"]);
  const limpio = s.trim().replace(/^(condominio|residencial)\s+/i, "");
  return limpio.toLowerCase().split(/\s+/).map((w, i) => {
    if (/^(a\.c\.|s\.c\.)$/.test(w)) return w.toUpperCase();
    if (/^dr\.?$/.test(w)) return "Dr.";
    if (i > 0 && menores.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

export const mxn = (v: number) =>
  v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export function compacto(v: number) {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)} M`;
  if (a >= 10_000) return `${s}$${Math.round(a / 1_000)} mil`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(1)} mil`;
  return mxn(v);
}

export function fechaLarga(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}
export function fechaCorta(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export const jost: React.CSSProperties = { fontFamily: "'Jost', system-ui, sans-serif" };
export const card: React.CSSProperties = {
  background: "#fff", border: `1px solid ${SPARC.LINEA}`, borderRadius: 14, padding: "18px 20px",
  boxShadow: "0 1px 2px rgba(14,29,40,.04)",
};

/* ── Estatus (icono + etiqueta + color) ─────────────────────────────── */

export type Nivel = "atender" | "vigilar" | "sano";

export const NIVEL: Record<Nivel, { color: string; bg: string; label: string; icono: string; orden: number }> = {
  atender: { color: COLOR.atender, bg: "#FCEEEC", label: "Atender ya", icono: "▲", orden: 0 },
  vigilar: { color: COLOR.vigilar, bg: "#FFF6E5", label: "Vigilar", icono: "●", orden: 1 },
  sano:    { color: COLOR.bueno,   bg: "#EDF7EF", label: "Sano",       icono: "✓", orden: 2 },
};

export function Chip({ nivel }: { nivel: Nivel }) {
  const m = NIVEL[nivel];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
      background: m.bg, fontSize: 12, fontWeight: 600, color: SPARC.TINTA, whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ color: m.color, fontSize: 10 }}>{m.icono}</span>{m.label}
    </span>
  );
}

/* ── Tooltip ligero (hover y foco) ──────────────────────────────────── */

export type TipState = { x: number; y: number; lines: string[] } | null;

export function useTip() {
  const [tip, setTip] = useState<TipState>(null);
  const bind = (lines: string[]) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, lines }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, lines });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  const node = tip ? (
    <div role="tooltip" style={{ position: "fixed", left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
      top: tip.y + 14, zIndex: 50, background: SPARC.TINTA, color: "#fff", borderRadius: 8, padding: "8px 11px",
      fontSize: 12.5, lineHeight: 1.5, pointerEvents: "none", maxWidth: 230, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }}>
      {tip.lines.map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 600 : 400 }}>{l}</div>)}
    </div>
  ) : null;
  return { bind, node };
}

/* ── Grupos de cobranza ─────────────────────────────────────────────── */

export type Grupo = "cobrar" | "historico" | "convenio" | "recordatorio";

export const GRUPO: Record<Grupo, { label: string; accion: string; icono: string }> = {
  cobrar:       { label: "Cobrar ya",    accion: "Deuda relevante y reciente: llamada y aviso formal esta semana.", icono: "→" },
  historico:    { label: "Histórico",    accion: "Más de un año o heredado: negociar convenio o turnar a legal.",   icono: "◷" },
  convenio:     { label: "En convenio",  accion: "Ya hay convenio de pago: vigilar que se cumpla.",                icono: "✎" },
  recordatorio: { label: "Recordatorio", accion: "Menos de $5,000: un recordatorio suele bastar.",                   icono: "✉" },
};

export interface Adeudo {
  snapshot_date: string;
  condominio: string;
  unidad: string;
  saldo: number;
  saldo_inicial: number | null;
  vencimiento_mas_antiguo: string | null;
  num_adeudos: number | null;
  con_convenio: boolean;
}

export function diasAtraso(a: Adeudo, corte: string) {
  if (!a.vencimiento_mas_antiguo) return 0;
  const d = (new Date(corte + "T12:00:00").getTime() - new Date(a.vencimiento_mas_antiguo + "T12:00:00").getTime()) / 86_400_000;
  return Math.max(0, Math.round(d));
}

export function grupo(a: Adeudo, corte: string): Grupo {
  const s = n(a.saldo), hist = n(a.saldo_inicial);
  if (a.con_convenio) return "convenio";
  if (diasAtraso(a, corte) > 365 || (hist > 0 && hist >= s * 0.5)) return "historico";
  if (s < 5000) return "recordatorio";
  return "cobrar";
}

export function antiguedad(dias: number) {
  if (dias < 45) return `${dias} días`;
  const m = Math.round(dias / 30.4);
  if (m < 24) return `${m} meses`;
  return `${(dias / 365).toFixed(1).replace(".0", "")} años`;
}
