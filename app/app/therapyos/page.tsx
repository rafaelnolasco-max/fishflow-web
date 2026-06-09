"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, MARIO_CLIENT_ID } from "@/lib/supabase";
import type {
  TherapyPatient,
  TherapySession,
  EmotionalState,
  SessionTopic,
  Commitment,
  Pattern,
  SessionConnection,
} from "@/lib/supabase";
import SessionRecorder from "@/components/SessionRecorder";
import type { RecorderResult } from "@/components/SessionRecorder";

// ─── Paleta TherapyOS ──────────────────────────────────────────────────────────
const C = {
  sage:        "#7A9E7E",
  sageDark:    "#4A6B4E",
  sageLight:   "#A8C5AC",
  cream:       "#F5F0E8",
  warmWhite:   "#FAFAF7",
  charcoal:    "#2C2C2C",
  muted:       "#7A7A72",
  accent:      "#C4956A",
  alert:       "#D4726A",
  border:      "#E0DDD5",
  purple:      "#9B8EC4",
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

function gcalLink(patient: TherapyPatient, sessionNum: number) {
  if (!patient.next_session_at) return null;
  const dt = new Date(patient.next_session_at);
  const end = new Date(dt.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0];
  return (
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(`Sesión #${sessionNum} · ${patient.full_name} · TherapyOS`)}` +
    `&dates=${fmt(dt)}/${fmt(end)}` +
    `&details=${encodeURIComponent(`Sesión terapéutica con Mario Citalán`)}`
  );
}

type TabId = "briefing" | "current" | "prev" | "connection" | "payment";

// ─── Componentes pequeños ──────────────────────────────────────────────────────
function TopicCard({ topic }: { topic: SessionTopic }) {
  const borderColor =
    topic.tipo === "principal" ? C.sage :
    topic.tipo === "clinico"   ? C.alert :
    topic.tipo === "laboral"   ? C.accent :
    topic.tipo === "insight"   ? C.accent :
    topic.tipo === "familiar"  ? C.purple : C.sage;
  const labelColor =
    topic.tipo === "principal" ? C.sageDark :
    topic.tipo === "clinico"   ? C.alert :
    topic.tipo === "laboral"   ? C.accent :
    topic.tipo === "insight"   ? C.accent :
    topic.tipo === "familiar"  ? C.purple : C.sageDark;
  return (
    <div style={{
      display: "flex", gap: 12, padding: "12px 14px",
      background: C.cream, borderRadius: 8,
      borderLeft: `3px solid ${borderColor}`, marginBottom: 8,
    }}>
      <div>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em",
          color: labelColor, fontWeight: 500, marginBottom: 4 }}>
          {topic.tipo}
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: C.charcoal, marginBottom: 4 }}>
          {topic.label}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: C.charcoal }}>
          {topic.descripcion}
        </p>
      </div>
    </div>
  );
}

function EmotionGrid({ state }: { state: EmotionalState }) {
  const items = [
    { emoji: "🕊️", label: "Sobriedad",    value: state.sobriedad },
    { emoji: "🌱", label: "Madurez emoc.", value: state.madurez_emocional },
    { emoji: "⚡",  label: "Ansiedad",     value: state.ansiedad },
    { emoji: "🔥",  label: "Energía vital",value: state.energia_vital },
  ];
  const color = (v: string) =>
    v === "Estable" || v === "Alta" || v === "Baja" ? C.sageDark :
    v === "En riesgo" || v === "Alta" /* ansiedad */ ? C.alert :
    C.accent;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} style={{
          padding: "10px 14px", borderRadius: 8, background: C.cream,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>{item.emoji}</span>
          <div>
            <span style={{ fontSize: 11, color: C.muted, display: "block" }}>{item.label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: color(item.value) }}>{item.value}</span>
          </div>
        </div>
      ))}
      {state.notas_emocionales && (
        <div style={{ gridColumn: "1 / -1", padding: "10px 14px", borderRadius: 8,
          background: `rgba(122,158,126,0.08)`, border: `1px solid rgba(122,158,126,0.2)`,
          fontSize: 12, color: C.charcoal, lineHeight: 1.6 }}>
          {state.notas_emocionales}
        </div>
      )}
    </div>
  );
}

function CommitmentList({ items }: { items: Commitment[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((c, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.5,
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            border: `2px solid ${C.sage}`,
            background: c.completado ? C.sage : "transparent",
            flexShrink: 0, marginTop: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {c.completado && <span style={{ color: "white", fontSize: 10 }}>✓</span>}
          </div>
          <div>
            <p>{c.texto}</p>
            <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase",
              color: C.muted, display: "block", marginTop: 2 }}>
              {c.quien === "paciente" ? "Paciente" : "Terapeuta"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PatternList({ items }: { items: Pattern[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((p, i) => (
        <div key={i} style={{
          padding: "12px 14px", borderRadius: 8,
          background: p.es_nuevo ? `rgba(196,149,106,0.06)` : C.cream,
          borderLeft: `2px solid ${p.es_nuevo ? C.accent : C.sageLight}`,
          fontSize: 13, lineHeight: 1.5,
        }}>
          <span style={{ marginRight: 8 }}>{p.emoji}</span>
          {p.es_nuevo && (
            <span style={{
              fontSize: 9, background: C.sage, color: "white",
              padding: "2px 6px", borderRadius: 20, marginRight: 6,
              fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase",
            }}>Nuevo</span>
          )}
          {p.descripcion}
        </div>
      ))}
    </div>
  );
}

// ─── Vista de sesión individual ────────────────────────────────────────────────
function SessionView({ session, label }: { session: TherapySession; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, letterSpacing: ".08em",
        textTransform: "uppercase", marginBottom: 16,
        display: "flex", alignItems: "center", gap: 8 }}>
        {label}
        <span style={{ flex: 1, height: 1, background: C.border }} />
      </div>

      {/* Session title */}
      {session.session_title && (
        <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 17,
          fontWeight: 400, marginBottom: 16, color: C.charcoal }}>
          "{session.session_title}"
        </h3>
      )}

      {/* Topics */}
      {session.topics && session.topics.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em",
            color: C.muted, marginBottom: 10, fontWeight: 500 }}>Temas clave</p>
          {session.topics.map((t, i) => <TopicCard key={i} topic={t} />)}
        </div>
      )}

      {/* Clinical summary */}
      {session.clinical_summary && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em",
            color: C.muted, marginBottom: 8, fontWeight: 500 }}>Resumen clínico</p>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: C.charcoal }}>{session.clinical_summary}</p>
        </div>
      )}

      {/* Emotional state */}
      {session.emotional_state && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em",
            color: C.muted, marginBottom: 10, fontWeight: 500 }}>Estado emocional</p>
          <EmotionGrid state={session.emotional_state} />
        </div>
      )}

      {/* Commitments */}
      {session.commitments && session.commitments.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em",
            color: C.muted, marginBottom: 10, fontWeight: 500 }}>Compromisos</p>
          <CommitmentList items={session.commitments} />
        </div>
      )}

      {/* Patient summary */}
      {session.patient_summary && (
        <div style={{ marginBottom: 20 }}>
          <div style={{
            background: "linear-gradient(135deg, #F5F0E8 0%, #EDE8DC 100%)",
            border: `1px solid #DDD8CC`, borderRadius: 12, padding: 22,
          }}>
            <p style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
              color: C.accent, fontWeight: 500, marginBottom: 10 }}>
              Nota para el paciente
            </p>
            <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 14,
              lineHeight: 1.75, color: C.charcoal, fontStyle: "italic" }}>
              {session.patient_summary}
            </p>
          </div>
        </div>
      )}

      {/* Private notes */}
      {session.private_notes && (
        <div style={{
          background: `rgba(212,114,106,0.04)`,
          border: `1px solid rgba(212,114,106,0.2)`,
          borderRadius: 10, padding: "14px 16px",
        }}>
          <p style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase",
            color: C.alert, fontWeight: 500, marginBottom: 8 }}>
            🔒 Nota privada
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: C.charcoal }}>{session.private_notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Nueva sesión: modal overlay ───────────────────────────────────────────────
function NewSessionModal({
  patients,
  defaultPatientId,
  onClose,
  onSaved,
  isMobile = false,
}: {
  patients: TherapyPatient[];
  defaultPatientId: string | null;
  onClose: () => void;
  onSaved: (session: TherapySession) => void;
  isMobile?: boolean;
}) {
  const [patientId, setPatientId]   = useState(defaultPatientId ?? "");
  const [transcript, setTranscript] = useState("");
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split("T")[0]);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview]       = useState<TherapySession | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"manual" | "fireflies" | "recorder">("manual");
  const [firefliesInput, setFirefliesInput] = useState("");

  async function handleProcess() {
    if (!patientId) { setError("Selecciona un paciente."); return; }
    if (importMode === "manual" && !transcript.trim()) { setError("Ingresa la transcripción."); return; }
    if (importMode === "fireflies" && !firefliesInput.trim()) { setError("Ingresa el ID o URL de Fireflies."); return; }
    setError(null);
    setProcessing(true);
    try {
      const endpoint = importMode === "fireflies"
        ? "/api/therapyos/import-transcript"
        : "/api/therapyos/process-session";
      const body = importMode === "fireflies"
        ? { patient_id: patientId, meeting_id_or_url: firefliesInput, session_date: sessionDate }
        : { patient_id: patientId, transcript, session_date: sessionDate };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error al procesar");
      }
      const data = await res.json();
      setPreview(data.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setProcessing(false);
    }
  }

  async function handleRecorded(r: RecorderResult) {
    if (!patientId) { setError("Selecciona un paciente antes de grabar."); return; }
    setError(null);
    setProcessing(true);
    try {
      const res = await fetch("/api/therapyos/record-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          storage_path: r.storagePath,
          filename: r.filename,
          session_date: sessionDate,
          duration_seconds: r.durationSeconds,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? "Error al procesar la grabación");
      }
      const data = await res.json();
      setPreview(data.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setProcessing(false);
    }
  }

  function handleSave() {
    if (!preview) return;
    // La API route ya guardó la sesión en Supabase — solo notificamos al parent
    onSaved(preview);
    onClose();
  }

  const selectedPatient = patients.find(p => p.id === patientId);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(44,44,44,0.6)",
      display: "flex", alignItems: isMobile ? "flex-end" : "center",
      justifyContent: "center",
      zIndex: 100, padding: isMobile ? 0 : 24,
    }}>
      <div style={{
        background: "white", borderRadius: isMobile ? "16px 16px 0 0" : 16,
        width: "100%", maxWidth: 700,
        maxHeight: isMobile ? "92vh" : "90vh", overflow: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isMobile ? "18px 18px 14px" : "22px 28px 18px",
          borderBottom: `1px solid ${C.border}`,
          position: "sticky", top: 0, background: "white", zIndex: 1,
        }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 400 }}>
            Nueva sesión
          </h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 20, cursor: "pointer",
            color: C.muted, lineHeight: 1,
          }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? "18px 18px 28px" : "24px 28px",
          display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Patient selector */}
          <div>
            <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
              color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
              Paciente
            </label>
            <select
              value={patientId}
              onChange={e => setPatientId(e.target.value)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 14,
                background: "white", color: C.charcoal,
              }}
            >
              <option value="">— Selecciona un paciente —</option>
              {patients.filter(p => p.active).map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
              color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
              Fecha de sesión
            </label>
            <input
              type="date"
              value={sessionDate}
              onChange={e => setSessionDate(e.target.value)}
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 14,
                background: "white", color: C.charcoal,
              }}
            />
          </div>

          {/* Modo de importación */}
          <div>
            <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
              color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
              Fuente de transcripción
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["manual", "fireflies", "recorder"] as const).map(mode => (
                <button key={mode} onClick={() => { setImportMode(mode); setPreview(null); }} style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 13,
                  border: `1px solid ${importMode === mode ? C.sage : C.border}`,
                  background: importMode === mode ? `rgba(122,158,126,0.1)` : "white",
                  color: importMode === mode ? C.sageDark : C.muted,
                  cursor: "pointer", fontWeight: importMode === mode ? 500 : 400,
                }}>
                  {mode === "manual" ? "✏️ Pegar texto" : mode === "fireflies" ? "🔥 Importar de Fireflies" : "🎙️ Grabar sesión"}
                </button>
              ))}
            </div>
          </div>

          {importMode === "manual" ? (
            <div>
              <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
                color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
                Transcripción
              </label>
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                placeholder="Pega aquí la transcripción completa de la sesión..."
                rows={10}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 13,
                  lineHeight: 1.6, resize: "vertical", fontFamily: "inherit",
                  color: C.charcoal,
                }}
              />
            </div>
          ) : importMode === "fireflies" ? (
            <div>
              <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
                color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
                ID o URL de la reunión en Fireflies
              </label>
              <input
                type="text"
                value={firefliesInput}
                onChange={e => setFirefliesInput(e.target.value)}
                placeholder="https://app.fireflies.ai/view/... o ID de reunión"
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 8,
                  border: `1px solid ${C.border}`, fontSize: 13,
                  fontFamily: "inherit", color: C.charcoal,
                }}
              />
              <p style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                Copia el link desde Fireflies o solo el ID. La transcripción debe estar lista (3-5 min después de la llamada).
              </p>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em",
                color: C.muted, display: "block", marginBottom: 8, fontWeight: 500 }}>
                Grabar la sesión
              </label>
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 14px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              }}>
                <SessionRecorder
                  clientId={MARIO_CLIENT_ID}
                  module="therapy_session"
                  refId={patientId || null}
                  disabled={!patientId || processing}
                  onUploaded={handleRecorded}
                  accent={C.sage}
                />
                {!patientId && (
                  <p style={{ fontSize: 11, color: C.muted }}>Selecciona un paciente para habilitar la grabación.</p>
                )}
                <p style={{ fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
                  Al detener, el audio se transcribe y la IA genera el borrador. Nada se envía al paciente hasta que tú apruebes.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: C.alert, fontSize: 13, padding: "10px 14px",
              background: `rgba(212,114,106,0.08)`, borderRadius: 8 }}>{error}</p>
          )}

          {/* Preview */}
          {preview && !processing && (
            <div style={{
              border: `1px solid rgba(122,158,126,0.3)`,
              borderRadius: 10, padding: "16px 18px",
              background: `rgba(122,158,126,0.04)`,
            }}>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em",
                color: C.sageDark, fontWeight: 500, marginBottom: 10 }}>
                ✓ Preview generado por IA
              </p>
              {preview.session_title && (
                <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 15,
                  marginBottom: 10, color: C.charcoal }}>"{preview.session_title}"</p>
              )}
              {preview.clinical_summary && (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: C.charcoal }}>
                  {preview.clinical_summary.slice(0, 200)}…
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{
              padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "transparent", fontSize: 13, cursor: "pointer", color: C.charcoal,
            }}>
              Cancelar
            </button>
            {preview ? (
              <button
                onClick={handleSave}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: C.sageDark, color: "white", fontSize: 13,
                  fontWeight: 500, cursor: "pointer",
                }}
              >
                ✓ Ver sesión
              </button>
            ) : importMode === "recorder" ? (
              <span style={{ fontSize: 12, color: C.muted }}>
                {processing ? "Procesando grabación…" : "Graba la sesión para generar el borrador"}
              </span>
            ) : (
              <button
                onClick={handleProcess}
                disabled={processing || !patientId || (importMode === "manual" ? !transcript.trim() : !firefliesInput.trim())}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: processing ? C.muted : C.sage,
                  color: "white", fontSize: 13, fontWeight: 500,
                  cursor: processing ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {processing ? (
                  <>
                    <span style={{ animation: "spin 1s linear infinite",
                      display: "inline-block" }}>⟳</span>
                    Procesando con IA…
                  </>
                ) : "✨ Procesar con IA"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ──────────────────────────────────────────────────────────
export default function TherapyOSPage() {
  const router = useRouter();
  const [patients, setPatients]         = useState<TherapyPatient[]>([]);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [sessions, setSessions]         = useState<TherapySession[]>([]);
  const [activeTab, setActiveTab]       = useState<TabId>("briefing");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]   = useState("");
  const [showNewSession, setShowNewSession] = useState(false);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [toast, setToast]               = useState<string | null>(null);
  const [editingNote, setEditingNote]   = useState(false);
  const [noteValue, setNoteValue]       = useState("");

  // ── Responsive ────────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile]   = useState(false);
  const [isTablet, setIsTablet]   = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const mqMobile = window.matchMedia("(max-width: 767px)");
    const mqTablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const sync = () => {
      setIsMobile(mqMobile.matches);
      setIsTablet(mqTablet.matches);
      if (!mqMobile.matches) setDrawerOpen(false);
    };
    sync();
    mqMobile.addEventListener("change", sync);
    mqTablet.addEventListener("change", sync);
    return () => {
      mqMobile.removeEventListener("change", sync);
      mqTablet.removeEventListener("change", sync);
    };
  }, []);

  // true cuando hay que apilar columnas y reducir paddings
  const stack = isMobile || isTablet;

  // ── Auth + carga de pacientes ────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/therapyos"); return; }
      loadPatients();
    });
  }, [router]);

  async function loadPatients() {
    setLoadingPatients(true);
    const { data, error } = await supabase
      .from("patients")
      .select(`*, sessions(count)`)
      .eq("client_id", MARIO_CLIENT_ID)
      .eq("active", true)
      .order("full_name");

    if (!error && data) {
      const enriched = data.map((p: TherapyPatient & { sessions?: { count: number }[] }) => ({
        ...p,
        session_count: p.sessions?.[0]?.count ?? 0,
      }));
      setPatients(enriched);
      // Auto-seleccionar Rafael Nolasco en la demo
      const rafa = enriched.find((p: TherapyPatient) =>
        p.full_name.toLowerCase().includes("rafael")
      );
      if (rafa && !selectedId) setSelectedId(rafa.id);
    }
    setLoadingPatients(false);
  }

  // ── Cargar sesiones del paciente seleccionado ────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    setActiveTab("briefing");
    setSelectedSessionId(null);
    setLoadingSessions(true);
    supabase
      .from("sessions")
      .select("*")
      .eq("patient_id", selectedId)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (!error && data) setSessions(data as TherapySession[]);
        setLoadingSessions(false);
      });
  }, [selectedId]);

  // ── Toast helper ─────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  // ── Generar link de pago (Mercado Pago) ──────────────────────────────────────
  async function handleGeneratePaymentLink() {
    if (!selectedPatient || !currentSession) return;
    setGeneratingLink(true);
    try {
      const res = await fetch("/api/therapyos/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: currentSession.id,
          patient_name: selectedPatient.full_name,
          amount: selectedPatient.session_fee,
        }),
      });
      const data = await res.json();
      if (data.payment_link) {
        setSessions(prev => prev.map(s =>
          s.id === currentSession.id
            ? { ...s, payment_link: data.payment_link, payment_status: "pending" }
            : s
        ));
        showToast("Link de pago generado ✓");
      }
    } catch {
      showToast("Error al generar el link de pago");
    } finally {
      setGeneratingLink(false);
    }
  }

  // ── Enviar email al paciente ──────────────────────────────────────────────────
  async function handleSendEmail() {
    if (!selectedPatient || !viewedSession) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/therapyos/send-session-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: viewedSession.id,
          patient_id: selectedPatient.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.sent_at) {
        setSessions(prev => prev.map(s =>
          s.id === viewedSession.id
            ? { ...s, payment_status: "sent", approved_at: data.approved_at ?? s.approved_at, sent_at: data.sent_at }
            : s
        ));
        showToast("Resumen enviado a " + selectedPatient.full_name + " ✓");
      } else {
        showToast(data.error ?? "No se pudo enviar el email");
      }
    } catch {
      showToast("Error al enviar el email");
    } finally {
      setSendingEmail(false);
    }
  }

  // ── Guardar nota privada ──────────────────────────────────────────────────────
  async function handleSaveNote() {
    if (!currentSession) return;
    await supabase
      .from("sessions")
      .update({ private_notes: noteValue })
      .eq("id", currentSession.id);
    setSessions(prev => prev.map(s =>
      s.id === currentSession.id ? { ...s, private_notes: noteValue } : s
    ));
    setEditingNote(false);
    showToast("Nota guardada ✓");
  }

  // ── Cuando se guarda una nueva sesión ─────────────────────────────────────────
  function handleSessionSaved(session: TherapySession) {
    setSessions(prev => [session, ...prev]);
    setActiveTab("briefing");
    loadPatients(); // refresca conteo de sesiones
    showToast(`Sesión #${session.session_number} guardada ✓`);
  }

  // ── Datos derivados ───────────────────────────────────────────────────────────
  const selectedPatient = patients.find(p => p.id === selectedId) ?? null;
  const currentSession  = sessions[0] ?? null;
  const prevSession     = sessions[1] ?? null;
  const viewedSession   = sessions.find(s => s.id === selectedSessionId) ?? currentSession;

  const filteredPatients = useMemo(() =>
    patients.filter(p =>
      p.full_name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  [patients, searchQuery]);

  const upcomingToday = useMemo(() =>
    patients
      .filter(p => p.next_session_at)
      .sort((a, b) => new Date(a.next_session_at!).getTime() - new Date(b.next_session_at!).getTime())
      .slice(0, 4),
  [patients]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div style={{
        display: "flex", minHeight: "100vh",
        fontFamily: "'DM Sans', sans-serif",
        background: C.warmWhite, color: C.charcoal,
      }}>

        {/* ─── Overlay del drawer (solo móvil) ──────────────────────────────── */}
        {isMobile && drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed", inset: 0, background: "rgba(44,44,44,0.5)",
              zIndex: 89,
            }}
          />
        )}

        {/* ─── SIDEBAR ──────────────────────────────────────────────────────── */}
        <aside style={{
          width: isMobile ? 280 : 260, background: C.charcoal, padding: "32px 20px",
          flexShrink: 0, display: "flex", flexDirection: "column", gap: 24,
          ...(isMobile
            ? {
                position: "fixed", top: 0, left: 0, height: "100vh",
                zIndex: 90, overflowY: "auto",
                transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform .25s ease",
                boxShadow: drawerOpen ? "4px 0 24px rgba(0,0,0,0.25)" : "none",
              }
            : {
                position: "sticky", top: 0, height: "100vh", overflowY: "auto",
              }),
        }}>
          {/* Logo */}
          <div style={{
            fontFamily: "'Playfair Display', serif", color: C.cream,
            fontSize: 20, letterSpacing: ".02em",
            paddingBottom: 24, borderBottom: "1px solid rgba(255,255,255,.1)",
          }}>
            TherapyOS
            <span style={{
              display: "block", fontSize: 11, fontFamily: "'DM Sans', sans-serif",
              color: C.muted, fontWeight: 300, letterSpacing: ".12em",
              textTransform: "uppercase", marginTop: 4,
            }}>
              Mario Citalán · Psicólogo
            </span>
          </div>

          {/* Búsqueda */}
          <div>
            <input
              placeholder="Buscar paciente…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,.15)",
                background: "rgba(255,255,255,.06)", color: C.cream,
                fontSize: 13, outline: "none",
              }}
            />
          </div>

          {/* Lista de pacientes */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase",
              color: C.muted, marginBottom: 12, fontWeight: 500 }}>
              Pacientes activos
            </p>
            {loadingPatients ? (
              <p style={{ color: C.muted, fontSize: 13 }}>Cargando…</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {filteredPatients.map(p => (
                  <button key={p.id} onClick={() => { setSelectedId(p.id); setDrawerOpen(false); }} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", borderRadius: 8,
                    background: selectedId === p.id
                      ? `rgba(122,158,126,0.2)` : "transparent",
                    border: "none", cursor: "pointer", width: "100%", textAlign: "left",
                    color: selectedId === p.id
                      ? C.sageLight : "rgba(255,255,255,.6)",
                    fontSize: 14, transition: "background .15s",
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: selectedId === p.id ? C.sage : C.sageDark,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 500, color: "white", flexShrink: 0,
                    }}>
                      {initials(p.full_name)}
                    </div>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap" }}>
                      {p.full_name}
                    </span>
                    <span style={{
                      fontSize: 10, background: "rgba(255,255,255,.1)",
                      padding: "2px 6px", borderRadius: 10, color: C.muted, flexShrink: 0,
                    }}>
                      {p.session_count ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Próximas sesiones */}
          {upcomingToday.length > 0 && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)", lineHeight: 1.9 }}>
              <p style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase",
                color: C.muted, marginBottom: 8, fontWeight: 500 }}>
                Próximas sesiones
              </p>
              {upcomingToday.map(p => p.next_session_at && (
                <div key={p.id} style={{ marginBottom: 6 }}>
                  <span style={{ color: "rgba(255,255,255,.8)", fontWeight: 500, display: "block" }}>
                    {new Date(p.next_session_at).toLocaleDateString("es-MX", {
                      weekday: "short", day: "numeric", month: "short"
                    })}
                  </span>
                  <span>
                    {p.full_name.split(" ")[0]} ·{" "}
                    {new Date(p.next_session_at).toLocaleTimeString("es-MX", {
                      hour: "2-digit", minute: "2-digit"
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Botón nueva sesión */}
          <button onClick={() => { setShowNewSession(true); setDrawerOpen(false); }} style={{
            padding: "12px 16px", borderRadius: 10,
            background: C.sage, border: "none",
            color: "white", fontSize: 14, fontWeight: 500,
            cursor: "pointer", letterSpacing: ".02em",
          }}>
            + Nueva sesión
          </button>

          {/* Cerrar sesión */}
          <button
            onClick={async () => { await supabase.auth.signOut(); router.push("/login?next=/app/therapyos"); }}
            style={{
              marginTop: "auto", padding: "8px 12px", borderRadius: 8,
              background: "transparent", border: "1px solid rgba(255,255,255,.12)",
              color: C.muted, fontSize: 12, cursor: "pointer", letterSpacing: ".04em",
            }}>
            ⎋ Cerrar sesión
          </button>
        </aside>

        {/* ─── MAIN ─────────────────────────────────────────────────────────── */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Barra superior móvil con hamburguesa */}
          {isMobile && (
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 16px", background: C.charcoal,
              position: "sticky", top: 0, zIndex: 20,
            }}>
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Abrir menú"
                style={{
                  background: "rgba(255,255,255,.08)", border: "none",
                  color: C.cream, fontSize: 18, lineHeight: 1,
                  width: 38, height: 38, borderRadius: 8, cursor: "pointer",
                  flexShrink: 0,
                }}>
                ☰
              </button>
              <span style={{
                fontFamily: "'Playfair Display', serif", color: C.cream,
                fontSize: 17, letterSpacing: ".02em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {selectedPatient ? selectedPatient.full_name : "TherapyOS"}
              </span>
            </div>
          )}

          {!selectedPatient ? (
            /* Estado vacío */
            <div style={{ flex: 1, display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 16, color: C.muted }}>
              <span style={{ fontSize: 40 }}>🌿</span>
              <p style={{ fontFamily: "'Playfair Display', serif", fontSize: 18,
                color: C.charcoal, fontWeight: 400 }}>
                Selecciona un paciente
              </p>
              <p style={{ fontSize: 14, maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
                O usa el botón "+ Nueva sesión" para procesar una transcripción con IA.
              </p>
            </div>
          ) : (
            <>
              {/* Topbar */}
              <div style={{
                background: "white", borderBottom: `1px solid ${C.border}`,
                padding: isMobile ? "14px 16px" : "20px 36px", display: "flex",
                alignItems: "center", justifyContent: "space-between",
                gap: 12, flexWrap: "wrap",
                position: "sticky", top: isMobile ? 66 : 0, zIndex: 10,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: C.sage, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "white", fontSize: 15, fontWeight: 500,
                  }}>
                    {initials(selectedPatient.full_name)}
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "'Playfair Display', serif",
                      fontSize: 20, fontWeight: 400, margin: 0 }}>
                      {selectedPatient.full_name}
                    </h2>
                    <p style={{ fontSize: 12, color: C.muted, margin: "2px 0 0" }}>
                      {currentSession?.session_number ?? 0} sesiones
                      {selectedPatient.started_at ? ` · Inicio: ${fmtDate(selectedPatient.started_at)}` : ""}
                      {currentSession ? ` · Última: ${fmtDate(currentSession.session_date)}` : ""}
                      {selectedPatient.next_session_at ? ` · Próxima: ${fmtDateTime(selectedPatient.next_session_at)}` : ""}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setShowNewSession(true); }}
                    style={{
                      padding: "8px 18px", borderRadius: 8, fontSize: 13,
                      fontWeight: 500, cursor: "pointer", border: "none",
                      background: C.sage, color: "white",
                    }}>
                    + Nueva sesión
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div style={{
                display: isMobile ? "grid" : "flex",
                gridTemplateColumns: isMobile ? "1fr 1fr" : undefined,
                gap: isMobile ? 8 : 12,
                padding: isMobile ? "14px 16px 0" : "16px 36px 0",
                background: "white", borderBottom: `1px solid ${C.border}`,
              }}>
                {[
                  { num: currentSession?.session_number ?? 0, label: "Sesiones" },
                  { num: currentSession?.commitments?.filter(c => !c.completado).length ?? 0, label: "Compromisos activos" },
                  { num: currentSession?.patterns_detected?.length ?? 0, label: "Patrones" },
                  { num: selectedPatient.session_fee ? `$${selectedPatient.session_fee.toLocaleString("es-MX")}` : "—", label: "Tarifa/sesión" },
                ].map(s => (
                  <div key={s.label} style={{
                    flex: isMobile ? undefined : 1, padding: "12px 16px", background: C.cream,
                    borderRadius: isMobile ? 8 : "8px 8px 0 0", textAlign: "center",
                    marginBottom: isMobile ? 0 : -1,
                  }}>
                    <span style={{ fontFamily: "'Playfair Display', serif",
                      fontSize: 22, color: C.sageDark, display: "block" }}>
                      {s.num}
                    </span>
                    <span style={{ fontSize: 10, color: C.muted,
                      textTransform: "uppercase", letterSpacing: ".08em" }}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div style={{
                display: "flex", borderBottom: `1px solid ${C.border}`,
                background: "white", paddingLeft: isMobile ? 16 : 36,
                overflowX: "auto", WebkitOverflowScrolling: "touch",
              }}>
                {([
                  { id: "briefing",    label: "⚡ Briefing" },
                  { id: "current",     label: `Sesión #${viewedSession?.session_number ?? "—"} · ${viewedSession ? fmtDate(viewedSession.session_date) : "—"}` },
                  { id: "prev",        label: prevSession ? `Sesión #${prevSession.session_number} · ${fmtDate(prevSession.session_date)}` : "Sesión anterior" },
                  { id: "connection",  label: "🔗 Conexión" },
                  { id: "payment",     label: "💳 Pago" },
                ] as { id: TabId; label: string }[]).map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                    padding: "12px 18px", fontSize: 12, cursor: "pointer",
                    border: "none", background: "transparent",
                    color: activeTab === tab.id ? C.sageDark : C.muted,
                    borderBottom: `2px solid ${activeTab === tab.id ? C.sage : "transparent"}`,
                    fontWeight: activeTab === tab.id ? 500 : 400,
                    marginBottom: -1, whiteSpace: "nowrap",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflowY: "auto",
                padding: isMobile ? "20px 16px" : "28px 36px",
                display: "flex", flexDirection: stack ? "column" : "row", gap: 24 }}>

                {loadingSessions ? (
                  <p style={{ color: C.muted }}>Cargando sesiones…</p>
                ) : !currentSession ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 12 }}>
                    <p style={{ fontSize: 15, color: C.muted }}>
                      No hay sesiones registradas para este paciente.
                    </p>
                    <button onClick={() => setShowNewSession(true)} style={{
                      padding: "10px 20px", borderRadius: 8, border: "none",
                      background: C.sage, color: "white", cursor: "pointer", fontSize: 13,
                    }}>
                      + Crear primera sesión
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Columna principal */}
                    <div style={{ flex: 1.4, minWidth: 0 }}>

                      {/* ── Tab: Briefing ─────────────────────────────────────────── */}
                      {activeTab === "briefing" && (
                        <div style={{
                          background: "linear-gradient(135deg, #4A6B4E 0%, #2D4A30 100%)",
                          borderRadius: 12, overflow: "hidden",
                        }}>
                          <div style={{
                            padding: "18px 22px 14px",
                            borderBottom: "1px solid rgba(255,255,255,.12)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                          }}>
                            <h3 style={{ fontFamily: "'Playfair Display', serif",
                              fontSize: 15, fontWeight: 400, color: "white", margin: 0 }}>
                              ⚡ Briefing · Sesión #{(currentSession.session_number ?? 0) + 1}
                            </h3>
                            {selectedPatient.next_session_at && (
                              <span style={{ fontSize: 11, letterSpacing: ".08em",
                                textTransform: "uppercase", color: "rgba(255,255,255,.55)" }}>
                                {fmtDateTime(selectedPatient.next_session_at)}
                              </span>
                            )}
                          </div>
                          <div style={{ padding: "20px 22px" }}>
                            {currentSession.briefing_next ? (
                              currentSession.briefing_next.split("\n").filter(Boolean).map((line, i) => (
                                <div key={i} style={{
                                  display: "flex", gap: 12,
                                  padding: "10px 0",
                                  borderBottom: "1px solid rgba(255,255,255,.08)",
                                }}>
                                  <div style={{
                                    width: 6, height: 6, borderRadius: "50%",
                                    background: C.sageLight, marginTop: 7, flexShrink: 0,
                                  }} />
                                  <p style={{ fontSize: 13, color: "rgba(255,255,255,.82)",
                                    lineHeight: 1.6, margin: 0 }}>
                                    {line.startsWith("**") ? (
                                      <>
                                        <strong style={{ color: "white", fontWeight: 500 }}>
                                          {line.replace(/\*\*(.*?)\*\*/, "$1").split(":")[0]}:
                                        </strong>
                                        {" "}{line.split(":").slice(1).join(":")}
                                      </>
                                    ) : line}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <p style={{ color: "rgba(255,255,255,.5)", fontSize: 13 }}>
                                El briefing se genera automáticamente al procesar la sesión anterior.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Tab: Sesión actual ─────────────────────────────────────── */}
                      {activeTab === "current" && viewedSession && (
                        <>
                          <SessionView
                            session={viewedSession}
                            label={`Sesión #${viewedSession.session_number} · ${fmtDate(viewedSession.session_date)}`}
                          />
                          {/* Aprobar y enviar al paciente — al final del resumen */}
                          <div style={{
                            marginTop: 20, padding: "18px 20px", borderRadius: 12,
                            border: `1px solid ${C.border}`, background: "white",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            gap: 16, flexWrap: "wrap",
                          }}>
                            <div>
                              <p style={{ fontSize: 13, fontWeight: 500, color: C.charcoal, marginBottom: 4 }}>
                                {viewedSession.sent_at ? "Resumen enviado ✓" : "¿Listo para compartir este resumen?"}
                              </p>
                              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                                {viewedSession.sent_at
                                  ? `Enviado el ${new Date(viewedSession.sent_at).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`
                                  : selectedPatient?.email
                                    ? `Se enviará a ${selectedPatient.email} (con copia a raf@fishflow.mx)`
                                    : "El paciente no tiene email — se enviará a raf@fishflow.mx para tu revisión"}
                              </p>
                            </div>
                            <button
                              onClick={handleSendEmail}
                              disabled={sendingEmail || !!viewedSession.sent_at}
                              style={{
                                padding: "10px 22px", borderRadius: 8, border: "none",
                                background: sendingEmail || viewedSession.sent_at ? C.muted : C.sage,
                                color: "white", fontSize: 13, fontWeight: 500,
                                cursor: sendingEmail || viewedSession.sent_at ? "not-allowed" : "pointer",
                                whiteSpace: "nowrap",
                              }}>
                              {sendingEmail ? "Enviando…"
                                : viewedSession.sent_at
                                  ? `✓ Enviado ${new Date(viewedSession.sent_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`
                                  : "📤 Enviar email al paciente"}
                            </button>
                          </div>
                        </>
                      )}

                      {/* ── Tab: Sesión anterior ───────────────────────────────────── */}
                      {activeTab === "prev" && (
                        prevSession ? (
                          <SessionView
                            session={prevSession}
                            label={`Sesión #${prevSession.session_number} · ${fmtDate(prevSession.session_date)}`}
                          />
                        ) : (
                          <p style={{ color: C.muted, fontSize: 13 }}>
                            No hay sesión anterior registrada.
                          </p>
                        )
                      )}

                      {/* ── Tab: Conexión ──────────────────────────────────────────── */}
                      {activeTab === "connection" && currentSession.connections_to_prev && (
                        <div>
                          <div style={{
                            background: `rgba(155,142,196,0.08)`,
                            border: `1px solid rgba(155,142,196,0.25)`,
                            borderRadius: 10, padding: "14px 16px", marginBottom: 20,
                          }}>
                            <p style={{ fontSize: 10, textTransform: "uppercase",
                              letterSpacing: ".1em", color: C.purple, fontWeight: 500,
                              marginBottom: 8 }}>
                              🔗 Hilo conductor
                            </p>
                            <p style={{ fontSize: 13, lineHeight: 1.55, color: C.charcoal, margin: 0 }}>
                              {(currentSession.connections_to_prev as SessionConnection).descripcion}
                            </p>
                          </div>
                          {(currentSession.connections_to_prev as SessionConnection).evolucion && (
                            <div style={{ marginBottom: 20 }}>
                              <p style={{ fontSize: 10, textTransform: "uppercase",
                                letterSpacing: ".12em", color: C.muted,
                                marginBottom: 10, fontWeight: 500 }}>
                                Evolución del proceso
                              </p>
                              <p style={{ fontSize: 13, lineHeight: 1.6, color: C.charcoal }}>
                                {(currentSession.connections_to_prev as SessionConnection).evolucion}
                              </p>
                            </div>
                          )}
                          {currentSession.patterns_detected && (
                            <div>
                              <p style={{ fontSize: 10, textTransform: "uppercase",
                                letterSpacing: ".12em", color: C.muted,
                                marginBottom: 10, fontWeight: 500 }}>
                                Patrones detectados
                              </p>
                              <PatternList items={currentSession.patterns_detected} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Tab: Pago ─────────────────────────────────────────────── */}
                      {activeTab === "payment" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                          {/* Estado del pago */}
                          <div style={{
                            padding: "18px 20px", borderRadius: 12,
                            border: `1px solid ${C.border}`, background: "white",
                          }}>
                            <p style={{ fontSize: 10, textTransform: "uppercase",
                              letterSpacing: ".12em", color: C.muted,
                              marginBottom: 12, fontWeight: 500 }}>
                              Estado del pago — Sesión #{currentSession.session_number}
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{
                                padding: "4px 12px", borderRadius: 20, fontSize: 12,
                                fontWeight: 500,
                                background: currentSession.payment_status === "paid"
                                  ? `rgba(122,158,126,0.15)`
                                  : currentSession.payment_status === "sent"
                                  ? `rgba(196,149,106,0.15)`
                                  : `rgba(122,122,114,0.1)`,
                                color: currentSession.payment_status === "paid"
                                  ? C.sageDark
                                  : currentSession.payment_status === "sent"
                                  ? C.accent
                                  : C.muted,
                              }}>
                                {currentSession.payment_status === "paid" ? "✓ Pagado"
                                  : currentSession.payment_status === "sent" ? "Enviado"
                                  : "Pendiente"}
                              </span>
                              {selectedPatient.session_fee && (
                                <span style={{ fontSize: 20,
                                  fontFamily: "'Playfair Display', serif",
                                  color: C.sageDark }}>
                                  ${selectedPatient.session_fee.toLocaleString("es-MX")} MXN
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Link de MP */}
                          {currentSession.payment_link ? (
                            <div style={{
                              padding: "16px 18px", borderRadius: 10,
                              border: `1px solid rgba(122,158,126,0.3)`,
                              background: `rgba(122,158,126,0.04)`,
                            }}>
                              <p style={{ fontSize: 11, textTransform: "uppercase",
                                letterSpacing: ".1em", color: C.sageDark,
                                fontWeight: 500, marginBottom: 10 }}>
                                Link de pago generado
                              </p>
                              <a href={currentSession.payment_link} target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 12, color: C.sageDark,
                                  wordBreak: "break-all" }}>
                                {currentSession.payment_link}
                              </a>
                            </div>
                          ) : (
                            <button
                              onClick={handleGeneratePaymentLink}
                              disabled={generatingLink || !selectedPatient.session_fee}
                              style={{
                                padding: "12px 20px", borderRadius: 10, border: "none",
                                background: generatingLink ? C.muted : C.accent,
                                color: "white", fontSize: 14, fontWeight: 500,
                                cursor: generatingLink ? "not-allowed" : "pointer",
                                alignSelf: "flex-start",
                              }}>
                              {generatingLink ? "Generando…" : "💳 Generar link de pago (Mercado Pago)"}
                            </button>
                          )}

                          {!selectedPatient.session_fee && (
                            <p style={{ fontSize: 12, color: C.alert }}>
                              Este paciente no tiene tarifa configurada. Actualízala en la base de datos.
                            </p>
                          )}

                          {/* Enviar email */}
                          <div style={{
                            padding: "18px 20px", borderRadius: 12,
                            border: `1px solid ${C.border}`, background: "white",
                          }}>
                            <p style={{ fontSize: 10, textTransform: "uppercase",
                              letterSpacing: ".12em", color: C.muted,
                              marginBottom: 8, fontWeight: 500 }}>
                              Aprobar y enviar resumen al paciente
                            </p>
                            <p style={{ fontSize: 13, color: C.charcoal,
                              lineHeight: 1.5, marginBottom: 16 }}>
                              {selectedPatient.email ?? "Sin email registrado"}
                            </p>
                            <button
                              onClick={handleSendEmail}
                              disabled={sendingEmail || !!currentSession.sent_at}
                              style={{
                                padding: "10px 20px", borderRadius: 8, border: "none",
                                background: sendingEmail || currentSession.sent_at ? C.muted : C.sage,
                                color: "white", fontSize: 13, fontWeight: 500,
                                cursor: sendingEmail || currentSession.sent_at
                                  ? "not-allowed" : "pointer",
                              }}>
                              {sendingEmail ? "Enviando…"
                                : currentSession.sent_at
                                  ? `✓ Enviado ${new Date(currentSession.sent_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`
                                  : "📤 Aprobar y enviar resumen"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Columna derecha */}
                    <div style={{ width: stack ? "100%" : 300, flexShrink: 0,
                      display: "flex", flexDirection: "column", gap: 16 }}>

                      {/* Próxima cita */}
                      {selectedPatient.next_session_at && (
                        <div style={{
                          padding: "14px 16px",
                          background: `rgba(122,158,126,0.08)`,
                          border: `1px solid rgba(122,158,126,0.2)`,
                          borderRadius: 10,
                        }}>
                          <p style={{ fontSize: 10, textTransform: "uppercase",
                            letterSpacing: ".1em", color: C.sageDark,
                            fontWeight: 500, marginBottom: 6 }}>
                            Próxima sesión
                          </p>
                          <p style={{ fontSize: 15, fontWeight: 500, color: C.charcoal, margin: 0 }}>
                            {fmtDateTime(selectedPatient.next_session_at)}
                          </p>
                          <a
                            href={gcalLink(selectedPatient,
                              (currentSession?.session_number ?? 0) + 1) ?? "#"}
                            target="_blank" rel="noopener noreferrer"
                            style={{
                              display: "inline-block", marginTop: 10,
                              fontSize: 12, color: C.sageDark,
                              textDecoration: "none", fontWeight: 500,
                            }}>
                            📅 Agregar a Google Calendar →
                          </a>
                        </div>
                      )}

                      {/* Nota privada editable */}
                      <div style={{
                        background: `rgba(212,114,106,0.04)`,
                        border: `1px solid rgba(212,114,106,0.2)`,
                        borderRadius: 10, padding: "14px 16px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", marginBottom: 8 }}>
                          <p style={{ fontSize: 10, letterSpacing: ".12em",
                            textTransform: "uppercase", color: C.alert,
                            fontWeight: 500, margin: 0 }}>
                            🔒 Nota privada
                          </p>
                          <button
                            onClick={() => {
                              if (!editingNote) {
                                setNoteValue(currentSession?.private_notes ?? "");
                                setEditingNote(true);
                              } else {
                                handleSaveNote();
                              }
                            }}
                            style={{ fontSize: 11, color: C.accent, background: "none",
                              border: "none", cursor: "pointer", fontWeight: 500 }}>
                            {editingNote ? "Guardar" : "Editar"}
                          </button>
                        </div>
                        {editingNote ? (
                          <textarea
                            value={noteValue}
                            onChange={e => setNoteValue(e.target.value)}
                            rows={5}
                            style={{
                              width: "100%", border: `1px solid ${C.border}`,
                              borderRadius: 6, padding: "8px 10px", fontSize: 12,
                              lineHeight: 1.6, resize: "vertical", fontFamily: "inherit",
                            }}
                          />
                        ) : (
                          <p style={{ fontSize: 13, lineHeight: 1.6, color: C.charcoal, margin: 0 }}>
                            {currentSession?.private_notes ?? "Sin notas privadas."}
                          </p>
                        )}
                      </div>

                      {/* Resumen del proceso — sesiones timeline */}
                      {sessions.length > 1 && (
                        <div style={{
                          background: "white", border: `1px solid ${C.border}`,
                          borderRadius: 12, overflow: "hidden",
                        }}>
                          <div style={{ padding: "16px 18px 12px",
                            borderBottom: `1px solid ${C.border}` }}>
                            <h3 style={{ fontFamily: "'Playfair Display', serif",
                              fontSize: 14, fontWeight: 400, margin: 0 }}>
                              Historial
                            </h3>
                          </div>
                          <div style={{ padding: "16px 18px" }}>
                            {sessions.slice(0, 6).map((s, i) => (
                              <div key={s.id}
                                onClick={() => { setSelectedSessionId(s.id); setActiveTab("current"); }}
                                title="Abrir esta sesión"
                                style={{
                                display: "flex", gap: 12,
                                paddingBottom: 14, paddingTop: 4,
                                position: "relative", cursor: "pointer",
                                borderRadius: 8, marginLeft: -6, paddingLeft: 6,
                                background: s.id === viewedSession?.id ? "rgba(122,158,126,0.10)" : "transparent",
                              }}>
                                {i < sessions.length - 1 && (
                                  <div style={{
                                    position: "absolute", left: 4, top: 14,
                                    bottom: 0, width: 1, background: C.border,
                                  }} />
                                )}
                                <div style={{
                                  width: 10, height: 10, borderRadius: "50%",
                                  background: s.id === viewedSession?.id ? C.sage : C.border,
                                  marginTop: 4, flexShrink: 0,
                                }} />
                                <div>
                                  <p style={{ fontSize: 10, color: C.muted,
                                    letterSpacing: ".08em", textTransform: "uppercase",
                                    margin: "0 0 3px" }}>
                                    #{s.session_number} · {fmtDate(s.session_date)}
                                  </p>
                                  <p style={{ fontSize: 12, lineHeight: 1.5,
                                    color: C.charcoal, margin: 0 }}>
                                    {s.session_title ?? "Sin título"}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Modal nueva sesión */}
      {showNewSession && (
        <NewSessionModal
          patients={patients}
          defaultPatientId={selectedId}
          onClose={() => setShowNewSession(false)}
          onSaved={handleSessionSaved}
          isMobile={isMobile}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: C.charcoal, color: "white",
          padding: "12px 20px", borderRadius: 10,
          fontSize: 13, fontWeight: 500, zIndex: 200,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          animation: "fadeIn .2s ease",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
