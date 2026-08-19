"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AudioRecorder from "@/components/AudioRecorder";
import AudioUpload from "@/components/AudioUpload";
import {
  DashboardHeader, TabBar, StatGrid, StatCard as DStatCard, Section, Empty as DEmpty,
  Modal, Toast, Field as DField, SaveBtn as DSaveBtn, Chip, type DashTheme,
} from "@/components/dashboard";

// ─── Therapy Flow — la app del paciente ───────────────────────────────────────
// "Que tu terapia fluya". El expediente es del paciente: no hay paso de
// aprobación ni terapeuta en el circuito. Por eso la lectura técnica se muestra
// (colapsada, con encuadre) en vez de esconderse, y por eso el audio se borra
// solo salvo que la persona pida conservarlo.

const T: DashTheme = {
  accent: "#FF8C35", accentDark: "#F26B17", accentSoft: "rgba(255,140,53,.14)",
  bg: "#0D1B2A", surface: "#14283E", panel: "#102036",
  text: "#F1F5F9", muted: "#7E93A8", border: "#24405E",
  danger: "#F87171", disabled: "#41586F",
};
const CYAN = "#67D4E8";

const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Empty    = (p: Omit<React.ComponentProps<typeof DEmpty>,    "theme">) => <DEmpty    theme={T} {...p} />;
const Field    = (p: Omit<React.ComponentProps<typeof DField>,    "theme">) => <DField    theme={T} {...p} />;
const SaveBtn  = (p: Omit<React.ComponentProps<typeof DSaveBtn>,  "theme">) => <DSaveBtn  theme={T} {...p} />;

type Tab = "sesiones" | "proceso" | "compromisos" | "cuenta";

type Commitment = { texto: string; quien?: string; completado?: boolean };
type Pattern = { emoji?: string; es_nuevo?: boolean; descripcion: string };
type Topic = { label: string; tipo?: string; descripcion?: string };
type RiskFlag = { tipo: string; evidencia?: string };
type Emotional = {
  animo?: string; ansiedad?: string; energia_vital?: string; apertura?: string;
  notas_emocionales?: string;
};

type Session = {
  id: string;
  session_number: number;
  session_date: string;
  session_title: string | null;
  patient_summary: string | null;
  clinical_read: string | null;
  session_prep: string | null;
  emotional_state: Emotional | null;
  commitments: Commitment[] | null;
  patterns_detected: Pattern[] | null;
  topics: Topic[] | null;
  risk_flags: RiskFlag[] | null;
  mood_after: number | null;
};

type Config = {
  client_id: string;
  onboarded: boolean;
  consent_at: string | null;
  show_clinical: boolean;
  keep_audio: boolean;
  audio_retention_days: number;
  monthly_session_cap: number;
  max_minutes_session: number;
  sessions_used_month: number;
  month_anchor: string;
};

const RIESGO_ETIQUETA: Record<string, string> = {
  ideacion_suicida: "Ideas de muerte",
  autolesion: "Autolesión",
  violencia_recibida: "Violencia que recibes",
  violencia_ejercida: "Violencia que ejerces",
  consumo_riesgo: "Consumo de riesgo",
};

const NIVEL: Record<string, number> = { Alta: 3, Alto: 3, Media: 2, Medio: 2, Moderada: 2, Baja: 1, Bajo: 1 };

