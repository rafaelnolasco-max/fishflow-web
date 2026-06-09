"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, SIECKVET_CLIENT_ID } from "@/lib/supabase";
import type {
  VetVet,
  VetPet,
  VetAppointment,
  VetVisitSummary,
  VetSpecies,
  VetApptStatus,
  VetConfirmStatus,
} from "@/lib/supabase";

// ─── Paleta SieckVet (veterinaria — teal/verde, confianza y salud) ───────────────
const C = {
  teal:       "#0E7C7B",
  tealDark:   "#085656",
  tealLight:  "#5FB6B5",
  mint:       "#E6F4F3",
  cream:      "#F4F7F6",
  warmWhite:  "#FBFCFC",
  charcoal:   "#1F2A2A",
  muted:      "#6B7A79",
  amber:      "#D98A3D",
  alert:      "#D4726A",
  green:      "#2E8B57",
  border:     "#DDE6E5",
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function speciesIcon(s: VetSpecies | string) {
  if (s === "perro") return "🐕";
  if (s === "gato") return "🐈";
  return "🐾";
}

function ageFromBirth(birth: string | null): string | null {
  if (!birth) return null;
  const b = new Date(birth);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) years--;
  if (years <= 0) {
    const months = Math.max(0, (now.getFullYear() - b.getFullYear()) * 12 + m);
    return `${months} ${months === 1 ? "mes" : "meses"}`;
  }
  return `${years} ${years === 1 ? "año" : "años"}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Etiquetas de estado ───────────────────────────────────────────────────────
const STATUS_META: Record<VetApptStatus, { label: string; bg: string; fg: string }> = {
  scheduled:   { label: "Programada",  bg: "#E7F0FB", fg: "#2A6BB0" },
  in_progress: { label: "En consulta", bg: "#FDF1E3", fg: "#B5701F" },
  completed:   { label: "Completada",  bg: "#E6F4EC", fg: "#2E8B57" },
  cancelled:   { label: "Cancelada",   bg: "#F3E6E5", fg: "#B0463E" },
};

const CONFIRM_META: Record<VetConfirmStatus, { label: string; bg: string; fg: string }> = {
  pending:               { label: "Confirmación pendiente", bg: "#F1EFE7", fg: "#8A7A4A" },
  confirmed:             { label: "Confirmada",             bg: "#E6F4EC", fg: "#2E8B57" },
  reschedule_requested:  { label: "Pidió reagendar",        bg: "#FDF1E3", fg: "#B5701F" },
  cancelled:             { label: "Cancelada",              bg: "#F3E6E5", fg: "#B0463E" },
};

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

type TabId = "pacientes" | "citas" | "veterinarios" | "resumenes";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "pacientes",    label: "Pacientes",     icon: "🐾" },
  { id: "citas",        label: "Citas",         icon: "📅" },
  { id: "veterinarios", label: "Veterinarios",  icon: "🩺" },
  { id: "resumenes",    label: "Resúmenes",     icon: "📋" },
];

// ═══════════════════════════════════════════════════════════════════════════════
export default function SieckVetPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("pacientes");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [pets, setPets] = useState<VetPet[]>([]);
  const [vets, setVets] = useState<VetVet[]>([]);
  const [appts, setAppts] = useState<VetAppointment[]>([]);
  const [summaries, setSummaries] = useState<VetVisitSummary[]>([]);

  // modales
  const [showPetModal, setShowPetModal] = useState(false);
  const [showVetModal, setShowVetModal] = useState(false);
  const [showApptModal, setShowApptModal] = useState(false);
  const [viewSummary, setViewSummary] = useState<VetVisitSummary | null>(null);
  const [detailPet, setDetailPet] = useState<VetPet | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }

  // ── Auth + carga ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/sieckvet"); return; }
      loadAll();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadAll() {
    setLoading(true);
    const [petsRes, vetsRes, apptsRes, sumRes] = await Promise.all([
      supabase.from("vet_pets").select("*, vet_appointments(count)")
        .eq("client_id", SIECKVET_CLIENT_ID).eq("active", true).order("name"),
      supabase.from("vet_vets").select("*")
        .eq("client_id", SIECKVET_CLIENT_ID).eq("active", true).order("name"),
      supabase.from("vet_appointments")
        .select("*, pet:vet_pets(*), vet:vet_vets(*)")
        .eq("client_id", SIECKVET_CLIENT_ID).order("scheduled_at", { ascending: false }),
      supabase.from("vet_visit_summaries")
        .select("*, appointment:vet_appointments(*, pet:vet_pets(*), vet:vet_vets(*))")
        .eq("client_id", SIECKVET_CLIENT_ID).order("created_at", { ascending: false }),
    ]);

    if (petsRes.data) {
      setPets(petsRes.data.map((p: VetPet & { vet_appointments?: { count: number }[] }) => ({
        ...p, appt_count: p.vet_appointments?.[0]?.count ?? 0,
      })));
    }
    if (vetsRes.data) setVets(vetsRes.data as VetVet[]);
    if (apptsRes.data) setAppts(apptsRes.data as VetAppointment[]);
    if (sumRes.data) setSummaries(sumRes.data as VetVisitSummary[]);
    setLoading(false);
  }

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    return {
      pets: pets.length,
      upcoming: appts.filter((a) => a.status === "scheduled").length,
      todayAppts: appts.filter((a) => new Date(a.scheduled_at).toDateString() === today).length,
      pendingReview: summaries.filter((s) => s.ai_processed && !s.approved_at).length,
    };
  }, [pets, appts, summaries]);

  // ── Acciones CRUD ──────────────────────────────────────────────────────────────
  async function addPet(form: PetForm) {
    const { error } = await supabase.from("vet_pets").insert({
      client_id: SIECKVET_CLIENT_ID,
      name: form.name, species: form.species, breed: form.breed || null,
      sex: form.sex || null, birth_date: form.birth_date || null,
      owner_name: form.owner_name, owner_phone: form.owner_phone || null,
      owner_email: form.owner_email || null, notes: form.notes || null,
    });
    if (error) { showToast("Error al guardar: " + error.message); return; }
    setShowPetModal(false); showToast("Paciente agregado"); loadAll();
  }

  async function addVet(form: VetForm) {
    const { error } = await supabase.from("vet_vets").insert({
      client_id: SIECKVET_CLIENT_ID, name: form.name, specialty: form.specialty || null,
    });
    if (error) { showToast("Error al guardar: " + error.message); return; }
    setShowVetModal(false); showToast("Veterinario agregado"); loadAll();
  }

  async function addAppt(form: ApptForm) {
    const { error } = await supabase.from("vet_appointments").insert({
      client_id: SIECKVET_CLIENT_ID, pet_id: form.pet_id,
      vet_id: form.vet_id || null, scheduled_at: form.scheduled_at,
      reason: form.reason || null,
    });
    if (error) { showToast("Error al guardar: " + error.message); return; }
    setShowApptModal(false); showToast("Cita agendada"); loadAll();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
        background: C.cream, color: C.muted, fontFamily: "Inter, system-ui, sans-serif" }}>
        Cargando SieckVet…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.cream, color: C.charcoal,
      fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Header */}
      <header style={{ background: C.warmWhite, borderBottom: `1px solid ${C.border}`,
        padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: C.teal,
            display: "grid", placeItems: "center", fontSize: 20 }}>🐾</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em",
              fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>SieckVet</div>
            <div style={{ fontSize: 12, color: C.muted }}>Gestión clínica veterinaria</div>
          </div>
        </div>
        <button
          onClick={async () => { await supabase.auth.signOut(); router.push("/login?next=/app/sieckvet"); }}
          style={{ fontSize: 13, color: C.muted, background: "none", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
          Salir
        </button>
      </header>

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 28px 64px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          <StatCard label="Pacientes" value={stats.pets} icon="🐾" />
          <StatCard label="Citas hoy" value={stats.todayAppts} icon="📅" />
          <StatCard label="Próximas citas" value={stats.upcoming} icon="⏳" />
          <StatCard label="Resúmenes por revisar" value={stats.pendingReview} icon="📋"
            highlight={stats.pendingReview > 0} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${C.border}`, marginBottom: 22 }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px",
                  fontSize: 14, fontWeight: active ? 700 : 500,
                  color: active ? C.tealDark : C.muted,
                  borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
                  marginBottom: -1, display: "flex", alignItems: "center", gap: 7 }}>
                <span>{t.icon}</span>{t.label}
              </button>
            );
          })}
        </div>

        {/* Contenido */}
        {tab === "pacientes" && (
          <Section title="Pacientes" action={{ label: "+ Nuevo paciente", onClick: () => setShowPetModal(true) }}>
            {pets.length === 0 ? <Empty msg="Aún no hay pacientes." /> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {pets.map((p) => (
                  <button key={p.id} onClick={() => setDetailPet(p)} style={cardBtnStyle}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: C.mint,
                        display: "grid", placeItems: "center", fontSize: 22 }}>{speciesIcon(p.species)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.breed ?? "—"}{ageFromBirth(p.birth_date) ? ` · ${ageFromBirth(p.birth_date)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`,
                      display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted }}>
                      <span>👤 {p.owner_name}</span>
                      <span>{p.appt_count ?? 0} cita{(p.appt_count ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>
        )}

        {tab === "citas" && (
          <Section title="Citas" action={{ label: "+ Nueva cita", onClick: () => setShowApptModal(true) }}>
            {appts.length === 0 ? <Empty msg="Aún no hay citas." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {appts.map((a) => {
                  const sm = STATUS_META[a.status];
                  const cm = CONFIRM_META[a.confirmation_status];
                  return (
                    <div key={a.id} style={{ ...rowStyle, alignItems: "flex-start" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: C.mint,
                        display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>
                        {speciesIcon(a.pet?.species ?? "otro")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {a.pet?.name ?? "—"} <span style={{ fontWeight: 400, color: C.muted }}>· {a.reason ?? "Consulta"}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          📅 {fmtDateTime(a.scheduled_at)}{a.vet ? ` · ${a.vet.name}` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                          <Chip {...sm} />
                          <Chip {...cm} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {tab === "veterinarios" && (
          <Section title="Veterinarios" action={{ label: "+ Nuevo veterinario", onClick: () => setShowVetModal(true) }}>
            {vets.length === 0 ? <Empty msg="Aún no hay veterinarios." /> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                {vets.map((v) => (
                  <div key={v.id} style={cardStyle}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.teal,
                        color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15 }}>
                        {initials(v.name.replace(/^(Dra?\.?)\s*/i, ""))}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{v.name}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>{v.specialty ?? "Medicina general"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {tab === "resumenes" && (
          <Section title="Resúmenes de consulta">
            {summaries.length === 0 ? <Empty msg="Aún no hay resúmenes." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {summaries.map((s) => {
                  const st = s.sent_at
                    ? { label: "Enviado al dueño", bg: "#E6F4EC", fg: "#2E8B57" }
                    : s.approved_at
                    ? { label: "Aprobado, sin enviar", bg: "#E7F0FB", fg: "#2A6BB0" }
                    : { label: "Borrador — revisar", bg: "#FDF1E3", fg: "#B5701F" };
                  const pet = s.appointment?.pet;
                  return (
                    <button key={s.id} onClick={() => setViewSummary(s)} style={{ ...rowStyle, textAlign: "left", cursor: "pointer", width: "100%" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: C.mint,
                        display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>
                        {speciesIcon(pet?.species ?? "otro")}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {pet?.name ?? "—"} <span style={{ fontWeight: 400, color: C.muted }}>· {s.appointment?.reason ?? "Consulta"}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                          {s.appointment ? fmtDate(s.appointment.scheduled_at) : fmtDate(s.created_at)}
                          {s.source_type === "recorder" ? " · 🎙️ grabación" : " · ✍️ notas"}
                        </div>
                      </div>
                      <Chip {...st} />
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: C.tealDark, color: "#fff", padding: "10px 20px", borderRadius: 10,
          fontSize: 13, boxShadow: "0 6px 20px rgba(0,0,0,.2)", zIndex: 100 }}>
          {toast}
        </div>
      )}

      {/* Modales */}
      {showPetModal && <PetModal onClose={() => setShowPetModal(false)} onSave={addPet} />}
      {showVetModal && <VetModal onClose={() => setShowVetModal(false)} onSave={addVet} />}
      {showApptModal && <ApptModal pets={pets} vets={vets} onClose={() => setShowApptModal(false)} onSave={addAppt} />}
      {viewSummary && <SummaryModal summary={viewSummary} onClose={() => setViewSummary(null)} />}
      {detailPet && <PetDetailModal pet={detailPet} appts={appts.filter((a) => a.pet_id === detailPet.id)} onClose={() => setDetailPet(null)} />}
    </div>
  );
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, highlight }: { label: string; value: number; icon: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? "#FDF1E3" : C.warmWhite, border: `1px solid ${highlight ? "#EBC99A" : C.border}`,
      borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    </div>
  );
}

function Section({ title, action, children }: {
  title: string; action?: { label: string; onClick: () => void }; children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>{title}</h2>
        {action && (
          <button onClick={action.onClick} style={{ background: C.teal, color: "#fff", border: "none",
            borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div style={{ padding: "48px 0", textAlign: "center", color: C.muted, fontSize: 14 }}>{msg}</div>
  );
}

const cardStyle: React.CSSProperties = {
  background: C.warmWhite, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16,
};
const cardBtnStyle: React.CSSProperties = {
  ...cardStyle, cursor: "pointer", textAlign: "left", width: "100%", display: "block",
};
const rowStyle: React.CSSProperties = {
  background: C.warmWhite, border: `1px solid ${C.border}`, borderRadius: 12,
  padding: "14px 16px", display: "flex", gap: 12, alignItems: "center",
};

// ─── Modal genérico ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,30,.45)",
      display: "grid", placeItems: "center", zIndex: 200, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.warmWhite, borderRadius: 16,
        width: "100%", maxWidth: wide ? 560 : 440, maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: C.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.border}`,
  fontSize: 14, fontFamily: "inherit", background: "#fff", color: C.charcoal,
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 5, display: "block" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}><label style={labelStyle}>{label}</label>{children}</div>;
}

function SaveBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width: "100%", background: disabled ? C.tealLight : C.teal,
      color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 700,
      cursor: disabled ? "default" : "pointer", marginTop: 6 }}>
      Guardar
    </button>
  );
}

// ─── Formularios ─────────────────────────────────────────────────────────────────
type PetForm = { name: string; species: VetSpecies; breed: string; sex: string; birth_date: string; owner_name: string; owner_phone: string; owner_email: string; notes: string };
type VetForm = { name: string; specialty: string };
type ApptForm = { pet_id: string; vet_id: string; scheduled_at: string; reason: string };

function PetModal({ onClose, onSave }: { onClose: () => void; onSave: (f: PetForm) => void }) {
  const [f, setF] = useState<PetForm>({ name: "", species: "perro", breed: "", sex: "", birth_date: "", owner_name: "", owner_phone: "", owner_email: "", notes: "" });
  const up = (k: keyof PetForm, v: string) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.name.trim() && f.owner_name.trim();
  return (
    <Modal title="Nuevo paciente" onClose={onClose}>
      <Field label="Nombre de la mascota *"><input style={inputStyle} value={f.name} onChange={(e) => up("name", e.target.value)} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Especie">
          <select style={inputStyle} value={f.species} onChange={(e) => up("species", e.target.value as VetSpecies)}>
            <option value="perro">Perro</option><option value="gato">Gato</option><option value="otro">Otro</option>
          </select>
        </Field>
        <Field label="Raza"><input style={inputStyle} value={f.breed} onChange={(e) => up("breed", e.target.value)} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Sexo">
          <select style={inputStyle} value={f.sex} onChange={(e) => up("sex", e.target.value)}>
            <option value="">—</option><option value="macho">Macho</option><option value="hembra">Hembra</option>
          </select>
        </Field>
        <Field label="Fecha de nacimiento"><input type="date" style={inputStyle} value={f.birth_date} onChange={(e) => up("birth_date", e.target.value)} /></Field>
      </div>
      <div style={{ height: 1, background: C.border, margin: "4px 0 16px" }} />
      <Field label="Dueño *"><input style={inputStyle} value={f.owner_name} onChange={(e) => up("owner_name", e.target.value)} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Teléfono"><input style={inputStyle} value={f.owner_phone} onChange={(e) => up("owner_phone", e.target.value)} /></Field>
        <Field label="Email"><input style={inputStyle} value={f.owner_email} onChange={(e) => up("owner_email", e.target.value)} /></Field>
      </div>
      <Field label="Notas"><textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={f.notes} onChange={(e) => up("notes", e.target.value)} /></Field>
      <SaveBtn onClick={() => onSave(f)} disabled={!valid} />
    </Modal>
  );
}

function VetModal({ onClose, onSave }: { onClose: () => void; onSave: (f: VetForm) => void }) {
  const [f, setF] = useState<VetForm>({ name: "", specialty: "" });
  return (
    <Modal title="Nuevo veterinario" onClose={onClose}>
      <Field label="Nombre *"><input style={inputStyle} value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Dra. / Dr. ..." /></Field>
      <Field label="Especialidad"><input style={inputStyle} value={f.specialty} onChange={(e) => setF((s) => ({ ...s, specialty: e.target.value }))} /></Field>
      <SaveBtn onClick={() => onSave(f)} disabled={!f.name.trim()} />
    </Modal>
  );
}

function ApptModal({ pets, vets, onClose, onSave }: { pets: VetPet[]; vets: VetVet[]; onClose: () => void; onSave: (f: ApptForm) => void }) {
  const [f, setF] = useState<ApptForm>({ pet_id: "", vet_id: "", scheduled_at: "", reason: "" });
  const up = (k: keyof ApptForm, v: string) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.pet_id && f.scheduled_at;
  return (
    <Modal title="Nueva cita" onClose={onClose}>
      <Field label="Paciente *">
        <select style={inputStyle} value={f.pet_id} onChange={(e) => up("pet_id", e.target.value)}>
          <option value="">Selecciona…</option>
          {pets.map((p) => <option key={p.id} value={p.id}>{speciesIcon(p.species)} {p.name} — {p.owner_name}</option>)}
        </select>
      </Field>
      <Field label="Veterinario">
        <select style={inputStyle} value={f.vet_id} onChange={(e) => up("vet_id", e.target.value)}>
          <option value="">Sin asignar</option>
          {vets.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <Field label="Fecha y hora *"><input type="datetime-local" style={inputStyle} value={f.scheduled_at} onChange={(e) => up("scheduled_at", e.target.value)} /></Field>
      <Field label="Motivo"><input style={inputStyle} value={f.reason} onChange={(e) => up("reason", e.target.value)} placeholder="Vacunación, revisión, etc." /></Field>
      <SaveBtn onClick={() => onSave(f)} disabled={!valid} />
    </Modal>
  );
}

function SummaryModal({ summary, onClose }: { summary: VetVisitSummary; onClose: () => void }) {
  const r = summary.raw_summary ?? {};
  const pet = summary.appointment?.pet;
  const vet = summary.appointment?.vet;
  const pending = summary.ai_processed && !summary.approved_at;
  return (
    <Modal title={`Resumen — ${pet?.name ?? "Consulta"}`} onClose={onClose} wide>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {pet?.owner_name ? `Dueño: ${pet.owner_name}` : ""}{vet ? ` · ${vet.name}` : ""}
      </div>
      {pending && (
        <div style={{ background: "#FDF1E3", border: "1px solid #EBC99A", borderRadius: 10,
          padding: "10px 14px", fontSize: 12, color: "#8A5A1F", marginBottom: 16 }}>
          ⏳ Borrador generado por IA. El veterinario debe revisar y aprobar antes de enviarlo al dueño.
          <span style={{ display: "block", marginTop: 4, opacity: .8 }}>(Edición + envío se habilitan en la Fase 3–4.)</span>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SummaryRow icon="🔍" label="Motivo de consulta" text={r.motivo} />
        <SummaryRow icon="💊" label="Diagnóstico / Observaciones" text={r.diagnostico} />
        <SummaryRow icon="📋" label="Indicaciones" text={r.indicaciones} />
        <SummaryRow icon="📅" label="Próxima cita recomendada" text={r.proxima_cita} />
      </div>
      {summary.owner_summary && (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.tealDark }}>
            Ver mensaje al dueño
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.6,
            background: C.mint, padding: 14, borderRadius: 10, marginTop: 10, color: C.charcoal }}>
            {summary.owner_summary}
          </pre>
        </details>
      )}
      <div style={{ marginTop: 16, fontSize: 11, color: C.muted, textAlign: "center" }}>
        {summary.sent_at ? `Enviado el ${fmtDate(summary.sent_at)}` : pending ? "Pendiente de revisión" : "Aprobado, sin enviar"}
      </div>
    </Modal>
  );
}

function SummaryRow({ icon, label, text }: { icon: string; label: string; text?: string }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 14px", background: C.cream, borderRadius: 10,
      borderLeft: `3px solid ${C.teal}` }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: C.tealDark, fontWeight: 600, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: C.charcoal }}>{text ?? "—"}</div>
      </div>
    </div>
  );
}

function PetDetailModal({ pet, appts, onClose }: { pet: VetPet; appts: VetAppointment[]; onClose: () => void }) {
  return (
    <Modal title={`${pet.name}`} onClose={onClose} wide>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: C.mint, display: "grid", placeItems: "center", fontSize: 26 }}>
          {speciesIcon(pet.species)}
        </div>
        <div>
          <div style={{ fontSize: 13, color: C.muted }}>
            {pet.breed ?? "—"}{pet.sex ? ` · ${pet.sex}` : ""}{ageFromBirth(pet.birth_date) ? ` · ${ageFromBirth(pet.birth_date)}` : ""}
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>👤 {pet.owner_name}
            {pet.owner_phone ? ` · 📞 ${pet.owner_phone}` : ""}{pet.owner_email ? ` · ✉️ ${pet.owner_email}` : ""}</div>
        </div>
      </div>
      {pet.notes && (
        <div style={{ background: "#FDF1E3", border: "1px solid #EBC99A", borderRadius: 10, padding: "10px 14px",
          fontSize: 13, color: "#8A5A1F", marginBottom: 16 }}>📌 {pet.notes}</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
        Historial de citas
      </div>
      {appts.length === 0 ? <Empty msg="Sin citas registradas." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {appts.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 12px", background: C.cream, borderRadius: 9, fontSize: 13 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{a.reason ?? "Consulta"}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{fmtDateTime(a.scheduled_at)}</div>
              </div>
              <Chip {...STATUS_META[a.status]} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
