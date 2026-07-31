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

// ─── Prioridad por perfil ──────────────────────────────────────────────────────
// Los perfiles ya vienen ordenados por severidad en las dos evaluaciones:
// Actitud    (0-60):  Reconstrucción → Vulnerable → Funcional → Sólida
// Criterio (30-150):  Emergente → En Desarrollo → En Consolidación → Funcional → Alto Desempeño
//
// `nivel` 1 = más necesidad de acompañamiento; 5 = estructura ya sólida.
// Dos lecturas legítimas y opuestas de "prioridad":
//   · por NECESIDAD  → primero quien peor está (nivel 1)
//   · por POTENCIAL  → primero quien tiene estructura para programas ejecutivos (nivel 5)
// El panel deja elegir el orden en vez de imponer uno.
type Grupo = "atencion" | "seguimiento" | "potencial";

const PROFILE_PRIORITY: Record<string, { nivel: number; grupo: Grupo }> = {
  "Arquitectura de Actitud en Reconstrucción": { nivel: 1, grupo: "atencion" },
  "Arquitectura Emergente":                    { nivel: 1, grupo: "atencion" },
  "Arquitectura de Actitud Vulnerable":        { nivel: 2, grupo: "atencion" },
  "Arquitectura en Desarrollo":                { nivel: 2, grupo: "atencion" },
  "Arquitectura de Actitud Funcional":         { nivel: 3, grupo: "seguimiento" },
  "Arquitectura en Consolidación":             { nivel: 3, grupo: "seguimiento" },
  "Arquitectura de Actitud Sólida":            { nivel: 4, grupo: "potencial" },
  "Arquitectura Funcional":                    { nivel: 4, grupo: "potencial" },
  "Arquitectura de Alto Desempeño":            { nivel: 5, grupo: "potencial" },
};

const GRUPO_META: Record<Grupo, { label: string; corto: string; bg: string; fg: string; ayuda: string }> = {
  atencion:    { label: "Atención prioritaria", corto: "Atención", bg: "#FDECEC", fg: "#C0392B",
                 ayuda: "Estructura frágil: son quienes más necesitan acompañamiento." },
  seguimiento: { label: "Seguimiento",          corto: "Seguimiento", bg: "#FFF4E5", fg: "#B96A1E",
                 ayuda: "Tienen recursos pero áreas claras por fortalecer." },
  potencial:   { label: "Alto potencial",       corto: "Potencial", bg: "#E8F0F9", fg: "#2A6AAE",
                 ayuda: "Base sólida: perfil de programas ejecutivos y alto desempeño." },
};

function priorityOf(profile: string | null) {
  return PROFILE_PRIORITY[profile || ""] ?? { nivel: 3, grupo: "seguimiento" as Grupo };
}

const SOURCE_LABEL: Record<string, string> = {
  actitud:    "Evaluación de Actitud",
  criterio:   "Evaluación de Criterio",
  newsletter: "Suscripción directa",
  libro:      "Lista de espera del libro",
};

// Fuentes que SÍ son una evaluación. Quien llegó solo por el newsletter o por la
// lista del libro no tiene perfil ni respuestas: no debe contar como evaluación
// ni caer en un grupo de prioridad, porque no hay nada que priorizar todavía.
const FUENTES_EVALUACION = new Set(["actitud", "criterio"]);

