"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, HIREFLOW_CLIENT_ID } from "@/lib/supabase";
import type {
  HiringPosition,
  HiringApplication,
  HiringInterview,
  HiringAppStatus,
  HiringInterviewStatus,
} from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Chip,
  StatCard as DStatCard, Section as DSection, Empty as DEmpty,
  Modal as DModal, Field as DField, SaveBtn as DSaveBtn,
  inputStyle as mkInput, cardStyle as mkCard, cardBtnStyle as mkCardBtn, rowStyle as mkRow,
  type DashTheme,
} from "@/components/dashboard";

// ─── Paleta HireFlow (reclutamiento — naranja FishFlow + azul confianza) ─────────
const C = {
  orange:     "#FF8C35",
  orangeDark: "#C25E12",
  orangeSoft: "#FFF1E5",
  ink:        "#1C2434",
  muted:      "#6B7280",
  bg:         "#F6F7F9",
  surface:    "#FFFFFF",
  border:     "#E5E7EB",
  green:      "#2E8B57",
  amber:      "#B5701F",
  red:        "#C2554B",
  blue:       "#2A6BB0",
} as const;

const T: DashTheme = {
  accent: C.orange, accentDark: C.orangeDark, accentSoft: C.orangeSoft,
  bg: C.bg, surface: C.surface, text: C.ink,
  muted: C.muted, border: C.border, danger: C.red, disabled: "#F0C9A8",
};

const inputStyle = mkInput(T);
const cardStyle = mkCard(T);
const cardBtnStyle = mkCardBtn(T);
const rowStyle = mkRow(T);

type Opt<C> = Omit<React.ComponentProps<C>, "theme"> & { theme?: DashTheme };
const StatCard = (p: Opt<typeof DStatCard>) => <DStatCard {...p} theme={p.theme ?? T} />;
const Section  = (p: Opt<typeof DSection>)  => <DSection  {...p} theme={p.theme ?? T} />;
const Empty    = (p: Opt<typeof DEmpty>)    => <DEmpty    {...p} theme={p.theme ?? T} />;
const Modal    = (p: Opt<typeof DModal>)    => <DModal    {...p} theme={p.theme ?? T} />;
const Field    = (p: Opt<typeof DField>)    => <DField    {...p} theme={p.theme ?? T} />;
const SaveBtn  = (p: Opt<typeof DSaveBtn>)  => <DSaveBtn  {...p} theme={p.theme ?? T} />;

// ─── Tipos enriquecidos ──────────────────────────────────────────────────────────
type AppFull = HiringApplication; // candidate viene en el join

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function scoreColor(s: number | null) {
  if (s == null) return { bg: "#EEF0F2", fg: C.muted };
  if (s >= 85) return { bg: "#E6F4EC", fg: C.green };
  if (s >= 70) return { bg: "#FDF1E3", fg: C.amber };
  return { bg: "#F6E7E5", fg: C.red };
}

const APP_STATUS_META: Record<HiringAppStatus, { label: string; bg: string; fg: string }> = {
  new:          { label: "Nuevo",          bg: "#EEF0F2", fg: C.muted },
  screening:    { label: "Filtro CV",      bg: "#E7F0FB", fg: C.blue },
  interviewing: { label: "Entrevistando",  bg: "#FDF1E3", fg: C.amber },
  finalist:     { label: "Finalista",      bg: "#E6F4EC", fg: C.green },
  hired:        { label: "Contratado",     bg: "#DDF3E6", fg: C.green },
  rejected:     { label: "Descartado",     bg: "#F6E7E5", fg: C.red },
  withdrawn:    { label: "Se retiró",      bg: "#EEF0F2", fg: C.muted },
};

const IV_STATUS_META: Record<HiringInterviewStatus, { label: string; bg: string; fg: string }> = {
  scheduled: { label: "Programada", bg: "#E7F0FB", fg: C.blue },
  completed: { label: "Completada", bg: "#E6F4EC", fg: C.green },
  canceled:  { label: "Cancelada",  bg: "#F6E7E5", fg: C.red },
  no_show:   { label: "No asistió", bg: "#F6E7E5", fg: C.red },
};

