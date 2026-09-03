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
import type { CriterioLead, Assessment, ProgramEnrollment } from "@/lib/supabase";
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

// ─── Los dos instrumentos de Mario ────────────────────────────────────────────
// Criterio (30 reactivos, 30-150) y Actitud (15 reactivos, 0-60). Son escalas
// distintas y perfiles distintos: un "Funcional" de Actitud NO es un
// "Funcional" de Criterio. La ruta es la que el propio cuestionario ya le
// recomendó a la persona; aquí solo se repite, no se inventa.
const INSTRUMENTOS: { id: string; label: string; corto: string; tope: number }[] = [
  { id: "criterio_v1", label: "Arquitectura Mental y del Criterio", corto: "Criterio", tope: 150 },
  { id: "actitud_v1",  label: "Evaluación de Actitud",              corto: "Actitud",  tope: 60 },
];

type PerfilMeta = {
  instrumento: string; nombre: string; corto: string;
  min: number; max: number; bg: string; fg: string;
  ruta: string;
  /** ¿Su perfil cae en el rango que el programa de Reconstrucción atiende? */
  candidato: boolean;
};

const PERFILES: PerfilMeta[] = [
  // Criterio — 30 reactivos escala 1-5, puntaje 30-150.
  { instrumento: "criterio_v1", nombre: "Arquitectura Emergente",         corto: "Emergente",     min: 30,  max: 69,
    bg: "#FBEAEA", fg: "#C0392B", ruta: "Asesoría en estructuración",  candidato: true },
  { instrumento: "criterio_v1", nombre: "Arquitectura en Desarrollo",     corto: "En Desarrollo", min: 70,  max: 89,
    bg: "#FDF0E2", fg: "#B96A1E", ruta: "Fortalecimiento — Etapa 1",   candidato: true },
  { instrumento: "criterio_v1", nombre: "Arquitectura en Consolidación",  corto: "Consolidación", min: 90,  max: 109,
    bg: "#FBF7DC", fg: "#8A7B1F", ruta: "Fortalecimiento — Etapa 2",   candidato: true },
  { instrumento: "criterio_v1", nombre: "Arquitectura Funcional",         corto: "Funcional",     min: 110, max: 129,
    bg: "#E8F0F9", fg: "#2A6AAE", ruta: "Alto Desempeño",              candidato: false },
  { instrumento: "criterio_v1", nombre: "Arquitectura de Alto Desempeño", corto: "Alto Desempeño",min: 130, max: 150,
    bg: "#E3EEFA", fg: "#1F4E79", ruta: "Criterio Ejecutivo",          candidato: false },

  // Actitud — 15 reactivos ponderados 0-4, puntaje 0-60. Es el instrumento de
  // entrada: tres de sus cuatro perfiles mandan a hacer la evaluación de Criterio.
  { instrumento: "actitud_v1", nombre: "Arquitectura de Actitud en Reconstrucción", corto: "En Reconstrucción", min: 0,  max: 19,
    bg: "#FBEAEA", fg: "#C0392B", ruta: "Asesoría individual",     candidato: true },
  { instrumento: "actitud_v1", nombre: "Arquitectura de Actitud Vulnerable",        corto: "Vulnerable",        min: 20, max: 34,
    bg: "#FDF0E2", fg: "#B96A1E", ruta: "Evaluación de Criterio",  candidato: true },
  { instrumento: "actitud_v1", nombre: "Arquitectura de Actitud Funcional",         corto: "Funcional",         min: 35, max: 49,
    bg: "#FBF7DC", fg: "#8A7B1F", ruta: "Evaluación de Criterio",  candidato: false },
  { instrumento: "actitud_v1", nombre: "Arquitectura de Actitud Sólida",            corto: "Sólida",            min: 50, max: 60,
    bg: "#E3EEFA", fg: "#1F4E79", ruta: "Evaluación de Criterio",  candidato: false },
];

// Las seis dimensiones vienen con su nombre largo desde el cuestionario. En una
// tabla no caben, así que aquí viven sus etiquetas cortas.
const DIM_CORTA: Record<string, string> = {
  "Capacidad para sostenerte frente a la adversidad": "Adversidad",
  "Capacidad para aprender, adaptarte y evolucionar": "Adaptación",
  "Alineación entre lo que piensas, sientes, valoras y haces": "Congruencia",
  "Capacidad para mantener el equilibrio bajo presión": "Equilibrio",
  "Calidad de tus procesos de análisis y toma de decisiones": "Decisión",
  "Claridad respecto al rumbo que deseas construir": "Rumbo",
};

function dimCorta(nombre: string): string {
  return DIM_CORTA[nombre] ?? nombre.split(" ").slice(0, 2).join(" ");
}

function fmtFecha(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}

/** Evaluación + la persona que la contestó + su estado en el programa. */
type Evaluado = {
  ev: Assessment;
  lead: CriterioLead | null;
  inscripcion: ProgramEnrollment | null;
};

// ─── Cohorte (Fase 3): quién va en qué paso ────────────────────────────────────

/** Un paso del catálogo del programa (tabla `program_steps`). */
type ProgramStep = {
  program_id: string;
  step_number: number;
  title: string;
};

/** El avance de una persona en un paso (tabla `program_step_progress`). */
type StepProgress = {
  enrollment_id: string;
  step_number: number;
  /** bloqueado | en_curso | completado */
  status: string;
  started_at: string | null;
  completed_at: string | null;
  reflection: string | null;
  session_ids: string[] | null;
};

