"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Client ───────────────────────────────────────────────────────────────────
export const AUTOLAVADO_CLIENT_ID = "e87f4d4c-c8e6-48b8-a514-d240b8323b3d";

// ─── Design tokens ────────────────────────────────────────────────────────────
const PR   = "#0066FF";
const PR_D = "#0052CC";
const PR_L = "#EFF6FF";
const OK   = "#22C55E";
const OK_L = "#F0FDF4";
const WA   = "#F59E0B";
const PU   = "#8B5CF6";
const G50  = "#F8FAFC";
const G100 = "#F1F5F9";
const G200 = "#E2E8F0";
const G400 = "#94A3B8";
const G600 = "#475569";
const G800 = "#1E293B";
const WH   = "#FFFFFF";

// ─── Types ────────────────────────────────────────────────────────────────────
type Tamanio    = "chico" | "mediano" | "grande";
type Pago       = "Efectivo" | "Tarjeta" | "Transferencia";
type TicketStatus = "en_proceso" | "listo" | "entregado" | "cancelado";
type TabKey     = "registrar" | "servicios" | "reportes";
type RepPeriod  = "dia" | "semana" | "mes";

interface Paquete {
  id: string; nombre: string; descripcion: string | null;
  duracion_min: number; sort_order: number;
}
interface PrecioRow { paquete_id: string; tamanio: Tamanio; precio: number; }
interface StaffMember { id: string; nombre: string; rol: "lavador" | "gerente"; activo: boolean; }

interface Ticket {
  id: string; folio: string; gerente: string | null; turno: string | null;
  lavador: string | null; placa: string | null; modelo: string | null;
  tamanio: Tamanio | null; paquete_id: string | null; paquete_nombre: string;
  precio: number; cliente_tel: string | null; pago: Pago | null;
  status: TicketStatus; ts_inicio: string | null; ts_listo: string | null;
  ts_entregado: string | null; duracion_mins: number | null; espera_mins: number | null;
  sms_entrada_sent: boolean; sms_listo_sent: boolean;
  punch_number: number | null; es_gratis: boolean; created_at: string;
}

interface FormState {
  gerente: string; turno: string; lavadorNombre: string;
  paqueteId: string; paqueteNombre: string; tamanio: Tamanio | "";
  placa: string; modelo: string; tel: string; pago: Pago | "";
}

interface LoyaltyInfo { washCount: number; nextPunch: number; esGratis: boolean; }

// ─── Module-level helpers ─────────────────────────────────────────────────────
function tStr(m: number | null | undefined): string {
  if (!m || m <= 0) return "—";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}min`;
}
function fmx(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`;
}
function fTel(t: string): string {
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return t;
}
function elapsedMins(ts: string | null): number {
  if (!ts) return 0;
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}
function isToday(ts: string | null): boolean {
  if (!ts) return false;
  return new Date(ts).toDateString() === new Date().toDateString();
}
function autoTurno(): string {
  return new Date().getHours() < 13 ? "Mañana" : "Tarde";
}

// ─── BarsChart ────────────────────────────────────────────────────────────────
type BarColor = "blue" | "green" | "orange" | "purple";
const BAR_GRADIENTS: Record<BarColor, string> = {
  blue:   "#0066FF,#60A5FA",
  green:  "#22C55E,#86EFAC",
  orange: "#F59E0B,#FCD34D",
  purple: "#8B5CF6,#C4B5FD",
};
const RK_BG  = ["#FEF08A", G200, "#FED7AA"];
const RK_CLR = ["#854D0E", G600, "#7C2D12"];