const REC_META: Record<string, { label: string; bg: string; fg: string }> = {
  advance:  { label: "Avanzar",   bg: "#E6F4EC", fg: C.green },
  contratar:{ label: "Contratar", bg: "#DDF3E6", fg: C.green },
  hold:     { label: "En pausa",  bg: "#FDF1E3", fg: C.amber },
  reject:   { label: "Rechazar",  bg: "#F6E7E5", fg: C.red },
};

function sourceLabel(s: string | null) {
  if (s === "fireflies") return "🎙️ Fireflies";
  if (s === "manual") return "✍️ Manual";
  if (s === "recorder") return "🔴 Grabadora";
  return "—";
}

type TabId = "pipeline" | "entrevistas" | "veredicto";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "pipeline",    label: "Pipeline",     icon: "📊" },
  { id: "entrevistas", label: "Entrevistas",  icon: "🗓️" },
  { id: "veredicto",   label: "Veredicto IA", icon: "🏆" },
];

// Forms
type PositionForm = { title: string; description: string; requirements: string; department: string; location: string };
type CandidateForm = { full_name: string; email: string; phone: string; linkedin_url: string; cv_text: string; match_score: string; match_summary: string };
type InterviewForm = { stage_name: string; interviewer_name: string; interviewer_role: string; source_type: string; status: HiringInterviewStatus; scheduled_at: string; ai_summary: string; transcript: string; score: string; recommendation: string };

