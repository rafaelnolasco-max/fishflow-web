"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, REGINTEL_CLIENT_ID } from "@/lib/supabase";
import type {
  RegIntelSource, RegIntelWatchlist, RegIntelRegistro,
  RegIntelHallazgo, RegIntelConsulta, RegIntelEstado, RegIntelClasificacion,
} from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Chip,
  StatCard as DStatCard, Section as DSection, Empty as DEmpty,
  cardStyle as mkCard, rowStyle as mkRow,
  type DashTheme,
} from "@/components/dashboard";

// ─── Paleta regintel (regulatorio — azul profundo, sobrio y clínico) ───────────
const C = {
  navy:      "#12395C",
  navyDark:  "#0B2740",
  navyLight: "#7FA3C0",
  sky:       "#E8F0F7",
  cool:      "#F4F7FA",
  white:     "#FCFDFE",
  ink:       "#152430",
  muted:     "#65798A",
  amber:     "#B4530C",
  alert:     "#B3261E",
  green:     "#1B7A43",
  border:    "#DCE5EC",
} as const;

const T: DashTheme = {
  accent: C.navy, accentDark: C.navyDark, accentSoft: C.sky,
  bg: C.cool, surface: C.white, text: C.ink,
  muted: C.muted, border: C.border, danger: C.alert, disabled: C.navyLight,
};

const cardStyle = mkCard(T);
const rowStyle = mkRow(T);

const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Section  = (p: Omit<React.ComponentProps<typeof DSection>,  "theme">) => <DSection  theme={T} {...p} />;
const Empty    = (p: Omit<React.ComponentProps<typeof DEmpty>,    "theme">) => <DEmpty    theme={T} {...p} />;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function fecha(d: string | null): string {
  if (!d) return "—";
  const x = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
  if (isNaN(x.getTime())) return d;
  return `${String(x.getDate()).padStart(2, "0")}-${MESES[x.getMonth()]}-${x.getFullYear()}`;
}

function mesesHasta(d: string | null): number | null {
  if (!d) return null;
  const x = new Date(d + "T12:00:00");
  if (isNaN(x.getTime())) return null;
  return Math.round((x.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44));
}

function diasDesde(d: string | null): number | null {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  return Math.floor((Date.now() - x.getTime()) / (1000 * 60 * 60 * 24));
}

const CLAS_LABEL: Record<RegIntelClasificacion, string> = {
  ya_en_base: "Ya en base",
  fuera_de_base_curada: "Fuera de base curada",
  producto_propio: "Producto propio",
  discrepancia: "Discrepancia",
};

const CLAS_COLOR: Record<RegIntelClasificacion, { bg: string; fg: string }> = {
  ya_en_base:           { bg: "#E6F6EC", fg: C.green },
  fuera_de_base_curada: { bg: "#FFF3E0", fg: C.amber },
  producto_propio:      { bg: C.sky,     fg: C.navy  },
  discrepancia:         { bg: "#FDECEC", fg: C.alert },
};

const TIPO_COLOR: Record<string, { bg: string; fg: string }> = {
  autorizado: { bg: "#E6F6EC", fg: C.green },
  revocado:   { bg: "#FDECEC", fg: C.alert },
  cancelado:  { bg: "#FDECEC", fg: C.alert },
  solicitud:  { bg: C.sky,     fg: C.navy  },
};

type Tab = "bandeja" | "panorama" | "vigencias" | "fuentes" | "consultas";

type HallazgoFull = RegIntelHallazgo & {
  registro: RegIntelRegistro | null;
  watch: RegIntelWatchlist | null;
};