/** Nombre y correo de alguien inscrito directo como paciente, sin lead. */
type PatientBasico = { full_name: string; email: string | null };

/** Lo mínimo de una sesión para mostrarla colgada de un paso — nada clínico. */
type SesionBasica = { id: string; session_number: number | null; session_date: string | null; session_title: string | null };

const COLOR_PASO: Record<string, string> = {
  completado: C.blueDark,
  en_curso:   C.blue,
  bloqueado:  C.border,
};

/** Una persona ya inscrita: su avance por paso, reflexiones y movimiento por dimensión. */
type Cohortado = {
  inscripcion: ProgramEnrollment;
  nombre: string;
  email: string | null;
  pasos: { paso: ProgramStep; avance: StepProgress | null }[];
  /** Su medición de arranque (milestone "inicio", o la más antigua con desglose). */
  inicio: Assessment | null;
  /** Su medición más reciente con desglose. Si es la misma que `inicio`, no hay con qué comparar. */
  ultima: Assessment | null;
  sesiones: SesionBasica[];
};

/**
 * El mensaje que Mario copia y manda él mismo. La plataforma NO lo envía: una
 * invitación a un proceso personal la manda la persona, no un sistema.
 *
 * ⚠️ Cambia según el instrumento. El paso 1 del programa ES la evaluación de
 * Criterio: a quien solo contestó Actitud no se le puede decir que ya lo tiene
 * hecho. Y da igual que suene a venta cruzada — es justo lo que su propio
 * resultado de Actitud le recomienda.
 */
function mensajeInvitacion(x: Evaluado, link: string | null): string {
  const nombre = (x.lead?.name ?? "").trim().split(" ")[0] || "";
  const perfil = x.ev.profile ?? "";
  const esCriterio = x.ev.instrument === "criterio_v1";
  const conDesglose = x.ev.total_score != null;

  const apertura = esCriterio
    ? `Contestaste la evaluación de Arquitectura Mental y del Criterio y tu resultado fue ${perfil}.`
    : `Contestaste la Evaluación de Actitud y tu resultado fue ${perfil}.`;

  const sobreElPaso1 = esCriterio
    ? conDesglose
      ? "Tu evaluación ya cuenta como el primer paso, así que no tendrías que volver a contestarla."
      : "Tu evaluación es de hace unos meses, así que el proceso arranca contestándola una vez más para tener un punto de partida actualizado."
    : "El proceso arranca con la Evaluación de Arquitectura Mental y del Criterio, que es la que da el mapa detallado por dimensión.";

  return [
    `Hola ${nombre},`,
    "",
    apertura,
    "",
    "Quiero invitarte al Programa Personal de Reconstrucción Mental: un proceso individual de diez pasos para trabajar la estructura desde la que interpretas y decides.",
    "",
    sobreElPaso1,
    "",
    link
      ? `Si quieres entrar, este es tu acceso personal:\n${link}`
      : "Si te interesa, respóndeme y te explico cómo funciona.",
    "",
    "Dr. Mario Citalán",
  ].join("\n");
}

function perfilMeta(nombre: string | null) {
  return PERFILES.find((p) => p.nombre === nombre) ?? null;
}

/** Posición del perfil DENTRO de su propio instrumento, para ordenar. */
function perfilIndice(nombre: string | null): number {
  const meta = PERFILES.find((p) => p.nombre === nombre);
  if (!meta) return 99;
  return PERFILES.filter((p) => p.instrumento === meta.instrumento).indexOf(meta);
}

// El programa de Reconstrucción trabaja la parte baja de cada escala. Arriba de
// ese rango el propio cuestionario manda a otro lado, así que marcarlos como
// "candidato" sería empujar a alguien a un programa que no le toca.
function esCandidatoReconstruccion(nombre: string | null): boolean {
  return PERFILES.find((p) => p.nombre === nombre)?.candidato ?? false;
}

const ESTADO_INSCRIPCION: Record<string, { label: string; bg: string; fg: string }> = {
  evaluado:   { label: "Evaluado",   bg: "#EEF2F6", fg: "#5D7080" },
  invitado:   { label: "Invitado",   bg: "#FFF4E5", fg: "#B96A1E" },
  activo:     { label: "En el programa", bg: "#EAF7EE", fg: "#4B9A62" },
  pausado:    { label: "Pausado",    bg: "#F6F7F8", fg: "#9CA3AF" },
  completado: { label: "Completado", bg: "#E8F0F9", fg: "#2A6AAE" },
  abandonado: { label: "Abandonado", bg: "#F6F7F8", fg: "#9CA3AF" },
};

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
  actitud:              "Evaluación de Actitud",
  criterio:             "Evaluación de Criterio",
  newsletter:           "Suscripción directa",
  libro:                "Lista de espera del libro",
  asesoria:             "Asesoría personal",
  cea:                  "CEA",
  evoluciona:           "Evoluciona",
  "ciencia-en-escena":  "Ciencia en Escena",
};

// Fuentes que SÍ son una evaluación. Quien llegó solo por el newsletter o por la
// lista del libro no tiene perfil ni respuestas: no debe contar como evaluación
// ni caer en un grupo de prioridad, porque no hay nada que priorizar todavía.
const FUENTES_EVALUACION = new Set(["actitud", "criterio"]);

// Solicitudes de servicio: alguien pidiendo contratar. Tienen su propia pestaña
// porque el trabajo es distinto —hay que responderlas, no nutrirlas— y mezcladas
// entre decenas de evaluaciones se pierden.
const FUENTES_SOLICITUD = new Set(["asesoria", "cea", "evoluciona", "ciencia-en-escena"]);