function BarsChart({
  entries, metric, cls = "blue",
}: {
  entries: [string, { count: number; total: number; times: number[] }][];
  metric: "total" | "count";
  cls?: BarColor;
}) {
  const max = Math.max(...entries.map(e => e[1][metric]), 1);
  return (
    <>
      {entries.slice(0, 8).map(([lbl, d], i) => {
        const val = d[metric];
        const pct = Math.round((val / max) * 100);
        return (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, background: RK_BG[i] ?? G100, color: RK_CLR[i] ?? G400 }}>{i + 1}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: G800, minWidth: 76, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lbl || "—"}</div>
            <div style={{ flex: 1, background: G100, borderRadius: 20, height: 18, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 20, background: `linear-gradient(90deg,${BAR_GRADIENTS[cls]})`, width: `${pct}%`, minWidth: 20, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 7, transition: "width .5s ease" }}>
                {pct > 28 && <span style={{ fontSize: 10, fontWeight: 700, color: WH }}>{metric === "total" ? fmx(val) : val}</span>}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: G600, minWidth: 52, textAlign: "right" }}>
              {metric === "total" ? fmx(val) : `${val} svcs`}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AutolavadoPage() {
  const router = useRouter();

  // Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authReady, setAuthReady]  = useState(false);

  // Catalog
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [precios, setPrecios]   = useState<PrecioRow[]>([]);
  const [personal, setPersonal] = useState<StaffMember[]>([]);

  // Tickets (últimos 30 días)
  const [tickets, setTickets]           = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTix] = useState(false);

  // UI
  const [tab, setTab]           = useState<TabKey>("registrar");
  const [repPeriod, setRepPeriod] = useState<RepPeriod>("dia");
  const [showEntHoy, setShowEnt] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);
  const [_tick, setTick]        = useState(0); // timer para elapsed

  // Form
  const blankForm = (): FormState => ({
    gerente: "", turno: autoTurno(), lavadorNombre: "",
    paqueteId: "", paqueteNombre: "", tamanio: "",
    placa: "", modelo: "", tel: "", pago: "",
  });
  const [form, setForm]             = useState<FormState>(blankForm());
  const [loyalty, setLoyalty]       = useState<LoyaltyInfo | null>(null);
  const [loyaltyLoading, setLoyLd]  = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/autolavado"); return; }
      setUserEmail(user.email ?? null);
      setAuthReady(true);
    });
  }, [router]);

  // ── Load catalog ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady) return;
    Promise.all([
      supabase.from("autolavado_paquetes").select("*").eq("client_id", AUTOLAVADO_CLIENT_ID).eq("activo", true).order("sort_order"),
      supabase.from("autolavado_precios").select("paquete_id, tamanio, precio"),
      supabase.from("autolavado_personal").select("*").eq("client_id", AUTOLAVADO_CLIENT_ID).eq("activo", true).order("rol").order("nombre"),
    ]).then(([pR, prR, stR]) => {
      if (pR.data)  setPaquetes(pR.data  as Paquete[]);
      if (prR.data) setPrecios(prR.data  as PrecioRow[]);
      if (stR.data) setPersonal(stR.data as StaffMember[]);
    });
  }, [authReady]);

  // ── Load tickets ──────────────────────────────────────────────────────────
  const loadTickets = useCallback(async () => {
    setLoadingTix(true);
    const desde = new Date();
    desde.setDate(desde.getDate() - 30);
    desde.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("autolavado_tickets")
      .select("*")
      .eq("client_id", AUTOLAVADO_CLIENT_ID)
      .gte("created_at", desde.toISOString())
      .order("created_at", { ascending: false });
    if (!error && data) setTickets(data as Ticket[]);
    setLoadingTix(false);
  }, []);

  useEffect(() => { if (authReady) loadTickets(); }, [authReady, loadTickets]);

  // Auto-refresh cada 60s en tab Servicios
  useEffect(() => {
    if (tab !== "servicios") return;
    const iv = setInterval(() => loadTickets(), 60_000);
    return () => clearInterval(iv);
  }, [tab, loadTickets]);

  // Timer tick para elapsed displays
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(iv);
  }, []);

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  // ── Price lookup ──────────────────────────────────────────────────────────
  function getPrice(paqId: string, tam: Tamanio | ""): number | null {
    if (!tam) return null;
    const row = precios.find(p => p.paquete_id === paqId && p.tamanio === tam);
    return row ? Number(row.precio) : null;
  }
  const precio      = form.paqueteId && form.tamanio ? getPrice(form.paqueteId, form.tamanio) : null;
  const precioFinal = loyalty?.esGratis ? 0 : (precio ?? null);

  // ── Loyalty check ─────────────────────────────────────────────────────────
  async function checkLoyalty(tel: string) {
    const digits = tel.replace(/\D/g, "");
    if (digits.length < 10) { setLoyalty(null); return; }
    setLoyLd(true);
    const { count } = await supabase
      .from("autolavado_tickets")
      .select("*", { count: "exact", head: true })
      .eq("client_id", AUTOLAVADO_CLIENT_ID)
      .eq("cliente_tel", digits)
      .eq("status", "entregado");
    setLoyLd(false);
    if (count === null) { setLoyalty(null); return; }
    setLoyalty({ washCount: count, nextPunch: count + 1, esGratis: count > 0 && count % 5 === 0 });
  }

  // ── SMS notification ──────────────────────────────────────────────────────
  async function notifySMS(ticket: Partial<Ticket> & { cliente_tel: string | null }, event: "entrada" | "listo") {
    if (!ticket.cliente_tel) return;
    try {
      await fetch("/api/autolavado/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tel: ticket.cliente_tel,
          folio: ticket.folio,
          paquete: `${ticket.paquete_nombre} ${ticket.tamanio}`,
          evento: event,
          es_gratis: ticket.es_gratis ?? false,
        }),
      });
    } catch (e) { console.warn("SMS error:", e); }
  }

  // ── Register ──────────────────────────────────────────────────────────────
  async function registrar() {
    if (!form.gerente)       { showToast("⚠️ Selecciona gerente"); return; }
    if (!form.turno)         { showToast("⚠️ Selecciona turno"); return; }
    if (!form.lavadorNombre) { showToast("⚠️ Selecciona lavador"); return; }
    if (!form.paqueteId)     { showToast("⚠️ Selecciona paquete"); return; }
    if (!form.tamanio)       { showToast("⚠️ Selecciona tamaño"); return; }
    if (!form.placa.trim())  { showToast("⚠️ Ingresa la placa"); return; }
    if (!form.modelo.trim()) { showToast("⚠️ Ingresa el modelo"); return; }
    if (!form.pago)          { showToast("⚠️ Selecciona método de pago"); return; }
    if (precioFinal === null){ showToast("⚠️ Precio no disponible"); return; }

    setSubmitting(true);
    const telDigits = form.tel.replace(/\D/g, "");
    const todayCount = tickets.filter(t => isToday(t.created_at)).length;
    const folio = `AL-${String(todayCount + 1).padStart(4, "0")}`;

    const payload = {
      client_id:      AUTOLAVADO_CLIENT_ID,
      folio,
      gerente:        form.gerente,
      turno:          form.turno,
      lavador:        form.lavadorNombre,
      placa:          form.placa.trim().toUpperCase(),
      modelo:         form.modelo.trim(),
      tamanio:        form.tamanio,
      paquete_id:     form.paqueteId,
      paquete_nombre: form.paqueteNombre,
      precio:         precioFinal,
      cliente_tel:    telDigits.length === 10 ? telDigits : null,
      pago:           form.pago,
      status:         "en_proceso",
      ts_inicio:      new Date().toISOString(),
      punch_number:   loyalty ? loyalty.nextPunch : null,
      es_gratis:      loyalty?.esGratis ?? false,
    };

    const { data, error } = await supabase
      .from("autolavado_tickets").insert(payload).select().single();

    setSubmitting(false);
    if (error || !data) { showToast("❌ Error al registrar — intenta de nuevo"); console.error(error); return; }

    await loadTickets();
    showToast(`✅ ${folio} registrado — en proceso`);
    notifySMS(data as Ticket, "entrada");
    setForm(blankForm());
    setLoyalty(null);
  }

  // ── Marcar listo ──────────────────────────────────────────────────────────
  async function marcarListo(t: Ticket) {
    const now = new Date();
    const dur = Math.round((now.getTime() - new Date(t.ts_inicio!).getTime()) / 60_000);
    const { error } = await supabase.from("autolavado_tickets")
      .update({ status: "listo", ts_listo: now.toISOString(), duracion_mins: dur })
      .eq("id", t.id);
    if (error) { showToast("❌ Error al actualizar"); return; }
    await loadTickets();
    showToast(`🟢 ${t.folio} listo — lavado en ${tStr(dur)}`);
    notifySMS({ ...t, status: "listo", ts_listo: now.toISOString(), duracion_mins: dur }, "listo");
  }

  // ── Marcar entregado ──────────────────────────────────────────────────────
  async function marcarEntregado(t: Ticket) {
    const now = new Date();
    const espera = t.ts_listo ? Math.round((now.getTime() - new Date(t.ts_listo).getTime()) / 60_000) : null;
    const { error } = await supabase.from("autolavado_tickets")
      .update({ status: "entregado", ts_entregado: now.toISOString(), espera_mins: espera })
      .eq("id", t.id);
    if (error) { showToast("❌ Error al actualizar"); return; }
    await loadTickets();
    showToast(`🚗 ${t.folio} entregado — esperó ${tStr(espera)}`);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const todayAll   = tickets.filter(t => isToday(t.created_at));
  const enProceso  = todayAll.filter(t => t.status === "en_proceso");
  const listos     = todayAll.filter(t => t.status === "listo");
  const entregados = todayAll.filter(t => t.status === "entregado");
  const avgTime    = (() => {
    const ts = todayAll.filter(t => t.duracion_mins).map(t => t.duracion_mins!);
    return ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null;
  })();
  const gerentes  = personal.filter(p => p.rol === "gerente");
  const lavadores = personal.filter(p => p.rol === "lavador");

  // ── Reports helpers ───────────────────────────────────────────────────────
  function repTickets(): Ticket[] {
    const now = new Date();
    if (repPeriod === "dia") return tickets.filter(t => isToday(t.created_at));
    if (repPeriod === "semana") {
      const dow = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
      return tickets.filter(t => { const f = new Date(t.created_at); return f >= mon && f <= sun; });
    }
    const desde = new Date(now); desde.setDate(now.getDate() - 30); desde.setHours(0,0,0,0);
    return tickets.filter(t => new Date(t.created_at) >= desde);
  }

  function grpBy(arr: Ticket[], key: keyof Ticket) {
    return arr.reduce((acc, item) => {
      const k = String(item[key] ?? "—");
      if (!acc[k]) acc[k] = { count: 0, total: 0, times: [] };
      acc[k].count++;
      acc[k].total += item.precio;
      if (item.duracion_mins) acc[k].times.push(item.duracion_mins);
      return acc;
    }, {} as Record<string, { count: number; total: number; times: number[] }>);
  }
  function desc(obj: Record<string, { count: number; total: number; times: number[] }>, metric: "total" | "count" = "total") {
    return Object.entries(obj).sort((a, b) => b[1][metric] - a[1][metric]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Shared style objects
  // ─────────────────────────────────────────────────────────────────────────
  const CARD: React.CSSProperties = { background: WH, borderRadius: 12, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,.08)", marginBottom: 14 };
  const CT: React.CSSProperties   = { fontSize: 12, fontWeight: 700, color: G400, textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 14 };
  const LABEL: React.CSSProperties = { display: "block" as const, fontSize: 13, fontWeight: 600, color: G600, marginBottom: 7 };
  const INPUT: React.CSSProperties = { width: "100%", padding: "11px 14px", border: `1.5px solid ${G200}`, borderRadius: 8, fontSize: 15, color: G800, background: WH, boxSizing: "border-box" as const };

  function toggleBtn(active: boolean, onClick: () => void, children: React.ReactNode, style?: React.CSSProperties): React.ReactNode {
    return (
      <button onClick={onClick} style={{ flex: 1, padding: "11px 8px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1.5px solid ${active ? PR : G200}`, background: active ? PR : WH, color: active ? WH : G600, cursor: "pointer", transition: "all .15s", minWidth: 60, ...style }}>
        {children}
      </button>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab: Registrar
  // ─────────────────────────────────────────────────────────────────────────
  function renderRegistrar() {
    return (
      <div>
        {/* Gerente */}
        <div style={CARD}>
          <div style={CT}>👔 Gerente de turno</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {gerentes.map(g => toggleBtn(form.gerente === g.nombre, () => setForm(f => ({ ...f, gerente: g.nombre })), g.nombre))}
          </div>
        </div>

        {/* Turno */}
        <div style={CARD}>
          <div style={CT}>☀️ Turno</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Mañana", "Tarde"].map(t => toggleBtn(form.turno === t, () => setForm(f => ({ ...f, turno: t })), t))}
          </div>
        </div>

        {/* Lavador */}
        <div style={CARD}>
          <div style={CT}>🧑‍🔧 Lavador</div>
          <select value={form.lavadorNombre} onChange={e => setForm(f => ({ ...f, lavadorNombre: e.target.value }))} style={{ ...INPUT, WebkitAppearance: "none" }}>
            <option value="">— Selecciona lavador —</option>
            {lavadores.map(l => <option key={l.id} value={l.nombre}>{l.nombre}</option>)}
          </select>
        </div>

        {/* Paquete */}
        <div style={CARD}>
          <div style={CT}>📦 Paquete</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {paquetes.map(p => (
              <button key={p.id} onClick={() => setForm(f => ({ ...f, paqueteId: p.id, paqueteNombre: p.nombre }))} style={{ padding: 12, borderRadius: 8, cursor: "pointer", textAlign: "left", border: `1.5px solid ${form.paqueteId === p.id ? PR : G200}`, background: form.paqueteId === p.id ? PR_L : WH, position: "relative" }}>
                {form.paqueteId === p.id && <span style={{ position: "absolute", top: 8, right: 10, fontSize: 11, fontWeight: 800, color: PR }}>✓</span>}
                <div style={{ fontSize: 14, fontWeight: 700, color: G800, marginBottom: 2 }}>{p.nombre}</div>
                <div style={{ fontSize: 11, color: G400, marginBottom: 4, lineHeight: 1.4 }}>{p.descripcion}</div>
                <div style={{ fontSize: 11, color: G400 }}>~{p.duracion_min} min</div>
              </button>
            ))}
          </div>
        </div>

        {/* Tamaño */}
        <div style={CARD}>
          <div style={CT}>🚗 Tamaño del vehículo</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["chico", "mediano", "grande"] as Tamanio[]).map(t =>
              toggleBtn(form.tamanio === t, () => setForm(f => ({ ...f, tamanio: t })), t.charAt(0).toUpperCase() + t.slice(1))
            )}
          </div>
        </div>

        {/* Precio */}
        {precio !== null && (
          <div style={{ background: loyalty?.esGratis ? "linear-gradient(135deg,#22C55E,#16A34A)" : "linear-gradient(135deg,#0066FF,#0052CC)", borderRadius: 12, padding: 18, textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>
              {loyalty?.esGratis ? "🎉 ¡LAVADA GRATIS!" : "Precio"}
            </div>
            <div style={{ fontSize: 38, fontWeight: 900, color: WH, lineHeight: 1 }}>
              {loyalty?.esGratis ? "$0" : `$${precio}`}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.8)", marginTop: 3 }}>
              {form.paqueteNombre} · {form.tamanio ? form.tamanio.charAt(0).toUpperCase() + form.tamanio.slice(1) : ""}
              {loyalty?.esGratis ? ` · Lavada #${loyalty.nextPunch}` : ""}
            </div>
          </div>
        )}

        {/* Loyalty banner */}
        {loyalty && !loyalty.esGratis && loyalty.washCount > 0 && (
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#1E40AF" }}>
            📱 Cliente frecuente · Lavada #{loyalty.nextPunch} · {5 - (loyalty.washCount % 5)} más para lavada gratis
          </div>
        )}
        {loyalty && !loyalty.esGratis && loyalty.washCount === 0 && (
          <div style={{ background: G50, border: `1px solid ${G200}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: G400 }}>
            📱 Primera visita registrada
          </div>
        )}

        {/* Datos del vehículo */}
        <div style={CARD}>
          <div style={CT}>🚘 Datos del vehículo</div>
          <div style={{ marginBottom: 15 }}>
            <label style={LABEL}>Placa</label>
            <input type="text" placeholder="ABC-123" value={form.placa} onChange={e => setForm(f => ({ ...f, placa: e.target.value.toUpperCase() }))} style={{ ...INPUT, letterSpacing: 2 }} />
          </div>
          <div>
            <label style={LABEL}>Modelo</label>
            <input type="text" placeholder="Toyota Corolla" value={form.modelo} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))} style={INPUT} />
          </div>
        </div>

        {/* Teléfono */}
        <div style={CARD}>
          <div style={CT}>
            📱 Teléfono del cliente&nbsp;
            <span style={{ fontSize: 11, textTransform: "none", fontWeight: 500, color: G400 }}>(opcional — para SMS y lealtad)</span>
          </div>
          <input type="tel" placeholder="55 1234 5678" value={form.tel} onChange={e => setForm(f => ({ ...f, tel: e.target.value }))} onBlur={e => checkLoyalty(e.target.value)} style={INPUT} />
          {loyaltyLoading && <div style={{ fontSize: 12, color: G400, marginTop: 6 }}>Verificando historial…</div>}
        </div>

        {/* Pago */}
        <div style={CARD}>
          <div style={CT}>💳 Método de pago</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["Efectivo", "Tarjeta", "Transferencia"] as Pago[]).map(p =>
              toggleBtn(form.pago === p, () => setForm(f => ({ ...f, pago: p })), ({ Efectivo: "💵 Efectivo", Tarjeta: "💳 Tarjeta", Transferencia: "📲 Transfer." } as Record<Pago,string>)[p])
            )}
          </div>
        </div>

        {/* Registrar */}
        <button onClick={registrar} disabled={submitting} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 20px", borderRadius: 8, fontSize: 15, fontWeight: 700, border: "none", cursor: submitting ? "default" : "pointer", width: "100%", background: PR, color: WH, opacity: submitting ? 0.7 : 1, marginBottom: 24 }}>
          {submitting ? "Registrando…" : "🚗 Registrar servicio"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab: Servicios
  // ─────────────────────────────────────────────────────────────────────────
  function renderServicios() {
    const totalHoy = todayAll.reduce((a, t) => a + t.precio, 0);

    function SectionHeader({ dot, label, count }: { dot: string; label: string; count: number }) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: dot }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: G800 }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: G400, background: G100, padding: "2px 8px", borderRadius: 20 }}>{count}</span>
        </div>
      );
    }

    return (
      <div>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
          {[
            { v: todayAll.length, l: "Total hoy", c: PR },
            { v: enProceso.length, l: "En proceso", c: "#3B82F6" },
            { v: listos.length, l: "Listos 🟢", c: OK },
            { v: avgTime ? tStr(avgTime) : "—", l: "Prom lavado", c: PU },
          ].map(k => (
            <div key={k.l} style={{ background: WH, borderRadius: 12, padding: "12px 8px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: k.c, lineHeight: 1, marginBottom: 2 }}>{k.v}</div>
              <div style={{ fontSize: 10, color: G400, fontWeight: 500, lineHeight: 1.3 }}>{k.l}</div>
            </div>
          ))}
        </div>

        {/* Ingresos hoy */}
        {totalHoy > 0 && (
          <div style={{ background: G100, borderRadius: 8, padding: "8px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: G600, fontWeight: 600 }}>💰 Ingresos hoy</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: G800 }}>${totalHoy.toLocaleString()}</span>
          </div>
        )}

        {/* En proceso */}
        {enProceso.length > 0 && (
          <>
            <SectionHeader dot="#3B82F6" label="En proceso" count={enProceso.length} />
            {enProceso.map(t => (
              <div key={t.id} style={{ background: "#EFF6FF", border: "2px solid #93C5FD", borderRadius: 12, padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: PR }}>{t.folio}</div>
                    <div style={{ fontSize: 12, color: G400, marginTop: 2 }}>{t.lavador} · {t.pago}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "#DBEAFE", color: "#1E40AF" }}>
                    ⏱ {tStr(elapsedMins(t.ts_inicio))}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: G800 }}>🚗 {t.placa} · {t.modelo}</div>
                <div style={{ fontSize: 12, color: G600, marginTop: 2 }}>
                  {t.paquete_nombre} {t.tamanio} · {t.es_gratis ? "🎉 GRATIS" : `$${t.precio}`}
                  {t.cliente_tel ? ` · 📱 ${fTel(t.cliente_tel)}` : ""}
                </div>
                <button onClick={() => marcarListo(t)} style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", background: OK, color: WH, marginTop: 12 }}>
                  ✅ Marcar como Listo
                </button>
              </div>
            ))}
          </>
        )}

        {/* Listos */}
        {listos.length > 0 && (
          <>
            <SectionHeader dot={OK} label="Listos para entregar" count={listos.length} />
            {listos.map(t => (
              <div key={t.id} style={{ background: OK_L, border: "2px solid #86EFAC", borderRadius: 12, padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#15803D" }}>{t.folio}</div>
                    <div style={{ fontSize: 12, color: G400, marginTop: 2 }}>{t.lavador} · {t.pago}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "#D1FAE5", color: "#065F46" }}>🏎 {tStr(t.duracion_mins)}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "#FEF9C3", color: "#854D0E" }}>⏳ Esperando {tStr(elapsedMins(t.ts_listo))}</div>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: G800 }}>🚗 {t.placa} · {t.modelo}</div>
                <div style={{ fontSize: 12, color: G600, marginTop: 2 }}>
                  {t.paquete_nombre} {t.tamanio} · {t.es_gratis ? "🎉 GRATIS" : `$${t.precio}`}
                  {t.cliente_tel ? ` · 📱 ${fTel(t.cliente_tel)}` : ""}
                </div>
                <button onClick={() => marcarEntregado(t)} style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", background: G800, color: WH, marginTop: 12 }}>
                  🚗 Entregar al cliente
                </button>
              </div>
            ))}
          </>
        )}

        {/* Entregados */}
        {entregados.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: G400 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: G800 }}>Entregados hoy</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: G400, background: G100, padding: "2px 8px", borderRadius: 20 }}>{entregados.length}</span>
              <button onClick={() => setShowEnt(s => !s)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: PR }}>
                {showEntHoy ? "▲ Ocultar" : "▼ Ver detalle"}
              </button>
            </div>
            <div style={{ ...CARD, cursor: "pointer" }} onClick={() => setShowEnt(s => !s)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: G400 }}>{entregados.length} vehículos · toca para {showEntHoy ? "cerrar" : "ver detalle"}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: G800 }}>${entregados.reduce((a, t) => a + t.precio, 0).toLocaleString()}</span>
              </div>
            </div>
            {showEntHoy && [...entregados].sort((a, b) => new Date(b.ts_entregado!).getTime() - new Date(a.ts_entregado!).getTime()).map(t => (
              <div key={t.id} style={{ background: WH, border: `1px solid ${G200}`, borderRadius: 8, padding: "12px 14px", marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: G600 }}>{t.folio}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: G800 }}>{t.es_gratis ? "🎉 $0" : `$${t.precio}`}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: G800, marginTop: 2 }}>🚗 {t.placa} · {t.modelo}</div>
                <div style={{ fontSize: 11, color: G400, display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                  <span>{t.paquete_nombre} {t.tamanio}</span>
                  <span>{t.lavador}</span>
                  <span>{t.pago}</span>
                  {t.cliente_tel && <span>📱 {fTel(t.cliente_tel)}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {t.duracion_mins && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 12, background: "#D1FAE5", color: "#065F46" }}>🏎 {tStr(t.duracion_mins)}</span>}
                  {t.espera_mins   && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 12, background: "#FEF9C3", color: "#854D0E" }}>⏳ {tStr(t.espera_mins)}</span>}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Empty */}
        {todayAll.length === 0 && !loadingTickets && (
          <div style={{ textAlign: "center", padding: "36px 20px", color: G400 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🚗</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: G600, marginBottom: 3 }}>Sin servicios hoy</div>
            <div style={{ fontSize: 12 }}>Registra el primer vehículo en la pestaña Registrar</div>
          </div>
        )}

        {/* Refresh */}
        <button onClick={loadTickets} disabled={loadingTickets} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${G200}`, background: WH, color: G600, cursor: "pointer", width: "100%", marginTop: 8 }}>
          {loadingTickets ? "Actualizando…" : "🔄 Actualizar"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab: Reportes
  // ─────────────────────────────────────────────────────────────────────────
  function renderReportes() {
    const svcs   = repTickets();
    const total  = svcs.reduce((a, t) => a + t.precio, 0);
    const count  = svcs.length;
    const avg    = count ? Math.round(total / count) : 0;
    const tiempos = svcs.filter(t => t.duracion_mins).map(t => t.duracion_mins!);
    const avgT   = tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;
    const esperas = svcs.filter(t => t.espera_mins).map(t => t.espera_mins!);
    const avgE   = esperas.length ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : null;

    const byLav  = desc(grpBy(svcs, "lavador"));
    const byPaq  = desc(grpBy(svcs, "paquete_nombre"), "count");
    const byPago = grpBy(svcs, "pago");
    const byGer  = desc(grpBy(svcs, "gerente"));

    const PAGO_ICONS: Record<string, string> = { Efectivo: "💵", Tarjeta: "💳", Transferencia: "📲" };

    return (
      <div>
        {/* Period sub-tabs */}
        <div style={{ display: "flex", background: G100, borderRadius: 12, padding: 4, marginBottom: 14, gap: 3 }}>
          {(["dia", "semana", "mes"] as RepPeriod[]).map(p => (
            <button key={p} onClick={() => setRepPeriod(p)} style={{ flex: 1, padding: "9px 4px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", textAlign: "center", background: repPeriod === p ? WH : "none", color: repPeriod === p ? PR : G400, boxShadow: repPeriod === p ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
              {p === "dia" ? "Hoy" : p === "semana" ? "Semana" : "30 días"}
            </button>
          ))}
        </div>

        {/* Revenue header */}
        <div style={{ background: "linear-gradient(135deg,#1E293B,#334155)", borderRadius: 12, padding: 18, marginBottom: 14, color: WH }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>
            {repPeriod === "dia" ? "📊 Reporte del día" : repPeriod === "semana" ? "📊 Semana actual" : "📊 Últimos 30 días"}
          </div>
          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, marginBottom: 5 }}>${total.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.7)" }}>{count} servicios · Promedio ${avg} c/u</div>
        </div>

        {/* KPI grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { v: String(count), l: "Total servicios", c: PR },
            { v: `$${avg}`, l: "Ticket promedio", c: OK },
            { v: tStr(avgT), l: "🏎 Prom. lavado", c: PU },
            { v: tStr(avgE), l: "⏳ Prom. espera recogida", c: WA },
          ].map(k => (
            <div key={k.l} style={{ background: WH, borderRadius: 12, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: k.c, marginBottom: 2 }}>{k.v}</div>
              <div style={{ fontSize: 12, color: G400 }}>{k.l}</div>
            </div>
          ))}
        </div>

        {/* Corte de caja */}
        <div style={CARD}>
          <div style={CT}>💳 Corte de caja</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["Efectivo", "Tarjeta", "Transferencia"] as Pago[]).map(p => {
              const d = byPago[p] ?? { count: 0, total: 0, times: [] };
              return (
                <div key={p} style={{ flex: 1, background: G50, borderRadius: 8, padding: 11, textAlign: "center", border: `1px solid ${G200}` }}>
                  <div style={{ fontSize: 18, marginBottom: 3 }}>{PAGO_ICONS[p]}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: G800 }}>${d.total.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: G400 }}>{p}<br /><b>{d.count}</b> svcs</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Por gerente (semana/mes) */}
        {repPeriod !== "dia" && byGer.length > 0 && (
          <div style={CARD}>
            <div style={CT}>👔 Por gerente</div>
            <BarsChart entries={byGer} metric="total" cls="orange" />
          </div>
        )}

        {/* Ranking lavadores */}
        {byLav.length > 0 && (
          <div style={CARD}>
            <div style={CT}>🧑‍🔧 Ranking lavadores — ingresos</div>
            <BarsChart entries={byLav} metric="total" cls="blue" />
          </div>
        )}

        {/* Paquetes */}
        {byPaq.length > 0 && (
          <div style={CARD}>
            <div style={CT}>📦 Paquetes más vendidos</div>
            <BarsChart entries={byPaq} metric="count" cls="green" />
          </div>
        )}

        {/* Clientes frecuentes */}
        {(() => {
          const withPhone = svcs.filter(t => t.cliente_tel);
          if (!withPhone.length) return null;
          const byPhone = withPhone.reduce((acc, t) => {
            const k = t.cliente_tel!;
            if (!acc[k]) acc[k] = { count: 0, total: 0 };
            acc[k].count++; acc[k].total += t.precio;
            return acc;
          }, {} as Record<string, { count: number; total: number }>);
          const top = Object.entries(byPhone).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
          return (
            <div style={CARD}>
              <div style={CT}>👤 Clientes frecuentes</div>
              {top.map(([tel, d], i) => (
                <div key={tel} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, background: RK_BG[i] ?? G100, color: RK_CLR[i] ?? G400 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: G800 }}>{fTel(tel)}</div>
                    <div style={{ fontSize: 11, color: G400 }}>{d.count} visitas · ${d.total.toLocaleString()} total</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: G600 }}>{d.count}×</div>
                </div>
              ))}
            </div>
          );
        })()}

        {count === 0 && (
          <div style={{ textAlign: "center", padding: "36px 20px", color: G400 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: G600 }}>Sin datos en este período</div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  if (!authReady) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: G50 }}>
        <div style={{ color: G400, fontSize: 14 }}>Cargando…</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: G50, color: G800, minHeight: "100vh", paddingBottom: 90 }}>

        {/* Header */}
        <div style={{ background: WH, borderBottom: `1px solid ${G200}`, padding: "14px 20px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: PR, letterSpacing: "-.5px" }}>
              Fish<span style={{ color: G800 }}>Flow</span>
            </div>
            <div style={{ fontSize: 12, color: G400, marginTop: 1 }}>Autolavado</div>
          </div>
          <div style={{ marginLeft: "auto", background: PR_L, color: PR, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
            {userEmail?.split("@")[0] ?? "—"}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: WH, borderBottom: `1px solid ${G200}`, overflowX: "auto" }}>
          {([
            { key: "registrar", label: "🚗 Registrar" },
            { key: "servicios", label: "⚡ Servicios" },
            { key: "reportes",  label: "📊 Reportes"  },
          ] as { key: TabKey; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ flex: 1, padding: "13px 8px", fontSize: 13, fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? PR : G400, border: "none", background: "none", cursor: "pointer", borderBottom: tab === t.key ? `2px solid ${PR}` : "2px solid transparent", whiteSpace: "nowrap" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
          {tab === "registrar" && renderRegistrar()}
          {tab === "servicios" && renderServicios()}
          {tab === "reportes"  && renderReportes()}
        </div>

      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: G800, color: WH, padding: "11px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,.1)", pointerEvents: "none" }}>
          {toast}
        </div>
      )}
    </>
  );
}