export default function RegIntelPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("bandeja");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [sources, setSources] = useState<RegIntelSource[]>([]);
  const [watch, setWatch] = useState<RegIntelWatchlist[]>([]);
  const [registros, setRegistros] = useState<RegIntelRegistro[]>([]);
  const [hallazgos, setHallazgos] = useState<RegIntelHallazgo[]>([]);
  const [consultas, setConsultas] = useState<RegIntelConsulta[]>([]);
  const [filtro, setFiltro] = useState<"pendiente" | "todos">("pendiente");
  const [portafolio, setPortafolio] = useState<string>("todos");

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login?next=/app/regintel"); return; }
      await cargar();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    const cid = REGINTEL_CLIENT_ID;
    const [s, w, r, h, c] = await Promise.all([
      supabase.from("regintel_sources").select("*").eq("client_id", cid).order("canal").order("anio", { ascending: false }),
      supabase.from("regintel_watchlist").select("*").eq("client_id", cid).eq("activo", true).order("molecula"),
      supabase.from("regintel_registros").select("*").eq("client_id", cid).order("vigencia", { nullsFirst: false }),
      supabase.from("regintel_hallazgos").select("*").eq("client_id", cid).order("created_at"),
      supabase.from("regintel_consultas_manuales").select("*").eq("client_id", cid).order("created_at"),
    ]);
    if (s.data) setSources(s.data as RegIntelSource[]);
    if (w.data) setWatch(w.data as RegIntelWatchlist[]);
    if (r.data) setRegistros(r.data as RegIntelRegistro[]);
    if (h.data) setHallazgos(h.data as RegIntelHallazgo[]);
    if (c.data) setConsultas(c.data as RegIntelConsulta[]);
  }

  // ─── Derivados ──────────────────────────────────────────────────────────────
  const regById = useMemo(() => {
    const m = new Map<string, RegIntelRegistro>();
    registros.forEach((r) => m.set(r.id, r));
    return m;
  }, [registros]);

  const watchById = useMemo(() => {
    const m = new Map<string, RegIntelWatchlist>();
    watch.forEach((w) => m.set(w.id, w));
    return m;
  }, [watch]);

  const full: HallazgoFull[] = useMemo(
    () => hallazgos.map((h) => ({
      ...h,
      registro: regById.get(h.registro_id) ?? null,
      watch: h.watchlist_id ? watchById.get(h.watchlist_id) ?? null : null,
    })),
    [hallazgos, regById, watchById],
  );

  const portafolios = useMemo(() => {
    const s = new Set<string>();
    watch.forEach((w) => { if (w.portafolio) s.add(w.portafolio); });
    return Array.from(s).sort();
  }, [watch]);

  const visibles = useMemo(() => {
    let v = full;
    if (filtro === "pendiente") v = v.filter((h) => h.estado === "pendiente");
    if (portafolio !== "todos") v = v.filter((h) => h.watch?.portafolio === portafolio);
    const orden: Record<string, number> = { discrepancia: 0, fuera_de_base_curada: 1, producto_propio: 2, ya_en_base: 3 };
    return [...v].sort((a, b) => (orden[a.clasificacion ?? ""] ?? 9) - (orden[b.clasificacion ?? ""] ?? 9));
  }, [full, filtro, portafolio]);

  const revisados = useMemo(
    () => sources.reduce((n, s) => n + (s.registros_parseados ?? 0), 0),
    [sources],
  );
  const pendientes = useMemo(() => hallazgos.filter((h) => h.estado === "pendiente").length, [hallazgos]);
  const sinCuadrar = useMemo(() => sources.filter((s) => s.cuadra === false).length, [sources]);
  const estancadas = useMemo(
    () => sources.filter((s) => { const d = diasDesde(s.last_modified); return d !== null && d > 45; }).length,
    [sources],
  );
  const captchaPend = useMemo(() => consultas.filter((c) => c.estado === "pendiente").length, [consultas]);

  const porVencer = useMemo(
    () => registros
      .filter((r) => r.tipo === "autorizado" && r.vigencia)
      .map((r) => ({ r, m: mesesHasta(r.vigencia) }))
      .filter((x) => x.m !== null && x.m! <= 12)
      .sort((a, b) => (a.m ?? 0) - (b.m ?? 0)),
    [registros],
  );

  const erosion = useMemo(() => {
    const m = new Map<string, { molecula: string; portafolio: string | null; propio: string | null; regs: RegIntelRegistro[] }>();
    full.forEach((h) => {
      if (!h.registro || h.registro.tipo !== "autorizado") return;
      if (h.clasificacion === "producto_propio") return;
      const key = h.watch?.molecula ?? h.molecula_match;
      if (portafolio !== "todos" && h.watch?.portafolio !== portafolio) return;
      if (!m.has(key)) m.set(key, { molecula: key, portafolio: h.watch?.portafolio ?? null, propio: h.watch?.producto_propio ?? null, regs: [] });
      m.get(key)!.regs.push(h.registro);
    });
    return Array.from(m.values()).sort((a, b) => b.regs.length - a.regs.length);
  }, [full, portafolio]);

  const maxErosion = erosion[0]?.regs.length ?? 1;

  // ─── Acciones ───────────────────────────────────────────────────────────────
  async function decidir(id: string, estado: RegIntelEstado) {
    setBusy(id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("regintel_hallazgos")
      .update({ estado, revisado_en: new Date().toISOString(), revisado_por: user?.id ?? null })
      .eq("id", id);
    setBusy(null);
    if (error) { flash("No se pudo guardar: " + error.message); return; }
    setHallazgos((prev) => prev.map((h) => (h.id === id ? { ...h, estado } : h)));
    flash(estado === "aprobado" ? "Hallazgo aprobado" : "Hallazgo descartado");
  }

  async function resolverConsulta(id: string) {
    setBusy(id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("regintel_consultas_manuales")
      .update({ estado: "resuelta", consultado_en: new Date().toISOString(), consultado_por: user?.id ?? null })
      .eq("id", id);
    setBusy(null);
    if (error) { flash("No se pudo guardar: " + error.message); return; }
    setConsultas((prev) => prev.map((c) => (c.id === id ? { ...c, estado: "resuelta" } : c)));
    flash("Consulta marcada como resuelta");
  }

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "grid", placeItems: "center", color: T.muted }}>
        Cargando…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <DashboardHeader
        icon="🧬"
        title="Inteligencia Regulatoria"
        subtitle="Monitoreo de COFEPRIS · fuentes públicas"
        theme={T}
        sticky
        onLogout={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
      />

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 20px 64px" }}>
        <StatGrid>
          <StatCard label="Registros revisados" value={revisados.toLocaleString("es-MX")} icon="📄" sub="en listados COFEPRIS" />
          <StatCard label="Moléculas vigiladas" value={watch.length} icon="🔬" />
          <StatCard label="Hallazgos pendientes" value={pendientes} icon="📥" highlight={pendientes > 0} />
          <StatCard label="Consultas con CAPTCHA" value={captchaPend} icon="🔐" sub="requieren captura manual" />
          <StatCard label="Fuentes sin cuadrar" value={sinCuadrar} icon="⚠️" highlight={sinCuadrar > 0} />
          <StatCard label="Fuentes estancadas" value={estancadas} icon="⏳" highlight={estancadas > 0} sub="más de 45 días" />
        </StatGrid>

        <div style={{ marginTop: 18 }}>
          <TabBar<Tab>
            theme={T}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "bandeja",   label: `Bandeja (${pendientes})`, icon: "📥" },
              { id: "panorama",  label: "Panorama", icon: "📊" },
              { id: "vigencias", label: "Vigencias", icon: "📅" },
              { id: "fuentes",   label: "Fuentes", icon: "🗂️" },
              { id: "consultas", label: `Consultas (${captchaPend})`, icon: "🔐" },
            ]}
          />
        </div>

        {/* Filtro de portafolio, común a bandeja y panorama */}
        {(tab === "bandeja" || tab === "panorama") && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0 4px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.muted, marginRight: 4 }}>Portafolio</span>
            {["todos", ...portafolios].map((p) => (
              <button
                key={p}
                onClick={() => setPortafolio(p)}
                style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${portafolio === p ? T.accent : T.border}`,
                  background: portafolio === p ? T.accent : "#fff",
                  color: portafolio === p ? "#fff" : T.muted,
                }}
              >
                {p === "todos" ? "Todos" : p}
              </button>
            ))}
            {tab === "bandeja" && (
              <button
                onClick={() => setFiltro(filtro === "pendiente" ? "todos" : "pendiente")}
                style={{
                  marginLeft: "auto", padding: "5px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  border: `1px solid ${T.border}`, background: "#fff", color: T.muted,
                }}
              >
                {filtro === "pendiente" ? "Ver todos" : "Solo pendientes"}
              </button>
            )}
          </div>
        )}

        {/* ─── BANDEJA ─────────────────────────────────────────────────────── */}
        {tab === "bandeja" && (
          <Section title="Hallazgos por revisar">
            {visibles.length === 0 ? (
              <Empty msg="No hay hallazgos con estos filtros." />
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {visibles.map((h) => {
                  const r = h.registro;
                  const cl = h.clasificacion ? CLAS_COLOR[h.clasificacion] : { bg: C.sky, fg: C.navy };
                  const tc = r ? TIPO_COLOR[r.tipo] ?? { bg: C.sky, fg: C.navy } : null;
                  return (
                    <div key={h.id} style={{ ...cardStyle, padding: 14 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                        {h.clasificacion && <Chip label={CLAS_LABEL[h.clasificacion]} bg={cl.bg} fg={cl.fg} />}
                        {r && tc && <Chip label={r.tipo} bg={tc.bg} fg={tc.fg} />}
                        {h.watch?.portafolio && <Chip label={h.watch.portafolio} bg={C.sky} fg={C.navy} />}
                        {h.estado !== "pendiente" && (
                          <Chip label={h.estado} bg="#EDEFF0" fg={C.muted} />
                        )}
                        <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 12, color: T.muted }}>
                          {r?.folio ?? "—"}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline" }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{r?.denominacion_distintiva ?? "—"}</div>
                        <div style={{ color: T.muted, fontSize: 13 }}>{r?.denominacion_generica ?? h.molecula_match}</div>
                        {h.watch?.producto_propio && (
                          <div style={{ fontSize: 12, color: C.navy }}>compite con <strong>{h.watch.producto_propio}</strong></div>
                        )}
                      </div>

                      <div style={{ fontSize: 12.5, color: T.muted, marginTop: 5 }}>
                        {r?.titular ?? "—"}
                        {r?.vigencia ? ` · vigencia ${fecha(r.vigencia)}` : r?.motivo ? ` · ${r.motivo}` : ""}
                      </div>

                      {h.nota && (
                        <div style={{ marginTop: 9, padding: "8px 11px", background: C.cool, borderLeft: `3px solid ${C.amber}`, borderRadius: 6, fontSize: 12.5, lineHeight: 1.45 }}>
                          {h.nota}
                        </div>
                      )}

                      {h.referencia_base && (
                        <div style={{ marginTop: 7, fontSize: 11.5, color: T.muted }}>
                          En la base: {h.referencia_base}
                        </div>
                      )}

                      {h.estado === "pendiente" && (
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <button
                            onClick={() => decidir(h.id, "aprobado")}
                            disabled={busy === h.id}
                            style={{
                              padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                              background: busy === h.id ? T.disabled : T.accent, color: "#fff", fontSize: 13, fontWeight: 600,
                            }}
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => decidir(h.id, "descartado")}
                            disabled={busy === h.id}
                            style={{
                              padding: "7px 16px", borderRadius: 8, cursor: "pointer",
                              border: `1px solid ${T.border}`, background: "#fff", color: T.muted, fontSize: 13,
                            }}
                          >
                            Descartar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {/* ─── PANORAMA ────────────────────────────────────────────────────── */}
        {tab === "panorama" && (
          <Section title="Erosión por competidores con registro otorgado">
            {erosion.length === 0 ? (
              <Empty msg="Sin competidores autorizados para este portafolio." />
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {erosion.map((e) => (
                  <div key={e.molecula} style={{ ...cardStyle, padding: 13 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, minWidth: 130 }}>{e.molecula}</div>
                      {e.propio && <div style={{ fontSize: 12.5, color: T.muted }}>Pfizer: <strong style={{ color: C.navy }}>{e.propio}</strong></div>}
                      {e.portafolio && <Chip label={e.portafolio} bg={C.sky} fg={C.navy} />}
                      <div style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 15, fontWeight: 700, color: e.regs.length >= 4 ? C.amber : C.navy }}>
                        {e.regs.length}
                      </div>
                    </div>
                    <div style={{ height: 7, background: "#EDEFF0", borderRadius: 4, overflow: "hidden", margin: "8px 0 9px" }}>
                      <div style={{ height: "100%", width: `${(e.regs.length / maxErosion) * 100}%`, background: e.regs.length >= 4 ? C.amber : C.navyLight }} />
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                      {e.regs.map((r) => r.denominacion_distintiva).filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ─── VIGENCIAS ───────────────────────────────────────────────────── */}
        {tab === "vigencias" && (
          <Section title="Horizonte de vigencias">
            <p style={{ fontSize: 13, color: T.muted, marginTop: -4, marginBottom: 12 }}>
              Registros de competidores ordenados por proximidad de vencimiento. Se marcan los que vencen dentro de 12 meses.
            </p>
            {porVencer.length === 0 ? (
              <Empty msg="Ningún registro vigilado vence en los próximos 12 meses." />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {porVencer.map(({ r, m }) => (
                  <div key={r.id} style={rowStyle}>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: T.muted, minWidth: 110 }}>{r.folio}</div>
                    <div style={{ fontWeight: 600, minWidth: 130 }}>{r.denominacion_distintiva}</div>
                    <div style={{ fontSize: 13, color: T.muted, flex: 1 }}>{r.denominacion_generica}</div>
                    <div style={{ fontSize: 12.5 }}>{fecha(r.vigencia)}</div>
                    <Chip
                      label={m !== null && m <= 6 ? `Vence en ${m} meses` : `${m} meses`}
                      bg={m !== null && m <= 6 ? "#FDECEC" : "#FFF3E0"}
                      fg={m !== null && m <= 6 ? C.alert : C.amber}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ─── FUENTES ─────────────────────────────────────────────────────── */}
        {tab === "fuentes" && (
          <Section title="Fuentes monitoreadas y control de calidad">
            <p style={{ fontSize: 13, color: T.muted, marginTop: -4, marginBottom: 12 }}>
              Cada documento de COFEPRIS declara al pie cuántos registros publica. Si el conteo no cuadra con lo leído, el corte se marca y no se publica.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {sources.map((s) => {
                const d = diasDesde(s.last_modified);
                const estancada = d !== null && d > 45;
                return (
                  <div key={s.id} style={{ ...cardStyle, padding: 13 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 650, fontSize: 14 }}>{s.nombre}</div>
                      <Chip label={s.canal} bg={C.sky} fg={C.navy} />
                      {s.cuadra === true && <Chip label="Cuadra" bg="#E6F6EC" fg={C.green} />}
                      {s.cuadra === false && <Chip label="No cuadra" bg="#FDECEC" fg={C.alert} />}
                      {s.declarado_es_incremento && <Chip label="Declara incremento" bg="#FFF3E0" fg={C.amber} />}
                      {estancada && <Chip label={`Sin cambios ${d} días`} bg="#FDECEC" fg={C.alert} />}
                    </div>
                    <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6 }}>
                      Declarados {s.registros_declarados ?? "—"} · leídos {s.registros_parseados ?? "—"}
                      {s.last_modified ? ` · actualizado ${fecha(s.last_modified.slice(0, 10))}` : " · sin fecha de actualización"}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 4, fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                      {s.url}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ─── CONSULTAS CON CAPTCHA ───────────────────────────────────────── */}
        {tab === "consultas" && (
          <Section title="Consultas que requieren CAPTCHA">
            <p style={{ fontSize: 13, color: T.muted, marginTop: -4, marginBottom: 12 }}>
              El buscador de registros sanitarios de COFEPRIS requiere CAPTCHA y no se automatiza. Aquí queda la cola de lo que sí hay que consultar a mano, con registro de quién y cuándo.
            </p>
            {consultas.length === 0 ? (
              <Empty msg="Sin consultas en cola." />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {consultas.map((c) => (
                  <div key={c.id} style={{ ...cardStyle, padding: 13 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 650 }}>{c.molecula}</div>
                      <Chip
                        label={c.estado}
                        bg={c.estado === "pendiente" ? "#FFF3E0" : "#E6F6EC"}
                        fg={c.estado === "pendiente" ? C.amber : C.green}
                      />
                      <a
                        href="https://www.gob.mx/cofepris"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ marginLeft: "auto", fontSize: 12.5, color: C.navy, textDecoration: "underline" }}
                      >
                        Abrir COFEPRIS
                      </a>
                    </div>
                    {c.motivo && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6 }}>{c.motivo}</div>}
                    {c.estado === "pendiente" && (
                      <button
                        onClick={() => resolverConsulta(c.id)}
                        disabled={busy === c.id}
                        style={{
                          marginTop: 10, padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                          background: busy === c.id ? T.disabled : T.accent, color: "#fff", fontSize: 12.5, fontWeight: 600,
                        }}
                      >
                        Marcar como consultada
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </main>

      <Toast msg={toast} theme={T} />
    </div>
  );
}