const SOLICITUD_META: Record<string, { corto: string; bg: string; fg: string }> = {
  asesoria:             { corto: "Asesoría",  bg: "#E8F0F9", fg: "#2A6AAE" },
  cea:                  { corto: "CEA",       bg: "#EAF7EE", fg: "#4B9A62" },
  evoluciona:           { corto: "Evoluciona", bg: "#FFF4E5", fg: "#B96A1E" },
  "ciencia-en-escena":  { corto: "Ciencia",   bg: "#F3EEF9", fg: "#6B4E9B" },
};

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
  const [tab, setTab] = useState<"resumen" | "solicitudes" | "evaluados" | "cohorte" | "prospectos" | "newsletter">("resumen");
  const [leads, setLeads] = useState<CriterioLead[]>([]);
  // Evaluaciones ya aplicadas (tabla `assessments`) y su inscripción, si la hay.
  const [evals, setEvals] = useState<Assessment[]>([]);
  const [inscripciones, setInscripciones] = useState<ProgramEnrollment[]>([]);
  // Cohorte (Fase 3): catálogo de pasos, avance por paso, y quién no tiene lead
  // porque Mario lo inscribió directo como paciente.
  const [pasos, setPasos] = useState<ProgramStep[]>([]);
  const [avances, setAvances] = useState<StepProgress[]>([]);
  const [patientsBasico, setPatientsBasico] = useState<Map<string, PatientBasico>>(new Map());
  const [sesionesBasico, setSesionesBasico] = useState<Map<string, SesionBasica>>(new Map());
  const [invitando, setInvitando] = useState<string | null>(null);
  const [invitar, setInvitar] = useState<Assessment | null>(null);
  // El link con el token: lo devuelve /api/programa/invitar y es lo que hace
  // que el mensaje sirva de algo. Sin él, "invitar" no lleva a ningún lado.
  const [linkInvitacion, setLinkInvitacion] = useState<string | null>(null);
  // Criterio es el instrumento del programa, así que abre en ese.
  const [fInstrumento, setFInstrumento] = useState<string>("criterio_v1");
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

  // Evaluaciones e inscripciones del motor de programas. Van en su propio
  // efecto para que un fallo aquí no deje al panel de prospectos sin cargar.
  useEffect(() => {
    async function fetchPrograma() {
      const [
        { data: ev, error: e1 },
        { data: ins, error: e2 },
        { data: pasosData, error: e3 },
        { data: avancesData, error: e4 },
        { data: pacientes, error: e5 },
      ] = await Promise.all([
        supabase
          .from("assessments")
          .select("id,client_id,lead_id,patient_id,enrollment_id,instrument,milestone,taken_at,total_score,max_score,profile,dimensions,answers,source")
          .eq("client_id", CRITERIO_CLIENT_ID)
          .order("taken_at", { ascending: false }),
        supabase
          .from("program_enrollments")
          .select("id,program_id,client_id,lead_id,patient_id,status,current_step,invited_at,started_at,notes")
          .eq("client_id", CRITERIO_CLIENT_ID),
        // Catálogo de pasos — para la cohorte, no cambia por persona.
        supabase
          .from("program_steps")
          .select("program_id,step_number,title")
          .eq("client_id", CRITERIO_CLIENT_ID)
          .eq("active", true)
          .order("step_number"),
        // Avance por paso de TODAS las inscripciones del cliente — se reparte
        // por enrollment_id al construir la cohorte.
        supabase
          .from("program_step_progress")
          .select("enrollment_id,step_number,status,started_at,completed_at,reflection,session_ids")
          .eq("client_id", CRITERIO_CLIENT_ID)
          .order("step_number"),
        // Nombre/correo de quien Mario inscribió directo como paciente, sin
        // pasar por un lead (como mi propia inscripción de prueba).
        supabase
          .from("patients")
          .select("id,full_name,email")
          .eq("client_id", CRITERIO_CLIENT_ID),
      ]);
      if (e1) console.error(e1); else setEvals((ev as Assessment[]) ?? []);
      if (e2) console.error(e2); else setInscripciones((ins as ProgramEnrollment[]) ?? []);
      if (e3) console.error(e3); else setPasos((pasosData as ProgramStep[]) ?? []);
      if (e4) console.error(e4); else setAvances((avancesData as StepProgress[]) ?? []);
      if (e5) console.error(e5);
      else setPatientsBasico(new Map(
        ((pacientes as { id: string; full_name: string; email: string | null }[]) ?? [])
          .map((p) => [p.id, { full_name: p.full_name, email: p.email }]),
      ));
    }
    fetchPrograma();
  }, []);

  // Sesiones colgadas de cada paso: dependen de los `session_ids` de los
  // avances, que solo se conocen después de cargarlos. Va en su propio efecto
  // para no bloquear todo lo demás si esto falla — y solo trae lo mínimo
  // (nada de transcripciones ni notas clínicas).
  useEffect(() => {
    async function fetchSesiones() {
      const ids = Array.from(new Set(avances.flatMap((a) => a.session_ids ?? [])));
      if (!ids.length) { setSesionesBasico(new Map()); return; }
      const { data, error } = await supabase
        .from("sessions")
        .select("id,session_number,session_date,session_title")
        .in("id", ids);
      if (error) { console.error(error); return; }
      setSesionesBasico(new Map(((data as SesionBasica[]) ?? []).map((s) => [s.id, s])));
    }
    if (avances.length) fetchSesiones();
  }, [avances]);

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

  // Marca la inscripción como `invitado`. NO crea paciente: eso pasa cuando la
  // persona acepta. Ver app/api/programa/invitar/route.ts.
  async function marcarInvitado(ev: Assessment, deshacer = false) {
    setInvitando(ev.id);
    try {
      const r = await fetch("/api/programa/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment_id: ev.id, deshacer }),
      });
      const j = await r.json();
      if (!r.ok) { flash(j.error ?? "No se pudo registrar la invitación"); return; }

      setLinkInvitacion(typeof j.link === "string" ? j.link : null);
      const nueva = j.enrollment as ProgramEnrollment | null;
      setInscripciones((prev) => {
        const otras = prev.filter((i) => i.lead_id !== ev.lead_id);
        return nueva ? [...otras, { ...nueva, lead_id: ev.lead_id }] : otras;
      });
      flash(deshacer ? "Regresado a evaluado." : "Marcado como invitado.");
    } catch (err) {
      console.error(err);
      flash("No se pudo registrar la invitación");
    } finally {
      setInvitando(null);
    }
  }

  // Alguien ya invitado necesita que Mario pueda volver a copiar SU link. La
  // ruta no cambia nada cuando el estado ya no es `evaluado`: solo lo devuelve.
  async function recuperarLink(ev: Assessment) {
    try {
      const r = await fetch("/api/programa/invitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment_id: ev.id }),
      });
      const j = await r.json();
      if (r.ok && typeof j.link === "string") setLinkInvitacion(j.link);
    } catch (err) {
      console.error(err);
    }
  }

  function openDetail(l: CriterioLead) {
    setDetail(l);
    setNoteDraft(l.notes ?? "");
  }

  // ─── Derivados ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = leads.filter((l) => {
      // Las solicitudes de servicio viven en su propia pestaña.
      if (FUENTES_SOLICITUD.has(l.source || "")) return false;
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

  // ─── Solicitudes de servicio ─────────────────────────────────────────────────
  // Sin agrupar por persona: dos solicitudes del mismo correo en momentos
  // distintos son dos asuntos que atender, no un duplicado.
  const solicitudes = useMemo(
    () => leads.filter((l) => FUENTES_SOLICITUD.has(l.source || "")),
    [leads]
  );
  const solicitudesAbiertas = useMemo(
    () => solicitudes.filter((l) => (l.status || "nuevo") === "nuevo").length,
    [solicitudes]
  );

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

  // Une evaluación + prospecto + inscripción. La persona vive en `leads`; la
  // evaluación en `assessments`; su estado en el programa en `program_enrollments`.
  const evaluados = useMemo<Evaluado[]>(() => {
    const porId = new Map(leads.map((l) => [l.id, l]));
    const porLead = new Map(
      inscripciones.filter((i) => i.lead_id).map((i) => [i.lead_id as string, i]),
    );
    return evals
      .filter((e) => e.instrument === fInstrumento)
      .map((e) => ({
        ev: e,
        lead: e.lead_id ? porId.get(e.lead_id) ?? null : null,
        inscripcion: e.lead_id ? porLead.get(e.lead_id) ?? null : null,
      }))
      // Primero las que traen puntaje, de menor a mayor: el que más lo necesita
      // arriba. Las de antes del 30-jul no tienen puntaje y van al final,
      // ordenadas por perfil para que no queden revueltas.
      .sort((a, b) => {
        const sa = a.ev.total_score;
        const sb = b.ev.total_score;
        if (sa == null && sb == null) return perfilIndice(a.ev.profile) - perfilIndice(b.ev.profile);
        if (sa == null) return 1;
        if (sb == null) return -1;
        return sa - sb;
      });
  }, [evals, leads, inscripciones, fInstrumento]);

  // Cohorte: quienes ya aceptaron y están en el programa (activo/pausado/
  // completado) — evaluado/invitado se quedan en la pestaña Evaluados. Por
  // persona: su avance por paso, sus reflexiones y el movimiento por
  // dimensión desde su medición de inicio hasta la más reciente.
  const cohorte = useMemo<Cohortado[]>(() => {
    const porLeadId = new Map(leads.map((l) => [l.id, l]));
    return inscripciones
      .filter((i) => i.status === "activo" || i.status === "pausado" || i.status === "completado")
      .map((insc) => {
        const lead = insc.lead_id ? porLeadId.get(insc.lead_id) ?? null : null;
        const paciente = insc.patient_id ? patientsBasico.get(insc.patient_id) ?? null : null;
        const nombre = lead?.name || paciente?.full_name || "Sin nombre";
        const email = lead?.email || paciente?.email || null;

        const pasosPrograma = pasos.filter((p) => p.program_id === insc.program_id);
        const avancePorPaso = new Map(
          avances.filter((a) => a.enrollment_id === insc.id).map((a) => [a.step_number, a]),
        );
        const pasosConAvance = pasosPrograma.map((paso) => ({
          paso, avance: avancePorPaso.get(paso.step_number) ?? null,
        }));

        // Sus mediciones con desglose por dimensión — misma lógica que ya usa
        // /api/programa/evaluacion: por enrollment_id, y si no por lead/patient_id
        // (cubre la línea base que contestó antes de inscribirse).
        const misMediciones = evals
          .filter((e) => e.enrollment_id === insc.id
            || (!!insc.lead_id && e.lead_id === insc.lead_id)
            || (!!insc.patient_id && e.patient_id === insc.patient_id))
          .filter((e) => e.dimensions && Object.keys(e.dimensions).length > 0)
          .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());
        const inicio = misMediciones.find((e) => e.milestone === "inicio") ?? misMediciones[0] ?? null;
        const ultima = misMediciones[misMediciones.length - 1] ?? null;

        const idsSesiones = Array.from(new Set(
          Array.from(avancePorPaso.values()).flatMap((a) => a.session_ids ?? []),
        ));
        const sesiones = idsSesiones
          .map((id) => sesionesBasico.get(id))
          .filter((s): s is SesionBasica => !!s)
          .sort((a, b) => (a.session_date ?? "").localeCompare(b.session_date ?? ""));

        return { inscripcion: insc, nombre, email, pasos: pasosConAvance, inicio, ultima, sesiones };
      })
      // Quien va más avanzado primero: es a quien Mario más necesita revisar.
      .sort((a, b) => b.inscripcion.current_step - a.inscripcion.current_step);
  }, [inscripciones, leads, patientsBasico, pasos, avances, evals, sesionesBasico]);

  const porInstrumento = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of evals) m.set(e.instrument, (m.get(e.instrument) ?? 0) + 1);
    return m;
  }, [evals]);

  const evalStats = useMemo(() => {
    const conDesglose = evaluados.filter((x) => x.ev.total_score != null).length;
    const candidatos = evaluados.filter((x) => esCandidatoReconstruccion(x.ev.profile)).length;
    const invitados = evaluados.filter((x) => x.inscripcion?.status === "invitado").length;
    const activos = evaluados.filter((x) => x.inscripcion?.status === "activo").length;
    const puntajes = evaluados.map((x) => x.ev.total_score).filter((n): n is number => n != null);
    const promedio = puntajes.length
      ? Math.round((puntajes.reduce((a, b) => a + b, 0) / puntajes.length) * 10) / 10
      : 0;
    return { total: evaluados.length, conDesglose, candidatos, invitados, activos, promedio };
  }, [evaluados]);

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
            // El contador muestra las SIN atender, no el total: es lo único
            // que exige acción hoy.
            { id: "solicitudes", label: `Solicitudes${solicitudesAbiertas ? ` (${solicitudesAbiertas})` : ""}`, icon: "🔔" },
            // Evaluados NO son pacientes: contestaron la evaluación y nada más.
            { id: "evaluados", label: `Evaluados${evaluados.length ? ` (${evaluados.length})` : ""}`, icon: "🧭" },
            // Solo quien ya aceptó y está en el proceso — no se mezcla con Evaluados.
            { id: "cohorte", label: `Cohorte${cohorte.length ? ` (${cohorte.length})` : ""}`, icon: "🪜" },
            { id: "prospectos", label: `Prospectos${filtered.length ? ` (${filtered.length})` : ""}`, icon: "👥" },
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
        ) : tab === "solicitudes" ? (
          <>
            <StatGrid>
              <StatCard theme={T} label="Sin atender" icon="🔔" accent={C.blueDark}
                value={solicitudesAbiertas}
                sub={solicitudesAbiertas ? "esperan tu respuesta" : "todo respondido"} />
              <StatCard theme={T} label="Solicitudes en total" icon="📥" value={solicitudes.length} />
              <StatCard theme={T} label="Agendadas" icon="📅"
                value={solicitudes.filter((l) => l.status === "agendado").length} />
            </StatGrid>

            <Section title={`${solicitudes.length} solicitudes de servicio`}>
              <p style={{ fontSize: 13.5, color: C.muted, marginBottom: 16 }}>
                Personas que pidieron un servicio desde el sitio. Cada una te llegó
                también por correo; responder ese correo les escribe directamente.
              </p>

              {solicitudes.length === 0 ? (
                <Empty msg="Todavía no hay solicitudes" theme={T} />
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {solicitudes.map((l) => {
                    const sm = statusMeta(l.status);
                    const meta = SOLICITUD_META[l.source || ""] ??
                      { corto: sourceLabel(l.source), bg: C.blueSoft, fg: C.blueDark };
                    const primer = l.name.split(" ")[0] || l.name;
                    const detalles = answerEntries(l.answers);
                    return (
                      <div key={l.id} style={{ ...cardStyle,
                        // Lo nuevo se distingue de un vistazo sin tener que leer el chip.
                        borderLeft: (l.status || "nuevo") === "nuevo"
                          ? `3px solid ${C.blueDark}` : `3px solid transparent` }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start",
                          justifyContent: "space-between", flexWrap: "wrap" }}>
                          <div style={{ minWidth: 220, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 600 }}>{l.name}</span>
                              <Chip label={meta.corto} bg={meta.bg} fg={meta.fg} />
                              <Chip label={sm.label} bg={sm.bg} fg={sm.fg} />
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                              {l.email}{l.phone ? ` · ${l.phone}` : ""} · {fmtDateTime(l.created_at)}
                            </div>
                            {detalles.length > 0 && (
                              <div style={{ marginTop: 10, background: C.blueSoft, borderRadius: 8, padding: "10px 12px" }}>
                                {detalles.map((d) => (
                                  <div key={d.k} style={{ fontSize: 13.5, color: C.ink, marginBottom: 3 }}>
                                    <span style={{ color: C.muted }}>{d.k}: </span>{d.v}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <a href={`mailto:${l.email}?subject=${encodeURIComponent("Sobre tu solicitud")}&body=${encodeURIComponent(`Hola ${primer},\n\n`)}`}
                              style={{ fontSize: 12.5, textDecoration: "none", color: "#fff",
                                background: C.blueDark, borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}>
                              Responder
                            </a>
                            {l.phone && (
                              <a href={waLink(l.phone)} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 12.5, textDecoration: "none", color: "#fff",
                                  background: "#25D366", borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}>
                                WhatsApp
                              </a>
                            )}
                            <select
                              value={l.status || "nuevo"}
                              onChange={(e) => changeStatus(l.id, e.target.value)}
                              style={{ ...selectStyle, color: sm.fg, background: sm.bg, border: "none", fontWeight: 600 }}
                            >
                              {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                            <button onClick={() => openDetail(l)}
                              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
                                padding: "8px 12px", fontSize: 12.5, cursor: "pointer", color: C.blueDark }}>
                              Detalle
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
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
                                ? "Aún no hace evaluación"
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
        ) : tab === "evaluados" ? (
          <>
            <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: 18,
              background: C.blueSoft, borderColor: C.blue, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>🧭</span>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: C.ink2 }}>
                Estas personas <strong>contestaron tu evaluación</strong>, no son pacientes.
                Nadie entra al programa hasta que tú lo invitas y esa persona acepta.
                Su evaluación ya cuenta como el paso 1: no la vuelve a contestar.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {INSTRUMENTOS.map((ins) => {
                const activo = fInstrumento === ins.id;
                const n = porInstrumento.get(ins.id) ?? 0;
                return (
                  <button
                    key={ins.id}
                    onClick={() => setFInstrumento(ins.id)}
                    title={ins.label}
                    style={{ background: activo ? C.blueDark : C.white,
                      color: activo ? "#fff" : C.ink2,
                      border: `1px solid ${activo ? C.blueDark : C.border}`,
                      borderRadius: 999, padding: "8px 16px", fontSize: 13,
                      fontWeight: activo ? 600 : 500, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {ins.corto}{n ? ` (${n})` : ""}
                  </button>
                );
              })}
            </div>

            <StatGrid>
              <StatCard theme={T} label="Personas evaluadas" value={evalStats.total} icon="🧭" accent={C.blueDark}
                sub={`${evalStats.conDesglose} con desglose por dimensión`} />
              <StatCard theme={T} label="Perfil para Reconstrucción" value={evalStats.candidatos}
                icon="🎯" sub={evalStats.total ? `de ${evalStats.total} evaluados` : undefined} />
              <StatCard theme={T} label="Invitados" value={evalStats.invitados} icon="✉️" />
              <StatCard theme={T} label="Puntaje promedio" value={evalStats.promedio} icon="📐"
                sub={`de ${INSTRUMENTOS.find((i) => i.id === fInstrumento)?.tope ?? 150} · ${evalStats.conDesglose} medidos`} />
            </StatGrid>

            <Section title={`${evaluados.length} en ${INSTRUMENTOS.find((i) => i.id === fInstrumento)?.label ?? "la evaluación"}`}>
              {evaluados.length === 0 ? (
                <Empty msg="Todavía no hay evaluaciones cargadas." theme={T} />
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {evaluados.map((x) => {
                    const meta = perfilMeta(x.ev.profile);
                    const estado = ESTADO_INSCRIPCION[x.inscripcion?.status ?? "evaluado"];
                    const candidato = esCandidatoReconstruccion(x.ev.profile);
                    const dims = Object.entries(x.ev.dimensions ?? {});
                    const yaInvitado = x.inscripcion?.status === "invitado";
                    const bloqueado = !!x.inscripcion && x.inscripcion.status !== "evaluado" && !yaInvitado;
                    return (
                      <div key={x.ev.id} style={{ ...cardStyle, padding: 18 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 12,
                          alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ minWidth: 190, flex: "1 1 220px" }}>
                            <div style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.ink, lineHeight: 1.25 }}>
                              {x.lead?.name || "Sin nombre"}
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, wordBreak: "break-word" }}>
                              {x.lead?.email || "—"}
                            </div>
                            <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: C.muted, marginTop: 5 }}>
                              {new Date(x.ev.taken_at).toLocaleDateString("es-MX",
                                { day: "2-digit", month: "short", year: "numeric" })}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            {meta && <Chip label={meta.corto} bg={meta.bg} fg={meta.fg} />}
                            {x.ev.total_score != null ? (
                              <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.ink2 }}>
                                {x.ev.total_score}
                                <span style={{ color: C.muted }}> / {x.ev.max_score ?? 150}</span>
                              </span>
                            ) : (
                              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}>
                                sin desglose
                              </span>
                            )}
                            <Chip label={estado.label} bg={estado.bg} fg={estado.fg} />
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              onClick={() => {
                                setLinkInvitacion(null);
                                setInvitar(x.ev);
                                if (yaInvitado) recuperarLink(x.ev);
                              }}
                              disabled={bloqueado}
                              style={{ background: bloqueado ? C.gray : yaInvitado ? C.white : C.blue,
                                color: bloqueado ? "#fff" : yaInvitado ? C.blueDark : "#fff",
                                border: yaInvitado ? `1px solid ${C.blue}` : "none",
                                borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600,
                                cursor: bloqueado ? "default" : "pointer", fontFamily: "inherit" }}
                            >
                              {yaInvitado ? "Ver mensaje" : "Invitar"}
                            </button>
                            {yaInvitado && (
                              <button
                                onClick={() => marcarInvitado(x.ev, true)}
                                disabled={invitando === x.ev.id}
                                style={{ background: "transparent", color: C.muted,
                                  border: `1px solid ${C.border}`, borderRadius: 9, padding: "9px 14px",
                                  fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                              >
                                Deshacer
                              </button>
                            )}
                          </div>
                        </div>

                        {dims.length === 0 && (
                          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`,
                            fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
                            Terminó su evaluación, pero es anterior a julio 2026: en ese momento el
                            cuestionario todavía no guardaba el detalle. Sirve para ubicar su perfil;
                            si entra al programa, la contesta una vez más para tener una medición
                            de arranque.
                          </div>
                        )}

                        {dims.length > 0 && (
                          <div style={{ display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
                            gap: 10, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                            {dims.map(([nombre, d]) => {
                              const pct = d.max ? Math.round((d.score / d.max) * 100) : 0;
                              return (
                                <div key={nombre} title={nombre}>
                                  <div style={{ display: "flex", justifyContent: "space-between",
                                    fontSize: 11, color: C.muted, marginBottom: 4 }}>
                                    <span>{dimCorta(nombre)}</span>
                                    <span style={{ fontFamily: FONT_MONO, color: C.ink2 }}>{d.score}/{d.max}</span>
                                  </div>
                                  <div style={{ height: 5, background: C.bg2, borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{ width: `${pct}%`, height: "100%",
                                      background: pct >= 80 ? C.blueDark : pct >= 60 ? C.blue : "#B96A1E" }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div style={{ marginTop: 12, fontSize: 12.5, color: C.muted }}>
                          Ruta que le recomendó su evaluación:{" "}
                          <span style={{ color: C.ink2 }}>{meta?.ruta ?? x.lead?.route ?? "—"}</span>
                          {!candidato && (
                            <span style={{ color: "#B96A1E" }}>
                              {" "}· su perfil está arriba del rango de Reconstrucción
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        ) : tab === "cohorte" ? (
          <>
            <div style={{ ...cardStyle, padding: "14px 18px", marginBottom: 18,
              background: C.blueSoft, borderColor: C.blue, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>🪜</span>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: C.ink2 }}>
                Quienes ya aceptaron tu invitación y están en el Programa de Reconstrucción.
                Cada quien avanza a su propio ritmo — su evaluación de inicio es su línea base;
                la comparo contra su medición más reciente para ver qué se movió.
              </p>
            </div>

            <Section title={`${cohorte.length} en el programa`}>
              {cohorte.length === 0 ? (
                <Empty msg="Todavía nadie aceptó su invitación." theme={T} />
              ) : (
                <div style={{ display: "grid", gap: 16 }}>
                  {cohorte.map((p) => {
                    const estado = ESTADO_INSCRIPCION[p.inscripcion.status] ?? ESTADO_INSCRIPCION.evaluado;
                    const totalPasos = p.pasos.length || p.inscripcion.current_step;
                    const dimsInicio = p.inicio?.dimensions ?? {};
                    const dimsUltima = p.ultima?.dimensions ?? {};
                    const hayComparacion = !!p.inicio && !!p.ultima && p.inicio.id !== p.ultima.id;
                    const nombresDim = Array.from(new Set([
                      ...Object.keys(dimsInicio),
                      ...(hayComparacion ? Object.keys(dimsUltima) : []),
                    ]));
                    const reflexiones = p.pasos.filter((x) => x.avance?.reflection);

                    return (
                      <div key={p.inscripcion.id} style={{ ...cardStyle, padding: 18 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 12,
                          alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ minWidth: 190, flex: "1 1 220px" }}>
                            <div style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.ink, lineHeight: 1.25 }}>
                              {p.nombre}
                            </div>
                            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3, wordBreak: "break-word" }}>
                              {p.email || "—"}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            <Chip label={estado.label} bg={estado.bg} fg={estado.fg} />
                            <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ink2 }}>
                              Paso {p.inscripcion.current_step} de {totalPasos}
                            </span>
                          </div>
                        </div>

                        {p.pasos.length > 0 && (
                          <div style={{ display: "flex", gap: 4, marginTop: 16 }}>
                            {p.pasos.map(({ paso, avance }) => (
                              <div key={paso.step_number} title={`${paso.step_number}. ${paso.title}`}
                                style={{ flex: 1, height: 7, borderRadius: 4,
                                  background: COLOR_PASO[avance?.status ?? "bloqueado"] ?? COLOR_PASO.bloqueado }} />
                            ))}
                          </div>
                        )}

                        {nombresDim.length > 0 ? (
                          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10,
                              textTransform: "uppercase", letterSpacing: ".03em" }}>
                              {hayComparacion
                                ? `Movimiento por dimensión · inicio (${fmtFecha(p.inicio?.taken_at)}) → última medición (${fmtFecha(p.ultima?.taken_at)})`
                                : `Línea base · ${fmtFecha((p.inicio ?? p.ultima)?.taken_at)} — todavía no hay una segunda medición para comparar`}
                            </div>
                            <div style={{ display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                              {nombresDim.map((nombre) => {
                                const antes = dimsInicio[nombre];
                                const despues = hayComparacion ? dimsUltima[nombre] : undefined;
                                const max = antes?.max ?? despues?.max ?? 1;
                                const pctAntes = antes ? Math.round((antes.score / max) * 100) : 0;
                                const pctDespues = despues ? Math.round((despues.score / max) * 100) : null;
                                const delta = antes && despues ? despues.score - antes.score : null;
                                return (
                                  <div key={nombre} title={nombre}>
                                    <div style={{ display: "flex", justifyContent: "space-between",
                                      fontSize: 11, color: C.muted, marginBottom: 4 }}>
                                      <span>{dimCorta(nombre)}</span>
                                      <span style={{ fontFamily: FONT_MONO, color: C.ink2 }}>
                                        {antes ? antes.score : "—"}{despues != null ? ` → ${despues.score}` : ""}
                                        {delta != null && (
                                          <span style={{ marginLeft: 4,
                                            color: delta > 0 ? "#4B9A62" : delta < 0 ? C.red : C.muted }}>
                                            ({delta > 0 ? "+" : ""}{delta})
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <div style={{ height: 5, background: C.bg2, borderRadius: 3,
                                      overflow: "hidden", position: "relative" }}>
                                      <div style={{ width: `${pctAntes}%`, height: "100%", background: C.border }} />
                                      {pctDespues != null && (
                                        <div style={{ width: `${pctDespues}%`, height: "100%", position: "absolute",
                                          top: 0, left: 0, opacity: 0.85,
                                          background: (delta ?? 0) >= 0 ? C.blueDark : "#B96A1E" }} />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted }}>
                            Sin desglose por dimensión todavía.
                          </div>
                        )}

                        {reflexiones.length > 0 && (
                          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10,
                              textTransform: "uppercase", letterSpacing: ".03em" }}>
                              Reflexiones
                            </div>
                            <div style={{ display: "grid", gap: 10 }}>
                              {reflexiones.map(({ paso, avance }) => (
                                <div key={paso.step_number} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
                                  <div style={{ fontSize: 11.5, color: C.blueDark, fontWeight: 600, marginBottom: 4 }}>
                                    Paso {paso.step_number} · {paso.title}
                                    {avance?.completed_at && (
                                      <span style={{ color: C.muted, fontWeight: 400 }}> · {fmtFecha(avance.completed_at)}</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55,
                                    maxHeight: 140, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                                    {avance?.reflection}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ marginTop: 14, fontSize: 12.5, color: C.muted }}>
                          {p.sesiones.length
                            ? `${p.sesiones.length} sesión${p.sesiones.length === 1 ? "" : "es"} registrada${p.sesiones.length === 1 ? "" : "s"} · `
                              + p.sesiones.map((s) => fmtFecha(s.session_date)).join(", ")
                            : "Sin sesiones registradas todavía."}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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

      {invitar && (() => {
        const x = evaluados.find((e) => e.ev.id === invitar.id);
        if (!x) return null;
        const texto = mensajeInvitacion(x, linkInvitacion);
        const correo = x.lead?.email ?? "";
        const tel = (x.lead?.phone ?? "").replace(/\D/g, "");
        const yaInvitado = x.inscripcion?.status === "invitado";
        return (
          <Modal title={`Invitar a ${x.lead?.name ?? "esta persona"}`} onClose={() => setInvitar(null)} theme={T} wide>
            <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6, color: C.ink2 }}>
              La plataforma <strong>no manda este mensaje</strong>. Cópialo y mándalo tú por
              el medio que uses con esa persona; al hacerlo, marca la invitación aquí para
              llevar el registro.
            </p>

            <Field label="Mensaje" theme={T}>
              <textarea
                readOnly
                value={texto}
                rows={11}
                style={{ ...inputStyle, fontSize: 14, lineHeight: 1.6, resize: "vertical" }}
              />
            </Field>

            {linkInvitacion && (
              <div style={{ background: "#0A1820", borderRadius: 8, padding: "11px 15px", margin: "0 0 14px" }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: ".18em",
                  textTransform: "uppercase", color: "#FFAE5E", marginBottom: 4 }}>
                  Su acceso personal
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: "#fff", wordBreak: "break-all" }}>
                  {linkInvitacion}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", marginTop: 5 }}>
                  Es de una sola persona y se desactiva cuando la usa. Ya va incluido en el mensaje.
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
              <button
                onClick={() => { navigator.clipboard?.writeText(texto); flash("Mensaje copiado."); }}
                style={{ background: C.blue, color: "#fff", border: "none", borderRadius: 10,
                  padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                Copiar mensaje
              </button>
              {correo && (
                <a
                  href={`mailto:${correo}?subject=${encodeURIComponent("Programa Personal de Reconstrucción Mental")}&body=${encodeURIComponent(texto)}`}
                  style={{ background: C.white, color: C.blueDark, border: `1px solid ${C.blue}`,
                    borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 600,
                    textDecoration: "none", display: "inline-block" }}
                >
                  Abrir en correo
                </a>
              )}
              {tel.length >= 10 && (
                <a
                  href={`https://wa.me/${tel.length === 10 ? "52" + tel : tel}?text=${encodeURIComponent(texto)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: C.white, color: C.blueDark, border: `1px solid ${C.blue}`,
                    borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 600,
                    textDecoration: "none", display: "inline-block" }}
                >
                  Abrir en WhatsApp
                </a>
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <button
                onClick={async () => { await marcarInvitado(x.ev, yaInvitado); setInvitar(null); }}
                disabled={invitando === x.ev.id}
                style={{ background: yaInvitado ? "transparent" : C.steel,
                  color: yaInvitado ? C.muted : "#fff",
                  border: yaInvitado ? `1px solid ${C.border}` : "none",
                  borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 600,
                  cursor: invitando === x.ev.id ? "default" : "pointer", fontFamily: "inherit" }}
              >
                {invitando === x.ev.id
                  ? "Guardando…"
                  : yaInvitado
                    ? "Regresar a evaluado"
                    : "Ya la mandé, marcar como invitada"}
              </button>
            </div>
          </Modal>
        );
      })()}

      <Toast msg={toast} theme={T} />
    </div>
  );
}
