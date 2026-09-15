"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ConsultaRecorder from "@/components/trufa/ConsultaRecorder";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Section, Modal as DModal,
  StatCard as DStatCard, Empty as DEmpty, Field as DField, SaveBtn as DSaveBtn,
  type DashTheme,
} from "@/components/dashboard";

// ─── Trufa — el carnet de tu mascota (B2C) ────────────────────────────────────
// Mismo patrón que /finanzas: app de cliente final sobre la plataforma
// multi-tenant. La diferencia importante es el aislamiento: aquí NO alcanza
// client_id, porque todos los suscriptores comparten el cliente "trufa". El
// candado real es user_owns_pet() en la BD — dueño titular, co-dueños
// invitados (vet_pet_owners) o acceso de administrador.

// ─── Tema Trufa (crema, tinta, terracota) ────────────────────────────────────
const TERRACOTA = "#C2552E";
const SALVIA    = "#5F8A6A";
const AMBAR     = "#E0A33E";
const TINTA     = "#1F1714";
const CREMA     = "#F6F0E8";
const ARENA     = "#E3D7C7";

const T: DashTheme = {
  accent: TERRACOTA, accentDark: "#9C4123", accentSoft: "rgba(194,85,46,.12)",
  bg: CREMA, surface: "#FFFFFF", text: TINTA,
  muted: "#8E7D6D", border: ARENA, danger: "#B03A1C", disabled: "#C9BCA9",
  panel: "#FBF7F1",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${ARENA}`,
  fontSize: 14, fontFamily: "inherit", background: "#FFFFFF", color: TINTA,
};
const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Empty    = (p: Omit<React.ComponentProps<typeof DEmpty>,    "theme">) => <DEmpty    theme={T} {...p} />;
const Field    = (p: Omit<React.ComponentProps<typeof DField>,    "theme">) => <DField    theme={T} {...p} />;
const SaveBtn  = (p: Omit<React.ComponentProps<typeof DSaveBtn>,  "theme">) => <DSaveBtn  theme={T} {...p} />;
const Modal    = (p: Omit<React.ComponentProps<typeof DModal>,    "theme">) => <DModal    theme={T} {...p} />;

// ─── Types ────────────────────────────────────────────────────────────────────
type TabKey = "carnet" | "salud" | "consultas" | "peso" | "duenos";

interface Pet {
  id: string; client_id: string; name: string; species: string;
  breed: string | null; sex: string | null; birth_date: string | null;
  color: string | null; microchip: string | null; notes: string | null;
}
interface Vaccination {
  id: string; applied_on: string; vaccine: string; brand: string | null;
  lot: string | null; next_due_on: string | null; vet_name: string | null; notes: string | null;
}
interface Deworming {
  id: string; applied_on: string; kind: string; product: string;
  weight_kg: number | null; next_due_on: string | null; notes: string | null;
}
interface Weight { id: string; measured_on: string; weight_kg: number; source: string; }
interface Condition {
  id: string; name: string; diagnosed_on: string | null; status: string; notes: string | null;
}
interface Treatment {
  id: string; condition_id: string | null; product: string; dose: string | null;
  applied_on: string; lot: string | null; weight_kg: number | null;
  next_due_on: string | null; notes: string | null;
}
/** Lo que el modelo sacó de la grabación. Los null son deliberados: si la
 *  dosis no se escuchó, se queda vacía y sube a `preguntas`. */
interface IndicacionVet {
  que: string; producto: string | null; dosis: string | null;
  frecuencia: string | null; duracion: string | null;
}
interface NotaVet {
  motivo: string | null; hallazgos: string | null;
  indicaciones: IndicacionVet[]; proxima_cita: string | null;
  preguntas: string[]; resumen: string | null;
}
interface Consulta {
  id: string;
  appointment_id: string;
  owner_summary: string | null;
  raw_summary: NotaVet | null;
  created_at: string;
  appointment: { scheduled_at: string; reason: string | null; notes: string | null } | null;
}
interface PetOwner {
  id: string; user_id: string | null; email: string;
  display_name: string | null; role: string; accepted_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const todayStr = () => new Date().toLocaleDateString("en-CA");

/** "2026-09-15" → "15 sep 2026". Se parte el string: new Date(iso) corre un día en México. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayStr().split("-").map(Number);
  return Math.round((target - Date.UTC(ty, tm - 1, td)) / 86400000);
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
function ageLabel(birth: string | null): string {
  if (!birth) return "—";
  const [y, m] = birth.split("-").map(Number);
  const [ty, tm] = todayStr().split("-").map(Number);
  let years = ty - y;
  if (tm < m) years -= 1;
  return `${years} ${years === 1 ? "año" : "años"}`;
}
/** Mediana de los intervalos entre aplicaciones — sirve para estimar la próxima. */
function medianGap(datesDesc: string[]): number | null {
  if (datesDesc.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 0; i < datesDesc.length - 1; i++) {
    const a = Date.parse(datesDesc[i] + "T00:00:00Z");
    const b = Date.parse(datesDesc[i + 1] + "T00:00:00Z");
    gaps.push(Math.round((a - b) / 86400000));
  }
  gaps.sort((x, y) => x - y);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

type AgendaItem = { key: string; label: string; detail: string; due: string; estimated: boolean };

function statusOf(due: string): { color: string; bg: string; text: string } {
  const d = daysUntil(due);
  if (d < 0)  return { color: TERRACOTA, bg: "rgba(194,85,46,.12)",  text: `Vencida hace ${Math.abs(d)} d` };
  if (d === 0) return { color: TERRACOTA, bg: "rgba(194,85,46,.12)", text: "Es hoy" };
  if (d <= 21) return { color: AMBAR, bg: "rgba(224,163,62,.16)",    text: `En ${d} d` };
  return { color: SALVIA, bg: "rgba(95,138,106,.14)",                text: `En ${d} d` };
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function TrufaApp() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [petId, setPetId] = useState<string | null>(null);
  const [vacunas, setVacunas] = useState<Vaccination[]>([]);
  const [desp, setDesp] = useState<Deworming[]>([]);
  const [pesos, setPesos] = useState<Weight[]>([]);
  const [cond, setCond] = useState<Condition[]>([]);
  const [trat, setTrat] = useState<Treatment[]>([]);
  const [duenos, setDuenos] = useState<PetOwner[]>([]);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [tab, setTab] = useState<TabKey>("carnet");
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "vacuna" | "tratamiento" | "desparasitacion" | "peso" | "invitar" | "mascota">(null);
  const [saving, setSaving] = useState(false);

  const pet = useMemo(() => pets.find(p => p.id === petId) ?? null, [pets, petId]);
  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600); }, []);

  // ── Carga inicial: sesión → reclamo de invitaciones → mascotas ──────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/trufaapp/registro"); return; }
      try {
        const res = await fetch("/api/trufa/provision", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) { const j = await res.json(); setClientId(j.client_id ?? null); }
      } catch { /* la RLS resuelve el acceso igual */ }

      // Solo las mascotas de las que ESTE usuario es dueño. No basta con la RLS:
      // user_owns_pet() también deja pasar por user_has_access_to_client(), así
      // que un administrador veía aquí las mascotas demo de la clínica SieckVet.
      // El carnet B2C se arma desde vet_pet_owners, no desde el cliente.
      const email = session.user.email ?? "";
      const { data: links, error: linkErr } = await supabase
        .from("vet_pet_owners")
        .select("pet_id")
        .or(`user_id.eq.${session.user.id},email.eq.${email}`);
      if (linkErr) { say("No se pudo cargar tu carnet."); setLoading(false); return; }

      const ids = Array.from(new Set((links ?? []).map(l => l.pet_id as string)));
      if (ids.length === 0) { setPets([]); setPetId(null); setLoading(false); return; }

      const { data, error } = await supabase
        .from("vet_pets")
        .select("id, client_id, name, species, breed, sex, birth_date, color, microchip, notes")
        .in("id", ids)
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (error) { say("No se pudo cargar tu carnet."); setLoading(false); return; }
      setPets((data ?? []) as Pet[]);
      setPetId(data?.[0]?.id ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Carga del carnet de la mascota seleccionada ────────────────────────────
  const loadPet = useCallback(async (id: string) => {
    const [v, d, w, c, t, o, s] = await Promise.all([
      supabase.from("vet_vaccinations").select("id, applied_on, vaccine, brand, lot, next_due_on, vet_name, notes").eq("pet_id", id).order("applied_on", { ascending: false }),
      supabase.from("vet_dewormings").select("id, applied_on, kind, product, weight_kg, next_due_on, notes").eq("pet_id", id).order("applied_on", { ascending: false }),
      supabase.from("vet_weights").select("id, measured_on, weight_kg, source").eq("pet_id", id).order("measured_on", { ascending: false }),
      supabase.from("vet_conditions").select("id, name, diagnosed_on, status, notes").eq("pet_id", id).order("created_at", { ascending: true }),
      supabase.from("vet_treatments").select("id, condition_id, product, dose, applied_on, lot, weight_kg, next_due_on, notes").eq("pet_id", id).order("applied_on", { ascending: false }),
      supabase.from("vet_pet_owners").select("id, user_id, email, display_name, role, accepted_at").eq("pet_id", id).order("created_at", { ascending: true }),
      supabase.from("vet_appointments")
        .select("id, scheduled_at, reason, notes")
        .eq("pet_id", id)
        .order("scheduled_at", { ascending: false }),
    ]);
    setVacunas((v.data ?? []) as Vaccination[]);
    setDesp((d.data ?? []) as Deworming[]);
    setPesos((w.data ?? []) as Weight[]);
    setCond((c.data ?? []) as Condition[]);
    setTrat((t.data ?? []) as Treatment[]);
    setDuenos((o.data ?? []) as PetOwner[]);

    // Las consultas se arman en dos pasos: primero las citas de ESTA mascota y
    // luego sus notas. Un join con filtro embebido haría lo mismo, pero deja la
    // correctitud en manos de la sintaxis de PostgREST; esto no.
    const citas = (s.data ?? []) as { id: string; scheduled_at: string; reason: string | null; notes: string | null }[];
    if (citas.length === 0) { setConsultas([]); return; }
    const { data: notas } = await supabase
      .from("vet_visit_summaries")
      .select("id, appointment_id, owner_summary, raw_summary, created_at")
      .in("appointment_id", citas.map(a => a.id))
      .order("created_at", { ascending: false });
    const porCita = new Map(citas.map(a => [a.id, a]));
    setConsultas(((notas ?? []) as Record<string, unknown>[]).map(n => ({
      ...n,
      appointment: porCita.get(n.appointment_id as string) ?? null,
    })) as unknown as Consulta[]);
  }, []);

  useEffect(() => { if (petId) loadPet(petId); }, [petId, loadPet]);

  // ── Agenda: lo que viene, con estimación cuando el MVZ no anotó fecha ───────
  const agenda = useMemo<AgendaItem[]>(() => {
    const items: AgendaItem[] = [];

    // Una entrada por LÍNEA, no por dosis: la refuerzo de este año sustituye a
    // la del año pasado. Sin esto, cada dosis vieja se queda vencida para
    // siempre y el contador de vencidas miente (8 cuando en realidad son 4).
    const latestBy = <R extends { applied_on: string }>(rows: R[], keyOf: (r: R) => string) => {
      const m = new Map<string, R>();
      for (const r of rows) {
        const k = keyOf(r);
        const prev = m.get(k);
        if (!prev || r.applied_on > prev.applied_on) m.set(k, r);
      }
      return Array.from(m.values());
    };

    for (const v of latestBy(vacunas, r => r.vaccine.trim().toLowerCase())) {
      if (v.next_due_on) items.push({ key: `v-${v.id}`, label: v.vaccine, detail: v.brand ?? "Vacuna", due: v.next_due_on, estimated: false });
    }
    for (const d of latestBy(desp, r => r.kind)) {
      if (d.next_due_on) items.push({ key: `d-${d.id}`, label: `Desparasitación ${d.kind}`, detail: d.product, due: d.next_due_on, estimated: false });
    }

    // Tratamientos: una entrada por producto, la más reciente. Si el MVZ no
    // anotó próxima fecha, se estima con la mediana de los intervalos reales.
    const byProduct = new Map<string, Treatment[]>();
    for (const t of trat) {
      const arr = byProduct.get(t.product) ?? [];
      arr.push(t);
      byProduct.set(t.product, arr);
    }
    for (const [product, list] of byProduct) {
      const last = list[0];
      if (last.next_due_on) {
        items.push({ key: `t-${last.id}`, label: product, detail: last.dose ?? "Tratamiento", due: last.next_due_on, estimated: false });
        continue;
      }
      const gap = medianGap(list.map(x => x.applied_on));
      if (gap && gap > 0) {
        items.push({
          key: `t-est-${last.id}`, label: product,
          detail: `${last.dose ?? "Tratamiento"} · cada ~${Math.round(gap / 7)} semanas`,
          due: addDays(last.applied_on, gap), estimated: true,
        });
      }
    }

    return items.sort((a, b) => a.due.localeCompare(b.due));
  }, [vacunas, desp, trat]);

  const proxima = agenda[0] ?? null;
  const pesoActual = pesos[0] ?? null;
  const pesoPrevio = pesos[1] ?? null;
  const vencidas = agenda.filter(a => daysUntil(a.due) < 0).length;

  // ── Guardados ──────────────────────────────────────────────────────────────
  async function insertRow(table: string, row: Record<string, unknown>, okMsg: string) {
    if (!pet) return;
    setSaving(true);
    const { error } = await supabase.from(table).insert({ ...row, pet_id: pet.id, client_id: pet.client_id });
    setSaving(false);
    if (error) { say("No se pudo guardar. Revisa los datos."); return; }
    setModal(null);
    say(okMsg);
    loadPet(pet.id);
  }

  async function crearMascota(form: Record<string, string>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !clientId) { say("Falta la sesión. Vuelve a entrar."); return; }
    setSaving(true);
    const { data, error } = await supabase.from("vet_pets").insert({
      client_id: clientId,
      name: form.name,
      species: form.species || "perro",
      breed: form.breed || null,
      sex: form.sex || null,
      birth_date: form.birth_date || null,
      owner_name: session.user.email ?? "",
      owner_email: session.user.email ?? "",
      owner_user_id: session.user.id,
      active: true,
    }).select("id, client_id, name, species, breed, sex, birth_date, color, microchip, notes").single();
    if (error || !data) { setSaving(false); say("No se pudo crear la mascota."); return; }
    await supabase.from("vet_pet_owners").insert({
      pet_id: data.id, user_id: session.user.id, email: session.user.email,
      display_name: session.user.email, role: "titular", accepted_at: new Date().toISOString(),
    });
    setSaving(false);
    setPets(prev => [...prev, data as Pet]);
    setPetId(data.id);
    setModal(null);
    say(`${data.name} quedó registrado.`);
  }

  async function invitar(email: string, nombre: string) {
    if (!pet) return;
    setSaving(true);
    const { error } = await supabase.from("vet_pet_owners").insert({
      pet_id: pet.id, email: email.trim().toLowerCase(),
      display_name: nombre.trim() || null, role: "coowner",
    });
    setSaving(false);
    if (error) {
      say(error.code === "23505" ? "Ese correo ya está invitado." : "No se pudo invitar.");
      return;
    }
    setModal(null);
    say("Invitación lista. Pídele que cree su cuenta con ese correo.");
    loadPet(pet.id);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: CREMA, color: T.muted, display: "flex",
        alignItems: "center", justifyContent: "center", fontFamily: "Inter, -apple-system, sans-serif" }}>
        Cargando tu carnet…
      </div>
    );
  }

  const shell: React.CSSProperties = {
    minHeight: "100vh", background: CREMA, color: TINTA,
    fontFamily: "Inter, -apple-system, sans-serif",
    paddingBottom: 48,
  };
  const wrap: React.CSSProperties = { maxWidth: 780, margin: "0 auto", padding: "0 16px" };

  if (!pet) {
    return (
      <div style={shell}>
        <div style={{ ...wrap, paddingTop: 72, textAlign: "center" }}>
          <img src="/trufa-isotipo.svg" alt="Trufa" style={{ width: 58, height: 51 }} />
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", margin: "14px 0 8px" }}>
            Aún no hay ninguna mascota
          </h1>
          <p style={{ color: T.muted, fontSize: 15, lineHeight: 1.6, maxWidth: 420, margin: "0 auto 24px" }}>
            Registra a tu compañero y empieza a pasar su carnet de papel aquí.
          </p>
          <button onClick={() => setModal("mascota")}
            style={{ padding: "12px 22px", borderRadius: 10, border: "none", background: TERRACOTA,
              color: "#FFF4EC", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
            Registrar mascota
          </button>
        </div>
        {modal === "mascota" && (
          <Modal title="Nueva mascota" onClose={() => setModal(null)}>
            <MascotaForm saving={saving} onSave={crearMascota} />
          </Modal>
        )}
        <Toast msg={toast} theme={T} />
      </div>
    );
  }

  return (
    <div style={shell}>
      <DashboardHeader
        theme={T}
        sticky
        iconShape="circle"
        iconBg="#FFFFFF"
        icon={<img src="/trufa-isotipo.svg" alt="" style={{ width: 24, height: 21 }} />}
        title={pet.name}
        subtitle={`${pet.breed ?? pet.species} · ${ageLabel(pet.birth_date)}`}
        onLogout={async () => { await supabase.auth.signOut(); router.push("/trufaapp/registro"); }}
        right={pets.length > 1 ? (
          <select value={pet.id} onChange={e => setPetId(e.target.value)}
            style={{ ...inp, width: "auto", padding: "7px 10px" }}>
            {pets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : undefined}
      />

      <div style={wrap}>
        <div style={{ margin: "16px 0" }}>
          <TabBar<TabKey>
            theme={T}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "carnet", label: "Carnet" },
              { id: "salud",  label: "Salud" },
              { id: "consultas", label: "Consultas" },
              { id: "peso",   label: "Peso" },
              { id: "duenos", label: "Dueños" },
            ]}
          />
        </div>

        {/* ── Carnet ── */}
        {tab === "carnet" && (
          <>
            <StatGrid>
              <StatCard label="Próxima fecha" icon="📅"
                value={proxima ? fmtDate(proxima.due) : "Sin pendientes"}
                sub={proxima ? proxima.label : undefined}
                highlight accent={proxima ? statusOf(proxima.due).color : SALVIA} />
              <StatCard label="Peso actual" icon="⚖️"
                value={pesoActual ? `${pesoActual.weight_kg} kg` : "—"}
                sub={pesoActual && pesoPrevio
                  ? `${pesoActual.weight_kg >= pesoPrevio.weight_kg ? "▲" : "▼"} ${Math.abs(pesoActual.weight_kg - pesoPrevio.weight_kg).toFixed(1)} kg vs anterior`
                  : undefined} />
              <StatCard label="Vencidas" icon="⚠️" value={String(vencidas)}
                accent={vencidas > 0 ? TERRACOTA : SALVIA} />
            </StatGrid>

            <Section theme={T} title="Lo que viene">
              {agenda.length === 0 ? <Empty msg="No hay fechas pendientes anotadas." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agenda.map(a => {
                    const st = statusOf(a.due);
                    return (
                      <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 12,
                        padding: "12px 14px", background: "#FFFFFF", border: `1px solid ${ARENA}`, borderRadius: 11 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: st.color, flexShrink: 0 }} />
                        <div style={{ flexGrow: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{a.label}</div>
                          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>
                            {a.detail}{a.estimated ? " · fecha estimada" : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtDate(a.due)}</div>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: st.color,
                            background: st.bg, borderRadius: 999, padding: "2px 8px", marginTop: 3, display: "inline-block" }}>
                            {st.text}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section theme={T} title="Datos">
              <div style={{ background: "#FFFFFF", border: `1px solid ${ARENA}`, borderRadius: 11, padding: "6px 14px" }}>
                {[
                  ["Especie", pet.species],
                  ["Raza", pet.breed ?? "—"],
                  ["Sexo", pet.sex ?? "—"],
                  ["Nacimiento", fmtDate(pet.birth_date)],
                  ["Color", pet.color ?? "—"],
                  ["Microchip", pet.microchip ?? "—"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16,
                    padding: "10px 0", borderBottom: `1px solid ${CREMA}`, fontSize: 14 }}>
                    <span style={{ color: T.muted }}>{k}</span>
                    <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* ── Salud ── */}
        {tab === "salud" && (
          <>
            <Section theme={T} title="Padecimientos">
              {cond.length === 0 ? <Empty msg="Ninguno registrado." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cond.map(c => (
                    <div key={c.id} style={{ padding: "12px 14px", background: "#FFFFFF",
                      border: `1px solid ${ARENA}`, borderRadius: 11 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: c.status === "activo" ? AMBAR : SALVIA,
                          background: c.status === "activo" ? "rgba(224,163,62,.16)" : "rgba(95,138,106,.14)",
                          borderRadius: 999, padding: "2px 9px", height: "fit-content" }}>{c.status}</div>
                      </div>
                      {c.diagnosed_on && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>Desde {fmtDate(c.diagnosed_on)}</div>}
                      {c.notes && <div style={{ fontSize: 13, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{c.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section theme={T} title="Tratamientos"
              action={{ label: "Agregar", onClick: () => setModal("tratamiento") }}>
              {trat.length === 0 ? <Empty msg="Sin tratamientos registrados." /> : (
                <HistoryList rows={trat.map(t => ({
                  id: t.id, title: `${t.product}${t.dose ? ` · ${t.dose}` : ""}`,
                  date: t.applied_on,
                  meta: [t.lot ? `Lote ${t.lot}` : null, t.weight_kg ? `${t.weight_kg} kg` : null, t.notes].filter(Boolean).join(" · "),
                }))} />
              )}
            </Section>

            <Section theme={T} title="Vacunas"
              action={{ label: "Agregar", onClick: () => setModal("vacuna") }}>
              {vacunas.length === 0 ? <Empty msg="Sin vacunas registradas." /> : (
                <HistoryList rows={vacunas.map(v => ({
                  id: v.id, title: v.vaccine, date: v.applied_on,
                  meta: [v.brand, v.lot ? `Lote ${v.lot}` : null, v.next_due_on ? `Próxima ${fmtDate(v.next_due_on)}` : null].filter(Boolean).join(" · "),
                }))} />
              )}
            </Section>

            <Section theme={T} title="Desparasitación"
              action={{ label: "Agregar", onClick: () => setModal("desparasitacion") }}>
              {desp.length === 0 ? <Empty msg="Sin registros." /> : (
                <HistoryList rows={desp.map(d => ({
                  id: d.id, title: d.product, date: d.applied_on,
                  meta: [d.kind, d.weight_kg ? `${d.weight_kg} kg` : null, d.next_due_on ? `Próxima ${fmtDate(d.next_due_on)}` : null].filter(Boolean).join(" · "),
                }))} />
              )}
            </Section>
          </>
        )}

        {/* ── Consultas ── */}
        {tab === "consultas" && (
          <>
            <Section theme={T} title="Grabar una consulta">
              <ConsultaRecorder
                petId={pet.id}
                onSaved={async () => { await loadPet(pet.id); say("Consulta guardada."); }}
                theme={{ accent: TERRACOTA, surface: "#FFFFFF", border: ARENA, text: TINTA, muted: T.muted, danger: T.danger, panel: T.panel }}
              />
              <p style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.6, margin: "14px 0 0" }}>
                Esto es tu memoria de lo que te dijeron, no un documento clínico. Si algo no se
                escuchó bien, Trufa lo deja en blanco y te lo apunta como pregunta en vez de
                inventarlo — sobre todo las dosis.
              </p>
            </Section>

            <Section theme={T} title="Consultas guardadas">
              {consultas.length === 0 ? <Empty msg="Todavía no hay ninguna." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {consultas.map(c => {
                    const n = c.raw_summary;
                    const fecha = (c.appointment?.scheduled_at ?? c.created_at).slice(0, 10);
                    return (
                      <div key={c.id} style={{ background: "#FFFFFF", border: `1px solid ${ARENA}`,
                        borderRadius: 11, padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>
                            {n?.motivo ?? c.appointment?.reason ?? "Consulta"}
                          </div>
                          <div style={{ fontSize: 13, color: T.muted, whiteSpace: "nowrap" }}>{fmtDate(fecha)}</div>
                        </div>

                        {n?.hallazgos && (
                          <p style={{ fontSize: 14, lineHeight: 1.6, color: TINTA, margin: "0 0 12px" }}>{n.hallazgos}</p>
                        )}

                        {n?.indicaciones && n.indicaciones.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em",
                              textTransform: "uppercase", color: T.muted, marginBottom: 7 }}>Qué hacer en casa</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                              {n.indicaciones.map((ind, i) => {
                                const detalle = [ind.dosis, ind.frecuencia, ind.duracion].filter(Boolean).join(" · ");
                                return (
                                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: SALVIA, marginTop: 7, flexShrink: 0 }} />
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                                        {ind.que}{ind.producto ? ` — ${ind.producto}` : ""}
                                      </div>
                                      {detalle && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>{detalle}</div>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {n?.proxima_cita && (
                          <div style={{ fontSize: 13.5, color: TINTA, background: "rgba(95,138,106,.12)",
                            borderRadius: 9, padding: "9px 12px", marginBottom: n.preguntas?.length ? 10 : 0 }}>
                            <strong>Seguimiento:</strong> {n.proxima_cita}
                          </div>
                        )}

                        {n?.preguntas && n.preguntas.length > 0 && (
                          <div style={{ background: "rgba(224,163,62,.14)", borderRadius: 9, padding: "10px 12px" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5A1C", marginBottom: 5 }}>
                              Esto no se entendió — vuelve a preguntarlo
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 17 }}>
                              {n.preguntas.map((q, i) => (
                                <li key={i} style={{ fontSize: 13, color: "#7A5A1C", lineHeight: 1.5 }}>{q}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        )}

        {/* ── Peso ── */}
        {tab === "peso" && (
          <Section theme={T} title="Historial de peso"
            action={{ label: "Agregar", onClick: () => setModal("peso") }}>
            {pesos.length === 0 ? <Empty msg="Sin mediciones." /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pesos.map((w, i) => {
                  const prev = pesos[i + 1];
                  const delta = prev ? w.weight_kg - prev.weight_kg : null;
                  return (
                    <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 14px", background: "#FFFFFF", border: `1px solid ${ARENA}`, borderRadius: 11 }}>
                      <div style={{ flexGrow: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{w.weight_kg} kg</div>
                        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>{w.source}</div>
                      </div>
                      {delta !== null && Math.abs(delta) >= 0.05 && (
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: delta > 0 ? AMBAR : SALVIA }}>
                          {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} kg
                        </div>
                      )}
                      <div style={{ fontSize: 13, color: T.muted, minWidth: 92, textAlign: "right" }}>{fmtDate(w.measured_on)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {/* ── Dueños ── */}
        {tab === "duenos" && (
          <Section theme={T} title="Quién puede ver y anotar"
            action={{ label: "Invitar", onClick: () => setModal("invitar") }}>
            <p style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.6, margin: "0 0 14px" }}>
              Quien invites entra con su propio correo y contraseña, y puede agregar información igual que tú.
              Útil cuando uno lleva a la mascota al veterinario y el otro no.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {duenos.map(o => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", background: "#FFFFFF", border: `1px solid ${ARENA}`, borderRadius: 11 }}>
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{o.display_name ?? o.email}</div>
                    <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{o.email}</div>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 9px",
                    color: o.role === "titular" ? TERRACOTA : (o.accepted_at ? SALVIA : T.muted),
                    background: o.role === "titular" ? "rgba(194,85,46,.12)" : (o.accepted_at ? "rgba(95,138,106,.14)" : CREMA) }}>
                    {o.role === "titular" ? "Titular" : o.accepted_at ? "Activo" : "Invitado"}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* ── Modales ── */}
      {modal === "vacuna" && (
        <Modal title="Nueva vacuna" onClose={() => setModal(null)}>
          <VacunaForm saving={saving} onSave={r => insertRow("vet_vaccinations", r, "Vacuna guardada.")} />
        </Modal>
      )}
      {modal === "tratamiento" && (
        <Modal title="Nueva aplicación" onClose={() => setModal(null)}>
          <TratamientoForm saving={saving} conditions={cond} onSave={r => insertRow("vet_treatments", r, "Aplicación guardada.")} />
        </Modal>
      )}
      {modal === "desparasitacion" && (
        <Modal title="Nueva desparasitación" onClose={() => setModal(null)}>
          <DespForm saving={saving} onSave={r => insertRow("vet_dewormings", r, "Desparasitación guardada.")} />
        </Modal>
      )}
      {modal === "peso" && (
        <Modal title="Nuevo peso" onClose={() => setModal(null)}>
          <PesoForm saving={saving} onSave={r => insertRow("vet_weights", r, "Peso guardado.")} />
        </Modal>
      )}
      {modal === "invitar" && (
        <Modal title="Invitar a otro dueño" onClose={() => setModal(null)}>
          <InvitarForm saving={saving} onSave={invitar} />
        </Modal>
      )}
      {modal === "mascota" && (
        <Modal title="Nueva mascota" onClose={() => setModal(null)}>
          <MascotaForm saving={saving} onSave={crearMascota} />
        </Modal>
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );
}

// ─── Lista de historial (vacunas, tratamientos, desparasitación) ──────────────
function HistoryList({ rows }: { rows: { id: string; title: string; date: string; meta: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(r => (
        <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 12,
          padding: "12px 14px", background: "#FFFFFF", border: `1px solid ${ARENA}`, borderRadius: 11 }}>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.title}</div>
            {r.meta && <div style={{ fontSize: 12.5, color: "#8E7D6D", marginTop: 3, lineHeight: 1.45 }}>{r.meta}</div>}
          </div>
          <div style={{ fontSize: 13, color: "#8E7D6D", whiteSpace: "nowrap", flexShrink: 0 }}>{fmtDate(r.date)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Formularios ──────────────────────────────────────────────────────────────
type SaveFn = (row: Record<string, unknown>) => void;

function VacunaForm({ saving, onSave }: { saving: boolean; onSave: SaveFn }) {
  const [f, setF] = useState({ applied_on: todayStr(), vaccine: "", brand: "", lot: "", next_due_on: "", vet_name: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <Field label="Vacuna"><input style={inp} value={f.vaccine} onChange={set("vaccine")} placeholder="Rabia, Quíntuple…" /></Field>
      <Field label="Fecha de aplicación"><input style={inp} type="date" value={f.applied_on} onChange={set("applied_on")} /></Field>
      <Field label="Marca"><input style={inp} value={f.brand} onChange={set("brand")} placeholder="Nobivac, Defensor…" /></Field>
      <Field label="Lote"><input style={inp} value={f.lot} onChange={set("lot")} /></Field>
      <Field label="Próxima vacunación"><input style={inp} type="date" value={f.next_due_on} onChange={set("next_due_on")} /></Field>
      <Field label="Médico veterinario"><input style={inp} value={f.vet_name} onChange={set("vet_name")} /></Field>
      <SaveBtn disabled={saving || !f.vaccine.trim()} onClick={() => onSave({
        applied_on: f.applied_on, vaccine: f.vaccine.trim(), brand: f.brand || null,
        lot: f.lot || null, next_due_on: f.next_due_on || null, vet_name: f.vet_name || null,
      })} />
    </>
  );
}

function TratamientoForm({ saving, conditions, onSave }: { saving: boolean; conditions: Condition[]; onSave: SaveFn }) {
  const [f, setF] = useState({
    product: "", dose: "", applied_on: todayStr(), lot: "", weight_kg: "",
    next_due_on: "", condition_id: conditions[0]?.id ?? "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <Field label="Producto"><input style={inp} value={f.product} onChange={set("product")} placeholder="Cytopoint, Apoquel…" /></Field>
      <Field label="Dosis"><input style={inp} value={f.dose} onChange={set("dose")} placeholder="30 mg" /></Field>
      <Field label="Fecha de aplicación"><input style={inp} type="date" value={f.applied_on} onChange={set("applied_on")} /></Field>
      {conditions.length > 0 && (
        <Field label="Padecimiento">
          <select style={inp} value={f.condition_id} onChange={set("condition_id")}>
            <option value="">Sin asociar</option>
            {conditions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Lote"><input style={inp} value={f.lot} onChange={set("lot")} /></Field>
      <Field label="Peso (kg)"><input style={inp} type="number" step="0.1" value={f.weight_kg} onChange={set("weight_kg")} /></Field>
      <Field label="Próxima aplicación"><input style={inp} type="date" value={f.next_due_on} onChange={set("next_due_on")} /></Field>
      <SaveBtn disabled={saving || !f.product.trim()} onClick={() => onSave({
        product: f.product.trim(), dose: f.dose || null, applied_on: f.applied_on,
        lot: f.lot || null, weight_kg: f.weight_kg ? Number(f.weight_kg) : null,
        next_due_on: f.next_due_on || null, condition_id: f.condition_id || null,
      })} />
    </>
  );
}

function DespForm({ saving, onSave }: { saving: boolean; onSave: SaveFn }) {
  const [f, setF] = useState({ product: "", kind: "interna", applied_on: todayStr(), weight_kg: "", next_due_on: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <Field label="Producto"><input style={inp} value={f.product} onChange={set("product")} placeholder="Endal Plus, Vermiplex…" /></Field>
      <Field label="Tipo">
        <select style={inp} value={f.kind} onChange={set("kind")}>
          <option value="interna">Interna</option>
          <option value="externa">Externa (pulgas y garrapatas)</option>
        </select>
      </Field>
      <Field label="Fecha"><input style={inp} type="date" value={f.applied_on} onChange={set("applied_on")} /></Field>
      <Field label="Peso (kg)"><input style={inp} type="number" step="0.1" value={f.weight_kg} onChange={set("weight_kg")} /></Field>
      <Field label="Próxima aplicación"><input style={inp} type="date" value={f.next_due_on} onChange={set("next_due_on")} /></Field>
      <SaveBtn disabled={saving || !f.product.trim()} onClick={() => onSave({
        product: f.product.trim(), kind: f.kind, applied_on: f.applied_on,
        weight_kg: f.weight_kg ? Number(f.weight_kg) : null, next_due_on: f.next_due_on || null,
      })} />
    </>
  );
}

function PesoForm({ saving, onSave }: { saving: boolean; onSave: SaveFn }) {
  const [f, setF] = useState({ weight_kg: "", measured_on: todayStr(), source: "consulta" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <Field label="Peso (kg)"><input style={inp} type="number" step="0.1" value={f.weight_kg} onChange={set("weight_kg")} autoFocus /></Field>
      <Field label="Fecha"><input style={inp} type="date" value={f.measured_on} onChange={set("measured_on")} /></Field>
      <Field label="Dónde se midió">
        <select style={inp} value={f.source} onChange={set("source")}>
          <option value="consulta">Consulta</option>
          <option value="revision">Revisión</option>
          <option value="casa">En casa</option>
        </select>
      </Field>
      <SaveBtn disabled={saving || !f.weight_kg} onClick={() => onSave({
        weight_kg: Number(f.weight_kg), measured_on: f.measured_on, source: f.source,
      })} />
    </>
  );
}

function InvitarForm({ saving, onSave }: { saving: boolean; onSave: (email: string, nombre: string) => void }) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  return (
    <>
      <Field label="Correo"><input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" autoFocus /></Field>
      <Field label="Nombre (opcional)"><input style={inp} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Martha" /></Field>
      <p style={{ fontSize: 12.5, color: "#8E7D6D", lineHeight: 1.55, margin: "4px 0 14px" }}>
        Al crear su cuenta con ese correo en trufa, verá este carnet automáticamente.
      </p>
      <SaveBtn label="Invitar" disabled={saving || !email.includes("@")} onClick={() => onSave(email, nombre)} />
    </>
  );
}

function MascotaForm({ saving, onSave }: { saving: boolean; onSave: (f: Record<string, string>) => void }) {
  const [f, setF] = useState({ name: "", species: "perro", breed: "", sex: "", birth_date: "" });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <Field label="Nombre"><input style={inp} value={f.name} onChange={set("name")} placeholder="Macario" autoFocus /></Field>
      <Field label="Especie">
        <select style={inp} value={f.species} onChange={set("species")}>
          <option value="perro">Perro</option>
          <option value="gato">Gato</option>
          <option value="otro">Otro</option>
        </select>
      </Field>
      <Field label="Raza"><input style={inp} value={f.breed} onChange={set("breed")} /></Field>
      <Field label="Sexo">
        <select style={inp} value={f.sex} onChange={set("sex")}>
          <option value="">Sin especificar</option>
          <option value="macho">Macho</option>
          <option value="hembra">Hembra</option>
        </select>
      </Field>
      <Field label="Fecha de nacimiento"><input style={inp} type="date" value={f.birth_date} onChange={set("birth_date")} /></Field>
      <SaveBtn disabled={saving || !f.name.trim()} onClick={() => onSave(f)} />
    </>
  );
}
