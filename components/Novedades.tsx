"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DashTheme } from "@/components/dashboard";
import {
  historialNovedades,
  llaveNovedades,
  ultimaNovedad,
  type Novedad,
} from "@/lib/novedades";

// ─── Aviso de novedades ───────────────────────────────────────────────────────
// Se muestra una vez por navegador, cuando la última entrada del changelog del
// módulo no coincide con la que el usuario ya vio.
//
// Por qué localStorage y no la base: es un "este navegador ya lo vio", no un
// dato del usuario. Ver el aviso otra vez al abrir desde el celular es
// correcto, no un bug. Cada lectura y escritura va en try/catch porque en
// ventana privada el acceso puede tronar, y entonces el aviso simplemente no
// sale — nunca rompe el tablero.

interface Props {
  /** Slug del módulo en NOVEDADES (p.ej. "finanzas"). */
  modulo: string;
  theme: DashTheme;
  /**
   * true para no mostrar nada a quien abre el tablero por primera vez.
   * Se usa al onboardear un cliente nuevo: no tiene sentido anunciarle
   * "novedades" de funciones que nunca vio ausentes.
   */
  omitirSiEsPrimeraVisita?: boolean;
}

export default function Novedades({ modulo, theme: T, omitirSiEsPrimeraVisita = false }: Props) {
  const [novedad, setNovedad] = useState<Novedad | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const cerrar = useCallback(() => {
    const n = ultimaNovedad(modulo);
    try {
      if (n) window.localStorage.setItem(llaveNovedades(modulo), n.version);
    } catch { /* ventana privada: se volverá a mostrar, y está bien */ }
    setNovedad(null);
  }, [modulo]);

  useEffect(() => {
    const n = ultimaNovedad(modulo);
    if (!n) return;

    let visto: string | null = null;
    let accesible = true;
    try {
      visto = window.localStorage.getItem(llaveNovedades(modulo));
    } catch {
      accesible = false;
    }
    // Sin acceso al storage no se muestra: sin dónde recordarlo, saldría en
    // cada carga y se volvería una molestia.
    if (!accesible) return;
    if (visto === n.version) return;
    if (visto === null && omitirSiEsPrimeraVisita) {
      try { window.localStorage.setItem(llaveNovedades(modulo), n.version); } catch { /* ignorar */ }
      return;
    }
    setNovedad(n);
  }, [modulo, omitirSiEsPrimeraVisita]);

  useEffect(() => {
    if (!novedad) return;
    btnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [novedad, cerrar]);

  if (!novedad) return null;

  const historial = verHistorial ? historialNovedades(modulo) : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ff-novedades-titulo"
      onClick={cerrar}
      style={{ position: "fixed", inset: 0, zIndex: 140, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 18,
        background: "rgba(6,13,20,.66)" }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16,
          maxWidth: 460, width: "100%", maxHeight: "86vh", overflowY: "auto",
          boxShadow: "0 18px 50px rgba(0,0,0,.45)" }}>

        <div style={{ padding: "20px 22px 0" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
            letterSpacing: ".12em", color: T.accent, marginBottom: 9 }}>
            NOVEDADES · {novedad.version}
          </div>
          <h2 id="ff-novedades-titulo"
            style={{ margin: 0, fontSize: 21, fontWeight: 800, lineHeight: 1.2,
              fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", color: T.text }}>
            {novedad.titulo}
          </h2>
        </div>

        <ul style={{ margin: "14px 0 0", padding: "0 22px 0 40px", color: T.muted,
          fontSize: 14.5, lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 9 }}>
          {novedad.puntos.map((p, i) => <li key={i}>{p}</li>)}
        </ul>

        {historial.length > 0 && (
          <div style={{ margin: "16px 22px 0", paddingTop: 14, borderTop: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column", gap: 14 }}>
            {historial.map(h => (
              <div key={h.version}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>
                  {h.titulo} <span style={{ color: T.muted, fontWeight: 500 }}>· {h.version}</span>
                </div>
                <ul style={{ margin: "5px 0 0", paddingLeft: 18, color: T.muted, fontSize: 13, lineHeight: 1.55 }}>
                  {h.puntos.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <button ref={btnRef} onClick={cerrar}
            style={{ flex: 1, padding: "12px 0", borderRadius: 11, border: "none",
              background: T.accent, color: "#fff", fontSize: 15, fontWeight: 700,
              cursor: "pointer", fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            Entendido
          </button>
          {historialNovedades(modulo).length > 0 && !verHistorial && (
            <button onClick={() => setVerHistorial(true)}
              style={{ padding: "12px 14px", borderRadius: 11, background: "none",
                border: `1px solid ${T.border}`, color: T.muted, fontSize: 13.5,
                fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Ver anteriores
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
