"use client";

/**
 * Cartera consolidada de SPARC — los 10 condominios en una sola pantalla.
 *
 * Vivook opera condominio por condominio; su "Reporte Global" solo trae
 * viviendas, ingresos, egresos y % de cobranza. Aquí se junta lo que Eduardo
 * no ve junto: cuánto le deben, cuánto deben sus edificios, si les alcanza
 * para pagar y qué parte de lo vencido heredó de administraciones anteriores.
 *
 * Datos (solo lectura, RLS por cliente):
 *   sparc_portfolio_snapshots  saldos por condominio por fecha de corte
 *   sparc_delinquencies        vencido por unidad (reporte Morosos de Vivook)
 *
 * Semáforo (criterio FishFlow, explicado en pantalla):
 *   Atender ya  morosidad >= 25 %  o  bancos en negativo
 *   Vigilar     morosidad >= 10 %  o  bancos no cubren las CxP
 *   Sano        lo demás
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SparcHeader, { SPARC, SparcFonts } from "../_components/SparcHeader";
import {
  COLOR, NIVEL, Chip, card, compacto, fechaCorta, fechaLarga, jost, mxn, n, nombre, useTip,
  type Nivel,
} from "../_components/sparcData";

const { AZUL, AZUL_900, TINTA, GRIS, LINEA, PAPEL, CLIENT_ID } = SPARC;

interface Corte {
  snapshot_date: string;
  condominio: string;
  viviendas: number | null;
  cxc: number | null;
  cxp: number | null;
  bancos: number | null;
  morosidad_pct: number | null;
}
interface Vencido { snapshot_date: string; condominio: string; saldo: number; saldo_inicial: number | null }

function nivel(c: Corte): Nivel {
  const m = n(c.morosidad_pct), b = n(c.bancos), p = n(c.cxp);
  if (m >= 25 || b < 0) return "atender";
  if (m >= 10 || b < p) return "vigilar";
  return "sano";
}

export default function SparcCartera() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [vencidos, setVencidos] = useState<Vencido[]>([]);
  const [fecha, setFecha] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verTabla, setVerTabla] = useState(false);
  const tip = useTip();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const [a, b] = await Promise.all([
        supabase.from("sparc_portfolio_snapshots")
          .select("snapshot_date,condominio,viviendas,cxc,cxp,bancos,morosidad_pct")
          .eq("client_id", CLIENT_ID).order("snapshot_date", { ascending: false }).range(0, 999),
        supabase.from("sparc_delinquencies")
          .select("snapshot_date,condominio,saldo,saldo_inicial")
          .eq("client_id", CLIENT_ID).order("snapshot_date", { ascending: false }).range(0, 999),
      ]);
      if (a.error || b.error) setError((a.error ?? b.error)!.message);
      else {
        const filas = (a.data ?? []) as Corte[];
        setCortes(filas);
        setVencidos((b.data ?? []) as Vencido[]);
        if (filas.length) setFecha(filas[0].snapshot_date);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  const fechas = useMemo(() => Array.from(new Set(cortes.map((c) => c.snapshot_date))), [cortes]);
  const actual = useMemo(() => cortes.filter((c) => c.snapshot_date === fecha), [cortes, fecha]);
  const fechaPrevia = fechas[fechas.indexOf(fecha) + 1];
  const previo = useMemo(
    () => new Map(cortes.filter((c) => c.snapshot_date === fechaPrevia).map((c) => [c.condominio, c])),
    [cortes, fechaPrevia],
  );

  /* Vencido: el corte de Morosos más reciente que no sea posterior al corte elegido. */
  const fechaVenc = useMemo(
    () => Array.from(new Set(vencidos.map((v) => v.snapshot_date))).find((f) => f <= fecha) ?? "",
    [vencidos, fecha],
  );
  const venc = useMemo(() => {
    const m = new Map<string, { total: number; heredado: number; unidades: number }>();
    for (const v of vencidos.filter((x) => x.snapshot_date === fechaVenc)) {
      const cur = m.get(v.condominio) ?? { total: 0, heredado: 0, unidades: 0 };
      cur.total += n(v.saldo);
      cur.heredado += Math.min(n(v.saldo_inicial), n(v.saldo));
      cur.unidades += 1;
      m.set(v.condominio, cur);
    }
    return m;
  }, [vencidos, fechaVenc]);

  const tot = useMemo(() => {
    const s = (k: keyof Corte, arr: Corte[]) => arr.reduce((acc, c) => acc + n(c[k] as number), 0);
    const prev = Array.from(previo.values());
    const vt = Array.from(venc.values());
    return {
      condominios: actual.length,
      viviendas: s("viviendas", actual),
      cxc: s("cxc", actual), cxcPrev: prev.length ? s("cxc", prev) : null,
      cxp: s("cxp", actual), bancos: s("bancos", actual),
      vencido: vt.reduce((a, v) => a + v.total, 0),
      heredado: vt.reduce((a, v) => a + v.heredado, 0),
      unidades: vt.reduce((a, v) => a + v.unidades, 0),
      atender: actual.filter((c) => nivel(c) === "atender").length,
      vigilar: actual.filter((c) => nivel(c) === "vigilar").length,
    };
  }, [actual, previo, venc]);

  const ordenados = useMemo(() => [...actual].sort((a, b) =>
    NIVEL[nivel(a)].orden - NIVEL[nivel(b)].orden || n(b.cxc) - n(a.cxc)), [actual]);

  const porVencido = useMemo(() => [...actual]
    .map((c) => ({ c, v: venc.get(c.condominio) ?? { total: 0, heredado: 0, unidades: 0 } }))
    .sort((a, b) => b.v.total - a.v.total), [actual, venc]);
  const maxVenc = Math.max(1, ...porVencido.map((x) => x.v.total));

  const porLiquidez = useMemo(() => [...actual]
    .map((c) => ({ c, liq: n(c.bancos) - n(c.cxp) }))
    .sort((a, b) => b.liq - a.liq), [actual]);
  const maxLiq = Math.max(1, ...porLiquidez.map((x) => Math.abs(x.liq)));

  const delta = tot.cxcPrev !== null ? tot.cxc - tot.cxcPrev : null;

  const titulo2: React.CSSProperties = { ...jost, fontSize: 19, fontWeight: 500, margin: "0 0 4px" };
  const sub: React.CSSProperties = { color: GRIS, fontSize: 13.5, margin: "0 0 18px", lineHeight: 1.55 };

  return (
    <div style={{ minHeight: "100vh", background: PAPEL, color: TINTA, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <SparcFonts />
      <style>{`
        .sp-hero { display: grid; grid-template-columns: 1.35fr 1fr 1fr 1fr; gap: 14px; }
        .sp-bld  { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
        .sp-two  { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sp-bld a:hover, .sp-bld a:focus-visible { border-color: ${AZUL} !important; box-shadow: 0 4px 14px rgba(0,101,161,.10) !important; }
        @media (max-width: 900px) { .sp-hero { grid-template-columns: 1fr 1fr; } .sp-hero > :first-child { grid-column: 1 / -1; } .sp-two { grid-template-columns: 1fr; } }
        @media (max-width: 520px) { .sp-hero { grid-template-columns: 1fr; } }
      `}</style>
      <SparcHeader userEmail={userEmail} />
      {tip.node}

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 16px 64px" }}>
        {/* Encabezado */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <h1 style={{ ...jost, fontSize: 30, fontWeight: 500, margin: "0 0 6px", letterSpacing: "-.01em" }}>Tu cartera</h1>
            <p style={{ color: GRIS, fontSize: 15, margin: 0 }}>
              {tot.condominios} condominios · {tot.viviendas.toLocaleString("es-MX")} viviendas · saldos de Vivook
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
        {error && <p style={{ color: COLOR.negativo }}>Error: {error}</p>}
        {!loading && !error && actual.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: "56px 24px", color: GRIS }}>Todavía no hay cortes de cartera cargados.</div>
        )}

        {!loading && !error && actual.length > 0 && (
          <>
            {/* 1 · Cifras principales */}
            <div className="sp-hero" style={{ marginBottom: 14 }}>
              <div style={{ ...card, background: AZUL_900, border: "none", color: "#fff", padding: "22px 24px" }}>
                <div style={{ fontSize: 13.5, opacity: 0.8 }}>Te deben tus condóminos</div>
                <div style={{ ...jost, fontSize: 48, fontWeight: 500, lineHeight: 1.1, margin: "6px 0 8px" }}>{compacto(tot.cxc)}</div>
                {delta !== null && fechaPrevia && (
                  <div style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6,
                    background: "rgba(255,255,255,.12)", borderRadius: 999, padding: "4px 11px" }}>
                    <span aria-hidden>{delta <= 0 ? "▼" : "▲"}</span>
                    {compacto(Math.abs(delta)).replace("-", "")} {delta <= 0 ? "menos" : "más"} que el {fechaCorta(fechaPrevia)}
                  </div>
                )}
              </div>
              {[
                { l: "Vencido", v: tot.vencido, s: tot.vencido ? `${Math.round((tot.heredado / tot.vencido) * 100)}% heredado · ${tot.unidades} unidades` : "sin detalle" },
                { l: "Deben tus edificios a proveedores", v: tot.cxp, s: "cuentas por pagar" },
                { l: "En bancos", v: tot.bancos, s: `${compacto(tot.bancos - tot.cxp)} después de pagar` },
              ].map((k) => (
                <div key={k.l} style={card}>
                  <div style={{ color: GRIS, fontSize: 13 }}>{k.l}</div>
                  <div style={{ ...jost, fontSize: 30, fontWeight: 500, color: AZUL_900, lineHeight: 1.2, margin: "6px 0 4px" }}>{compacto(k.v)}</div>
                  <div style={{ color: GRIS, fontSize: 12.5 }}>{k.s}</div>
                </div>
              ))}
            </div>

            {/* Lectura en una línea */}
            <div style={{ ...card, marginBottom: 26, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", padding: "14px 20px" }}>
              {(["atender", "vigilar", "sano"] as Nivel[]).map((k) => {
                const cuantos = actual.filter((c) => nivel(c) === k).length;
                return (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <span aria-hidden style={{ color: NIVEL[k].color }}>{NIVEL[k].icono}</span>
                    <strong style={{ ...jost, fontSize: 18, fontWeight: 600 }}>{cuantos}</strong>
                    <span style={{ color: GRIS }}>{NIVEL[k].label.toLowerCase()}</span>
                  </span>
                );
              })}
              <Link href="/app/sparc/cobranza" style={{ marginLeft: "auto", color: AZUL, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
                Ver a quién cobrar →
              </Link>
            </div>

            {/* 2 · Condominios */}
            <h2 style={titulo2}>Tus condominios</h2>
            <p style={sub}>Ordenados por urgencia. Toca uno para ver sus adeudos por unidad.</p>
            <div className="sp-bld" style={{ marginBottom: 30 }}>
              {ordenados.map((c) => {
                const nv = nivel(c);
                const mor = n(c.morosidad_pct);
                const liq = n(c.bancos) - n(c.cxp);
                const p = previo.get(c.condominio);
                const d = p ? n(c.cxc) - n(p.cxc) : 0;
                return (
                  <Link key={c.condominio} href={`/app/sparc/cobranza?c=${encodeURIComponent(c.condominio)}`}
                    style={{ ...card, display: "block", textDecoration: "none", color: TINTA, padding: "16px 18px",
                      borderTop: `3px solid ${NIVEL[nv].color}`, transition: "box-shadow .15s, border-color .15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ ...jost, fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{nombre(c.condominio)}</div>
                      <Chip nivel={nv} />
                    </div>
                    <div style={{ color: GRIS, fontSize: 12.5, marginTop: 2 }}>{n(c.viviendas)} viviendas</div>

                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "14px 0 2px", flexWrap: "wrap" }}>
                      <span style={{ ...jost, fontSize: 26, fontWeight: 500 }}>{compacto(n(c.cxc))}</span>
                      <span style={{ color: GRIS, fontSize: 12.5 }}>por cobrar</span>
                      {p && Math.abs(d) >= 1 && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: d < 0 ? "#217634" : COLOR.negativo }}>
                          {d < 0 ? "▼" : "▲"} {compacto(Math.abs(d))}
                        </span>
                      )}
                    </div>

                    {/* Medidor de morosidad */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: GRIS, margin: "12px 0 5px" }}>
                      <span>Morosidad del mes</span>
                      <strong style={{ color: TINTA }}>{mor.toFixed(1)}%</strong>
                    </div>
                    <div style={{ height: 8, background: COLOR.track, borderRadius: 4, overflow: "hidden" }}
                      role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={mor} aria-label="Morosidad">
                      <div style={{ width: `${Math.min(100, mor)}%`, height: "100%", borderRadius: 4, background: NIVEL[nv].color }} />
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINEA}` }}>
                      <span style={{ color: GRIS }}>Bancos − por pagar</span>
                      <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: liq < 0 ? COLOR.negativo : COLOR.positivo }} />
                        {compacto(liq)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* 3 · Dos gráficas */}
            <div className="sp-two" style={{ marginBottom: 26 }}>
              {/* Vencido heredado vs generado */}
              <div style={card}>
                <h2 style={titulo2}>¿De dónde viene lo vencido?</h2>
                <p style={{ ...sub, marginBottom: 12 }}>
                  {tot.vencido ? <>El <strong style={{ color: TINTA }}>{Math.round((tot.heredado / tot.vencido) * 100)}%</strong> se heredó de administraciones anteriores.</> : "Sin detalle de adeudos para este corte."}
                </p>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: GRIS, marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: COLOR.heredado, display: "inline-block" }} />Heredado</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: COLOR.generado, display: "inline-block" }} />Generado en la gestión actual</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {porVencido.map(({ c, v }) => {
                    const gen = v.total - v.heredado;
                    const wH = (v.heredado / maxVenc) * 100, wG = (gen / maxVenc) * 100;
                    return (
                      <div key={c.condominio} style={{ display: "grid", gridTemplateColumns: "minmax(92px,128px) 1fr auto", gap: 10, alignItems: "center" }}
                        {...tip.bind([nombre(c.condominio), `Vencido ${mxn(v.total)}`, `Heredado ${mxn(v.heredado)}`, `Generado ${mxn(gen)}`, `${v.unidades} unidades con adeudo`])}>
                        <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nombre(c.condominio)}</span>
                        <div style={{ display: "flex", height: 16, gap: wH > 0 && wG > 0 ? 2 : 0 }}>
                          {wH > 0 && <div style={{ width: `${wH}%`, background: COLOR.heredado, borderRadius: wG > 0 ? "0" : "0 4px 4px 0" }} />}
                          {wG > 0 && <div style={{ width: `${wG}%`, background: COLOR.generado, borderRadius: "0 4px 4px 0" }} />}
                        </div>
                        <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", minWidth: 62, textAlign: "right" }}>{compacto(v.total)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Liquidez */}
              <div style={card}>
                <h2 style={titulo2}>¿Alcanza para pagar a proveedores?</h2>
                <p style={{ ...sub, marginBottom: 12 }}>
                  Bancos menos cuentas por pagar. <strong style={{ color: TINTA }}>{porLiquidez.filter((x) => x.liq < 0).length}</strong> condominios no alcanzan.
                </p>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: GRIS, marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: COLOR.positivo, display: "inline-block" }} />Sobra</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 2, background: COLOR.negativo, display: "inline-block" }} />Falta</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {porLiquidez.map(({ c, liq }) => {
                    const w = (Math.abs(liq) / maxLiq) * 36;
                    return (
                      <div key={c.condominio} style={{ display: "grid", gridTemplateColumns: "minmax(92px,128px) 1fr", gap: 10, alignItems: "center" }}
                        {...tip.bind([nombre(c.condominio), `Bancos ${mxn(n(c.bancos))}`, `Por pagar ${mxn(n(c.cxp))}`, `${liq < 0 ? "Faltan" : "Sobran"} ${mxn(Math.abs(liq))}`])}>
                        <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nombre(c.condominio)}</span>
                        <div style={{ position: "relative", height: 16 }}>
                          <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "#C3CFD8" }} />
                          <div style={{ position: "absolute", top: 0, height: 16, width: `${w}%`, background: liq < 0 ? COLOR.negativo : COLOR.positivo,
                            left: liq < 0 ? `${50 - w}%` : "50%", borderRadius: liq < 0 ? "4px 0 0 4px" : "0 4px 4px 0" }} />
                          <span style={{ position: "absolute", top: -1, fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: TINTA, whiteSpace: "nowrap",
                            ...(liq < 0 ? { right: `${50 + w}%`, marginRight: 5 } : { left: `${50 + w}%`, marginLeft: 5 }) }}>
                            {compacto(liq)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 4 · Tabla completa */}
            <button onClick={() => setVerTabla((v) => !v)} aria-expanded={verTabla}
              style={{ background: "#fff", border: `1px solid ${LINEA}`, borderRadius: 9, padding: "9px 16px", fontSize: 14,
                fontFamily: "inherit", color: AZUL, fontWeight: 600, cursor: "pointer", marginBottom: 14 }}>
              {verTabla ? "Ocultar tabla completa" : "Ver tabla completa"}
            </button>
            {verTabla && (
              <div style={{ ...card, padding: 0, overflowX: "auto", marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: GRIS, fontSize: 12 }}>
                      {["Condominio", "Viviendas", "Por cobrar", "Vencido", "Por pagar", "Bancos", "Morosidad", "Estado"].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 ? "left" : i === 7 ? "center" : "right", padding: "10px 12px", borderBottom: `1px solid ${LINEA}`, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                    {ordenados.map((c) => (
                      <tr key={c.condominio}>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, fontWeight: 500 }}>{nombre(c.condominio)}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{n(c.viviendas)}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{mxn(n(c.cxc))}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{mxn(venc.get(c.condominio)?.total ?? 0)}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{mxn(n(c.cxp))}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{mxn(n(c.bancos))}</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "right" }}>{n(c.morosidad_pct).toFixed(1)}%</td>
                        <td style={{ padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, textAlign: "center" }}><Chip nivel={nivel(c)} /></td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}>
                      <td style={{ padding: "11px 12px" }}>Total</td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>{tot.viviendas}</td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>{mxn(tot.cxc)}</td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>{mxn(tot.vencido)}</td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>{mxn(tot.cxp)}</td>
                      <td style={{ padding: "11px 12px", textAlign: "right" }}>{mxn(tot.bancos)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <p style={{ color: GRIS, fontSize: 12.5, lineHeight: 1.7, margin: "8px 0 0", maxWidth: "90ch" }}>
              <strong style={{ color: TINTA }}>▲ Atender ya</strong>: morosidad de 25% o más, o bancos en negativo.{" "}
              <strong style={{ color: TINTA }}>● Vigilar</strong>: morosidad de 10% o más, o los bancos no cubren lo que se debe a proveedores.{" "}
              La morosidad es la que Vivook calcula al mes corriente. «Heredado» son los saldos iniciales y adeudos anteriores que Vivook registra al arrancar la administración.
              Fuente: Panel del Administrador y reporte de Morosos de Vivook, corte del {fecha && fechaLarga(fecha)}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