function fechaLarga(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export default function TherapyFlowApp() {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tab, setTab] = useState<Tab>("sesiones");
  const [open, setOpen] = useState<Session | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3500); };

  // ── Alta / carga ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/terapia/registro"); return; }
      const res = await fetch("/api/terapia/provision", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { router.push("/terapia/registro"); return; }
      const { client_id, patient_id } = await res.json();
      setClientId(client_id);
      setPatientId(patient_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = useCallback(async () => {
    if (!clientId || !patientId) return;
    const [{ data: cfg }, { data: sess }] = await Promise.all([
      supabase.from("therapy_self_config").select("*").eq("client_id", clientId).single(),
      supabase.from("sessions").select(
        "id, session_number, session_date, session_title, patient_summary, clinical_read, session_prep, emotional_state, commitments, patterns_detected, topics, risk_flags, mood_after",
      ).eq("patient_id", patientId).order("session_date", { ascending: false }),
    ]);
    setConfig((cfg as Config) ?? null);
    setSessions((sess as Session[]) ?? []);
    setLoading(false);
  }, [clientId, patientId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Acciones ───────────────────────────────────────────────────────────────
  async function saveConfig(patch: Partial<Config>) {
    if (!clientId) return;
    const { error } = await supabase.from("therapy_self_config").update(patch).eq("client_id", clientId);
    if (error) { say("No se pudo guardar"); console.error(error); return; }
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  async function procesarSesion(storagePath: string, durationSeconds: number | null) {
    const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10); // CDMX
    const res = await fetch("/api/terapia/upload-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: patientId,
        storage_path: storagePath,
        session_date: hoy,
        duration_seconds: durationSeconds ?? undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "No se pudo procesar la sesión.");
    await loadAll();
    say("Listo, tus notas ya están aquí");
  }

  async function toggleCommitment(s: Session, idx: number) {
    const list = [...(s.commitments ?? [])];
    list[idx] = { ...list[idx], completado: !list[idx].completado };
    const { error } = await supabase.from("sessions").update({ commitments: list }).eq("id", s.id);
    if (error) { say("No se pudo guardar"); console.error(error); return; }
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, commitments: list } : x)));
    if (open?.id === s.id) setOpen({ ...s, commitments: list });
  }

  async function exportarTodo() {
    const { data } = await supabase.from("sessions").select("*").eq("patient_id", patientId)
      .order("session_date", { ascending: true });
    const blob = new Blob([JSON.stringify(data ?? [], null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mi-proceso-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const usadas = config && config.month_anchor === new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 8) + "01"
    ? config.sessions_used_month : 0;
  const restantes = config ? Math.max(0, config.monthly_session_cap - usadas) : 0;

  const compromisosAbiertos = useMemo(
    () => sessions.flatMap((s) => (s.commitments ?? []).map((c, i) => ({ s, c, i }))).filter((x) => !x.c.completado),
    [sessions],
  );

  // ── Estados de carga y onboarding ──────────────────────────────────────────
  if (loading || !config) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.muted, display: "grid",
        placeItems: "center", fontFamily: "Inter, sans-serif" }}>
        Cargando tu proceso…
      </div>
    );
  }

  if (!config.onboarded) {
    return <Onboarding onDone={async (patch) => { await saveConfig({ ...patch, onboarded: true }); }} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: T.bg }}>
        <DashboardHeader
          theme={T}
          icon={<img src="/icons/icon-therapyflow-192.png" alt="" style={{ width: 34, height: 34, borderRadius: 9 }} />}
          title="Therapy Flow"
          subtitle="Que tu terapia fluya"
          onLogout={async () => { await supabase.auth.signOut(); router.push("/terapia/registro"); }}
        />
        <TabBar<Tab>
          theme={T}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "sesiones", label: "Sesiones" },
            { id: "proceso", label: "Mi proceso" },
            { id: "compromisos", label: "Compromisos" },
            { id: "cuenta", label: "Cuenta" },
          ]}
        />
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "18px 16px 60px" }}>
        {tab === "sesiones" && (
          <>
            <div style={{ marginBottom: 18 }}>
              <AudioRecorder
                clientId={clientId}
                patientId={patientId}
                maxMinutes={config.max_minutes_session}
                disabled={restantes === 0}
                disabledReason={`Ya usaste tus ${config.monthly_session_cap} sesiones de este mes. El contador se reinicia el día 1.`}
                onUploaded={({ storagePath, durationSeconds }) => procesarSesion(storagePath, durationSeconds)}
                theme={{ accent: T.accent, surface: T.surface, border: T.border, text: T.text, muted: T.muted, danger: T.danger, panel: T.panel }}
              />
              <div style={{ marginTop: 12 }}>
                <AudioUpload
                  clientId={clientId}
                  patientId={patientId}
                  maxMinutes={config.max_minutes_session}
                  disabled={restantes === 0}
                  onUploaded={({ storagePath, durationSeconds }) => procesarSesion(storagePath, durationSeconds)}
                  theme={{ accent: T.accent, surface: T.surface, border: T.border, text: T.text, muted: T.muted, danger: T.danger }}
                />
              </div>
            </div>

            <StatGrid>
              <StatCard label="Sesiones guardadas" value={sessions.length} />
              <StatCard label="Este mes" value={`${usadas} de ${config.monthly_session_cap}`} accent={CYAN} />
              <StatCard label="Compromisos abiertos" value={compromisosAbiertos.length} accent={T.accent} />
            </StatGrid>

            <Section theme={T} title="Tus sesiones">
              {sessions.length === 0 ? (
                <Empty msg="Todavía no hay ninguna. Sube el audio de tu próxima sesión y aquí aparecerá." />
              ) : (
                sessions.map((s) => (
                  <button key={s.id} onClick={() => setOpen(s)}
                    style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
                      padding: "14px 16px", marginBottom: 10, color: T.text, fontFamily: "inherit" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 15 }}>{s.session_title ?? `Sesión ${s.session_number}`}</strong>
                      <span style={{ fontSize: 12, color: T.muted, whiteSpace: "nowrap" }}>{fechaLarga(s.session_date)}</span>
                    </div>
                    {s.patient_summary && (
                      <p style={{ fontSize: 13.5, color: T.muted, margin: "8px 0 0", lineHeight: 1.5,
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {s.patient_summary}
                      </p>
                    )}
                    {(s.risk_flags?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <Chip label="Sesión delicada" bg="rgba(248,113,113,.16)" fg={T.danger} />
                      </div>
                    )}
                  </button>
                ))
              )}
            </Section>
          </>
        )}

        {tab === "proceso" && <Proceso sessions={sessions} />}

        {tab === "compromisos" && (
          <Section theme={T} title="Lo que te llevaste de cada sesión">
            {compromisosAbiertos.length === 0 && sessions.length > 0 && (
              <Empty msg="No tienes compromisos abiertos." />
            )}
            {sessions.length === 0 && <Empty msg="Aún no hay sesiones." />}
            {sessions.map((s) =>
              (s.commitments ?? []).map((c, i) => (
                <label key={`${s.id}-${i}`}
                  style={{ display: "flex", gap: 12, alignItems: "flex-start", background: T.surface,
                    border: `1px solid ${T.border}`, borderRadius: 12, padding: "13px 15px",
                    marginBottom: 9, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!c.completado} onChange={() => toggleCommitment(s, i)}
                    style={{ marginTop: 3, width: 17, height: 17, accentColor: T.accent }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, lineHeight: 1.5,
                      textDecoration: c.completado ? "line-through" : "none",
                      color: c.completado ? T.muted : T.text }}>
                      {c.texto}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: T.muted, marginTop: 5 }}>
                      {fechaLarga(s.session_date)}
                    </span>
                  </span>
                </label>
              )),
            )}
          </Section>
        )}

        {tab === "cuenta" && (
          <>
            <Section theme={T} title="Tu audio">
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={config.keep_audio}
                    onChange={(e) => saveConfig({ keep_audio: e.target.checked })}
                    style={{ marginTop: 3, width: 17, height: 17, accentColor: T.accent }} />
                  <span style={{ fontSize: 14, lineHeight: 1.55 }}>
                    Conservar el audio de mis sesiones
                    <span style={{ display: "block", fontSize: 12.5, color: T.muted, marginTop: 5 }}>
                      Apagado, el audio se borra en cuanto termina de transcribirse y solo se queda el texto.
                      Encendido, se guarda {config.audio_retention_days} días y luego se borra solo.
                    </span>
                  </span>
                </label>
              </div>
            </Section>

            <Section theme={T} title="Cómo se ve tu sesión">
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
                <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={config.show_clinical}
                    onChange={(e) => saveConfig({ show_clinical: e.target.checked })}
                    style={{ marginTop: 3, width: 17, height: 17, accentColor: T.accent }} />
                  <span style={{ fontSize: 14, lineHeight: 1.55 }}>
                    Mostrar la lectura técnica
                    <span style={{ display: "block", fontSize: 12.5, color: T.muted, marginTop: 5 }}>
                      Es la lectura de patrones de cada sesión. Viene colapsada y la abres cuando quieras.
                      Si prefieres quedarte solo con el resumen, apágala.
                    </span>
                  </span>
                </label>
              </div>
            </Section>

            <Section theme={T} title="Tus datos">
              <button onClick={exportarTodo}
                style={{ width: "100%", padding: "13px 0", borderRadius: 11, cursor: "pointer",
                  border: `1px solid ${T.border}`, background: T.surface, color: T.text,
                  fontSize: 14, fontWeight: 700, fontFamily: "inherit", marginBottom: 10 }}>
                Descargar todo mi proceso
              </button>
              <BorrarCuenta busy={busy} setBusy={setBusy} onDone={async () => {
                await supabase.auth.signOut();
                router.push("/terapia/registro");
              }} />
            </Section>

            <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.65, marginTop: 22 }}>
              Therapy Flow no es un servicio de salud, no da diagnósticos y no sustituye a un profesional.
              Lo que lees aquí es una lectura automatizada de tu propia sesión.
              {config.consent_at && ` Aceptaste grabar tus sesiones el ${fechaLarga(config.consent_at.slice(0, 10))}.`}
            </p>
          </>
        )}
      </div>

      {open && (
        <Modal title={open.session_title ?? `Sesión ${open.session_number}`} theme={T} onClose={() => setOpen(null)} wide>
          <DetalleSesion s={open} showClinical={config.show_clinical} onToggle={(i) => toggleCommitment(open, i)} />
        </Modal>
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );
}