// ─── Suscripción al newsletter ─────────────────────────────────────────────────
const NEWSLETTER_STATE: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "pendiente", label: "Por preguntar", bg: "#EEF2F6", fg: "#5D7080" },
  { id: "suscrito",  label: "Suscrito",      bg: "#EAF7EE", fg: "#4B9A62" },
  { id: "baja",      label: "No quiere",     bg: "#F6F7F8", fg: "#9CA3AF" },
  { id: "fuera",     label: "Correo inválido", bg: "#FDECEC", fg: "#C0392B" },
];
function newsletterMeta(id: string | null) {
  return NEWSLETTER_STATE.find((s) => s.id === (id || "pendiente")) ?? NEWSLETTER_STATE[0];
}
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
  const [tab, setTab] = useState<"resumen" | "prospectos" | "newsletter">("resumen");
  const [leads, setLeads] = useState<CriterioLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Filtros de la pestaña Prospectos
  const [search, setSearch] = useState("");
  const [fSource, setFSource] = useState<string>("todo");
  const [fStatus, setFStatus] = useState<string>("todo");
  const [fOptIn, setFOptIn] = useState(false);
  const [fGrupo, setFGrupo] = useState<"todo" | Grupo>("todo");
  const [orden, setOrden] = useState<"reciente" | "necesidad" | "potencial">("reciente");

  // Periodo de la pestaña Resumen
  const [periodo, setPeriodo] = useState<Periodo>("30");

  // Redactor del envío quincenal
  const [nlTema, setNlTema] = useState("");
  const [nlNotas, setNlNotas] = useState("");
  const [nlAudiencia, setNlAudiencia] = useState<"todos" | Grupo>("todos");
  const [nlSubject, setNlSubject] = useState("");
  const [nlBody, setNlBody] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlSending, setNlSending] = useState(false);

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
          .select("id,name,email,phone,problem,ai_response,profile,route,answers,notes,opt_in,newsletter,newsletter_at,newsletter_note,libro_at,source,status,created_at")
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

  // Suscripción al newsletter: la marca Mario después de preguntarle a la persona.
  // Se guarda por correo (no por evaluación) porque quien hizo las dos pruebas
  // aparece dos veces y la decisión es de la persona, no del cuestionario.
  async function setNewsletter(email: string, estado: string) {
    const { error } = await supabase
      .from("leads")
      .update({ newsletter: estado, newsletter_at: new Date().toISOString() })
      .eq("client_id", CRITERIO_CLIENT_ID)
      .eq("email", email);
    if (error) { console.error(error); flash("No se pudo actualizar: " + error.message); return; }
    setLeads((prev) => prev.map((l) => (l.email === email ? { ...l, newsletter: estado } : l)));
    setDetail((d) => (d && d.email === email ? { ...d, newsletter: estado } : d));
    flash(estado === "suscrito" ? "Suscrito al newsletter" : "Actualizado");
  }

  async function generarBorrador() {
    if (!nlTema.trim()) { flash("Escribe de qué quieres hablar"); return; }
    setNlLoading(true);
    try {
      const r = await fetch("/api/newsletter/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tema: nlTema, notas: nlNotas, audiencia: nlAudiencia }),
      });
      const d = await r.json();
      if (!r.ok) { flash(d.error || "No se pudo generar"); return; }
      setNlSubject(d.subject || "");
      setNlBody(d.body || "");
      flash("Borrador listo — revísalo y edítalo");
    } catch {
      flash("No se pudo generar el borrador");
    } finally {
      setNlLoading(false);
    }
  }

  async function enviarPrueba() {
    if (!nlSubject.trim() || !nlBody.trim()) { flash("Falta asunto o contenido"); return; }
    setNlSending(true);
    try {
      const r = await fetch("/api/newsletter/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: nlSubject, body: nlBody, audience: nlAudiencia }),
      });
      const d = await r.json();
      if (!r.ok) { flash(d.error || "No se pudo enviar"); return; }
      flash(`Prueba enviada a ${(d.sentTo || []).length} buzones`);
    } catch {
      flash("No se pudo enviar");
    } finally {
      setNlSending(false);
    }
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
    const out = leads.filter((l) => {
      if (fSource !== "todo" && (l.source || "") !== fSource) return false;
      if (fStatus !== "todo" && (l.status || "nuevo") !== fStatus) return false;
      if (fOptIn && (l.newsletter || "pendiente") !== "suscrito") return false;
      // Sin perfil no hay grupo: quien solo se suscribió no debe colarse en el
      // filtro por grupo (priorityOf lo mandaría a "seguimiento" por defecto).
      if (fGrupo !== "todo" && (!l.profile || priorityOf(l.profile).grupo !== fGrupo)) return false;
      if (!q) return true;
      return [l.name, l.email, l.phone, l.profile].some((v) => (v || "").toLowerCase().includes(q));
    });
    if (orden === "necesidad") {
      // nivel 1 primero: quien peor está, arriba
      return [...out].sort((a, b) =>
        priorityOf(a.profile).nivel - priorityOf(b.profile).nivel ||
        (a.created_at < b.created_at ? 1 : -1));
    }
    if (orden === "potencial") {
      // nivel 5 primero: perfil de programas ejecutivos
      return [...out].sort((a, b) =>
        priorityOf(b.profile).nivel - priorityOf(a.profile).nivel ||
        (a.created_at < b.created_at ? 1 : -1));
    }
    return out; // ya viene ordenado por fecha desde la consulta
  }, [leads, search, fSource, fStatus, fOptIn, fGrupo, orden]);

  // ─── Personas (no evaluaciones) para el trabajo de newsletter ────────────────
  // Quien hizo Actitud y Criterio aparece dos veces en `leads`; aquí se colapsa
  // por correo y se conserva su perfil más severo, que es el que manda para priorizar.
  type Persona = {
    email: string; name: string; phone: string | null;
    profile: string | null; nivel: number; grupo: Grupo;
    newsletter: string; evaluaciones: number; ultima: string;
    /** Está en la lista de espera del libro (permiso aparte del boletín). */
    libro: boolean;
  };
  const personas = useMemo<Persona[]>(() => {
    const map = new Map<string, Persona>();
    for (const l of leads) {
      const key = l.email.toLowerCase();
      const p = priorityOf(l.profile);
      const esEvaluacion = FUENTES_EVALUACION.has(l.source || "");
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          email: l.email, name: l.name, phone: l.phone,
          profile: l.profile, nivel: p.nivel, grupo: p.grupo,
          newsletter: l.newsletter || "pendiente",
          evaluaciones: esEvaluacion ? 1 : 0,
          ultima: l.created_at,
          libro: l.libro_at != null,
        });
      } else {
        if (esEvaluacion) prev.evaluaciones += 1;
        if (l.created_at > prev.ultima) { prev.ultima = l.created_at; prev.name = l.name; }
        if (!prev.phone && l.phone) prev.phone = l.phone;
        if (p.nivel < prev.nivel) { prev.nivel = p.nivel; prev.grupo = p.grupo; prev.profile = l.profile; }
        if (l.newsletter && l.newsletter !== "pendiente") prev.newsletter = l.newsletter;
        if (l.libro_at != null) prev.libro = true;
      }
    }
    return [...map.values()];
  }, [leads]);

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
            { id: "newsletter", label: "Newsletter", icon: "✉️" },
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
                <Section title="A quién atender primero">
                  {(() => {
                    const porGrupo = (["atencion", "seguimiento", "potencial"] as Grupo[]).map((g) => ({
                      g,
                      n: personas.filter((p) => p.grupo === g).length,
                      sinTocar: personas.filter((p) => p.grupo === g && p.newsletter === "pendiente").length,
                    }));
                    return (
                      <div style={{ display: "grid", gap: 12 }}>
                        {porGrupo.map(({ g, n, sinTocar }) => {
                          const gm = GRUPO_META[g];
                          return (
                            <div key={g} style={{ borderLeft: `3px solid ${gm.fg}`, paddingLeft: 14 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                                <span style={{ fontWeight: 600, fontSize: 14.5 }}>{gm.label}</span>
                                <span style={{ fontFamily: FONT_SERIF, fontSize: 22, color: gm.fg }}>{n}</span>
                              </div>
                              <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginTop: 2 }}>
                                {gm.ayuda}
                                {sinTocar > 0 && ` · ${sinTocar} sin contactar`}
                              </div>
                            </div>
                          );
                        })}
                        <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginTop: 2 }}>
                          Ordena la lista de prospectos por <strong>mayor necesidad</strong> para atender
                          primero a quien peor está, o por <strong>mayor potencial</strong> para buscar
                          perfiles de programas ejecutivos.
                        </p>
                      </div>
                    );
                  })()}
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
        ) : tab === "newsletter" ? (
          <>
            <StatGrid>
              <StatCard theme={T} label="Suscritos" icon="✉️" accent={C.blueDark}
                value={personas.filter((p) => p.newsletter === "suscrito").length}
                sub="reciben tus publicaciones" />
              <StatCard theme={T} label="Por preguntar" icon="🕓"
                value={personas.filter((p) => p.newsletter === "pendiente").length}
                sub="aún no les preguntas" />
              <StatCard theme={T} label="No quieren" icon="—"
                value={personas.filter((p) => p.newsletter === "baja").length} />
              {/* Lista aparte: pidieron aviso del libro, no el boletín. */}
              <StatCard theme={T} label="Espera el libro" icon="📕"
                value={personas.filter((p) => p.libro).length}
                sub="solo aviso de lanzamiento" />
              <StatCard theme={T} label="Personas en total" icon="👥" value={personas.length}
                sub={`${leads.filter((l) => FUENTES_EVALUACION.has(l.source || "")).length} evaluaciones`} />
            </StatGrid>

            {/* ── Envío quincenal ─────────────────────────────────────────── */}
            <div style={{ marginTop: 34 }}>
              <Section title="Tu envío quincenal">
                <div style={{ ...cardStyle, background: "#FFF9E9", borderColor: "#EBC99A", marginBottom: 18 }}>
                  <div style={{ ...eyebrowStyle, color: "#B96A1E" }}>Modo prueba</div>
                  <p style={{ fontSize: 14, lineHeight: 1.7, color: C.ink2, marginTop: 9, margin: "9px 0 0" }}>
                    Por ahora el correo <strong>solo llega a Mario y a FishFlow</strong>, aunque digas
                    &quot;enviar&quot;. Los suscriptores no lo reciben. Sirve para afinar el formato y la
                    voz antes de soltarlo. Se abre a la lista real cuando esté verificado el correo propio
                    de Mario.
                  </p>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
                  {/* Redactor */}
                  <div style={cardStyle}>
                    <Field label="¿De qué quieres hablar esta quincena?" theme={T}>
                      <input
                        value={nlTema}
                        onChange={(e) => setNlTema(e.target.value)}
                        placeholder="Ej. por qué repetimos decisiones que ya sabemos que no funcionan"
                        style={{ ...inputStyle, fontSize: 16 }}
                      />
                    </Field>
                    <Field label="Notas tuyas (opcional)" theme={T}>
                      <textarea
                        value={nlNotas}
                        onChange={(e) => setNlNotas(e.target.value)}
                        rows={3}
                        placeholder="Un caso que quieras contar, una idea, algo que dijiste en radio…"
                        style={{ ...inputStyle, fontSize: 16, resize: "vertical", lineHeight: 1.6 }}
                      />
                    </Field>
                    <Field label="¿A quién le escribes?" theme={T}>
                      <select
                        value={nlAudiencia}
                        onChange={(e) => setNlAudiencia(e.target.value as "todos" | Grupo)}
                        style={{ ...selectStyle, width: "100%", padding: "10px 12px", fontSize: 14 }}
                      >
                        <option value="todos">Todos mis suscritos</option>
                        <option value="atencion">Solo atención prioritaria</option>
                        <option value="seguimiento">Solo seguimiento</option>
                        <option value="potencial">Solo alto potencial</option>
                      </select>
                    </Field>
                    <button
                      onClick={generarBorrador}
                      disabled={nlLoading}
                      style={{ width: "100%", background: nlLoading ? C.gray : C.ink, color: "#fff",
                        border: "none", padding: "13px", fontFamily: FONT_MONO, fontSize: 11.5,
                        letterSpacing: ".14em", textTransform: "uppercase",
                        cursor: nlLoading ? "default" : "pointer", marginTop: 4 }}
                    >
                      {nlLoading ? "Escribiendo…" : "Proponme un borrador"}
                    </button>
                    <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 10 }}>
                      El borrador está escrito con tu voz, pero es tuyo: léelo completo y cámbialo. Nada
                      sale sin que tú lo edites.
                    </p>
                  </div>

                  {/* Vista previa editable */}
                  <div style={cardStyle}>
                    <Field label="Asunto" theme={T}>
                      <input
                        value={nlSubject}
                        onChange={(e) => setNlSubject(e.target.value)}
                        placeholder="Aparecerá aquí el asunto propuesto"
                        style={{ ...inputStyle, fontSize: 16 }}
                      />
                    </Field>
                    <Field label="Contenido del correo" theme={T}>
                      <textarea
                        value={nlBody}
                        onChange={(e) => setNlBody(e.target.value)}
                        rows={14}
                        placeholder="Aquí aparece el borrador. Edítalo hasta que suene a ti."
                        style={{ ...inputStyle, fontSize: 15.5, resize: "vertical", lineHeight: 1.75,
                          fontFamily: FONT_BODY }}
                      />
                    </Field>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={enviarPrueba}
                        disabled={nlSending || !nlSubject.trim() || !nlBody.trim()}
                        style={{ flex: 1, minWidth: 180,
                          background: nlSending || !nlSubject.trim() || !nlBody.trim() ? C.gray : C.blue,
                          color: "#fff", border: "none", padding: "13px",
                          fontFamily: FONT_MONO, fontSize: 11.5, letterSpacing: ".14em",
                          textTransform: "uppercase", cursor: nlSending ? "default" : "pointer" }}
                      >
                        {nlSending ? "Enviando…" : "Enviar prueba"}
                      </button>
                      {nlBody.trim() && (
                        <span style={{ fontSize: 12.5, color: C.muted }}>
                          {nlBody.trim().split(/\s+/).length} palabras
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 10 }}>
                      Llega a <strong>mariocitalan@gmail.com</strong> y <strong>raf@fishflow.mx</strong>,
                      con la marca y el formato reales del envío.
                    </p>
                  </div>
                </div>
              </Section>
            </div>

            <div style={{ ...cardStyle, marginBottom: 20, borderLeft: `3px solid ${C.blue}` }}>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: C.ink2, margin: 0 }}>
                Quien llenó una evaluación pidió <strong>su resultado</strong>, no un boletín. Antes de
                incluir a alguien aquí, pregúntale — por WhatsApp o en tu correo de seguimiento — y marca
                su respuesta. Una lista de 20 personas que sí quieren leerte vale más que una de 200 que
                te reportan como spam.
              </p>
            </div>

            <Section title="A quién preguntarle">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
                <select value={fGrupo} onChange={(e) => setFGrupo(e.target.value as "todo" | Grupo)} style={selectStyle}>
                  <option value="todo">Todos los perfiles</option>
                  <option value="atencion">Atención prioritaria</option>
                  <option value="seguimiento">Seguimiento</option>
                  <option value="potencial">Alto potencial</option>
                </select>
                <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} style={selectStyle}>
                  <option value="reciente">Más recientes primero</option>
                  <option value="necesidad">Mayor necesidad primero</option>
                  <option value="potencial">Mayor potencial primero</option>
                </select>
                <span style={{ fontSize: 12.5, color: C.muted }}>
                  {fGrupo !== "todo" ? GRUPO_META[fGrupo as Grupo].ayuda : "Una fila por persona, no por evaluación."}
                </span>
              </div>

              {(() => {
                const lista = personas
                  // Sin evaluación no hay grupo real: `priorityOf(null)` los pondría
                  // en "Seguimiento" por defecto y ensuciaría el filtro.
                  .filter((p) => fGrupo === "todo" || (p.evaluaciones > 0 && p.grupo === fGrupo))
                  .filter((p) => p.newsletter !== "fuera")
                  .sort((a, b) => {
                    if (orden === "necesidad") return a.nivel - b.nivel || (a.ultima < b.ultima ? 1 : -1);
                    if (orden === "potencial") return b.nivel - a.nivel || (a.ultima < b.ultima ? 1 : -1);
                    return a.ultima < b.ultima ? 1 : -1;
                  });
                if (lista.length === 0) return <Empty msg="No hay personas con ese filtro" theme={T} />;
                return (
                  <div style={{ display: "grid", gap: 10 }}>
                    {lista.map((p) => {
                      const gm = GRUPO_META[p.grupo];
                      const nm = newsletterMeta(p.newsletter);
                      const soloBoletin = p.evaluaciones === 0;
                      const primer = p.name.split(" ")[0] || p.name;
                      const msg = encodeURIComponent(
                        soloBoletin
                          // No hizo evaluación: agradecerle una que no hizo se nota falso.
                          ? `Hola ${primer}, soy Mario Citalán. Gracias por suscribirte. ` +
                            `Si en algún momento quieres una lectura de tu perfil, tengo dos ` +
                            `evaluaciones cortas en mariocitalan.net. Sin compromiso.`
                          : `Hola ${primer}, soy Mario Citalán. Gracias por hacer mi evaluación. ` +
                            `Cada quincena comparto material sobre arquitectura mental y toma de decisiones. ` +
                            `¿Te gustaría que te lo mande por correo?`
                      );
                      return (
                        <div key={p.email} style={{ ...cardStyle, display: "flex", gap: 12,
                          alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                          <div style={{ minWidth: 210, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 600 }}>{p.name}</span>
                              {soloBoletin
                                ? <Chip label="Sin evaluación" bg="#EEF2F6" fg="#5D7080" />
                                : <Chip label={gm.corto} bg={gm.bg} fg={gm.fg} />}
                              <Chip label={nm.label} bg={nm.bg} fg={nm.fg} />
                              {/* Permiso aparte: solo autoriza el aviso de lanzamiento. */}
                              {p.libro && <Chip label="Espera el libro" bg="#F3EEF9" fg="#6B4E9B" />}
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
                              {soloBoletin
                                ? "Se suscribió sin hacer evaluación"
                                : p.profile || "—"}
                              {p.evaluaciones > 1 && ` · ${p.evaluaciones} evaluaciones`}
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted }}>{p.email}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {p.phone && (
                              <a href={`${waLink(p.phone)}?text=${msg}`} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12.5, textDecoration: "none", color: "#fff",
                                  background: "#25D366", borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}>
                                Preguntar por WhatsApp
                              </a>
                            )}
                            {p.newsletter !== "suscrito" && (
                              <button onClick={() => setNewsletter(p.email, "suscrito")}
                                style={{ fontSize: 12.5, background: C.blue, color: "#fff", border: "none",
                                  borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>
                                Dijo que sí
                              </button>
                            )}
                            {p.newsletter !== "baja" && (
                              <button onClick={() => setNewsletter(p.email, "baja")}
                                style={{ fontSize: 12.5, background: "none", color: C.muted,
                                  border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>
                                No quiere
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Section>

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
                <option value="todo">Todas las fuentes</option>
                <option value="actitud">Actitud</option>
                <option value="criterio">Criterio</option>
                <option value="newsletter">Suscripción directa</option>
                <option value="libro">Lista de espera del libro</option>
              </select>
              <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selectStyle}>
                <option value="todo">Todos los estatus</option>
                {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <select value={fGrupo} onChange={(e) => setFGrupo(e.target.value as "todo" | Grupo)} style={selectStyle}>
                <option value="todo">Todos los perfiles</option>
                <option value="atencion">Atención prioritaria</option>
                <option value="seguimiento">Seguimiento</option>
                <option value="potencial">Alto potencial</option>
              </select>
              <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} style={selectStyle}>
                <option value="reciente">Más recientes primero</option>
                <option value="necesidad">Mayor necesidad primero</option>
                <option value="potencial">Mayor potencial primero</option>
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
                          <td style={{ padding: "12px" }}>
                            <div>{l.profile || "—"}</div>
                            <div style={{ marginTop: 4 }}>
                              <Chip
                                label={GRUPO_META[priorityOf(l.profile).grupo].corto}
                                bg={GRUPO_META[priorityOf(l.profile).grupo].bg}
                                fg={GRUPO_META[priorityOf(l.profile).grupo].fg}
                              />
                            </div>
                          </td>
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
              label={GRUPO_META[priorityOf(detail.profile).grupo].label}
              bg={GRUPO_META[priorityOf(detail.profile).grupo].bg}
              fg={GRUPO_META[priorityOf(detail.profile).grupo].fg}
            />
            <Chip
              label={newsletterMeta(detail.newsletter).label}
              bg={newsletterMeta(detail.newsletter).bg}
              fg={newsletterMeta(detail.newsletter).fg}
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
