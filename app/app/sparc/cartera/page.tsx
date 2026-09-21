"use client";

/**
 * Cartera consolidada de SPARC — todos los condominios en una sola pantalla.
 *
 * Por que existe: Vivook (el sistema con el que SPARC administra) opera por
 * condominio. Eduardo nunca ve el total de su cartera junto: cuanto le deben,
 * cuanto deben sus edificios y cuales estan en riesgo. Esta pantalla lo junta.
 *
 * Datos: tabla `sparc_portfolio_snapshots`, un renglon por condominio por fecha
 * de corte, cargados por FishFlow desde los reportes que exporta Vivook. Solo
 * lectura: el panel no escribe nada. RLS con user_has_access_to_client.
 *
 * Semaforo (criterio propio de FishFlow, explicado en pantalla):
 *   rojo   = morosidad >= 25 %  o  bancos en negativo
 *   ambar  = morosidad >= 10 %  o  bancos no alcanzan a cubrir las CxP
 *   verde  = lo demas
 *
 * No se calcula una "morosidad de la cartera": Vivook no documenta como la
 * calcula por condominio, y promediarla seria inventar un numero.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SparcHeader, { SPARC, SparcFonts } from "../_components/SparcHeader";

const { AZUL, AZUL_900, VERDE, TINTA, GRIS, LINEA, PAPEL, CLIENT_ID } = SPARC;
const ROJO = "#B3261E";
const AMBAR = "#9A6B00";

interface Corte {
  snapshot_date: string;
  condominio: string;
  viviendas: number | null;
  usuarios: number | null;
  cxc: number | null;
  cxp: number | null;
  bancos: number | null;
  morosidad_pct: number | null;
}

type Nivel = "rojo" | "ambar" | "verde";
type Orden = "cxc" | "morosidad_pct" | "liquidez" | "viviendas" | "condominio";

const n = (v: number | null | undefined) => Number(v ?? 0);

function nivel(c: Corte): Nivel {
  const m = n(c.morosidad_pct), b = n(c.bancos), p = n(c.cxp);
  if (m >= 25 || b < 0) return "rojo";
  if (m >= 10 || b < p) return "ambar";
  return "verde";
}

const NIVEL_META: Record<Nivel, { fg: string; bg: string; bd: string; label: string }> = {
  rojo:  { fg: ROJO,  bg: "#FCEEEC", bd: "#F3C9C4", label: "Atender ya" },
  ambar: { fg: AMBAR, bg: "#FFF6E5", bd: "#F0DDB5", label: "Vigilar" },
  verde: { fg: "#217634", bg: "#EDF7EF", bd: "#BFE0CB", label: "Sano" },
};

/** Vivook guarda nombres en mayusculas o mixtos; se muestran parejos. */
function nombre(s: string) {
  const menores = new Set(["de", "del", "la", "las", "los", "y"]);
  return s.toLowerCase().split(/\s+/).map((w, i) => {
    if (/^(a\.c\.|s\.c\.)$/.test(w)) return w.toUpperCase();
    if (/^dr\.?$/.test(w)) return "Dr.";
    if (i > 0 && menores.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ").replace(/^Condominio |^Residencial /, "");
}

const mxn = (v: number) => v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
function compacto(v: number) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${v < 0 ? "-" : ""}$${(a / 1_000_000).toFixed(2)} M`;
  if (a >= 1_000) return `${v < 0 ? "-" : ""}$${Math.round(a / 1_000)} mil`;
  return mxn(v);
}
function fechaLarga(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

export default function SparcCartera() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [fecha, setFecha] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<Orden>("cxc");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const { data, error } = await supabase
        .from("sparc_portfolio_snapshots")
        .select("snapshot_date,condominio,viviendas,usuarios,cxc,cxp,bancos,morosidad_pct")
        .eq("client_id", CLIENT_ID)
        .order("snapshot_date", { ascending: false })
        .range(0, 999);
      if (error) setError(error.message);
      else {
        const filas = (data ?? []) as Corte[];
        setCortes(filas);
        if (filas.length) setFecha(filas[0].snapshot_date);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  const fechas = useMemo(() => Array.from(new Set(cortes.map((c) => c.snapshot_date))), [cortes]);
  const actual = useMemo(() => cortes.filter((c) => c.snapshot_date === fecha), [cortes, fecha]);
  const previo = useMemo(() => {
    const i = fechas.indexOf(fecha);
    const f = i >= 0 ? fechas[i + 1] : undefined;
    return f ? new Map(cortes.filter((c) => c.snapshot_date === f).map((c) => [c.condominio, c])) : null;
  }, [cortes, fechas, fecha]);

  const tot = useMemo(() => ({
    condominios: actual.length,
    viviendas: actual.reduce((s, c) => s + n(c.viviendas), 0),
    cxc: actual.reduce((s, c) => s + n(c.cxc), 0),
    cxp: actual.reduce((s, c) => s + n(c.cxp), 0),
    bancos: actual.reduce((s, c) => s + n(c.bancos), 0),
    rojos: actual.filter((c) => nivel(c) === "rojo").length,
    ambar: actual.filter((c) => nivel(c) === "ambar").length,
  }), [actual]);

  const filas = useMemo(() => {
    const v = (c: Corte) =>
      orden === "liquidez" ? n(c.bancos) - n(c.cxp)
      : orden === "condominio" ? 0
      : n(c[orden] as number | null);
    const copia = [...actual];
    if (orden === "condominio") copia.sort((a, b) => nombre(a.condominio).localeCompare(nombre(b.condominio)));
    else if (orden === "liquidez") copia.sort((a, b) => v(a) - v(b));
    else copia.sort((a, b) => v(b) - v(a));
    return copia;
  }, [actual, orden]);

  const maxCxc = Math.max(1, ...actual.map((c) => n(c.cxc)));
  const top3 = [...actual].sort((a, b) => n(b.cxc) - n(a.cxc)).slice(0, 3);
  const pctTop3 = tot.cxc ? Math.round((top3.reduce((s, c) => s + n(c.cxc), 0) / tot.cxc) * 100) : 0;

  const jost: React.CSSProperties = { fontFamily: "'Jost', system-ui, sans-serif" };
  const card: React.CSSProperties = {
    background: "#fff", border: `1px solid ${LINEA}`, borderRadius: 13, padding: "18px 20px",
    boxShadow: "0 1px 2px rgba(14,29,40,.04)",
  };
  const th: React.CSSProperties = {
    textAlign: "right", padding: "10px 12px", fontSize: 12, fontWeight: 600, color: GRIS,
    borderBottom: `1px solid ${LINEA}`, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
  };
  const td: React.CSSProperties = {
    textAlign: "right", padding: "12px", fontSize: 14, borderBottom: `1px solid ${LINEA}`,
    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
  };

  function Th({ k, children, left }: { k: Orden; children: React.ReactNode; left?: boolean }) {
    const activo = orden === k;
    return (
      <th onClick={() => setOrden(k)} style={{ ...th, textAlign: left ? "left" : "right", color: activo ? AZUL : GRIS }}>
        {children}{activo ? " ▾" : ""}
      </th>
    );
  }

  function Delta({ actual: a, antes, invertir }: { actual: number; antes?: number | null; invertir?: boolean }) {
    if (antes === undefined || antes === null) return null;
    const d = a - antes;
    if (Math.abs(d) < 0.005) return null;
    const bueno = invertir ? d < 0 : d > 0;
    return (
      <div style={{ fontSize: 11.5, color: bueno ? "#217634" : ROJO, marginTop: 2 }}>
        {d > 0 ? "▲" : "▼"} {compacto(Math.abs(d)).replace("-", "")}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: PAPEL, color: TINTA, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <SparcFonts />
      <SparcHeader userEmail={userEmail} />

      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 16px 64px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <h1 style={{ ...jost, fontSize: 30, fontWeight: 500, margin: "0 0 8px", letterSpacing: "-.01em" }}>Cartera consolidada</h1>
            <p style={{ color: GRIS, fontSize: 15, margin: 0, lineHeight: 1.6, maxWidth: "64ch" }}>
              Todos los condominios que administra SPARC en una sola vista, con los saldos que reporta Vivook.
            </p>
          </div>
          {fechas.length > 0 && (
            <label style={{ fontSize: 13, color: GRIS, display: "flex", alignItems: "center", gap: 8 }}>
              Corte
              <select value={fecha} onChange={(e) => setFecha(e.target.value)}
                style={{ border: `1px solid ${LINEA}`, borderRadius: 8, padding: "7px 10px", fontSize: 14, fontFamily: "inherit", color: TINTA, background: "#fff" }}>
                {fechas.map((f) => <option key={f} value={f}>{fechaLarga(f)}</option>)}
              </select>
            </label>
          )}
        </div>

        {loading && <p style={{ color: GRIS }}>Cargando cartera…</p>}
        {error && <p style={{ color: ROJO }}>Error: {error}</p>}
        {!loading && !error && actual.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: "56px 24px", color: GRIS }}>
            Todavía no hay cortes de cartera cargados.
          </div>
        )}

        {!loading && !error && actual.length > 0 && (
          <>
            {/* Totales */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 18 }}>
              {[
                { v: String(tot.condominios), l: `condominios · ${tot.viviendas.toLocaleString("es-MX")} viviendas`, c: AZUL_900 },
                { v: compacto(tot.cxc), l: "por cobrar a condóminos", c: AZUL_900 },
                { v: compacto(tot.cxp), l: "por pagar a proveedores", c: AZUL_900 },
                { v: compacto(tot.bancos), l: "en bancos", c: AZUL_900 },
                { v: String(tot.rojos), l: tot.rojos === 1 ? "condominio por atender ya" : "condominios por atender ya", c: tot.rojos ? ROJO : VERDE },
              ].map((k) => (
                <div key={k.l} style={card}>
                  <div style={{ ...jost, fontSize: 28, fontWeight: 500, color: k.c, lineHeight: 1.15 }}>{k.v}</div>
                  <div style={{ color: GRIS, fontSize: 13, marginTop: 4 }}>{k.l}</div>
                </div>
              ))}
            </div>

            {/* Lectura rapida */}
            <div style={{ ...card, marginBottom: 18, background: "#fff", borderLeft: `4px solid ${AZUL}` }}>
              <div style={{ fontSize: 14.5, lineHeight: 1.7, color: TINTA }}>
                Tres condominios concentran el <strong>{pctTop3}%</strong> de lo que se debe:{" "}
                {top3.map((c, i) => (
                  <span key={c.condominio}>
                    <strong>{nombre(c.condominio)}</strong> ({compacto(n(c.cxc))}){i < 2 ? (i === 1 ? " y " : ", ") : "."}
                  </span>
                ))}{" "}
                {tot.rojos + tot.ambar > 0 && (
                  <>Hay <strong>{tot.rojos}</strong> en rojo y <strong>{tot.ambar}</strong> en ámbar.</>
                )}
              </div>
            </div>

            {/* Por cobrar por condominio */}
            <div style={{ ...card, marginBottom: 18 }}>
              <div style={{ ...jost, fontSize: 18, fontWeight: 500, marginBottom: 14 }}>Por cobrar, por condominio</div>
              <div style={{ display: "grid", gap: 9 }}>
                {[...actual].sort((a, b) => n(b.cxc) - n(a.cxc)).map((c) => {
                  const nv = NIVEL_META[nivel(c)];
                  return (
                    <div key={c.condominio} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 190px) 1fr auto", gap: 12, alignItems: "center" }}>
                      <div style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.condominio}>
                        {nombre(c.condominio)}
                      </div>
                      <div style={{ background: PAPEL, borderRadius: 4, height: 14 }}>
                        <div style={{ width: `${(n(c.cxc) / maxCxc) * 100}%`, height: "100%", borderRadius: 4, background: nv.fg, opacity: 0.85 }} />
                      </div>
                      <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 72, textAlign: "right" }}>{compacto(n(c.cxc))}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tabla completa */}
            <div style={{ ...card, padding: 0, overflowX: "auto", marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr>
                    <Th k="condominio" left>Condominio</Th>
                    <Th k="viviendas">Viviendas</Th>
                    <Th k="cxc">Por cobrar</Th>
                    <th style={{ ...th, cursor: "default" }}>Por pagar</th>
                    <th style={{ ...th, cursor: "default" }}>Bancos</th>
                    <Th k="liquidez">Bancos − por pagar</Th>
                    <Th k="morosidad_pct">Morosidad</Th>
                    <th style={{ ...th, cursor: "default", textAlign: "center" }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((c) => {
                    const nv = NIVEL_META[nivel(c)];
                    const liq = n(c.bancos) - n(c.cxp);
                    const p = previo?.get(c.condominio);
                    return (
                      <tr key={c.condominio}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 500 }} title={c.condominio}>{nombre(c.condominio)}</td>
                        <td style={td}>{n(c.viviendas)}</td>
                        <td style={td}>{mxn(n(c.cxc))}<Delta actual={n(c.cxc)} antes={p ? n(p.cxc) : undefined} invertir /></td>
                        <td style={td}>{mxn(n(c.cxp))}</td>
                        <td style={{ ...td, color: n(c.bancos) < 0 ? ROJO : TINTA }}>{mxn(n(c.bancos))}</td>
                        <td style={{ ...td, color: liq < 0 ? ROJO : TINTA }}>{mxn(liq)}</td>
                        <td style={{ ...td, fontWeight: 600, color: nv.fg }}>
                          {n(c.morosidad_pct).toFixed(1)}%
                          {p && Math.abs(n(c.morosidad_pct) - n(p.morosidad_pct)) >= 0.05 && (
                            <div style={{ fontSize: 11.5, fontWeight: 400, color: n(c.morosidad_pct) < n(p.morosidad_pct) ? "#217634" : ROJO }}>
                              {n(c.morosidad_pct) > n(p.morosidad_pct) ? "▲" : "▼"} {Math.abs(n(c.morosidad_pct) - n(p.morosidad_pct)).toFixed(1)} pts
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                            background: nv.bg, color: nv.fg, border: `1px solid ${nv.bd}` }}>{nv.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700, borderBottom: "none" }}>Total</td>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{tot.viviendas}</td>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{mxn(tot.cxc)}</td>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{mxn(tot.cxp)}</td>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{mxn(tot.bancos)}</td>
                    <td style={{ ...td, fontWeight: 700, borderBottom: "none" }}>{mxn(tot.bancos - tot.cxp)}</td>
                    <td style={{ ...td, borderBottom: "none" }} />
                    <td style={{ ...td, borderBottom: "none" }} />
                  </tr>
                </tbody>
              </table>
            </div>

            <p style={{ color: GRIS, fontSize: 12.5, lineHeight: 1.65, margin: 0 }}>
              <strong style={{ color: ROJO }}>Atender ya</strong>: morosidad de 25% o más, o bancos en negativo.{" "}
              <strong style={{ color: AMBAR }}>Vigilar</strong>: morosidad de 10% o más, o el saldo en bancos no cubre lo que se debe a proveedores.{" "}
              La morosidad es la que calcula Vivook para cada condominio. Fuente: Panel del Administrador de Vivook, corte del {fecha && fechaLarga(fecha)}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
