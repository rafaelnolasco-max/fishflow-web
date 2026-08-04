"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
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

// ─── CSS de impresión ─────────────────────────────────────────────────────────
// Mismo criterio que el reporte de marca: A4 horizontal, tablas con anchos fijos,
// filas que no se parten y encabezado repetido en cada página.
const PRINT_CSS = `
@media screen { .ri-print { display: none; } }
@media print {
  @page { size: A4 landscape; margin: 12mm 12mm 14mm; }
  .ri-app { display: none !important; }
  .ri-print { display: block !important; }
  body { background: #fff !important; }
  .ri-print table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
  .ri-print tr { break-inside: avoid; }
  .ri-print thead { display: table-header-group; }
  .ri-print th { background: #12395C !important; color: #fff !important; text-align: left;
    padding: 2mm 2.2mm; font-size: 6.4pt; letter-spacing: .12em; text-transform: uppercase;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ri-print td { padding: 2mm 2.2mm; border-bottom: 1px solid #DCE5EC; vertical-align: top; line-height: 1.4; }
  .ri-print h2 { break-after: avoid; font-size: 13pt; margin: 6mm 0 1mm; letter-spacing: -.02em; }
  .ri-print .sec { break-inside: auto; }
  .ri-print .acc td { background: #FFF6EC !important;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

function hoyLargo() {
  return new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

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
  const [subiendo, setSubiendo] = useState(false);
  const [consultaAbierta, setConsultaAbierta] = useState<string | null>(null);
  const [textoConsulta, setTextoConsulta] = useState("");

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


  // ─── Export a Excel ─────────────────────────────────────────────────────────
  function exportarExcel() {
    const wb = XLSX.utils.book_new();

    const hallazgos = full.map((h) => ({
      "Estado": h.estado,
      "Clasificación": h.clasificacion ?? "",
      "Tipo": h.registro?.tipo ?? "",
      "No. de registro": h.registro?.folio ?? "",
      "Denominación genérica": h.registro?.denominacion_generica ?? h.molecula_match,
      "Denominación distintiva": h.registro?.denominacion_distintiva ?? "",
      "Titular": h.registro?.titular ?? "",
      "Vigencia": h.registro?.vigencia ?? "",
      "Motivo": h.registro?.motivo ?? "",
      "Portafolio": h.watch?.portafolio ?? "",
      "Producto Pfizer": h.watch?.producto_propio ?? "",
      "Referencia en base": h.referencia_base ?? "",
      "Nota": h.nota ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hallazgos), "Hallazgos");

    const pano = erosion.map((e) => ({
      "Molécula": e.molecula,
      "Producto Pfizer": e.propio ?? "",
      "Portafolio": e.portafolio ?? "",
      "Competidores": e.regs.length,
      "Marcas": e.regs.map((r) => r.denominacion_distintiva).filter(Boolean).join(" · "),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pano), "Panorama");

    const vig = porVencer.map(({ r, m }) => ({
      "No. de registro": r.folio,
      "Denominación distintiva": r.denominacion_distintiva ?? "",
      "Denominación genérica": r.denominacion_generica ?? "",
      "Titular": r.titular ?? "",
      "Vigencia": r.vigencia ?? "",
      "Meses restantes": m ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vig), "Vigencias");

    const src = sources.map((s) => ({
      "Documento": s.nombre,
      "Canal": s.canal,
      "Año": s.anio ?? "",
      "Origen": s.origen,
      "Declarados": s.registros_declarados ?? "",
      "Leídos": s.registros_parseados ?? "",
      "Cuadra": s.cuadra === null ? "" : s.cuadra ? "Sí" : "No",
      "Declara incremento": s.declarado_es_incremento ? "Sí" : "No",
      "Última actualización": s.last_modified ?? "",
      "URL": s.url,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(src), "Fuentes");

    XLSX.writeFile(wb, `Inteligencia-Regulatoria-${new Date().toISOString().slice(0, 10)}.xlsx`);
    flash("Excel descargado");
  }

  // ─── Carga manual de documentos ─────────────────────────────────────────────
  async function subirDocumento(file: File, canal: string, anio: number | null) {
    setSubiendo(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const limpio = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${REGINTEL_CLIENT_ID}/${Date.now()}_${limpio}`;

      const up = await supabase.storage.from("regintel-docs").upload(path, file);
      if (up.error) { flash("No se pudo subir: " + up.error.message); return; }

      const { error } = await supabase.from("regintel_sources").insert({
        client_id: REGINTEL_CLIENT_ID,
        canal,
        anio,
        nombre: file.name,
        url: "carga manual",
        origen: "manual",
        estado_proceso: "pendiente",
        nombre_archivo: file.name,
        storage_path: path,
        bytes: file.size,
        subido_por: user?.id ?? null,
      });
      if (error) { flash("Se subió el archivo pero no se registró: " + error.message); return; }

      await cargar();
      flash("Documento cargado. Queda pendiente de procesar.");
    } finally {
      setSubiendo(false);
    }
  }

  async function guardarConsulta(id: string, texto: string, file: File | null) {
    setBusy(id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let path: string | null = null;
      let nombre: string | null = null;

      if (file) {
        const limpio = file.name.replace(/[^\w.\-]+/g, "_");
        path = `${REGINTEL_CLIENT_ID}/consultas/${Date.now()}_${limpio}`;
        const up = await supabase.storage.from("regintel-docs").upload(path, file);
        if (up.error) { flash("No se pudo subir el archivo: " + up.error.message); return; }
        nombre = file.name;
      }

      const { error } = await supabase.from("regintel_consultas_manuales").update({
        estado: "resuelta",
        resultado: texto || null,
        storage_path: path,
        nombre_archivo: nombre,
        consultado_en: new Date().toISOString(),
        consultado_por: user?.id ?? null,
      }).eq("id", id);
      if (error) { flash("No se pudo guardar: " + error.message); return; }

      await cargar();
      setConsultaAbierta(null);
      setTextoConsulta("");
      flash("Consulta registrada");
    } finally {
      setBusy(null);
    }
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
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="ri-app">
      <DashboardHeader
        icon="🧬"
        title="Inteligencia Regulatoria"
        subtitle="Monitoreo de COFEPRIS · fuentes públicas"
        theme={T}
        sticky
        onLogout={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => window.print()}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                border: `1px solid ${T.border}`, background: "#fff", color: T.accentDark,
              }}
            >
              Exportar PDF
            </button>
            <button
              onClick={exportarExcel}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                border: "none", background: T.accent, color: "#fff",
              }}
            >
              Exportar Excel
            </button>
          </div>
        }
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

            <div style={{ ...cardStyle, padding: 14, marginBottom: 14, borderStyle: "dashed", background: C.sky }}>
              <div style={{ fontWeight: 650, fontSize: 13.5, marginBottom: 4 }}>Subir un documento de COFEPRIS</div>
              <p style={{ fontSize: 12.5, color: T.muted, margin: "0 0 10px" }}>
                Para los listados cuyo enlace está roto o cualquier corte que se haya descargado a mano. Se archiva con su fecha y queda en cola para procesarse.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  id="ri-canal"
                  defaultValue="solicitudes"
                  style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13, background: "#fff", color: T.text }}
                >
                  <option value="solicitudes">Solicitudes Gx y biocomparables</option>
                  <option value="alopaticos">Alopáticos</option>
                  <option value="revocados">Registros revocados</option>
                  <option value="cancelados">Registros cancelados</option>
                  <option value="cmn">Comité de Moléculas Nuevas</option>
                  <option value="otro">Otro</option>
                </select>
                <input
                  id="ri-anio"
                  type="number"
                  placeholder="Año"
                  defaultValue={new Date().getFullYear()}
                  style={{ width: 90, padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, fontSize: 13 }}
                />
                <input
                  type="file"
                  accept=".pdf,.xlsx,.png,.jpg,.jpeg,.txt"
                  disabled={subiendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const canal = (document.getElementById("ri-canal") as HTMLSelectElement)?.value ?? "otro";
                    const anioRaw = (document.getElementById("ri-anio") as HTMLInputElement)?.value;
                    void subirDocumento(f, canal, anioRaw ? parseInt(anioRaw, 10) : null);
                    e.target.value = "";
                  }}
                  style={{ fontSize: 12.5 }}
                />
                {subiendo && <span style={{ fontSize: 12.5, color: T.muted }}>Subiendo…</span>}
              </div>
            </div>
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
                      {s.origen === "manual" && <Chip label="Carga manual" bg={C.sky} fg={C.navy} />}
                      {s.estado_proceso === "pendiente" && <Chip label="Pendiente de procesar" bg="#FFF3E0" fg={C.amber} />}
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

                    {c.estado !== "pendiente" && c.resultado && (
                      <div style={{ marginTop: 8, padding: "8px 11px", background: C.cool, borderLeft: `3px solid ${C.green}`, borderRadius: 6, fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                        {c.resultado}
                      </div>
                    )}
                    {c.estado !== "pendiente" && c.nombre_archivo && (
                      <div style={{ marginTop: 6, fontSize: 11.5, color: T.muted }}>Archivo adjunto: {c.nombre_archivo}</div>
                    )}

                    {c.estado === "pendiente" && consultaAbierta !== c.id && (
                      <button
                        onClick={() => { setConsultaAbierta(c.id); setTextoConsulta(""); }}
                        style={{
                          marginTop: 10, padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                          background: T.accent, color: "#fff", fontSize: 12.5, fontWeight: 600,
                        }}
                      >
                        Registrar resultado
                      </button>
                    )}

                    {c.estado === "pendiente" && consultaAbierta === c.id && (
                      <div style={{ marginTop: 10, padding: 12, background: C.sky, borderRadius: 8 }}>
                        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>
                          Pega aquí lo que devolvió el buscador, o adjunta la captura. Puedes hacer las dos cosas.
                        </div>
                        <textarea
                          value={textoConsulta}
                          onChange={(e) => setTextoConsulta(e.target.value)}
                          rows={4}
                          placeholder="Resultado de la consulta en COFEPRIS…"
                          style={{
                            width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`,
                            fontSize: 13, fontFamily: "inherit", background: "#fff", color: T.text, resize: "vertical",
                          }}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            id={`ri-file-${c.id}`}
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.txt"
                            style={{ fontSize: 12.5 }}
                          />
                          <button
                            onClick={() => {
                              const el = document.getElementById(`ri-file-${c.id}`) as HTMLInputElement | null;
                              const f = el?.files?.[0] ?? null;
                              if (!textoConsulta.trim() && !f) { flash("Pega el resultado o adjunta un archivo"); return; }
                              void guardarConsulta(c.id, textoConsulta.trim(), f);
                            }}
                            disabled={busy === c.id}
                            style={{
                              padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                              background: busy === c.id ? T.disabled : T.accent, color: "#fff", fontSize: 12.5, fontWeight: 600,
                            }}
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => { setConsultaAbierta(null); setTextoConsulta(""); }}
                            style={{
                              padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                              border: `1px solid ${T.border}`, background: "#fff", color: T.muted, fontSize: 12.5,
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </main>
      </div>

      {/* ─── Reporte completo para impresión (Exportar PDF) ──────────────────── */}
      <div className="ri-print" style={{ fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
        <div style={{ borderBottom: `2px solid ${C.navy}`, paddingBottom: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 7, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, fontFamily: "ui-monospace, monospace" }}>
            FishFlow · Inteligencia Regulatoria
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>
            Panorama Competitivo{portafolio !== "todos" ? ` — ${portafolio}` : ""}
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>
            Corte al {hoyLargo()} · {revisados.toLocaleString("es-MX")} registros revisados en listados COFEPRIS · {watch.length} moléculas vigiladas
          </div>
        </div>

        <div className="sec">
          <h2>Hallazgos</h2>
          <table>
            <colgroup><col style={{ width: "22mm" }} /><col style={{ width: "26mm" }} /><col style={{ width: "30mm" }} /><col style={{ width: "38mm" }} /><col style={{ width: "24mm" }} /><col /></colgroup>
            <thead><tr><th>Estado</th><th>Registro</th><th>Producto</th><th>Titular</th><th>Vigencia</th><th>Notas</th></tr></thead>
            <tbody>
              {visibles.map((h) => (
                <tr key={h.id} className={h.clasificacion === "discrepancia" ? "acc" : ""}>
                  <td>{h.clasificacion ? CLAS_LABEL[h.clasificacion] : h.estado}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 7.4 }}>{h.registro?.folio ?? "—"}</td>
                  <td><strong>{h.registro?.denominacion_distintiva ?? "—"}</strong><br />{h.registro?.denominacion_generica ?? h.molecula_match}</td>
                  <td>{h.registro?.titular ?? "—"}</td>
                  <td>{h.registro?.vigencia ? fecha(h.registro.vigencia) : h.registro?.motivo ?? "—"}</td>
                  <td>{h.nota ?? h.referencia_base ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sec">
          <h2>Erosión por competidores con registro otorgado</h2>
          <table>
            <colgroup><col style={{ width: "30mm" }} /><col style={{ width: "30mm" }} /><col style={{ width: "20mm" }} /><col style={{ width: "18mm" }} /><col /></colgroup>
            <thead><tr><th>Molécula</th><th>Producto Pfizer</th><th>Portafolio</th><th>Compet.</th><th>Marcas autorizadas</th></tr></thead>
            <tbody>
              {erosion.map((e) => (
                <tr key={e.molecula} className={e.regs.length >= 4 ? "acc" : ""}>
                  <td><strong>{e.molecula}</strong></td>
                  <td>{e.propio ?? "—"}</td>
                  <td>{e.portafolio ?? "—"}</td>
                  <td style={{ fontFamily: "ui-monospace, monospace" }}>{e.regs.length}</td>
                  <td>{e.regs.map((r) => r.denominacion_distintiva).filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {porVencer.length > 0 && (
          <div className="sec">
            <h2>Horizonte de vigencias — próximos 12 meses</h2>
            <table>
              <colgroup><col style={{ width: "26mm" }} /><col style={{ width: "32mm" }} /><col style={{ width: "40mm" }} /><col style={{ width: "26mm" }} /><col /></colgroup>
              <thead><tr><th>Registro</th><th>Producto</th><th>Denominación genérica</th><th>Vigencia</th><th>Restante</th></tr></thead>
              <tbody>
                {porVencer.map(({ r, m }) => (
                  <tr key={r.id} className={m !== null && m <= 6 ? "acc" : ""}>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 7.4 }}>{r.folio}</td>
                    <td><strong>{r.denominacion_distintiva}</strong></td>
                    <td>{r.denominacion_generica}</td>
                    <td>{fecha(r.vigencia)}</td>
                    <td>{m} meses</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="sec">
          <h2>Fuentes consultadas y control de calidad</h2>
          <table>
            <colgroup><col style={{ width: "40mm" }} /><col style={{ width: "22mm" }} /><col style={{ width: "22mm" }} /><col style={{ width: "22mm" }} /><col /></colgroup>
            <thead><tr><th>Documento</th><th>Origen</th><th>Declarados</th><th>Leídos</th><th>Nota</th></tr></thead>
            <tbody>
              {sources.map((s) => {
                const d = diasDesde(s.last_modified);
                return (
                  <tr key={s.id} className={s.cuadra === false ? "acc" : ""}>
                    <td><strong>{s.nombre}</strong></td>
                    <td>{s.origen === "manual" ? "Carga manual" : "Automático"}</td>
                    <td>{s.registros_declarados ?? "—"}{s.declarado_es_incremento ? " (incremento)" : ""}</td>
                    <td>{s.registros_parseados ?? "—"}</td>
                    <td>
                      {s.cuadra === false ? "No cuadra con lo declarado. " : ""}
                      {d !== null && d > 45 ? `Sin cambios en ${d} días. ` : ""}
                      {s.estado_proceso === "pendiente" ? "Pendiente de procesar." : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, paddingTop: 6, borderTop: `1px solid ${C.border}`, fontSize: 7.4, color: C.muted, lineHeight: 1.5 }}>
          <strong style={{ color: C.ink }}>Alcance.</strong> Los listados públicos de COFEPRIS incluyen únicamente registros ya otorgados.
          Los trámites en curso se consultan en el buscador de registros sanitarios, que requiere CAPTCHA, y en la Gaceta de la Comisión
          de Autorización Sanitaria; ese paso se realiza de forma manual.<br />
          <strong style={{ color: C.ink }}>Método.</strong> La detección es automatizada por denominación genérica y principio activo contra
          la lista de moléculas prioritarias. Cada documento declara al pie cuántos registros publica y el sistema compara ese número contra
          los leídos. Toda coincidencia es validada por el área antes de incorporarse.<br /><br />
          Generado desde el panel de FishFlow · fishflow.mx/app/regintel · {hoyLargo()}
        </div>
      </div>

      <Toast msg={toast} theme={T} />
    </div>
  );
}
