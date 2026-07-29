"use client";

/**
 * Panel de prospectos — Mario Citalán · Arquitectura del Criterio
 *
 * Fuente: tabla genérica `leads` filtrada por CRITERIO_CLIENT_ID (RLS ya lo
 * limita; el filtro explícito es defensa en profundidad).
 * Los prospectos entran desde mariocitalan.net → /api/demo/mario-criterio
 * (evaluaciones de Actitud y de Criterio).
 *
 * Separado a propósito de /app/therapyos: ahí vive su consultorio (pacientes),
 * aquí su embudo de difusión (radio, TV, conferencias).
 */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, CRITERIO_CLIENT_ID } from "@/lib/supabase";
import type { CriterioLead } from "@/lib/supabase";
import {
  TabBar, StatGrid, StatCard, Chip, Empty, Modal, Field, Toast,
  Section as DSection,
  cardStyle as mkCard,
  inputStyle as mkInput,
  type DashTheme,
} from "@/components/dashboard";

// ─── Paleta y tipografía de mariocitalan.net (mismas variables del sitio) ──────
const C = {
  bg:       "#F4F7FA",  // --paper
  bg2:      "#E7EEF4",  // --paper-2
  white:    "#FFFFFF",  // --bone
  blue:     "#3E86CF",  // --accent
  blueDark: "#2A6AAE",  // --accent-deep
  blueSoft: "#E8F0F9",
  steel:    "#1F4E79",  // --steel
  ink:      "#0F1A24",  // --ink
  ink2:     "#283845",  // --ink-2
  muted:    "#7B8794",  // --muted
  border:   "#DCE4EC",  // --rule
  red:      "#D64545",
  gray:     "#9CA3AF",
} as const;

// Fraunces para títulos, JetBrains Mono para etiquetas, Inter para el cuerpo:
// exactamente el trío del sitio público, para que el panel se sienta suyo.
const FONT_SERIF = '"Fraunces", Georgia, serif';
const FONT_MONO  = '"JetBrains Mono", ui-monospace, monospace';
const FONT_BODY  = '"Inter", system-ui, sans-serif';
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

const T: DashTheme = {
  accent: C.blue, accentDark: C.blueDark, accentSoft: C.blueSoft,
  bg: C.bg, surface: C.white, text: C.ink,
  muted: C.muted, border: C.border, danger: C.red, disabled: C.gray,
  panel: C.bg,
};

const cardStyle = mkCard(T);
const inputStyle = mkInput(T);

// Wrappers a nivel de módulo (nunca dentro del render: remontarían los inputs)
const Section = (p: Omit<React.ComponentProps<typeof DSection>, "theme">) => <DSection theme={T} {...p} />;

const selectStyle: React.CSSProperties = {
  padding: "7px 11px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontSize: 13, fontFamily: "inherit", background: C.white, color: C.ink, cursor: "pointer",
};

// Etiqueta monoespaciada en versalitas, como los "eyebrow" del sitio
const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: ".24em",
  textTransform: "uppercase", color: C.blueDark,
};

// Ornamento línea + diamante que usa el sitio bajo cada eyebrow
function Ornament() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, color: C.blueDark, marginTop: 9 }}>
      <span style={{ width: 46, height: 1, background: C.blueDark }} />
      <span style={{ width: 6, height: 6, background: C.blueDark, transform: "rotate(45deg)" }} />
    </div>
  );
}

// ─── Embudo de seguimiento ─────────────────────────────────────────────────────
const LEAD_STATUS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "nuevo",      label: "Nuevo",      bg: "#EEF2F6", fg: "#5D7080" },
  { id: "contactado", label: "Contactado", bg: "#E8F0F9", fg: "#2A6AAE" },
  { id: "agendado",   label: "Agendado",   bg: "#FFF4E5", fg: "#B96A1E" },
  { id: "cliente",    label: "Cliente",    bg: "#EAF7EE", fg: "#4B9A62" },
  { id: "descartado", label: "Descartado", bg: "#F6F7F8", fg: "#9CA3AF" },
];
function statusMeta(id: string | null) {
  return LEAD_STATUS.find((s) => s.id === (id || "nuevo")) ?? LEAD_STATUS[0];
}

