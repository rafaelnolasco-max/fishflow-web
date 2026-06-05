"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, CANE_CLIENT_ID } from "@/lib/supabase";
import type { CANEAppointment } from "@/lib/supabase";

// ─── Paleta CANE ──────────────────────────────────────────────────────────────
const C = {
  bg:       "#F7F9FC",
  white:    "#FFFFFF",
  teal:     "#2A9D8F",
  tealDark: "#1E7268",
  tealLight:"#E0F4F2",
  text:     "#1A1A2E",
  muted:    "#6B7280",
  border:   "#E5E7EB",
  red:      "#EF4444",
  green:    "#10B981",
  yellow:   "#F59E0B",
  blue:     "#3B82F6",
  gray:     "#9CA3AF",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es-MX", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function fmtTime(t: string) { return t.slice(0, 5); }

const STATUS_LABEL: Record<string, string> = {
  pending:     "Pendiente",
  confirmed:   "Confirmada",
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

// ─── Formulario vacío ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  patient_name:     "",
  patient_phone:    "",
  doctor_name:      "",
  appointment_date: "",
  appointment_time: "",
  notes:            "",
};

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CANEAppointmentsPage() {
  const router = useRouter();
  const [appointments, setAppointments] = useState<CANEAppointment[]>([]);
  const [loading, setLoading]           = useState(true);
  const [calling, setCalling]           = useState<string | null>(null);
  const [showForm, setShowForm]         = useState(false);
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/cane");
    });
  }, [router]);

  // ── Fetch citas ─────────────────────────────────────────────────────────────
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

  useEffect(() => { fetchAppointments(); }, []);

  // ── Disparar llamada ────────────────────────────────────────────────────────
  async function callAppointment(id: string) {
    setCalling(id);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/trigger-appointment-call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: id }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al llamar");
      await fetchAppointments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCalling(null);
    }
  }

  // ── Guardar cita nueva ──────────────────────────────────────────────────────
  async function saveAppointment() {
    if (!form.patient_name || !form.patient_phone || !form.appointment_date || !form.appointment_time) {
      setError("Completa los campos obligatorios: nombre, teléfono, fecha y hora.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("appointments").insert({
      client_id:        CANE_CLIENT_ID,
      patient_name:     form.patient_name.trim(),
      patient_phone:    form.patient_phone.trim(),
      doctor_name:      form.doctor_name.trim() || null,
      appointment_date: form.appointment_date,
      appointment_time: form.appointment_time,
      notes:            form.notes.trim() || null,
    });
    if (error) {
      setError(error.message);
    } else {
      setForm(EMPTY_FORM);
      setShowForm(false);
      await fetchAppointments();
    }
    setSaving(false);
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/cane");
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <header style={{
        backgroundColor: C.white,
        borderBottom: `1px solid ${C.border}`,
        padding: "0 24px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: C.teal,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 13,
          }}>CN</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>CANE Neurofeedback</div>
            <div style={{ fontSize: 11, color: C.muted }}>Confirmación de Citas</div>
          </div>
        </div>
        <button onClick={logout} style={{
          fontSize: 12, color: C.muted, background: "none", border: "none",
          cursor: "pointer", padding: "4px 8px", borderRadius: 4,
        }}>Salir</button>
      </header>

      {/* Main */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>

        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
            Citas {appointments.length > 0 && (
              <span style={{ fontSize: 13, fontWeight: 400, color: C.muted, marginLeft: 8 }}>
                {appointments.length} registrada{appointments.length !== 1 ? "s" : ""}
              </span>
            )}
          </h1>
          <button
            onClick={() => { setShowForm(!showForm); setError(null); }}
            style={{
              backgroundColor: C.teal, color: "#fff",
              border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showForm ? "Cancelar" : "+ Nueva cita"}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            backgroundColor: "#FEF2F2", border: `1px solid #FCA5A5`,
            borderRadius: 8, padding: "10px 14px",
            color: C.red, fontSize: 13, marginBottom: 16,
          }}>{error}</div>
        )}

        {/* Formulario nueva cita */}
        {showForm && (
          <div style={{
            backgroundColor: C.white, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 20, marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 16px" }}>Nueva cita</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "Nombre del paciente *", key: "patient_name", type: "text", placeholder: "Nombre completo" },
                { label: "Teléfono *", key: "patient_phone", type: "tel", placeholder: "+521XXXXXXXXXX" },
                { label: "Doctor / Terapeuta", key: "doctor_name", type: "text", placeholder: "Karla Ruiz" },
                { label: "", key: "", type: "", placeholder: "" }, // spacer
                { label: "Fecha *", key: "appointment_date", type: "date", placeholder: "" },
                { label: "Hora *", key: "appointment_time", type: "time", placeholder: "" },
              ].map(({ label, key, type, placeholder }) =>
                key ? (
                  <div key={key}>
                    <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>{label}</label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={form[key as keyof typeof form]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      style={{
                        width: "100%", padding: "8px 10px",
                        border: `1px solid ${C.border}`, borderRadius: 6,
                        fontSize: 13, color: C.text, boxSizing: "border-box",
                        outline: "none",
                      }}
                    />
                  </div>
                ) : <div key="spacer" />
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }}>Notas</label>
                <textarea
                  placeholder="Observaciones opcionales..."
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    fontSize: 13, color: C.text, resize: "vertical",
                    boxSizing: "border-box", outline: "none",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                onClick={saveAppointment}
                disabled={saving}
                style={{
                  backgroundColor: saving ? C.gray : C.teal,
                  color: "#fff", border: "none", borderRadius: 8,
                  padding: "9px 20px", fontSize: 13, fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Guardando..." : "Guardar cita"}
              </button>
            </div>
          </div>
        )}

        {/* Tabla de citas */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Cargando citas...</div>
        ) : appointments.length === 0 ? (
          <div style={{
            backgroundColor: C.white, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 48, textAlign: "center",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>Sin citas registradas</div>
            <div style={{ fontSize: 13, color: C.muted }}>Agrega la primera cita con el botón de arriba.</div>
          </div>
        ) : (
          <div style={{
            backgroundColor: C.white, border: `1px solid ${C.border}`,
            borderRadius: 12, overflow: "hidden",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#F9FAFB" }}>
                  {["Paciente", "Fecha", "Hora", "Doctor", "Estado", "Acción"].map(h => (
                    <th key={h} style={{
                      padding: "10px 16px", textAlign: "left",
                      fontSize: 11, fontWeight: 600, color: C.muted,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      borderBottom: `1px solid ${C.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appointments.map((appt, i) => (
                  <tr key={appt.id} style={{
                    borderBottom: i < appointments.length - 1 ? `1px solid ${C.border}` : "none",
                    backgroundColor: calling === appt.id ? C.tealLight : "transparent",
                    transition: "background-color 0.2s",
                  }}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{appt.patient_name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{appt.patient_phone}</div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: C.text }}>
                      {fmtDate(appt.appointment_date)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: C.text }}>
                      {fmtTime(appt.appointment_time)}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: C.muted }}>
                      {appt.doctor_name ?? "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        display: "inline-block",
                        backgroundColor: `${STATUS_COLOR[appt.status]}20`,
                        color: STATUS_COLOR[appt.status],
                        borderRadius: 20, padding: "3px 10px",
                        fontSize: 12, fontWeight: 600,
                      }}>
                        {STATUS_LABEL[appt.status] ?? appt.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <button
                        onClick={() => callAppointment(appt.id)}
                        disabled={calling === appt.id || appt.status === "confirmed"}
                        title={appt.status === "confirmed" ? "Cita ya confirmada" : "Llamar al paciente"}
                        style={{
                          backgroundColor:
                            appt.status === "confirmed" ? C.border
                            : calling === appt.id ? C.tealLight
                            : C.teal,
                          color:
                            appt.status === "confirmed" ? C.muted
                            : calling === appt.id ? C.teal
                            : "#fff",
                          border: "none", borderRadius: 6,
                          padding: "6px 14px", fontSize: 12, fontWeight: 600,
                          cursor: appt.status === "confirmed" || calling === appt.id
                            ? "not-allowed" : "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {calling === appt.id ? "📞 Llamando..." : "📞 Llamar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