// ═══════════════════════════════════════════════════════════════════════════════
export default function HireFlowPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("pipeline");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [positions, setPositions] = useState<HiringPosition[]>([]);
  const [apps, setApps] = useState<AppFull[]>([]);
  const [interviews, setInterviews] = useState<HiringInterview[]>([]);
  const [posId, setPosId] = useState<string | null>(null);

  // modales
  const [showPosModal, setShowPosModal] = useState(false);
  const [showCandModal, setShowCandModal] = useState(false);
  const [detailApp, setDetailApp] = useState<AppFull | null>(null);
  const [addIvFor, setAddIvFor] = useState<AppFull | null>(null);
  const [editVerdictFor, setEditVerdictFor] = useState<AppFull | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  // ── Auth + carga ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/hireflow"); return; }
      loadAll();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadAll() {
    setLoading(true);
    const [posRes, appsRes, ivRes] = await Promise.all([
      supabase.from("hiring_positions").select("*")
        .eq("client_id", HIREFLOW_CLIENT_ID).order("created_at", { ascending: false }),
      supabase.from("hiring_applications")
        .select("*, candidate:hiring_candidates(*)")
        .eq("client_id", HIREFLOW_CLIENT_ID).order("match_score", { ascending: false }),
      supabase.from("hiring_interviews").select("*")
        .eq("client_id", HIREFLOW_CLIENT_ID).order("stage_order", { ascending: true }),
    ]);
    if (posRes.data) {
      setPositions(posRes.data as HiringPosition[]);
      setPosId((cur) => cur ?? (posRes.data!.length ? (posRes.data![0] as HiringPosition).id : null));
    }
    if (appsRes.data) setApps(appsRes.data as AppFull[]);
    if (ivRes.data) setInterviews(ivRes.data as HiringInterview[]);
    setLoading(false);
  }

  // ── Derivados ──────────────────────────────────────────────────────────────────
  const ivByApp = useMemo(() => {
    const m = new Map<string, HiringInterview[]>();
    interviews.forEach((iv) => {
      const arr = m.get(iv.application_id) ?? [];
      arr.push(iv); m.set(iv.application_id, arr);
    });
    return m;
  }, [interviews]);

  const appCountByPos = useMemo(() => {
    const m = new Map<string, number>();
    apps.forEach((a) => m.set(a.position_id, (m.get(a.position_id) ?? 0) + 1));
    return m;
  }, [apps]);

  const position = useMemo(() => positions.find((p) => p.id === posId) ?? null, [positions, posId]);
  const posApps = useMemo(
    () => apps.filter((a) => a.position_id === posId)
      .sort((x, y) => (y.match_score ?? 0) - (x.match_score ?? 0)),
    [apps, posId]
  );

  function avgScore(appId: string): number | null {
    const ivs = (ivByApp.get(appId) ?? []).filter((i) => i.score != null);
    if (!ivs.length) return null;
    return Math.round((ivs.reduce((s, i) => s + (i.score ?? 0), 0) / ivs.length) * 10) / 10;
  }
  function roundsDone(appId: string): number {
    return (ivByApp.get(appId) ?? []).filter((i) => i.status === "completed").length;
  }

  const stats = useMemo(() => ({
    openPositions: positions.filter((p) => p.status === "open").length,
    candidates: apps.length,
    completedIvs: interviews.filter((i) => i.status === "completed").length,
    finalists: apps.filter((a) => a.status === "finalist" || a.status === "hired").length,
  }), [positions, apps, interviews]);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  async function addPosition(f: PositionForm) {
    const { error } = await supabase.from("hiring_positions").insert({
      client_id: HIREFLOW_CLIENT_ID,
      title: f.title, description: f.description || null, requirements: f.requirements || null,
      department: f.department || null, location: f.location || null, status: "open",
    });
    if (error) { showToast("Error: " + error.message); return; }
    setShowPosModal(false); showToast("Vacante creada"); loadAll();
  }

  async function addCandidate(f: CandidateForm) {
    if (!posId) { showToast("Selecciona una vacante primero"); return; }
    const { data: cand, error: e1 } = await supabase.from("hiring_candidates").insert({
      client_id: HIREFLOW_CLIENT_ID,
      full_name: f.full_name, email: f.email || null, phone: f.phone || null,
      linkedin_url: f.linkedin_url || null, cv_text: f.cv_text || null, source: "manual",
    }).select().single();
    if (e1 || !cand) { showToast("Error: " + (e1?.message ?? "")); return; }
    const { error: e2 } = await supabase.from("hiring_applications").insert({
      client_id: HIREFLOW_CLIENT_ID, position_id: posId, candidate_id: cand.id,
      match_score: f.match_score ? Number(f.match_score) : null,
      match_summary: f.match_summary || null,
      status: f.match_score ? "screening" : "new", current_stage: 0,
    });
    if (e2) { showToast("Error: " + e2.message); return; }
    setShowCandModal(false); showToast("Candidato agregado al pipeline"); loadAll();
  }

  async function addInterview(appId: string, f: InterviewForm) {
    const nextOrder = (ivByApp.get(appId)?.length ?? 0) + 1;
    const { error } = await supabase.from("hiring_interviews").insert({
      client_id: HIREFLOW_CLIENT_ID, application_id: appId,
      stage_order: nextOrder, stage_name: f.stage_name || `Ronda ${nextOrder}`,
      interviewer_name: f.interviewer_name || null, interviewer_role: f.interviewer_role || null,
      source_type: f.source_type || null, status: f.status,
      scheduled_at: f.scheduled_at ? new Date(f.scheduled_at).toISOString() : null,
      completed_at: f.status === "completed" ? new Date().toISOString() : null,
      ai_summary: f.ai_summary || null, transcript: f.transcript || null,
      ai_processed: !!f.ai_summary,
      score: f.score ? Number(f.score) : null,
      recommendation: f.recommendation || null,
    });
    if (error) { showToast("Error: " + error.message); return; }
    // avanzar la postulación a "entrevistando" si seguía en filtro
    await supabase.from("hiring_applications")
      .update({ status: "interviewing", current_stage: nextOrder })
      .eq("id", appId).in("status", ["new", "screening", "interviewing"]);
    setAddIvFor(null); showToast("Entrevista registrada"); loadAll();
  }

  async function saveVerdict(appId: string, text: string) {
    const { error } = await supabase.from("hiring_applications")
      .update({ final_verdict: text || null, status: "finalist", decided_at: new Date().toISOString() })
      .eq("id", appId);
    if (error) { showToast("Error: " + error.message); return; }
    setEditVerdictFor(null); showToast("Veredicto guardado"); loadAll();
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, display: "grid", placeItems: "center",
        fontFamily: "Inter, sans-serif", color: T.muted }}>
        Cargando HireFlow…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "Inter, sans-serif" }}>
      <DashboardHeader
        icon="💼" iconBg={C.orange} iconShape="square"
        title="HireFlow" subtitle="Reclutamiento inteligente"
        theme={T}
        onLogout={async () => { await supabase.auth.signOut(); router.push("/login?next=/app/hireflow"); }}
      />

      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 20px 64px" }}>
        <StatGrid>
          <StatCard label="Vacantes abiertas" value={stats.openPositions} icon="📋" />
          <StatCard label="Candidatos" value={stats.candidates} icon="👥" />
          <StatCard label="Entrevistas hechas" value={stats.completedIvs} icon="✅" />
          <StatCard label="Finalistas" value={stats.finalists} icon="🏆" highlight />
        </StatGrid>

        <div style={{ margin: "22px 0 18px" }}>
          <TabBar tabs={TABS} active={tab} onChange={setTab} theme={T} />
        </div>

        {/* Selector de vacante */}
        {positions.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            {positions.map((p) => {
              const on = p.id === posId;
              return (
                <button key={p.id} onClick={() => setPosId(p.id)}
                  style={{ border: `1px solid ${on ? C.orange : T.border}`, background: on ? C.orangeSoft : "#fff",
                    color: on ? C.orangeDark : T.text, borderRadius: 999, padding: "6px 14px",
                    fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {p.title} <span style={{ opacity: .7 }}>· {appCountByPos.get(p.id) ?? 0}</span>
                </button>
              );
            })}
            <button onClick={() => setShowPosModal(true)}
              style={{ border: `1px dashed ${T.border}`, background: "#fff", color: T.muted,
                borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              + Nueva vacante
            </button>
          </div>
        )}

        {/* ── TAB: PIPELINE ── */}
        {tab === "pipeline" && (
          <PipelineTab
            position={position} apps={posApps}
            avgScore={avgScore} roundsDone={roundsDone}
            onOpen={setDetailApp} onAddCandidate={() => setShowCandModal(true)}
          />
        )}

        {/* ── TAB: ENTREVISTAS ── */}
        {tab === "entrevistas" && (
          <EntrevistasTab interviews={interviews} apps={apps} />
        )}

        {/* ── TAB: VEREDICTO ── */}
        {tab === "veredicto" && (
          <VeredictoTab
            position={position} apps={posApps}
            avgScore={avgScore} roundsDone={roundsDone}
            onEditVerdict={setEditVerdictFor} onOpen={setDetailApp}
          />
        )}
      </main>

      {/* ── MODAL: detalle de candidato + rondas ── */}
      {detailApp && (
        <AppDetailModal
          app={detailApp} position={position}
          interviews={(ivByApp.get(detailApp.id) ?? []).slice().sort((a, b) => (a.stage_order ?? 0) - (b.stage_order ?? 0))}
          onClose={() => setDetailApp(null)}
          onAddInterview={() => { setAddIvFor(detailApp); setDetailApp(null); }}
          onEditVerdict={() => { setEditVerdictFor(detailApp); setDetailApp(null); }}
        />
      )}

      {/* ── MODAL: nueva vacante ── */}
      {showPosModal && <PositionModal onClose={() => setShowPosModal(false)} onSave={addPosition} />}

      {/* ── MODAL: nuevo candidato ── */}
      {showCandModal && (
        <CandidateModal positionTitle={position?.title ?? ""} onClose={() => setShowCandModal(false)} onSave={addCandidate} />
      )}

      {/* ── MODAL: agregar entrevista ── */}
      {addIvFor && (
        <InterviewModal
          app={addIvFor} position={position}
          nextOrder={(ivByApp.get(addIvFor.id)?.length ?? 0) + 1}
          onClose={() => setAddIvFor(null)}
          onSave={(f) => addInterview(addIvFor.id, f)}
        />
      )}

      {/* ── MODAL: editar veredicto ── */}
      {editVerdictFor && (
        <VerdictModal
          app={editVerdictFor}
          onClose={() => setEditVerdictFor(null)}
          onSave={(t) => saveVerdict(editVerdictFor.id, t)}
        />
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Subcomponentes
// ═══════════════════════════════════════════════════════════════════════════════

function Avatar({ name }: { name: string }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.orangeSoft, color: C.orangeDark,
      display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
      {initials(name)}
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  const c = scoreColor(score);
  return (
    <div style={{ textAlign: "center", flexShrink: 0 }}>
      <div style={{ width: 46, height: 46, borderRadius: "50%", background: c.bg, color: c.fg,
        display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15 }}>
        {score ?? "—"}
      </div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>match</div>
    </div>
  );
}

function PipelineTab({ position, apps, avgScore, roundsDone, onOpen, onAddCandidate }: {
  position: HiringPosition | null; apps: AppFull[];
  avgScore: (id: string) => number | null; roundsDone: (id: string) => number;
  onOpen: (a: AppFull) => void; onAddCandidate: () => void;
}) {
  if (!position) return <Empty msg="Crea tu primera vacante para empezar." />;
  const totalStages = position.stages?.length ?? 0;
  return (
    <Section title={<>Candidatos · <span style={{ color: C.muted, fontWeight: 500 }}>{position.title}</span></>}
      action={{ label: "+ Candidato", onClick: onAddCandidate }}>
      {/* requisitos */}
      {position.requirements && (
        <div style={{ ...cardStyle, marginBottom: 16, background: C.orangeSoft, borderColor: "#F6D6BB" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.orangeDark, marginBottom: 4 }}>Requisitos</div>
          <div style={{ fontSize: 13, color: T.text }}>{position.requirements}</div>
        </div>
      )}
      {apps.length === 0 ? (
        <Empty msg="Aún no hay candidatos en esta vacante." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {apps.map((a) => {
            const st = APP_STATUS_META[a.status];
            const done = roundsDone(a.id);
            const avg = avgScore(a.id);
            const name = a.candidate?.full_name ?? "—";
            return (
              <button key={a.id} onClick={() => onOpen(a)} style={{ ...cardBtnStyle, display: "flex",
                alignItems: "center", gap: 14 }}>
                <ScoreBadge score={a.match_score} />
                <Avatar name={name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{name}</span>
                    <Chip label={st.label} bg={st.bg} fg={st.fg} />
                  </div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>
                    {a.match_summary ?? "Sin análisis de match aún."}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>Ronda {done}/{totalStages}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{avg != null ? `★ ${avg}/10` : "sin score"}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function EntrevistasTab({ interviews, apps }: { interviews: HiringInterview[]; apps: AppFull[] }) {
  const nameByApp = useMemo(() => {
    const m = new Map<string, string>();
    apps.forEach((a) => m.set(a.id, a.candidate?.full_name ?? "—"));
    return m;
  }, [apps]);
  const sorted = useMemo(
    () => interviews.slice().sort((a, b) => {
      const da = a.scheduled_at ?? a.created_at, db = b.scheduled_at ?? b.created_at;
      return new Date(db).getTime() - new Date(da).getTime();
    }),
    [interviews]
  );
  if (!sorted.length) return <Empty msg="No hay entrevistas registradas." />;
  return (
    <Section title="Todas las entrevistas">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((iv) => {
          const st = IV_STATUS_META[iv.status];
          return (
            <div key={iv.id} style={{ ...rowStyle, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5, color: T.text }}>{nameByApp.get(iv.application_id)}</span>
                  <Chip label={iv.stage_name ?? "Ronda"} bg="#EEF0F2" fg={C.muted} />
                  <Chip label={st.label} bg={st.bg} fg={st.fg} />
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                  {iv.interviewer_name ?? "—"}{iv.interviewer_role ? ` · ${iv.interviewer_role}` : ""} · {fmtDate(iv.scheduled_at)} · {sourceLabel(iv.source_type)}
                </div>
                {iv.ai_summary && (
                  <div style={{ fontSize: 13, color: T.text, marginTop: 8, lineHeight: 1.5 }}>{iv.ai_summary}</div>
                )}
              </div>
              {iv.score != null && (
                <div style={{ fontWeight: 800, fontSize: 15, color: C.orangeDark, flexShrink: 0 }}>★ {iv.score}</div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function VeredictoTab({ position, apps, avgScore, roundsDone, onEditVerdict, onOpen }: {
  position: HiringPosition | null; apps: AppFull[];
  avgScore: (id: string) => number | null; roundsDone: (id: string) => number;
  onEditVerdict: (a: AppFull) => void; onOpen: (a: AppFull) => void;
}) {
  if (!position) return <Empty msg="Crea una vacante para ver el veredicto." />;
  const ranked = apps.filter((a) => a.status !== "rejected" && a.status !== "withdrawn");
  const totalStages = position.stages?.length ?? 0;
  return (
    <Section title={<>Veredicto comparativo · <span style={{ color: C.muted, fontWeight: 500 }}>{position.title}</span></>}>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
        Comparativa de candidatos activos basada en el match del CV y el desempeño en cada ronda. El veredicto final lo confirma RH.
      </div>
      {ranked.length === 0 ? (
        <Empty msg="No hay candidatos activos para comparar." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ranked.map((a, idx) => {
            const name = a.candidate?.full_name ?? "—";
            const avg = avgScore(a.id);
            const top = idx === 0;
            return (
              <div key={a.id} style={{ ...cardStyle, borderColor: top ? C.orange : T.border,
                borderWidth: top ? 2 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: top ? C.orangeDark : C.muted, width: 24 }}>#{idx + 1}</div>
                  <Avatar name={name} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      Match {a.match_score ?? "—"} · {avg != null ? `★ ${avg}/10 prom.` : "sin score"} · Ronda {roundsDone(a.id)}/{totalStages}
                    </div>
                  </div>
                  <button onClick={() => onOpen(a)} style={{ background: "none", border: `1px solid ${T.border}`,
                    borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: T.text, cursor: "pointer" }}>
                    Ver detalle
                  </button>
                </div>
                {a.final_verdict ? (
                  <div style={{ marginTop: 12, background: top ? C.orangeSoft : "#F6F7F9", borderRadius: 10,
                    padding: "12px 14px", fontSize: 13.5, color: T.text, lineHeight: 1.55 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.orangeDark, marginBottom: 4 }}>🏆 VEREDICTO IA</div>
                    {a.final_verdict}
                  </div>
                ) : (
                  <button onClick={() => onEditVerdict(a)} style={{ marginTop: 10, background: "none",
                    border: `1px dashed ${T.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
                    fontWeight: 600, color: C.orangeDark, cursor: "pointer", width: "100%" }}>
                    + Generar veredicto
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function AppDetailModal({ app, position, interviews, onClose, onAddInterview, onEditVerdict }: {
  app: AppFull; position: HiringPosition | null; interviews: HiringInterview[];
  onClose: () => void; onAddInterview: () => void; onEditVerdict: () => void;
}) {
  const cand = app.candidate;
  const md = app.match_details;
  const st = APP_STATUS_META[app.status];
  const chip = (arr: string[] | undefined, bg: string, fg: string) =>
    (arr ?? []).map((x, i) => <span key={i} style={{ marginRight: 6, marginBottom: 6, display: "inline-block" }}><Chip label={x} bg={bg} fg={fg} /></span>);
  return (
    <Modal title={cand?.full_name ?? "Candidato"} onClose={onClose} theme={T} wide>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <Chip label={st.label} bg={st.bg} fg={st.fg} />
        {app.match_score != null && (() => { const c = scoreColor(app.match_score);
          return <Chip label={`Match ${app.match_score}`} bg={c.bg} fg={c.fg} />; })()}
        {cand?.source && <Chip label={cand.source} bg="#EEF0F2" fg={C.muted} />}
      </div>

      {/* contacto / CV */}
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 4 }}>
        {cand?.email ?? "—"}{cand?.phone ? ` · ${cand.phone}` : ""}{cand?.linkedin_url ? ` · ${cand.linkedin_url}` : ""}
      </div>
      {cand?.cv_text && (
        <div style={{ fontSize: 13, color: T.text, background: "#F6F7F9", borderRadius: 10, padding: "10px 12px",
          marginBottom: 14, lineHeight: 1.5 }}>{cand.cv_text}</div>
      )}

      {/* match */}
      {(app.match_summary || md) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>Análisis de match (IA)</div>
          {app.match_summary && <div style={{ fontSize: 13, color: T.text, marginBottom: 8 }}>{app.match_summary}</div>}
          {md?.cumple?.length ? <div style={{ marginBottom: 4 }}><span style={{ fontSize: 11, color: C.muted }}>Cumple: </span>{chip(md.cumple, "#E6F4EC", C.green)}</div> : null}
          {md?.parcial?.length ? <div style={{ marginBottom: 4 }}><span style={{ fontSize: 11, color: C.muted }}>Parcial: </span>{chip(md.parcial, "#FDF1E3", C.amber)}</div> : null}
          {md?.falta?.length ? <div><span style={{ fontSize: 11, color: C.muted }}>Falta: </span>{chip(md.falta, "#F6E7E5", C.red)}</div> : null}
        </div>
      )}

      {/* rondas */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Rondas de entrevista</div>
        <button onClick={onAddInterview} style={{ background: C.orange, color: "#fff", border: "none",
          borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ Ronda</button>
      </div>
      {interviews.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: "12px 0" }}>Sin entrevistas aún.</div>
      ) : (
        <div style={{ position: "relative", paddingLeft: 18, marginBottom: 16 }}>
          <div style={{ position: "absolute", left: 5, top: 6, bottom: 6, width: 2, background: T.border }} />
          {interviews.map((iv) => {
            const sm = IV_STATUS_META[iv.status];
            const rec = iv.recommendation ? REC_META[iv.recommendation] : null;
            return (
              <div key={iv.id} style={{ position: "relative", marginBottom: 14 }}>
                <div style={{ position: "absolute", left: -16, top: 4, width: 10, height: 10, borderRadius: "50%",
                  background: iv.status === "completed" ? C.green : C.orange, border: "2px solid #fff" }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: T.text }}>{iv.stage_name}</span>
                  <Chip label={sm.label} bg={sm.bg} fg={sm.fg} />
                  {rec && <Chip label={rec.label} bg={rec.bg} fg={rec.fg} />}
                  {iv.score != null && <span style={{ fontSize: 12, fontWeight: 700, color: C.orangeDark }}>★ {iv.score}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                  {iv.interviewer_name ?? "—"}{iv.interviewer_role ? ` · ${iv.interviewer_role}` : ""} · {fmtDate(iv.scheduled_at)} · {sourceLabel(iv.source_type)}
                </div>
                {iv.ai_summary && <div style={{ fontSize: 13, color: T.text, marginTop: 6, lineHeight: 1.5 }}>{iv.ai_summary}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* veredicto */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
        {app.final_verdict ? (
          <div style={{ background: C.orangeSoft, borderRadius: 10, padding: "12px 14px", fontSize: 13.5,
            color: T.text, lineHeight: 1.55 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.orangeDark, marginBottom: 4 }}>🏆 VEREDICTO IA</div>
            {app.final_verdict}
            <button onClick={onEditVerdict} style={{ display: "block", marginTop: 8, background: "none",
              border: "none", color: C.orangeDark, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>Editar</button>
          </div>
        ) : (
          <SaveBtn onClick={onEditVerdict} label="Generar veredicto final" theme={T} />
        )}
      </div>
    </Modal>
  );
}

// ── Modales de formulario ──────────────────────────────────────────────────────
function PositionModal({ onClose, onSave }: { onClose: () => void; onSave: (f: PositionForm) => void }) {
  const [f, setF] = useState<PositionForm>({ title: "", description: "", requirements: "", department: "", location: "" });
  return (
    <Modal title="Nueva vacante" onClose={onClose} theme={T}>
      <Field label="Título del puesto" theme={T}>
        <input style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej. Ejecutivo de Ventas Telecom" />
      </Field>
      <Field label="Descripción" theme={T}>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Field label="Requisitos" theme={T}>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={f.requirements} onChange={(e) => setF({ ...f, requirements: e.target.value })} placeholder="Experiencia, idiomas, conocimientos…" />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}><Field label="Departamento" theme={T}><input style={inputStyle} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Ubicación" theme={T}><input style={inputStyle} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field></div>
      </div>
      <SaveBtn onClick={() => onSave(f)} disabled={!f.title.trim()} label="Crear vacante" theme={T} />
    </Modal>
  );
}

function CandidateModal({ positionTitle, onClose, onSave }: { positionTitle: string; onClose: () => void; onSave: (f: CandidateForm) => void }) {
  const [f, setF] = useState<CandidateForm>({ full_name: "", email: "", phone: "", linkedin_url: "", cv_text: "", match_score: "", match_summary: "" });
  return (
    <Modal title="Nuevo candidato" onClose={onClose} theme={T} wide>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>Se agrega al pipeline de <b>{positionTitle}</b>.</div>
      <Field label="Nombre completo" theme={T}>
        <input style={inputStyle} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}><Field label="Email" theme={T}><input style={inputStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Teléfono" theme={T}><input style={inputStyle} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
      </div>
      <Field label="LinkedIn" theme={T}><input style={inputStyle} value={f.linkedin_url} onChange={(e) => setF({ ...f, linkedin_url: e.target.value })} /></Field>
      <Field label="Texto del CV" theme={T}>
        <textarea style={{ ...inputStyle, minHeight: 90 }} value={f.cv_text} onChange={(e) => setF({ ...f, cv_text: e.target.value })} placeholder="Pega aquí el contenido del CV…" />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 120 }}><Field label="Match (0-100)" theme={T}><input style={inputStyle} type="number" value={f.match_score} onChange={(e) => setF({ ...f, match_score: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Resumen de match" theme={T}><input style={inputStyle} value={f.match_summary} onChange={(e) => setF({ ...f, match_summary: e.target.value })} placeholder="Opcional — luego lo genera la IA" /></Field></div>
      </div>
      <SaveBtn onClick={() => onSave(f)} disabled={!f.full_name.trim()} label="Agregar al pipeline" theme={T} />
    </Modal>
  );
}

function InterviewModal({ app, position, nextOrder, onClose, onSave }: {
  app: AppFull; position: HiringPosition | null; nextOrder: number;
  onClose: () => void; onSave: (f: InterviewForm) => void;
}) {
  const suggested = position?.stages?.find((s) => s.order === nextOrder)?.name ?? `Ronda ${nextOrder}`;
  const [f, setF] = useState<InterviewForm>({
    stage_name: suggested, interviewer_name: "", interviewer_role: "", source_type: "manual",
    status: "scheduled", scheduled_at: "", ai_summary: "", transcript: "", score: "", recommendation: "",
  });
  return (
    <Modal title={`Nueva ronda · ${app.candidate?.full_name ?? ""}`} onClose={onClose} theme={T} wide>
      <Field label="Nombre de la ronda" theme={T}><input style={inputStyle} value={f.stage_name} onChange={(e) => setF({ ...f, stage_name: e.target.value })} /></Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}><Field label="Entrevistador" theme={T}><input style={inputStyle} value={f.interviewer_name} onChange={(e) => setF({ ...f, interviewer_name: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Rol" theme={T}><input style={inputStyle} value={f.interviewer_role} onChange={(e) => setF({ ...f, interviewer_role: e.target.value })} /></Field></div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}><Field label="Estado" theme={T}>
          <select style={inputStyle} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as HiringInterviewStatus })}>
            <option value="scheduled">Programada</option>
            <option value="completed">Completada</option>
            <option value="canceled">Cancelada</option>
            <option value="no_show">No asistió</option>
          </select>
        </Field></div>
        <div style={{ flex: 1 }}><Field label="Fuente" theme={T}>
          <select style={inputStyle} value={f.source_type} onChange={(e) => setF({ ...f, source_type: e.target.value })}>
            <option value="manual">Manual</option>
            <option value="fireflies">Fireflies</option>
            <option value="recorder">Grabadora</option>
          </select>
        </Field></div>
      </div>
      <Field label="Fecha" theme={T}><input style={inputStyle} type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></Field>
      <Field label="Resumen IA / notas" theme={T}><textarea style={{ ...inputStyle, minHeight: 70 }} value={f.ai_summary} onChange={(e) => setF({ ...f, ai_summary: e.target.value })} placeholder="Resumen de la entrevista (la IA lo generará automáticamente desde Fireflies)" /></Field>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 120 }}><Field label="Score (0-10)" theme={T}><input style={inputStyle} type="number" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Recomendación" theme={T}>
          <select style={inputStyle} value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })}>
            <option value="">—</option>
            <option value="advance">Avanzar</option>
            <option value="hold">En pausa</option>
            <option value="reject">Rechazar</option>
          </select>
        </Field></div>
      </div>
      <SaveBtn onClick={() => onSave(f)} disabled={!f.stage_name.trim()} label="Guardar ronda" theme={T} />
    </Modal>
  );
}

function VerdictModal({ app, onClose, onSave }: { app: AppFull; onClose: () => void; onSave: (t: string) => void }) {
  const [text, setText] = useState(app.final_verdict ?? "");
  return (
    <Modal title={`Veredicto · ${app.candidate?.full_name ?? ""}`} onClose={onClose} theme={T} wide>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>
        Síntesis final que combina el CV y todas las rondas. La generación automática con IA es el siguiente módulo; por ahora puedes escribirla o ajustarla aquí.
      </div>
      <Field label="Veredicto" theme={T}>
        <textarea style={{ ...inputStyle, minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <SaveBtn onClick={() => onSave(text)} disabled={!text.trim()} label="Guardar veredicto" theme={T} />
    </Modal>
  );
}
