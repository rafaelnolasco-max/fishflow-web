"use client";

/**
 * Cobranza de SPARC — a quién cobrar primero, en toda la cartera.
 *
 * Vivook tiene un reporte de Morosos por condominio. Aquí se juntan los 10
 * condominios en una sola lista y cada unidad cae en un grupo con una acción:
 *   Cobrar ya     deuda >= $5,000, reciente y sin convenio
 *   Histórico     más de un año de atraso, o la mitad o más es heredada
 *   En convenio   Vivook marca convenio de pago
 *   Recordatorio  menos de $5,000
 *
 * Datos: sparc_delinquencies (solo lectura, RLS por cliente). Sin nombres ni
 * contactos de condóminos: solo unidad, saldo, composición y antigüedad.
 *
 * ?c=<condominio> filtra un condominio (se llega desde las tarjetas de Cartera).
 * Se lee de window.location para no requerir <Suspense> con useSearchParams.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SparcHeader, { SPARC, SparcFonts } from "../_components/SparcHeader";
import {
  COLOR, GRUPO, antiguedad, card, compacto, diasAtraso, fechaLarga, grupo, jost, mxn, n, nombre, useTip,
  type Adeudo, type Grupo,
} from "../_components/sparcData";

const { AZUL, AZUL_050, AZUL_900, TINTA, GRIS, LINEA, PAPEL, CLIENT_ID } = SPARC;
const GRUPOS: Grupo[] = ["cobrar", "historico", "convenio", "recordatorio"];
type Orden = "monto" | "antiguedad" | "condominio";

export default function SparcCobranza() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [filas, setFilas] = useState<Adeudo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [condo, setCondo] = useState("todos");
  const [g, setG] = useState<Grupo | "todos">("todos");
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState<Orden>("monto");
  const [limite, setLimite] = useState(60);
  const tip = useTip();

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setCondo(c);
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const { data, error } = await supabase.from("sparc_delinquencies")
        .select("snapshot_date,condominio,unidad,saldo,saldo_inicial,vencimiento_mas_antiguo,num_adeudos,con_convenio")
        .eq("client_id", CLIENT_ID).order("snapshot_date", { ascending: false }).range(0, 999);
      if (error) setError(error.message);
      else setFilas((data ?? []) as Adeudo[]);
      setLoading(false);
    }
    load();
  }, [router]);

  const corte = filas[0]?.snapshot_date ?? "";
  const actuales = useMemo(() => filas.filter((f) => f.snapshot_date === corte), [filas, corte]);
  const condominios = useMemo(() => Array.from(new Set(actuales.map((f) => f.condominio)))
    .sort((a, b) => nombre(a).localeCompare(nombre(b))), [actuales]);

  const enCondo = useMemo(() => actuales.filter((f) => condo === "todos" || f.condominio === condo), [actuales, condo]);
  const total = enCondo.reduce((s, f) => s + n(f.saldo), 0);
  const heredado = enCondo.reduce((s, f) => s + Math.min(n(f.saldo_inicial), n(f.saldo)), 0);

  const resumen = useMemo(() => {
    const r = Object.fromEntries(GRUPOS.map((k) => [k, { monto: 0, unidades: 0 }])) as Record<Grupo, { monto: number; unidades: number }>;
    for (const f of enCondo) { const k = grupo(f, corte); r[k].monto += n(f.saldo); r[k].unidades += 1; }
    return r;
  }, [enCondo, corte]);

  const top10 = useMemo(() => {
    const s = [...enCondo].sort((a, b) => n(b.saldo) - n(a.saldo)).slice(0, 10);
    return total ? Math.round((s.reduce((a, f) => a + n(f.saldo), 0) / total) * 100) : 0;
  }, [enCondo, total]);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = enCondo.filter((f) => (g === "todos" || grupo(f, corte) === g) && (!t || f.unidad.toLowerCase().includes(t)));
    if (orden === "monto") r.sort((a, b) => n(b.saldo) - n(a.saldo));
    if (orden === "antiguedad") r.sort((a, b) => diasAtraso(b, corte) - diasAtraso(a, corte) || n(b.saldo) - n(a.saldo));
    if (orden === "condominio") r.sort((a, b) => nombre(a.condominio).localeCompare(nombre(b.condominio)) || n(b.saldo) - n(a.saldo));
    return r;
  }, [enCondo, g, q, orden, corte]);
  const maxSaldo = Math.max(1, ...lista.map((f) => n(f.saldo)));
  const sumaLista = lista.reduce((s, f) => s + n(f.saldo), 0);

  const control: React.CSSProperties = {
    border: `1px solid ${LINEA}`, borderRadius: 9, padding: "8px 11px", fontSize: 14, fontFamily: "inherit",
    color: TINTA, background: "#fff", minHeight: 38,
  };
  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 12, fontWeight: 600, color: GRIS, borderBottom: `1px solid ${LINEA}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "11px 12px", borderBottom: `1px solid ${LINEA}`, fontSize: 14, verticalAlign: "middle" };

  return (
    <div style={{ minHeight: "100vh", background: PAPEL, color: TINTA, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <SparcFonts />
      <style>{`
        .sp-grp { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 900px) { .sp-grp { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 480px) { .sp-grp { grid-template-columns: 1fr; } }
        .sp-row:hover td { background: ${AZUL_050}; }
      `}</style>
      <SparcHeader userEmail={userEmail} />
      {tip.node}

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 16px 64px" }}>
        <h1 style={{ ...jost, fontSize: 30, fontWeight: 500, margin: "0 0 6px", letterSpacing: "-.01em" }}>Cobranza</h1>
        <p style={{ color: GRIS, fontSize: 15, margin: "0 0 22px", lineHeight: 1.6, maxWidth: "70ch" }}>
          Todos los adeudos vencidos de tu cartera en una sola lista, agrupados por lo que conviene hacer con cada uno.
          {corte && <> Corte de Vivook del {fechaLarga(corte)}.</>}
        </p>

        {loading && <p style={{ color: GRIS }}>Cargando adeudos…</p>}
        {error && <p style={{ color: COLOR.negativo }}>Error: {error}</p>}

        {!loading && !error && actuales.length > 0 && (
          <>
            {/* Cifra principal + lectura */}
            <div style={{ ...card, background: AZUL_900, border: "none", color: "#fff", padding: "22px 24px", marginBottom: 14,
              display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13.5, opacity: 0.8 }}>{condo === "todos" ? "Vencido en toda la cartera" : `Vencido en ${nombre(condo)}`}</div>
                <div style={{ ...jost, fontSize: 46, fontWeight: 500, lineHeight: 1.1, margin: "6px 0 4px" }}>{compacto(total)}</div>
                <div style={{ fontSize: 13.5, opacity: 0.85 }}>{enCondo.length} unidades con adeudo</div>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: 14, lineHeight: 1.5, maxWidth: 420 }}>
                <div><strong style={{ ...jost, fontSize: 20 }}>{top10}%</strong>&nbsp; lo concentran las 10 unidades que más deben</div>
                <div><strong style={{ ...jost, fontSize: 20 }}>{total ? Math.round((heredado / total) * 100) : 0}%</strong>&nbsp; viene de administraciones anteriores</div>
              </div>
            </div>

            {/* Grupos (también son filtro) */}
            <div className="sp-grp" style={{ marginBottom: 22 }}>
              {GRUPOS.map((k) => {
                const activo = g === k;
                return (
                  <button key={k} onClick={() => { setG(activo ? "todos" : k); setLimite(60); }} aria-pressed={activo}
                    style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: TINTA,
                      borderColor: activo ? AZUL : LINEA, boxShadow: activo ? `0 0 0 2px ${AZUL} inset` : card.boxShadow, padding: "15px 17px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                      <span aria-hidden style={{ width: 24, height: 24, borderRadius: 6, background: AZUL_050, color: AZUL,
                        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{GRUPO[k].icono}</span>
                      {GRUPO[k].label}
                    </div>
                    <div style={{ ...jost, fontSize: 26, fontWeight: 500, margin: "8px 0 0", color: AZUL_900 }}>{compacto(resumen[k].monto)}</div>
                    <div style={{ color: GRIS, fontSize: 12.5, marginBottom: 8 }}>{resumen[k].unidades} unidades</div>
                    <div style={{ color: GRIS, fontSize: 12.5, lineHeight: 1.5 }}>{GRUPO[k].accion}</div>
                  </button>
                );
              })}
            </div>

            {/* Filtros en una sola fila */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <select aria-label="Condominio" value={condo} onChange={(e) => { setCondo(e.target.value); setLimite(60); }} style={control}>
                <option value="todos">Todos los condominios</option>
                {condominios.map((c) => <option key={c} value={c}>{nombre(c)}</option>)}
              </select>
              <input aria-label="Buscar unidad" placeholder="Buscar unidad" value={q} onChange={(e) => setQ(e.target.value)}
                style={{ ...control, width: 160 }} />
              <select aria-label="Ordenar" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} style={control}>
                <option value="monto">Mayor adeudo primero</option>
                <option value="antiguedad">Más antiguo primero</option>
                <option value="condominio">Por condominio</option>
              </select>
              {(g !== "todos" || condo !== "todos" || q) && (
                <button onClick={() => { setG("todos"); setCondo("todos"); setQ(""); }}
                  style={{ ...control, color: AZUL, fontWeight: 600, cursor: "pointer" }}>Quitar filtros</button>
              )}
              <span style={{ marginLeft: "auto", color: GRIS, fontSize: 13.5 }}>
                {lista.length} unidades · <strong style={{ color: TINTA }}>{mxn(sumaLista)}</strong>
              </span>
            </div>

            {/* Lista */}
            <div style={{ ...card, padding: 0, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 36, textAlign: "right" }}>#</th>
                    <th style={th}>Condominio</th>
                    <th style={th}>Unidad</th>
                    <th style={{ ...th, textAlign: "right" }}>Vencido</th>
                    <th style={{ ...th, width: "22%" }}>
                      <span style={{ display: "inline-flex", gap: 12 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR.heredado, display: "inline-block" }} />Heredado</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: COLOR.generado, display: "inline-block" }} />Reciente</span>
                      </span>
                    </th>
                    <th style={th}>Atraso</th>
                    <th style={th}>Qué hacer</th>
                  </tr>
                </thead>
                <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                  {lista.slice(0, limite).map((f, i) => {
                    const s = n(f.saldo), h = Math.min(n(f.saldo_inicial), s), dias = diasAtraso(f, corte), k = grupo(f, corte);
                    const w = (s / maxSaldo) * 100;
                    return (
                      <tr key={f.condominio + f.unidad} className="sp-row">
                        <td style={{ ...td, textAlign: "right", color: GRIS, fontSize: 12.5 }}>{i + 1}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{nombre(f.condominio)}</td>
                        <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{f.unidad}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{mxn(s)}</td>
                        <td style={td}>
                          <div style={{ display: "flex", height: 10, gap: h > 0 && s - h > 0 ? 2 : 0, width: `${Math.max(w, 2)}%` }}
                            {...tip.bind([`${nombre(f.condominio)} · ${f.unidad}`, `Vencido ${mxn(s)}`, `Heredado ${mxn(h)}`, `Reciente ${mxn(s - h)}`, `${n(f.num_adeudos)} cargos pendientes`])}>
                            {h > 0 && <div style={{ flex: h, background: COLOR.heredado, borderRadius: s - h > 0 ? "2px 0 0 2px" : 3 }} />}
                            {s - h > 0 && <div style={{ flex: s - h, background: COLOR.generado, borderRadius: h > 0 ? "0 3px 3px 0" : 3 }} />}
                          </div>
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap", color: dias > 365 ? TINTA : GRIS }}>{antiguedad(dias)}</td>
                        <td style={td}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
                            background: AZUL_050, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                            <span aria-hidden style={{ color: AZUL }}>{GRUPO[k].icono}</span>{GRUPO[k].label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && (
                    <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: GRIS, padding: "40px 12px" }}>Ninguna unidad con esos filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {lista.length > limite && (
              <div style={{ textAlign: "center", marginTop: 14 }}>
                <button onClick={() => setLimite((l) => l + 100)}
                  style={{ ...control, color: AZUL, fontWeight: 600, cursor: "pointer", padding: "9px 18px" }}>
                  Ver {Math.min(100, lista.length - limite)} más
                </button>
              </div>
            )}

            <p style={{ color: GRIS, fontSize: 12.5, lineHeight: 1.7, margin: "18px 0 0", maxWidth: "90ch" }}>
              «Atraso» se cuenta desde el cargo vencido más antiguo de cada unidad. «Heredado» son los saldos iniciales y adeudos
              anteriores que Vivook registra al arrancar la administración; su fecha es la de captura, así que la deuda real puede ser más vieja.
              Fuente: reporte de Morosos de Vivook por condominio.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
