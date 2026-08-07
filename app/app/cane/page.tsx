"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, CANE_CLIENT_ID } from "@/lib/supabase";
import type { CANEAppointment, CANECallLog } from "@/lib/supabase";
import {
  DashboardHeader, Chip, TabBar,
  Section as DSection, Field as DField,
  inputStyle as mkInput, cardStyle as mkCard,
  type DashTheme,
} from "@/components/dashboard";
import ReviewsTab, { normalizePhone } from "./ReviewsTab";
import ContentTab from "./ContentTab";

// ─── Paleta CANE ──────────────────────────────────────────────────────────────
const C = {
  bg:        "#F7F9FC",
  white:     "#FFFFFF",
  teal:      "#2A9D8F",
  tealLight: "#E0F4F2",
  text:      "#1A1A2E",
  muted:     "#6B7280",
  border:    "#E5E7EB",
  red:       "#EF4444",
  green:     "#10B981",
  yellow:    "#F59E0B",
  blue:      "#3B82F6",
  gray:      "#9CA3AF",
  rowHover:  "#F0FDF9",
} as const;

// ─── Tema para componentes compartidos + wrappers locales ────────────────────
const T: DashTheme = {
  accent: C.teal, accentDark: C.teal, accentSoft: C.tealLight,
  bg: C.bg, surface: C.white, text: C.text,
  muted: C.muted, border: C.border, danger: C.red, disabled: C.gray,
};

const inputStyle = mkInput(T);
const cardStyle = mkCard(T);

const Section = (p: Omit<React.ComponentProps<typeof DSection>, "theme">) => <DSection theme={T} {...p} />;
const Field   = (p: Omit<React.ComponentProps<typeof DField>,   "theme">) => <DField   theme={T} {...p} />;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es-MX", {
    weekday: "short", day: "numeric", month: "short",
  });
}
function fmtTime(t: string) { return t.slice(0, 5); }
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  pending:     "Pendiente",
  confirmed:   "Confirmada ✓",
  cancelled:   "Cancelada",
  rescheduled: "Reagendar",
  no_response: "Sin respuesta",
};
const STATUS_COLOR: Record<string, string> = {
  pending:     C.yellow,
  confirmed:   C.green,
  cancelled:   C.red,
  rescheduled: C.blue,
  no_response: C.gray,
};

const OUTCOME_LABEL: Record<string, string> = {
  confirmed:   "✓ Confirmó",
  cancelled:   "✗ Canceló",
  rescheduled: "↻ Reagendar",
  no_response: "Sin respuesta",
  error:       "Error",
};
const OUTCOME_COLOR: Record<string, string> = {
  confirmed:   C.green,
  cancelled:   C.red,
  rescheduled: C.blue,
  no_response: C.gray,
  error:       C.red,
};

const EMPTY_FORM = {
  patient_name: "", patient_phone: "", doctor_name: "",
  appointment_date: "", appointment_time: "", notes: "",
  date_day: "", date_month: "", date_year: "",
};

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2].map(String);

// ─── Hook: detectar viewport móvil ─────────────────────────────────────────────
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