// ─── Detalle de una sesión ────────────────────────────────────────────────────
function DetalleSesion({ s, showClinical, onToggle }: {
  s: Session; showClinical: boolean; onToggle: (idx: number) => void;
}) {
  const [verClinica, setVerClinica] = useState(false);
  const riesgo = s.risk_flags ?? [];

  return (
    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
      <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px" }}>{fechaLarga(s.session_date)}</p>

      {riesgo.length > 0 && (
        <div style={{ background: "rgba(248,113,113,.10)", border: "1px solid rgba(248,113,113,.35)",
          borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <strong style={{ display: "block", marginBottom: 8, color: "#FCA5A5" }}>
            En esta sesión salió algo que no conviene dejar pasar
          </strong>
          <p style={{ margin: "0 0 10px", color: T.text }}>
            Aparecieron temas de {riesgo.map((r) => (RIESGO_ETIQUETA[r.tipo] ?? r.tipo).toLowerCase()).join(", ")}.
            Llévalo a tu próxima sesión y dilo en voz alta: es exactamente el lugar para eso.
            Si ahora mismo la estás pasando mal, no te quedes solo con esto — habla con tu terapeuta,
            con alguien de confianza o con una línea de apoyo.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: T.muted }}>
            En México, la Línea de la Vida atiende las 24 horas al 800 911 2000.
          </p>
        </div>
      )}

      {s.patient_summary && <p style={{ marginTop: 0 }}>{s.patient_summary}</p>}

      {(s.topics?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "16px 0" }}>
          {s.topics!.map((t, i) => (
            <Chip key={i} label={t.label} bg="rgba(103,212,232,.14)" fg={CYAN} />
          ))}
        </div>
      )}

      {showClinical && s.clinical_read && (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, marginTop: 18, overflow: "hidden" }}>
          <button onClick={() => setVerClinica((v) => !v)}
            style={{ width: "100%", textAlign: "left", padding: "13px 15px", cursor: "pointer",
              background: T.panel, border: "none", color: T.text, fontSize: 14, fontWeight: 700,
              fontFamily: "inherit", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Lectura técnica de la sesión</span>
            <span style={{ color: T.muted, fontWeight: 400 }}>{verClinica ? "Ocultar" : "Ver"}</span>
          </button>
          {verClinica && (
            <div style={{ padding: "0 15px 15px" }}>
              <p style={{ fontSize: 12.5, color: T.muted, margin: "12px 0 14px", lineHeight: 1.55 }}>
                Esto es una lectura automatizada de patrones, no un diagnóstico ni la opinión de tu terapeuta.
                Sirve para llevar preguntas a tu sesión, no para sacar conclusiones sobre ti.
              </p>
              <p style={{ margin: 0 }}>{s.clinical_read}</p>
            </div>
          )}
        </div>
      )}

      {(s.patterns_detected?.length ?? 0) > 0 && (
        <div style={{ marginTop: 20 }}>
          <strong style={{ display: "block", marginBottom: 10, fontSize: 13, color: T.muted }}>Patrones</strong>
          {s.patterns_detected!.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 9 }}>
              <span aria-hidden style={{ fontSize: 16 }}>{p.emoji ?? "•"}</span>
              <span style={{ flex: 1 }}>
                {p.descripcion}
                {p.es_nuevo && <span style={{ color: T.accent, fontSize: 11.5, marginLeft: 7 }}>nuevo</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {(s.commitments?.length ?? 0) > 0 && (
        <div style={{ marginTop: 20 }}>
          <strong style={{ display: "block", marginBottom: 10, fontSize: 13, color: T.muted }}>Te llevaste</strong>
          {s.commitments!.map((c, i) => (
            <label key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 9, cursor: "pointer" }}>
              <input type="checkbox" checked={!!c.completado} onChange={() => onToggle(i)}
                style={{ marginTop: 3, width: 16, height: 16, accentColor: T.accent }} />
              <span style={{ textDecoration: c.completado ? "line-through" : "none",
                color: c.completado ? T.muted : T.text }}>{c.texto}</span>
            </label>
          ))}
        </div>
      )}

      {s.session_prep && (
        <div style={{ marginTop: 20, background: T.panel, borderRadius: 12, padding: 15 }}>
          <strong style={{ display: "block", marginBottom: 9, fontSize: 13, color: CYAN }}>
            Para tu próxima sesión
          </strong>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{s.session_prep}</p>
        </div>
      )}
    </div>
  );
}

