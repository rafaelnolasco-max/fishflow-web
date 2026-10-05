"use client";

/**
 * Por confirmar — condominios que salieron de la lista de Vivook.
 *
 * El 5-oct-2026, CONDOMINIO SANTA CRUZ 73 y RESIDENCIAL CUMBRES 421 dejaron de
 * aparecer en el selector de condominios de Vivook, y sus cifras ya no cambiaban
 * desde el corte del 9-sep. Puede ser una baja real o un cambio de permisos.
 *
 * Mientras no se confirme, quedan FUERA del consolidado: no suman en Cartera ni
 * en Cobranza. Aquí se ve su último corte conocido y se resuelve con un clic.
 *
 * Datos: sparc_condominios (estado), sparc_portfolio_snapshots y
 * sparc_delinquencies (último corte conocido de cada uno).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import SparcHeader, { SPARC, SparcFonts } from "../_components/SparcHeader";
import {
  COLOR, card, compacto, fechaLarga, jost, mxn, n, nombre,
  type CondoEstado,
} from "../_components/sparcData";

const { AZUL, VERDE, TINTA, GRIS, LINEA, PAPEL, CLIENT_ID } = SPARC;

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
interface Venc { snapshot_date: string; condominio: string; saldo: number }

export default function SparcPorConfirmar() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [catalogo, setCatalogo] = useState<CondoEstado[]>([]);
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [venc, setVenc] = useState<Venc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const [a, b, c] = await Promise.all([
        supabase.from("sparc_condominios")
          .select("condominio,estado,visto_hasta,motivo,resuelto_por,resuelto_en")
          .eq("client_id", CLIENT_ID),
        supabase.from("sparc_portfolio_snapshots")
          .select("snapshot_date,condominio,viviendas,usuarios,cxc,cxp,bancos,morosidad_pct")
          .eq("client_id", CLIENT_ID).order("snapshot_date", { ascending: false }).range(0, 999),
        supabase.from("sparc_delinquencies")
          .select("snapshot_date,condominio,saldo")
          .eq("client_id", CLIENT_ID).order("snapshot_date", { ascending: false }).range(0, 999),
      ]);
      if (a.error) setError(a.error.message);
      else {
        setCatalogo((a.data ?? []) as CondoEstado[]);
        setCortes((b.data ?? []) as Corte[]);
        setVenc((c.data ?? []) as Venc[]);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  const pendientes = useMemo(() => catalogo.filter((c) => c.estado === "por_confirmar"), [catalogo]);
  const bajas = useMemo(() => catalogo.filter((c) => c.estado === "baja"), [catalogo]);

  /** Último corte conocido de un condominio y su vencido por unidad. */
  function ultimo(cond: string) {
    const corte = cortes.find((x) => x.condominio === cond);
    if (!corte) return null;
    const unidades = venc.filter((v) => v.condominio === cond && v.snapshot_date === corte.snapshot_date);
    const vencido = unidades.reduce((s, u) => s + n(u.saldo), 0);
    return { corte, unidades: unidades.length, vencido };
  }

  async function resolver(cond: string, estado: "activo" | "baja") {
    setGuardando(cond);
    const { error } = await supabase.from("sparc_condominios")
      .update({ estado, resuelto_por: userEmail, resuelto_en: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("client_id", CLIENT_ID).eq("condominio", cond);
    if (error) setError(error.message);
    else setCatalogo((prev) => prev.map((c) => c.condominio === cond
      ? { ...c, estado, resuelto_por: userEmail, resuelto_en: new Date().toISOString() } : c));
    setGuardando(null);
  }

  const btn = (fondo: string, borde: string, color: string): React.CSSProperties => ({
    background: fondo, border: `1px solid ${borde}`, color, borderRadius: 9, padding: "9px 16px",
    cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap",
  });

  return (
    <div style={{ minHeight: "100vh", background: PAPEL, color: TINTA, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <SparcFonts />
      <style>{`
        .pc-datos { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: ${LINEA};
          border: 1px solid ${LINEA}; border-radius: 10px; overflow: hidden; }
        @media (max-width: 680px) { .pc-datos { grid-template-columns: 1fr 1fr; } }
      `}</style>
      <SparcHeader userEmail={userEmail} />

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 16px 64px" }}>
        <h1 style={{ ...jost, fontSize: 30, fontWeight: 500, margin: "0 0 6px", letterSpacing: "-.01em" }}>Por confirmar</h1>
        <p style={{ color: GRIS, fontSize: 15, margin: "0 0 22px", lineHeight: 1.6, maxWidth: "72ch" }}>
          Condominios que dejaron de aparecer en Vivook. <strong style={{ color: TINTA }}>No están contados</strong> en
          Cartera ni en Cobranza: ninguna cifra del tablero los incluye mientras sigan aquí. Confirma qué pasó con cada uno
          y el tablero se ajusta solo.
        </p>

        {loading && <p style={{ color: GRIS }}>Cargando…</p>}
        {error && <p style={{ color: COLOR.negativo }}>Error: {error}</p>}

        {!loading && pendientes.length === 0 && bajas.length === 0 && (
          <div style={{ ...card, color: GRIS }}>
            Nada por confirmar. Los {catalogo.length} condominios del catálogo están activos y contados en el tablero.
          </div>
        )}

        {pendientes.map((p) => {
          const u = ultimo(p.condominio);
          return (
            <div key={p.condominio} style={{ ...card, marginBottom: 14, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "18px 20px 16px", borderBottom: `1px solid ${LINEA}` }}>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ ...jost, fontSize: 21, fontWeight: 500, margin: 0 }}>{nombre(p.condominio)}</h2>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
                    background: "#FFF6E5", fontSize: 12, fontWeight: 600 }}>
                    <span aria-hidden style={{ color: COLOR.vigilar, fontSize: 10 }}>●</span>Fuera del consolidado
                  </span>
                </div>
                <p style={{ color: GRIS, fontSize: 14, margin: "8px 0 0", lineHeight: 1.6, maxWidth: "70ch" }}>
                  {p.motivo}
                  {p.visto_hasta && <> Último dato confiable: corte del {fechaLarga(p.visto_hasta)}.</>}
                </p>
              </div>

              {u && (
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: 12.5, color: GRIS, marginBottom: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Último corte conocido · {fechaLarga(u.corte.snapshot_date)}
                  </div>
                  <div className="pc-datos">
                    {[
                      { k: "Te deben", v: compacto(n(u.corte.cxc)), d: `${u.unidades} unidades con adeudo` },
                      { k: "Debe el condominio", v: compacto(n(u.corte.cxp)), d: "cuentas por pagar" },
                      { k: "En bancos", v: compacto(n(u.corte.bancos)), d: "saldo disponible" },
                      { k: "Morosidad", v: `${n(u.corte.morosidad_pct).toFixed(2)}%`, d: `${n(u.corte.viviendas)} viviendas` },
                    ].map((x) => (
                      <div key={x.k} style={{ background: "#fff", padding: "12px 14px" }}>
                        <div style={{ fontSize: 12.5, color: GRIS }}>{x.k}</div>
                        <div style={{ ...jost, fontSize: 22, fontWeight: 500, margin: "2px 0 1px" }}>{x.v}</div>
                        <div style={{ fontSize: 12, color: GRIS }}>{x.d}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 13, color: GRIS, margin: "10px 0 0", lineHeight: 1.6 }}>
                    Equivale a {mxn(u.vencido)} de cartera vencida que hoy no se está reportando en ningún tablero.
                  </p>
                </div>
              )}

              <div style={{ padding: "14px 20px", background: PAPEL, borderTop: `1px solid ${LINEA}`,
                display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: GRIS, marginRight: 4 }}>¿SPARC sigue administrando este condominio?</span>
                <button disabled={guardando === p.condominio} onClick={() => resolver(p.condominio, "activo")}
                  style={btn("#fff", VERDE, VERDE)}>Sí, regrésalo al tablero</button>
                <button disabled={guardando === p.condominio} onClick={() => resolver(p.condominio, "baja")}
                  style={btn("#fff", LINEA, GRIS)}>No, ya no lo administramos</button>
              </div>
            </div>
          );
        })}

        {bajas.length > 0 && (
          <div style={{ ...card, marginTop: 20 }}>
            <h2 style={{ ...jost, fontSize: 18, fontWeight: 500, margin: "0 0 10px" }}>Dados de baja</h2>
            {bajas.map((b) => (
              <div key={b.condominio} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${LINEA}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{nombre(b.condominio)}</div>
                  <div style={{ fontSize: 13, color: GRIS }}>
                    Confirmado por {b.resuelto_por ?? "—"}
                    {b.resuelto_en && <> el {fechaLarga(b.resuelto_en.slice(0, 10))}</>}
                    {b.visto_hasta && <> · datos hasta el {fechaLarga(b.visto_hasta)}</>}
                  </div>
                </div>
                <button disabled={guardando === b.condominio} onClick={() => resolver(b.condominio, "activo")}
                  style={btn("#fff", LINEA, AZUL)}>Reactivar</button>
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 13, color: GRIS, marginTop: 24, lineHeight: 1.7, maxWidth: "72ch" }}>
          El histórico no se borra: los cortes anteriores de estos condominios siguen guardados y vuelven al tablero
          completos si se reactivan. Ver <Link href="/app/sparc/cartera" style={{ color: AZUL }}>Cartera</Link>.
        </p>
      </div>
    </div>
  );
}