// ─── Módulo de Citas: OCULTO ──────────────────────────────────────────────────
// Fue un piloto (confirmación de citas por voz IA). Karlita hoy solo usa Reseñas.
// El código se conserva completo: poner esta bandera en true lo devuelve tal cual,
// con su pestaña, su alta de citas y el botón ⭐ que manda un paciente a la cola.
const SHOW_CITAS: boolean = false;

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CANEAppointmentsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [appointments, setAppointments] = useState<CANEAppointment[]>([]);
  const [callLogs, setCallLogs]         = useState<Record<string, CANECallLog[]>>({});
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [calling, setCalling]           = useState<string | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [tab, setTab]                   = useState<"citas" | "resenas" | "contenido">(SHOW_CITAS ? "citas" : "resenas");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/cane");
    });
  }, [router]);

  async function fetchAppointments() {
    setLoading(true);
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("client_id", CANE_CLIENT_ID)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });
    if (error) console.error(error);
    else setAppointments(data ?? []);
    setLoading(false);
  }

  // Con el módulo oculto no vale la pena pegarle a Supabase por citas que nadie ve.
  useEffect(() => { if (SHOW_CITAS) fetchAppointments(); }, []);

  // ── Expandir fila y cargar historial de llamadas ────────────────────────────
  async function toggleExpand(apptId: string) {
    if (expanded === apptId) { setExpanded(null); return; }
    setExpanded(apptId);
    if (callLogs[apptId]) return; // ya cargado
    const { data } = await supabase
      .from("call_logs")
      .select("*")
      .eq("appointment_id", apptId)
      .order("called_at", { ascending: false });
    setCallLogs(prev => ({ ...prev, [apptId]: data ?? [] }));
  }

  // ── Disparar llamada ────────────────────────────────────────────────────────
  async function callAppointment(id: string) {
    setCalling(id);
    setError(null);
    try {
      const res = await fetch("/api/cane/trigger-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al llamar");
      // Refrescar logs si el panel está abierto
      setCallLogs(prev => { const copy = { ...prev }; delete copy[id]; return copy; });
      await fetchAppointments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCalling(null);
    }
  }

  // ── Guardar cita nueva ──────────────────────────────────────────────────────
  async function saveAppointment() {
    const missing: string[] = []
    if (!form.patient_name.trim())   missing.push("nombre")
    if (!form.patient_phone.trim())  missing.push("teléfono")
    if (!form.appointment_date)      missing.push("fecha")
    if (!form.appointment_time)      missing.push("hora")
    if (missing.length > 0) {
      setError(`Falta: ${missing.join(", ")}`)
      return
    }
    setSaving(true); setError(null);
    // Normalizar teléfono a E.164 — agregar +52 si solo son 10 dígitos
    const rawPhone = form.patient_phone.trim().replace(/\D/g, "")
    const normalizedPhone = rawPhone.startsWith("52")
      ? `+${rawPhone}`
      : `+52${rawPhone}`

    const { error } = await supabase.from("appointments").insert({
      client_id:        CANE_CLIENT_ID,
      patient_name:     form.patient_name.trim(),
      patient_phone:    normalizedPhone,
      doctor_name:      form.doctor_name.trim() || null,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      notes:            form.notes.trim() || null,
    });
    if (error) { setError(error.message); }
    else { setForm(EMPTY_FORM); setShowForm(false); await fetchAppointments(); }
    setSaving(false);
  }

  // ── Mandar paciente a la cola de reseñas ────────────────────────────────────
  async function requestReview(appt: CANEAppointment) {
    const { error } = await supabase.from("review_requests").insert({
      client_id:      CANE_CLIENT_ID,
      contact_name:   appt.patient_name,
      contact_phone:  normalizePhone(appt.patient_phone),
      source:         "appointment",
      appointment_id: appt.id,
    });
    if (error) {
      setError(error.code === "23505"
        ? `${appt.patient_name} ya está en la cola de reseñas`
        : error.message);
      return;
    }
    setError(null);
    setTab("resenas");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/cane");
  }

  // ── Botón Llamar (reutilizado en tabla y tarjetas) ──────────────────────────
  function CallButton({ appt, block = false }: { appt: CANEAppointment; block?: boolean }) {
    const isConfirmed = appt.status === "confirmed";
    const isCalling = calling === appt.id;
    return (
      <button
        onClick={() => callAppointment(appt.id)}
        disabled={isCalling || isConfirmed}
        title={isConfirmed ? "Cita ya confirmada" : "Llamar al paciente"}
        style={{
          backgroundColor: isConfirmed ? C.border : isCalling ? C.tealLight : C.teal,
          color: isConfirmed ? C.muted : isCalling ? C.teal : "#fff",
          border: "none", borderRadius: 6,
          padding: block ? "10px 14px" : "6px 14px",
          fontSize: block ? 13 : 12, fontWeight: 600,
          width: block ? "100%" : "auto",
          cursor: isConfirmed || isCalling ? "not-allowed" : "pointer",
          transition: "all 0.2s",
        }}
      >
        {isCalling ? "📞 Llamando..." : "📞 Llamar"}
      </button>
    );
  }

  // ── Panel de historial de llamadas (reutilizado) ────────────────────────────
  function LogsPanel({ apptId }: { apptId: string }) {
    const logs = callLogs[apptId] ?? [];
    return (
      <>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, marginTop: 8 }}>
          Historial de llamadas
        </div>
        {logs.length === 0 ? (
          <div style={{ fontSize: 13, color: C.muted, fontStyle: "italic" }}>
            Sin llamadas registradas aún.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {logs.map(log => (
              <div key={log.id} style={{
                backgroundColor: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "10px 14px",
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Chip
                    label={OUTCOME_LABEL[log.outcome ?? 'no_response'] ?? (log.outcome as string)}
                    bg={`${OUTCOME_COLOR[log.outcome ?? 'no_response'] ?? C.gray}20`}
                    fg={OUTCOME_COLOR[log.outcome ?? 'no_response'] ?? C.gray}
                  />
                  <span style={{ fontSize: 12, color: C.muted }}>
                    {fmtDateTime(log.called_at)}
                  </span>
                  {log.duration_seconds && (
                    <span style={{ fontSize: 12, color: C.muted }}>
                      · {log.duration_seconds}s
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: C.gray, marginLeft: "auto" }}>
                    via {log.provider}
                  </span>
                </div>
                {(log as CANECallLog & { transcript?: string }).transcript && (
                  <div style={{
                    fontSize: 12, color: C.muted,
                    backgroundColor: "#F9FAFB",
                    borderRadius: 6, padding: "6px 10px",
                    marginTop: 4, lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    maxHeight: 120, overflow: "auto",
                  }}>
                    {(log as CANECallLog & { transcript?: string }).transcript}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <DashboardHeader
        icon={<span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>CN</span>}
        title="CANE Neurofeedback"
        subtitle={SHOW_CITAS ? "Confirmación de Citas" : "Reseñas y Contenido"}
        theme={T}
        onLogout={logout}
      />

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>

        <TabBar
          theme={T}
          tabs={[
            ...(SHOW_CITAS ? [{ id: "citas" as const, label: "Citas", icon: "📅" }] : []),
            { id: "resenas" as const,    label: "Reseñas",   icon: "⭐" },
            { id: "contenido" as const,  label: "Contenido", icon: "✨" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "resenas" && <ReviewsTab />}

        {tab === "contenido" && <ContentTab />}

        {SHOW_CITAS && tab === "citas" && (
        <Section
          title={<>
            Citas
            {appointments.length > 0 && (
              <span style={{ fontSize: 13, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                {appointments.length} registrada{appointments.length !== 1 ? "s" : ""}
              </span>
            )}
          </>}
          action={{ label: showForm ? "Cancelar" : "+ Nueva cita", onClick: () => { setShowForm(!showForm); setError(null); } }}
        >

        {error && (
          <div style={{
            backgroundColor: "#FEF2F2", border: `1px solid #FCA5A5`,
            borderRadius: 8, padding: "10px 14px",
            color: C.red, fontSize: 13, marginBottom: 16,
          }}>{error}</div>
        )}

        {/* Formulario nueva cita */}
        {showForm && (
          <div style={{ ...cardStyle, padding: 20, marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Nueva cita</h2>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              {[
                { label: "Nombre del paciente *",   key: "patient_name",  type: "text", placeholder: "Nombre completo" },
                { label: "Teléfono * (10 dígitos)", key: "patient_phone", type: "tel",  placeholder: "5514831644" },
                { label: "Doctor / Terapeuta",       key: "doctor_name",   type: "text", placeholder: "Karla Ruiz" },
              ].map(({ label, key, type, placeholder }) => (
                <Field key={key} label={label}>
                  <input
                    type={type} placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ ...inputStyle, boxSizing: "border-box", outline: "none" }}
                  />
                </Field>
              ))}
              {/* Fecha — 3 selects para compatibilidad Safari */}
              <Field label="Fecha *">
                <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr 2fr", gap: 6 }}>
                  {[
                    { placeholder: "Día",  key: "date_day",   options: Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0")) },
                    { placeholder: "Mes",  key: "date_month", options: MONTHS.map((m,i)=>({ value: String(i+1).padStart(2,"0"), label: m })) },
                    { placeholder: "Año",  key: "date_year",  options: YEARS },
                  ].map(({ placeholder, key, options }) => (
                    <select key={key}
                      value={form[key as keyof typeof form]}
                      onChange={e => {
                        const newForm = { ...form, [key]: e.target.value }
                        // Recalcular appointment_date cuando cambien día/mes/año
                        const d = key === "date_day"   ? e.target.value : newForm.date_day
                        const m = key === "date_month" ? e.target.value : newForm.date_month
                        const y = key === "date_year"  ? e.target.value : newForm.date_year
                        const dateStr = d && m && y ? `${y}-${m}-${d}` : ""
                        setForm({ ...newForm, appointment_date: dateStr })
                      }}
                      style={{
                        ...inputStyle, padding: "8px 6px", fontSize: 12,
                        color: form[key as keyof typeof form] ? C.text : C.muted,
                        outline: "none",
                      }}
                    >
                      <option value="">{placeholder}</option>
                      {options.map(o =>
                        typeof o === "string"
                          ? <option key={o} value={o}>{o}</option>
                          : <option key={o.value} value={o.value}>{o.label}</option>
                      )}
                    </select>
                  ))}
                </div>
              </Field>
              {/* Hora — select para compatibilidad Safari */}
              <Field label="Hora *">
                <select
                  value={form.appointment_time}
                  onChange={e => setForm(f => ({ ...f, appointment_time: e.target.value }))}
                  style={{
                    ...inputStyle, boxSizing: "border-box", outline: "none",
                    color: form.appointment_time ? C.text : C.muted,
                  }}
                >
                  <option value="">Selecciona hora</option>
                  {["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30",
                    "12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30",
                    "16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00"
                  ].map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Notas">
                  <textarea
                    placeholder="Observaciones opcionales..." value={form.notes} rows={2}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    style={{ ...inputStyle, resize: "vertical", boxSizing: "border-box", outline: "none" }}
                  />
                </Field>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={saveAppointment} disabled={saving} style={{
                backgroundColor: saving ? C.gray : C.teal, color: "#fff",
                border: "none", borderRadius: 8, padding: "9px 20px",
                fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "Guardando..." : "Guardar cita"}
              </button>
            </div>
          </div>
        )}

        {/* Tabla */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Cargando citas...</div>
        ) : appointments.length === 0 ? (
          <div style={{ ...cardStyle, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Sin citas registradas</div>
            <div style={{ fontSize: 13, color: C.muted }}>Agrega la primera cita con el botón de arriba.</div>
          </div>
        ) : isMobile ? (
          /* ─── Vista móvil: tarjetas apiladas ─────────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {appointments.map(appt => {
              const isExpanded = expanded === appt.id;
              return (
                <div key={appt.id} style={{
                  ...cardStyle, padding: 0, overflow: "hidden",
                  borderColor: calling === appt.id ? C.teal : C.border,
                }}>
                  <div style={{ padding: 14 }}>
                    {/* Encabezado: paciente + estado */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{appt.patient_name}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>{appt.patient_phone}</div>
                      </div>
                      <Chip
                        label={STATUS_LABEL[appt.status] ?? appt.status}
                        bg={`${STATUS_COLOR[appt.status]}20`}
                        fg={STATUS_COLOR[appt.status]}
                      />
                    </div>
                    {/* Fecha · hora · doctor */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 13, color: C.text, marginBottom: 12 }}>
                      <span>📅 {fmtDate(appt.appointment_date)}</span>
                      <span>🕐 {fmtTime(appt.appointment_time)}</span>
                      {appt.doctor_name && <span style={{ color: C.muted }}>👤 {appt.doctor_name}</span>}
                    </div>
                    {/* Botón llamar full width */}
                    <CallButton appt={appt} block />
                    <button
                      onClick={() => requestReview(appt)}
                      style={{
                        width: "100%", marginTop: 8, background: "none",
                        border: `1px solid ${C.border}`, borderRadius: 6,
                        padding: "9px", fontSize: 12.5, fontWeight: 600,
                        color: C.text, cursor: "pointer",
                      }}
                    >⭐ Pedir reseña</button>
                    {/* Toggle historial */}
                    <button onClick={() => toggleExpand(appt.id)} style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: C.muted, fontSize: 12, fontWeight: 600,
                      padding: "10px 0 0", display: "flex", alignItems: "center", gap: 6,
                    }}>
                      {isExpanded ? "▼" : "▶"} Historial de llamadas
                    </button>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: "0 14px 14px", backgroundColor: "#FAFBFC", borderTop: `1px solid ${C.border}` }}>
                      <LogsPanel apptId={appt.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#F9FAFB" }}>
                  {["", "Paciente", "Fecha", "Hora", "Doctor", "Estado", "Acción"].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 14px", textAlign: "left",
                      fontSize: 11, fontWeight: 600, color: C.muted,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      borderBottom: `1px solid ${C.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appointments.map((appt, i) => {
                  const isExpanded = expanded === appt.id;
                  const isLast = i === appointments.length - 1;

                  return (
                    <>
                      <tr key={appt.id} style={{
                        borderBottom: (!isExpanded && !isLast) ? `1px solid ${C.border}` : "none",
                        backgroundColor: calling === appt.id ? C.tealLight : "transparent",
                        transition: "background-color 0.2s",
                      }}>
                        {/* Toggle */}
                        <td style={{ padding: "12px 8px 12px 14px", width: 24 }}>
                          <button onClick={() => toggleExpand(appt.id)} style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: C.muted, fontSize: 12, padding: 0, lineHeight: 1,
                          }}>
                            {isExpanded ? "▼" : "▶"}
                          </button>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{appt.patient_name}</div>
                          <div style={{ fontSize: 12, color: C.muted }}>{appt.patient_phone}</div>
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 13, color: C.text }}>
                          {fmtDate(appt.appointment_date)}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 13, color: C.text }}>
                          {fmtTime(appt.appointment_time)}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: 13, color: C.muted }}>
                          {appt.doctor_name ?? "—"}
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <Chip
                            label={STATUS_LABEL[appt.status] ?? appt.status}
                            bg={`${STATUS_COLOR[appt.status]}20`}
                            fg={STATUS_COLOR[appt.status]}
                          />
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <CallButton appt={appt} />
                            <button
                              onClick={() => requestReview(appt)}
                              title="Pedir reseña a este paciente"
                              style={{
                                background: "none", border: `1px solid ${C.border}`,
                                borderRadius: 6, padding: "5px 9px", fontSize: 13, cursor: "pointer",
                              }}
                            >⭐</button>
                          </div>
                        </td>
                      </tr>

                      {/* Panel historial de llamadas */}
                      {isExpanded && (
                        <tr key={`${appt.id}-logs`}>
                          <td colSpan={7} style={{
                            padding: "0 14px 16px 40px",
                            borderBottom: !isLast ? `1px solid ${C.border}` : "none",
                            backgroundColor: "#FAFBFC",
                          }}>
                            <LogsPanel apptId={appt.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </Section>
        )}
      </main>
    </div>
  );
}