// ─── Mi proceso ───────────────────────────────────────────────────────────────
function Proceso({ sessions }: { sessions: Session[] }) {
  const cron = useMemo(() => [...sessions].reverse(), [sessions]);
  const patrones = useMemo(() => {
    const map = new Map<string, number>();
    sessions.forEach((s) => (s.patterns_detected ?? []).forEach((p) => {
      map.set(p.descripcion, (map.get(p.descripcion) ?? 0) + 1);
    }));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [sessions]);

  if (sessions.length === 0) return <Empty msg="Cuando tengas un par de sesiones, aquí vas a ver cómo se mueve tu proceso." />;

  const series: { key: keyof Emotional; label: string; color: string }[] = [
    { key: "animo", label: "Ánimo", color: CYAN },
    { key: "ansiedad", label: "Ansiedad", color: T.accent },
    { key: "energia_vital", label: "Energía", color: "#A5D6A7" },
  ];

  return (
    <>
      <Section theme={T} title="Cómo te has sentido">
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
            {series.map((s) => (
              <span key={s.key} style={{ fontSize: 12, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", overflowX: "auto", paddingBottom: 6 }}>
            {cron.map((s) => (
              <div key={s.id} style={{ minWidth: 46, textAlign: "center" }}>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 96, justifyContent: "center" }}>
                  {series.map((serie) => {
                    const raw = s.emotional_state?.[serie.key];
                    const n = typeof raw === "string" ? (NIVEL[raw] ?? 0) : 0;
                    return (
                      <div key={serie.key} title={`${serie.label}: ${raw ?? "sin dato"}`}
                        style={{ width: 9, height: `${(n / 3) * 100 || 4}%`, background: serie.color,
                          borderRadius: 3, opacity: n ? 1 : .28 }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: T.muted, marginTop: 7 }}>
                  {s.session_date.slice(8, 10)}/{s.session_date.slice(5, 7)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section theme={T} title="Lo que se repite">
        {patrones.length === 0 ? (
          <Empty msg="Todavía no hay patrones suficientes." />
        ) : (
          patrones.map(([desc, veces]) => (
            <div key={desc} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: "13px 15px", marginBottom: 9, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1.5 }}>{desc}</span>
              <span style={{ fontSize: 12, color: veces > 1 ? T.accent : T.muted, whiteSpace: "nowrap" }}>
                {veces > 1 ? `${veces} sesiones` : "1 sesión"}
              </span>
            </div>
          ))
        )}
      </Section>
    </>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }: { onDone: (patch: Partial<Config>) => Promise<void> }) {
  const [acepta, setAcepta] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Inter, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        <img src="/icons/icon-therapyflow-192.png" alt="" style={{ width: 60, height: 60, borderRadius: 15 }} />
        <h1 style={{ fontSize: 23, fontWeight: 800, margin: "16px 0 10px" }}>Antes de empezar</h1>
        <p style={{ fontSize: 14.5, color: T.muted, lineHeight: 1.6, marginTop: 0 }}>
          Therapy Flow toma el audio de tu sesión y te devuelve dos lecturas: una en lenguaje cotidiano
          y otra más técnica, para que llegues a la siguiente sesión con material propio.
        </p>

        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, margin: "20px 0" }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7, color: T.text }}>
            <li>Esto <strong>no es un servicio de salud</strong> y no sustituye a tu terapeuta.</li>
            <li>No emite diagnósticos. Lo que leas son hipótesis generadas por una IA.</li>
            <li>Grabas tu propia sesión, en la que tú participas, para tu uso personal.</li>
            <li>Tu expediente es tuyo: nadie más lo ve, y el audio se borra al transcribirse.</li>
          </ul>
        </div>

        <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", marginBottom: 20 }}>
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)}
            style={{ marginTop: 3, width: 18, height: 18, accentColor: T.accent }} />
          <span style={{ fontSize: 14, lineHeight: 1.55 }}>
            Entiendo lo anterior y confirmo que grabo sesiones en las que participo, para mi uso personal.
          </span>
        </label>

        <button
          disabled={!acepta || busy}
          onClick={async () => { setBusy(true); await onDone({ consent_at: new Date().toISOString() }); }}
          style={{ width: "100%", padding: "14px 0", borderRadius: 11, border: "none",
            background: !acepta || busy ? T.disabled : `linear-gradient(90deg, ${CYAN}, ${T.accent})`,
            color: "#0D1B2A", fontSize: 15, fontWeight: 800, cursor: !acepta || busy ? "default" : "pointer" }}>
          {busy ? "Un momento…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ─── Borrar cuenta ────────────────────────────────────────────────────────────
function BorrarCuenta({ busy, setBusy, onDone }: {
  busy: boolean; setBusy: (b: boolean) => void; onDone: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [err, setErr] = useState("");

  async function borrar() {
    setBusy(true); setErr("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/terapia/borrar", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    setBusy(false);
    if (!res.ok) { setErr("No se pudo borrar. Intenta de nuevo."); return; }
    await onDone();
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)}
        style={{ width: "100%", padding: "13px 0", borderRadius: 11, cursor: "pointer",
          border: `1px solid rgba(248,113,113,.4)`, background: "transparent", color: T.danger,
          fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}>
        Borrar mi proceso completo
      </button>
    );
  }

  return (
    <div style={{ background: T.surface, border: `1px solid rgba(248,113,113,.4)`, borderRadius: 12, padding: 16 }}>
      <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.55 }}>
        Esto borra todas tus sesiones, sus notas y tu expediente. No se puede deshacer.
        Escribe <strong>BORRAR</strong> para confirmar.
      </p>
      <input value={texto} onChange={(e) => setTexto(e.target.value.toUpperCase())} placeholder="BORRAR"
        style={{ width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${T.border}`,
          background: T.bg, color: T.text, fontSize: 15, fontFamily: "inherit", marginBottom: 12 }} />
      {err && <p style={{ color: T.danger, fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
      <div style={{ display: "flex", gap: 9 }}>
        <button onClick={() => { setAbierto(false); setTexto(""); }}
          style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: `1px solid ${T.border}`,
            background: "transparent", color: T.text, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
          Cancelar
        </button>
        <button disabled={texto !== "BORRAR" || busy} onClick={borrar}
          style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none",
            background: texto === "BORRAR" && !busy ? T.danger : T.disabled, color: "#0D1B2A",
            fontSize: 14, fontWeight: 800, cursor: texto === "BORRAR" && !busy ? "pointer" : "default",
            fontFamily: "inherit" }}>
          {busy ? "Borrando…" : "Borrar todo"}
        </button>
      </div>
    </div>
  );
}