const SOURCE_LABEL: Record<string, string> = {
  actitud:  "Evaluación de Actitud",
  criterio: "Evaluación de Criterio",
};
function sourceLabel(s: string | null) {
  return SOURCE_LABEL[s || ""] || s || "—";
}

// ─── Utilidades ────────────────────────────────────────────────────────────────
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function daysAgo(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 ? `52${digits}` : digits;
  return `https://wa.me/${full}`;
}

// Las respuestas se guardan como objeto libre; se pintan como lista legible.
function answerEntries(answers: Record<string, unknown> | null): { k: string; v: string }[] {
  if (!answers) return [];
  return Object.entries(answers).map(([k, v]) => ({
    k,
    v: typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—"),
  }));
}

type Periodo = "7" | "30" | "90" | "todo";
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "7", label: "Últimos 7 días" },
  { id: "30", label: "Últimos 30 días" },
  { id: "90", label: "Últimos 90 días" },
  { id: "todo", label: "Todo" },
];

export default function MarioCitalanPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<"resumen" | "prospectos">("resumen");
  const [leads, setLeads] = useState<CriterioLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Filtros de la pestaña Prospectos
  const [search, setSearch] = useState("");
  const [fSource, setFSource] = useState<string>("todo");
  const [fStatus, setFStatus] = useState<string>("todo");
  const [fOptIn, setFOptIn] = useState(false);

  // Periodo de la pestaña Resumen
  const [periodo, setPeriodo] = useState<Periodo>("30");

  // Detalle del prospecto
  const [detail, setDetail] = useState<CriterioLead | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/mariocitalan");
    });
  }, [router]);

  useEffect(() => {
    async function fetchLeads() {
      setLoading(true);
      // Supabase corta en 1000 filas por request: paginamos por si crece la lista.
      const all: CriterioLead[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("leads")
          .select("id,name,email,phone,problem,ai_response,profile,route,answers,notes,opt_in,source,status,created_at")
          .eq("client_id", CRITERIO_CLIENT_ID)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) { console.error(error); break; }
        const page = (data as CriterioLead[]) ?? [];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      setLeads(all);
      setLoading(false);
    }
    fetchLeads();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/mariocitalan");
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function changeStatus(id: string, status: string) {
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) { console.error(error); flash("No se pudo actualizar: " + error.message); return; }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    setDetail((d) => (d && d.id === id ? { ...d, status } : d));
  }

  async function saveNote(id: string) {
    setSaving(true);
    const { error } = await supabase.from("leads").update({ notes: noteDraft }).eq("id", id);
    setSaving(false);
    if (error) { console.error(error); flash("No se pudo guardar la nota: " + error.message); return; }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, notes: noteDraft } : l)));
    setDetail((d) => (d && d.id === id ? { ...d, notes: noteDraft } : d));
    flash("Nota guardada");
  }

  function openDetail(l: CriterioLead) {
    setDetail(l);
    setNoteDraft(l.notes ?? "");
  }

  // ─── Derivados ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (fSource !== "todo" && (l.source || "") !== fSource) return false;
      if (fStatus !== "todo" && (l.status || "nuevo") !== fStatus) return false;
      if (fOptIn && !l.opt_in) return false;
      if (!q) return true;
      return [l.name, l.email, l.phone, l.profile].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [leads, search, fSource, fStatus, fOptIn]);

  const stats = useMemo(() => {
    const desde = periodo === "todo" ? null : daysAgo(Number(periodo));
    const enRango = desde ? leads.filter((l) => new Date(l.created_at) >= desde) : leads;

    const porPerfil = new Map<string, number>();
    const porFuente = new Map<string, number>();
    const porDia = new Map<string, number>();
    for (const l of enRango) {
      const p = l.profile || "Sin perfil";
      porPerfil.set(p, (porPerfil.get(p) ?? 0) + 1);
      const s = l.source || "—";
      porFuente.set(s, (porFuente.get(s) ?? 0) + 1);
      const d = new Date(l.created_at).toISOString().slice(0, 10);
      porDia.set(d, (porDia.get(d) ?? 0) + 1);
    }

    const hoy = leads.filter((l) => new Date(l.created_at) >= daysAgo(0)).length;
    const suscritos = enRango.filter((l) => l.opt_in).length;
    const contactados = enRango.filter((l) => ["contactado", "agendado", "cliente"].includes(l.status || "")).length;
    const diaTop = [...porDia.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      total: enRango.length,
      totalGlobal: leads.length,
      hoy,
      suscritos,
      contactados,
      porPerfil: [...porPerfil.entries()].sort((a, b) => b[1] - a[1]),
      porFuente: [...porFuente.entries()].sort((a, b) => b[1] - a[1]),
      diaTop,
    };
  }, [leads, periodo]);

  function exportCSV() {
    const rows = filtered;
    if (rows.length === 0) { flash("No hay prospectos que exportar"); return; }
    const head = ["Nombre", "Correo", "Teléfono", "Perfil", "Ruta sugerida", "Evaluación", "Estatus", "Newsletter", "Fecha", "Notas"];
    const lines = [head.join(",")];
    for (const l of rows) {
      lines.push([
        l.name, l.email, l.phone || "", l.profile || "", l.route || "",
        sourceLabel(l.source), statusMeta(l.status).label,
        l.opt_in ? "Sí" : "No", fmtDate(l.created_at), (l.notes || "").replace(/\n/g, " "),
      ].map((v) => csvEscape(String(v))).join(","));
    }
    // BOM para que Excel respete los acentos
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prospectos-mariocitalan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash(`${rows.length} prospectos exportados`);
  }

  const maxPerfil = stats.porPerfil[0]?.[1] ?? 1;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: FONT_BODY }}>
      {/* Tipografía del sitio público de Mario */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={FONTS_HREF} />
      {/* Los componentes compartidos traen Plus Jakarta Sans en estilos inline.
          Aquí se sustituye por Fraunces para no romper la marca de Mario; el
          override vive solo en este panel y no toca /components/dashboard. */}
      <style dangerouslySetInnerHTML={{ __html: `
        [style*="Plus Jakarta Sans"] { font-family: ${FONT_SERIF} !important; font-weight: 500 !important; }
      ` }} />

      {/* Header con la marca de Mario, no la de FishFlow */}
      <header style={{ background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: "15px 26px", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 14, position: "sticky", top: 0, zIndex: 30, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mariocitalan/dr-mente-logo.png" alt="Mario Citalán"
            style={{ height: 38, width: "auto", display: "block", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONT_SERIF, fontWeight: 500, fontSize: 20, letterSpacing: "-.01em",
              color: C.ink, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Mario Citalán
            </div>
            <div style={{ ...eyebrowStyle, fontSize: 9.5, marginTop: 3 }}>
              Arquitectura del Criterio
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          <a href="https://mariocitalan.net" target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase",
              color: C.muted, textDecoration: "none", border: `1px solid ${C.border}`,
              padding: "8px 13px", whiteSpace: "nowrap" }}>
            Mi sitio
          </a>
          <a href="/app/therapyos"
            style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase",
              color: C.blueDark, textDecoration: "none", border: `1px solid ${C.blueDark}`,
              padding: "8px 13px", whiteSpace: "nowrap" }}>
            TherapyOS
          </a>
          <button onClick={logout}
            style={{ fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase",
              color: C.muted, background: "none", border: `1px solid ${C.border}`,
              padding: "8px 13px", cursor: "pointer" }}>
            Salir
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 22px 70px" }}>
        {/* Encabezado editorial, como las secciones del sitio */}
        <div style={{ marginBottom: 26 }}>
          <span style={eyebrowStyle}>Tus prospectos</span>
          <Ornament />
          <h1 style={{ fontFamily: FONT_SERIF, fontWeight: 500, fontSize: "clamp(26px,3.4vw,38px)",
            lineHeight: 1.12, letterSpacing: "-.015em", color: C.ink, marginTop: 16, maxWidth: "22ch" }}>
            Quiénes llegaron a <span style={{ fontStyle: "italic", color: C.blueDark }}>tus evaluaciones</span>.
          </h1>
        </div>

        <TabBar
          theme={T}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "resumen", label: "Resumen", icon: "📊" },
            { id: "prospectos", label: `Prospectos${leads.length ? ` (${leads.length})` : ""}`, icon: "👥" },
          ]}
        />

        {loading ? (
          <Empty msg="Cargando prospectos…" theme={T} />
        ) : tab === "resumen" ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
              <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} style={selectStyle}>
                {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>

            <StatGrid>
              <StatCard theme={T} label="Prospectos en el periodo" value={stats.total} icon="👥" accent={C.blueDark} />
              <StatCard theme={T} label="Llegaron hoy" value={stats.hoy} icon="⚡" />
              <StatCard theme={T} label="Quieren tus publicaciones" value={stats.suscritos}
                icon="✉️" sub={stats.total ? `${Math.round((stats.suscritos / stats.total) * 100)}% del periodo` : undefined} />
              <StatCard theme={T} label="Con seguimiento" value={stats.contactados}
                icon="🤝" sub={`${stats.totalGlobal} en total histórico`} />
            </StatGrid>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
              <div style={cardStyle}>
                <Section title="Perfiles que llegan">
                  {stats.porPerfil.length === 0 ? (
                    <Empty msg="Sin datos en este periodo" theme={T} />
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      {stats.porPerfil.map(([perfil, n]) => (
                        <div key={perfil}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                            <span style={{ fontWeight: 600 }}>{perfil}</span>
                            <span style={{ color: C.muted }}>{n}</span>
                          </div>
                          <div style={{ height: 7, background: C.bg, borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ width: `${(n / maxPerfil) * 100}%`, height: "100%", background: C.blue }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              <div style={cardStyle}>
                <Section title="De dónde vienen">
                  {stats.porFuente.length === 0 ? (
                    <Empty msg="Sin datos en este periodo" theme={T} />
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {stats.porFuente.map(([s, n]) => (
                        <div key={s} style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", fontSize: 14, padding: "9px 0",
                          borderBottom: `1px solid ${C.border}` }}>
                          <span>{sourceLabel(s)}</span>
                          <strong style={{ color: C.blueDark }}>{n}</strong>
                        </div>
                      ))}
                      {stats.diaTop && (
                        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
                          Tu mejor día del periodo fue el <strong style={{ color: C.ink }}>
                          {fmtDate(stats.diaTop[0] + "T12:00:00")}</strong> con {stats.diaTop[1]} prospectos.
                          Compáralo con tus apariciones en radio y TV para saber cuáles valen la pena repetir.
                        </p>
                      )}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          </>
        ) : (
          <Section title={`${filtered.length} de ${leads.length} prospectos`}
            action={{ label: "Exportar CSV", onClick: exportCSV }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, correo, teléfono o perfil"
                style={{ ...inputStyle, maxWidth: 320, fontSize: 16 }}
              />
              <select value={fSource} onChange={(e) => setFSource(e.target.value)} style={selectStyle}>
                <option value="todo">Todas las evaluaciones</option>
                <option value="actitud">Actitud</option>
                <option value="criterio">Criterio</option>
              </select>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selectStyle}>
                <option value="todo">Todos los estatus</option>
                {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={fOptIn} onChange={(e) => setFOptIn(e.target.checked)} />
                Solo suscritos al newsletter
              </label>
            </div>

            {filtered.length === 0 ? (
              <Empty msg="No hay prospectos con esos filtros" theme={T} />
            ) : (
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 760 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em" }}>
                      <th style={{ padding: "10px 12px 10px 0" }}>Prospecto</th>
                      <th style={{ padding: "10px 12px" }}>Perfil</th>
                      <th style={{ padding: "10px 12px" }}>Evaluación</th>
                      <th style={{ padding: "10px 12px" }}>Fecha</th>
                      <th style={{ padding: "10px 12px" }}>Estatus</th>
                      <th style={{ padding: "10px 0 10px 12px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      const sm = statusMeta(l.status);
                      return (
                        <tr key={l.id} style={{ borderTop: `1px solid ${C.border}`, background: C.white }}>
                          <td style={{ padding: "12px 12px 12px 0" }}>
                            <div style={{ fontWeight: 600 }}>
                              {l.name}
                              {l.opt_in && <span title="Aceptó recibir publicaciones" style={{ marginLeft: 7 }}>✉️</span>}
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted }}>{l.email}</div>
                            {l.phone && (
                              <a href={waLink(l.phone)} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12.5, color: C.blueDark, textDecoration: "none" }}>
                                {l.phone}
                              </a>
                            )}
                          </td>
                          <td style={{ padding: "12px" }}>{l.profile || "—"}</td>
                          <td style={{ padding: "12px", color: C.muted, fontSize: 13 }}>{sourceLabel(l.source)}</td>
                          <td style={{ padding: "12px", color: C.muted, fontSize: 13, whiteSpace: "nowrap" }}>
                            {fmtDate(l.created_at)}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <select
                              value={l.status || "nuevo"}
                              onChange={(e) => changeStatus(l.id, e.target.value)}
                              style={{ ...selectStyle, color: sm.fg, background: sm.bg, border: "none", fontWeight: 600 }}
                            >
                              {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "12px 0 12px 12px", textAlign: "right" }}>
                            <button onClick={() => openDetail(l)}
                              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
                                padding: "6px 12px", fontSize: 12.5, cursor: "pointer", color: C.blueDark, whiteSpace: "nowrap" }}>
                              Ver detalle
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}
      </main>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} theme={T} wide>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <Chip label={sourceLabel(detail.source)} bg={C.blueSoft} fg={C.blueDark} />
            <Chip label={statusMeta(detail.status).label} bg={statusMeta(detail.status).bg} fg={statusMeta(detail.status).fg} />
            <Chip
              label={detail.opt_in ? "Quiere tus publicaciones" : "Sin suscripción"}
              bg={detail.opt_in ? "#EAF7EE" : "#F6F7F8"}
              fg={detail.opt_in ? "#4B9A62" : C.gray}
            />
          </div>

          <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 18 }}>
            <div><span style={{ color: C.muted }}>Correo: </span>
              <a href={`mailto:${detail.email}`} style={{ color: C.blueDark }}>{detail.email}</a></div>
            {detail.phone && (
              <div><span style={{ color: C.muted }}>Teléfono: </span>
                <a href={waLink(detail.phone)} target="_blank" rel="noopener noreferrer" style={{ color: C.blueDark }}>
                  {detail.phone}
                </a></div>
            )}
            <div><span style={{ color: C.muted }}>Recibido: </span>{fmtDateTime(detail.created_at)}</div>
          </div>

          {detail.profile && (
            <div style={{ borderLeft: `3px solid ${C.blue}`, padding: "4px 0 4px 16px", marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{detail.profile}</div>
              {detail.ai_response && (
                <div style={{ fontSize: 13.5, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>{detail.ai_response}</div>
              )}
            </div>
          )}

          {detail.route && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "13px 15px", marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: C.blueDark, marginBottom: 4 }}>
                Ruta sugerida
              </div>
              <div style={{ fontSize: 14 }}>{detail.route}</div>
            </div>
          )}

          {answerEntries(detail.answers).length > 0 && (
            <details style={{ marginBottom: 18 }}>
              <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: C.blueDark, marginBottom: 10 }}>
                Ver respuestas del cuestionario
              </summary>
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {answerEntries(detail.answers).map(({ k, v }) => (
                  <div key={k} style={{ fontSize: 13, borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                    <div style={{ color: C.muted, fontSize: 12 }}>{k}</div>
                    <div>{v}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <Field label="Notas de seguimiento" theme={T}>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              placeholder="Qué platicaron, cuándo darle seguimiento, qué le interesa…"
              style={{ ...inputStyle, fontSize: 16, resize: "vertical", lineHeight: 1.6 }}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => saveNote(detail.id)}
              disabled={saving || noteDraft === (detail.notes ?? "")}
              style={{ background: saving || noteDraft === (detail.notes ?? "") ? C.gray : C.blue,
                color: "#fff", border: "none", borderRadius: 10, padding: "11px 22px",
                fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer" }}
            >
              {saving ? "Guardando…" : "Guardar nota"}
            </button>
            <select
              value={detail.status || "nuevo"}
              onChange={(e) => changeStatus(detail.id, e.target.value)}
              style={{ ...selectStyle, padding: "11px 14px" }}
            >
              {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </Modal>
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );
}
