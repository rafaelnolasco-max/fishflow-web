"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Section,
  StatCard as DStatCard, Empty as DEmpty, Field as DField, SaveBtn as DSaveBtn,
  type DashTheme,
} from "@/components/dashboard";

// ─── Client ───────────────────────────────────────────────────────────────────
export const RAFA_CLIENT_ID = "40ee7b1f-ef78-4632-a9ea-0468e26320e1";

// ─── Tema FishFlow (dark #0D1B2A, naranja + cyan — brand/design-philosophy) ───
const FF_ORANGE = "#FF8C35";
const FF_CYAN   = "#67D4E8";
const FF_DARK   = "#0D1B2A";
const T: DashTheme = {
  accent: FF_ORANGE, accentDark: FF_ORANGE, accentSoft: "rgba(255,140,53,.14)",
  bg: FF_DARK, surface: "#14283E", text: "#F1F5F9",
  muted: "#7E93A8", border: "#24405E", danger: "#F87171", disabled: "#41586F",
  panel: "#1B3350",
};
// Inputs sobre fondo oscuro (inputStyle base asume superficie clara)
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${T.border}`,
  fontSize: 14, fontFamily: "inherit", background: FF_DARK, color: T.text,
  colorScheme: "dark",
};
const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Empty    = (p: Omit<React.ComponentProps<typeof DEmpty>,    "theme">) => <DEmpty    theme={T} {...p} />;
const Field    = (p: Omit<React.ComponentProps<typeof DField>,    "theme">) => <DField    theme={T} {...p} />;
const SaveBtn  = (p: Omit<React.ComponentProps<typeof DSaveBtn>,  "theme">) => <DSaveBtn  theme={T} {...p} />;

// ─── Types ────────────────────────────────────────────────────────────────────
type TxType = "ingreso" | "fijo" | "placer" | "futuro" | "extraordinario";
type TabKey = "inicio" | "captura" | "mes" | "anio" | "config";
interface ChatMsg { role: "user" | "assistant"; content: string; }

interface Tx {
  id: string; tx_date: string; tx_type: TxType;
  concept: string; category: string | null; amount: number;
}
interface Recurring {
  id: string; tx_type: TxType; concept: string;
  amount: number; active: boolean; sort_order: number;
}
interface Bucket { name: string; balance_mxn: number; }
interface Config {
  monthly_cap: number; fx_rate: number; buckets: Bucket[]; start_month: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const TX_META: Record<TxType, { label: string; icon: string; color: string }> = {
  ingreso:        { label: "Ingreso",        icon: "💰", color: FF_CYAN },
  fijo:           { label: "Fijo",           icon: "🏠", color: "#7FA6FF" },
  placer:         { label: "Placer",         icon: "🎉", color: FF_ORANGE },
  futuro:         { label: "Futuro",         icon: "📈", color: "#B08CFF" },
  extraordinario: { label: "Extraordinario", icon: "⚡", color: "#F87171" },
};
const GASTO_TYPES: TxType[] = ["fijo", "placer", "futuro", "extraordinario"];
const EXTRA_CATS = ["VACACIONES", "CASA PICHI", "SALUD/MEDICAMENTOS", "AUTO IONIQ", "OTRO"];
const QUICK: { concept: string; amount: number; tx_type: TxType }[] = [
  { concept: "Café",         amount: 200, tx_type: "placer" },
  { concept: "Comida",       amount: 200, tx_type: "placer" },
  { concept: "Terapia Mario", amount: 800, tx_type: "fijo" },
  { concept: "Barba",        amount: 120, tx_type: "fijo" },
];
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
// Corte de era: desde jun-2026 Rafa vive de rentas + FishFlow + Lukon (sin Amdocs).
const ERA_ACTUAL = "2026-06";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
const monthKey = (d: string) => d.slice(0, 7);                  // YYYY-MM
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};
const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const dayLabel = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MESES[m - 1].slice(0, 3).toLowerCase()}`;
};

interface MonthSummary {
  ingresos: number; fijos: number; placer: number; futuro: number; extra: number;
  gasto: number; retiro: number;
}
function summarize(txs: Tx[]): MonthSummary {
  const s = { ingresos: 0, fijos: 0, placer: 0, futuro: 0, extra: 0, gasto: 0, retiro: 0 };
  for (const t of txs) {
    const a = Number(t.amount);
    if (t.tx_type === "ingreso") s.ingresos += a;
    else if (t.tx_type === "fijo") s.fijos += a;
    else if (t.tx_type === "placer") s.placer += a;
    else if (t.tx_type === "futuro") s.futuro += a;
    else s.extra += a;
  }
  s.gasto = s.fijos + s.placer + s.futuro + s.extra;
  s.retiro = s.gasto - s.ingresos;
  return s;
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function RafaFinanzas() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<TabKey>("inicio");
  const [toast, setToast] = useState<string | null>(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Datos
  const [txs, setTxs] = useState<Tx[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [config, setConfig] = useState<Config | null>(null);

  // Form captura
  const [fAmount, setFAmount]   = useState("");
  const [fType, setFType]       = useState<TxType>("placer");
  const [fConcept, setFConcept] = useState("");
  const [fCat, setFCat]         = useState(EXTRA_CATS[0]);
  const [fDate, setFDate]       = useState(todayStr());
  const [saving, setSaving]     = useState(false);

  // Mes seleccionado
  const [selMonth, setSelMonth] = useState(monthKey(todayStr()));

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/rafa"); return; }
      setAuthReady(true);
    });
  }, [router]);

  // ── Carga ───────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    // Supabase regresa máx. 1000 filas por request — paginar las transacciones
    const allTxs: Tx[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("finance_transactions").select("*")
        .eq("client_id", RAFA_CLIENT_ID)
        .order("tx_date", { ascending: false }).order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) { console.error("finance_transactions:", error); break; }
      allTxs.push(...((data ?? []) as Tx[]));
      if (!data || data.length < PAGE) break;
    }
    setTxs(allTxs);

    const [recR, cfgR] = await Promise.all([
      supabase.from("finance_recurring").select("*")
        .eq("client_id", RAFA_CLIENT_ID).order("tx_type").order("sort_order"),
      supabase.from("finance_config").select("*").eq("client_id", RAFA_CLIENT_ID).single(),
    ]);
    if (recR.error) console.error("finance_recurring:", recR.error);
    if (cfgR.error) console.error("finance_config:", cfgR.error);
    if (recR.data) setRecurring(recR.data as Recurring[]);
    if (cfgR.data) setConfig(cfgR.data as Config);
  }, []);
  useEffect(() => { if (authReady) loadAll(); }, [authReady, loadAll]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  // ── Derivados ───────────────────────────────────────────────────────────────
  const byMonth = useMemo(() => {
    const m = new Map<string, Tx[]>();
    for (const t of txs) {
      const k = monthKey(t.tx_date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [txs]);

  const cap = config?.monthly_cap ?? 125000;
  const liquidezPesos = useMemo(
    () => (config?.buckets ?? []).filter(b => !/usd/i.test(b.name)).reduce((s, b) => s + Number(b.balance_mxn), 0),
    [config]);
  const patrimonio = useMemo(
    () => (config?.buckets ?? []).reduce((s, b) => s + Number(b.balance_mxn), 0), [config]);

  // Estimado mensual desde recurrentes (para meses futuros)
  const recEst = useMemo(() => {
    const act = recurring.filter(r => r.active);
    const ing = act.filter(r => r.tx_type === "ingreso").reduce((s, r) => s + Number(r.amount), 0);
    const gto = act.filter(r => r.tx_type !== "ingreso").reduce((s, r) => s + Number(r.amount), 0);
    return { ing, gto, retiro: gto - ing };
  }, [recurring]);

  // ── Insights (tab Inicio) ───────────────────────────────────────────────
  const insights = useMemo(() => {
    const nowK = monthKey(todayStr());
    const prevK = shiftMonth(nowK, -1);
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    const cur = summarize(byMonth.get(nowK) ?? []);
    const prevTxs = byMonth.get(prevK) ?? [];
    const prev = summarize(prevTxs);

    // Mediana de placer histórica (meses con dato, antes del mes actual)
    const placerHist = [...byMonth.entries()]
      .filter(([k, list]) => k < nowK && list.some(t => t.tx_type === "placer"))
      .map(([, list]) => summarize(list).placer)
      .sort((a, b) => a - b);
    const medPlacer = placerHist.length
      ? placerHist[Math.floor(placerHist.length / 2)] : 0;

    // Proyección de cierre: fijo/futuro/extra ya cargados + placer a ritmo diario
    const proy = cur.fijos + cur.futuro + cur.extra + (cur.placer / dayOfMonth) * daysInMonth;
    const diasRestantes = Math.max(daysInMonth - dayOfMonth, 0);
    const dispPorDia = diasRestantes > 0 ? Math.max(cap - cur.gasto, 0) / diasRestantes : 0;
    const semaforo: "verde" | "amarillo" | "rojo" =
      proy <= cap * 0.85 ? "verde" : proy <= cap ? "amarillo" : "rojo";

    // Top gastos del mes anterior (sin futuro)
    const topPrev = prevTxs
      .filter(t => t.tx_type !== "ingreso" && t.tx_type !== "futuro")
      .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);

    // Frases del recap
    const frases: string[] = [];
    if (prevTxs.length > 0) {
      frases.push(prev.gasto > cap
        ? `Te pasaste del tope por ${fmt(prev.gasto - cap)}.`
        : `Cerraste ${fmt(cap - prev.gasto)} abajo del tope.`);
      if (medPlacer > 0 && prev.placer > 0) {
        const d = Math.round(((prev.placer - medPlacer) / medPlacer) * 100);
        frases.push(d > 10 ? `Placer ${d}% arriba de tu mediana histórica (${fmt(medPlacer)}).`
          : d < -10 ? `Placer ${-d}% abajo de tu mediana histórica (${fmt(medPlacer)}).`
          : `Placer en línea con tu mediana histórica (${fmt(medPlacer)}).`);
      }
      const partes: [string, number][] = [["fijos", prev.fijos], ["placer", prev.placer], ["extraordinarios", prev.extra]];
      partes.sort((a, b) => b[1] - a[1]);
      const oper = prev.fijos + prev.placer + prev.extra;
      if (oper > 0 && partes[0][1] > 0)
        frases.push(`Donde más se fue: ${partes[0][0]} (${Math.round((partes[0][1] / oper) * 100)}% del gasto operativo).`);
      if (prevK < ERA_ACTUAL) frases.push("Ese mes aún era etapa Amdocs — compara con cuidado.");
    }

    return { nowK, prevK, cur, prev, prevTxs, medPlacer, proy, diasRestantes, dispPorDia, semaforo, topPrev, frases, dayOfMonth, daysInMonth };
  }, [byMonth, cap]);

  // Tabla anual: 13 meses desde start_month
  const anual = useMemo(() => {
    if (!config) return [];
    const rows: { key: string; s: MonthSummary; est: boolean; acum: number; liquidez: number }[] = [];
    let acum = 0;
    let k = monthKey(config.start_month);
    const nowK = monthKey(todayStr());
    for (let i = 0; i < 13; i++) {
      const mtxs = byMonth.get(k) ?? [];
      const est = mtxs.length === 0 && k > nowK;
      const s = est
        ? { ingresos: recEst.ing, fijos: 0, placer: 0, futuro: 0, extra: 0, gasto: recEst.gto, retiro: recEst.retiro }
        : summarize(mtxs);
      acum += s.retiro;
      rows.push({ key: k, s, est, acum, liquidez: liquidezPesos - acum });
      k = shiftMonth(k, 1);
    }
    return rows;
  }, [config, byMonth, recEst, liquidezPesos]);

  // ── Guardar transacción ─────────────────────────────────────────────────────
  async function saveTx(over?: Partial<Tx>) {
    const amount = over?.amount ?? parseFloat(fAmount);
    const concept = (over?.concept ?? fConcept).trim();
    const tx_type = over?.tx_type ?? fType;
    if (!amount || amount <= 0 || !concept) { showToast("Falta monto o concepto"); return; }
    setSaving(true);
    const { error } = await supabase.from("finance_transactions").insert({
      client_id: RAFA_CLIENT_ID,
      tx_date: over?.tx_date ?? fDate,
      tx_type,
      concept,
      category: tx_type === "extraordinario" ? (over?.category ?? fCat) : null,
      amount,
    });
    setSaving(false);
    if (error) { console.error(error); showToast("Error al guardar"); return; }
    setFAmount(""); setFConcept(""); setFDate(todayStr());
    showToast(`${TX_META[tx_type].icon} ${concept} — ${fmt(amount)}`);
    loadAll();
  }

  async function deleteTx(t: Tx) {
    if (!window.confirm(`¿Borrar "${t.concept}" (${fmt(Number(t.amount))})?`)) return;
    const { error } = await supabase.from("finance_transactions").delete().eq("id", t.id);
    if (error) { console.error(error); showToast("Error al borrar"); return; }
    showToast("Borrado");
    loadAll();
  }

  // ── Cargar recurrentes al mes ───────────────────────────────────────────────
  async function loadRecurringIntoMonth() {
    const act = recurring.filter(r => r.active);
    if (act.length === 0) { showToast("No hay recurrentes activos"); return; }
    const existing = new Set((byMonth.get(selMonth) ?? []).map(t => `${t.tx_type}|${t.concept}`));
    const toInsert = act.filter(r => !existing.has(`${r.tx_type}|${r.concept}`));
    if (toInsert.length === 0) { showToast("Ya están cargados este mes"); return; }
    if (!window.confirm(`Cargar ${toInsert.length} recurrentes en ${monthLabel(selMonth)}?`)) return;
    const { error } = await supabase.from("finance_transactions").insert(
      toInsert.map(r => ({
        client_id: RAFA_CLIENT_ID, tx_date: `${selMonth}-01`,
        tx_type: r.tx_type, concept: r.concept, category: null, amount: r.amount,
      })));
    if (error) { console.error(error); showToast("Error al cargar"); return; }
    showToast(`${toInsert.length} recurrentes cargados`);
    loadAll();
  }

  // ── Chat financiero ─────────────────────────────────────────────────────
  async function sendChat() {
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    const next: ChatMsg[] = [...chatMsgs, { role: "user", content: q }];
    setChatMsgs(next); setChatInput(""); setChatBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/rafa/finanzas", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const data = await res.json();
      const reply = data.reply ?? data.error ?? "Error — intenta de nuevo.";
      setChatMsgs([...next, { role: "assistant", content: reply }]);
      if (data.inserted) loadAll();
    } catch {
      setChatMsgs([...next, { role: "assistant", content: "Error de conexión — intenta de nuevo." }]);
    }
    setChatBusy(false);
  }

  // ── Config updates ──────────────────────────────────────────────────────────
  async function saveConfig(patch: Partial<Config>) {
    const { error } = await supabase.from("finance_config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("client_id", RAFA_CLIENT_ID);
    if (error) { console.error(error); showToast("Error al guardar config"); return; }
    showToast("Config guardada");
    loadAll();
  }

  async function updateRecurring(r: Recurring, patch: Partial<Recurring>) {
    const { error } = await supabase.from("finance_recurring").update(patch).eq("id", r.id);
    if (error) { console.error(error); showToast("Error"); return; }
    loadAll();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!authReady) return <div style={{ minHeight: "100vh", background: T.bg }} />;

  const selTxs = byMonth.get(selMonth) ?? [];
  const selSum = summarize(selTxs);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: "Inter, -apple-system, sans-serif" }}>
      <DashboardHeader theme={T} sticky
        icon={<img src="/isotipo.svg" alt="FishFlow" style={{ width: 26, height: 26 }} />}
        iconBg="rgba(103,212,232,.10)"
        title="Finanzas Rafa" subtitle="FishFlow · gastos, cubetas y camino al retiro"
        onLogout={async () => { await supabase.auth.signOut(); router.push("/login"); }} />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "18px 16px 90px" }}>
        <TabBar theme={T} active={tab} onChange={setTab} tabs={[
          { id: "inicio",  label: "Inicio",  icon: "🏁" },
          { id: "captura", label: "Captura", icon: "➕" },
          { id: "mes",     label: "Mes",     icon: "📅" },
          { id: "anio",    label: "Año",     icon: "📊" },
          { id: "config",  label: "Config",  icon: "⚙️" },
        ]} />

        {/* ══ INICIO ══ */}
        {tab === "inicio" && (
          <>
            {/* Cómo voy este mes */}
            <Section title={`Cómo voy — ${monthLabel(insights.nowK)}`} theme={T}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
                    background: insights.semaforo === "verde" ? "#4ADE80" : insights.semaforo === "amarillo" ? "#FACC15" : T.danger }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {insights.semaforo === "verde" ? "Vas bien" : insights.semaforo === "amarillo" ? "Cuidado con el ritmo" : "Ritmo por arriba del tope"}
                    <span style={{ color: T.muted, fontWeight: 500 }}> — proyección de cierre {fmt(insights.proy)} vs tope {fmt(cap)}</span>
                  </span>
                </div>
                {/* Barra de progreso vs tope */}
                <div style={{ background: FF_DARK, borderRadius: 8, height: 14, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ width: `${Math.min((insights.cur.gasto / cap) * 100, 100)}%`, height: "100%",
                    background: insights.cur.gasto > cap ? T.danger : `linear-gradient(90deg, ${FF_CYAN}, ${FF_ORANGE})` }} />
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>
                  Gasto al día {insights.dayOfMonth}: <b style={{ color: T.text }}>{fmt(insights.cur.gasto)}</b> ({Math.round((insights.cur.gasto / cap) * 100)}% del tope)
                </div>
                <StatGrid>
                  <StatCard label="Disponible del mes" value={fmt(Math.max(cap - insights.cur.gasto, 0))} accent={FF_CYAN} soft />
                  <StatCard label={`Por día (${insights.diasRestantes} días restantes)`} value={fmt(insights.dispPorDia)} soft />
                  <StatCard label="Placer del mes" value={fmt(insights.cur.placer)} soft
                    sub={insights.medPlacer > 0 ? `mediana hist. ${fmt(insights.medPlacer)}` : undefined}
                    accent={insights.medPlacer > 0 && insights.cur.placer > insights.medPlacer ? FF_ORANGE : FF_CYAN} />
                  <StatCard label="Futuro del mes" value={fmt(insights.cur.futuro)} soft sub="plan ~$13,000" />
                </StatGrid>
              </div>
            </Section>

            {/* Recap mes anterior */}
            <Section title={`Cómo cerró ${monthLabel(insights.prevK)}`} theme={T}>
              {insights.prevTxs.length === 0 ? <Empty msg="Sin datos del mes anterior" /> : (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
                  <StatGrid>
                    <StatCard label="Gasto total" value={fmt(insights.prev.gasto)}
                      accent={insights.prev.gasto > cap ? T.danger : T.text as string} soft />
                    <StatCard label="Ingresos" value={fmt(insights.prev.ingresos)} accent={FF_CYAN} soft />
                    <StatCard label="Retiro de cubetas" value={fmt(insights.prev.retiro)}
                      accent={insights.prev.retiro > 0 ? FF_ORANGE : FF_CYAN} soft sub="gasto − ingresos" />
                  </StatGrid>
                  {/* Insights en texto */}
                  <div style={{ marginBottom: 16 }}>
                    {insights.frases.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: T.text, marginBottom: 6, lineHeight: 1.5 }}>
                        <span style={{ color: FF_ORANGE }}>◆</span><span>{f}</span>
                      </div>
                    ))}
                  </div>
                  {/* Top gastos */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 8 }}>TOP GASTOS (SIN FUTURO)</div>
                  {insights.topPrev.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10,
                      fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {TX_META[t.tx_type].icon} {t.concept}
                      </span>
                      <b style={{ whiteSpace: "nowrap" }}>{fmt(Number(t.amount))}</b>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}

        {/* ══ CAPTURA ══ */}
        {tab === "captura" && (
          <Section title="Registrar movimiento" theme={T}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
              {/* Monto grande */}
              <input inputMode="decimal" type="number" placeholder="$0" value={fAmount}
                onChange={e => setFAmount(e.target.value)} autoFocus
                style={{ width: "100%", fontSize: 40, fontWeight: 800, border: "none", outline: "none",
                  textAlign: "center", color: fType === "ingreso" ? FF_CYAN : T.text,
                  fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", background: "transparent",
                  padding: "6px 0 14px" }} />
              {/* Tipo */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 16 }}>
                {(Object.keys(TX_META) as TxType[]).map(tt => {
                  const on = fType === tt;
                  return (
                    <button key={tt} onClick={() => setFType(tt)}
                      style={{ padding: "8px 13px", borderRadius: 999, fontSize: 13, fontWeight: 600,
                        cursor: "pointer",
                        border: `1.5px solid ${on ? TX_META[tt].color : T.border}`,
                        background: on ? TX_META[tt].color : T.surface,
                        color: on ? "#fff" : T.muted }}>
                      {TX_META[tt].icon} {TX_META[tt].label}
                    </button>
                  );
                })}
              </div>
              <Field label="Concepto">
                <input style={inp} placeholder="¿En qué fue?" value={fConcept}
                  onChange={e => setFConcept(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveTx(); }} />
              </Field>
              {fType === "extraordinario" && (
                <Field label="Categoría">
                  <select style={inp} value={fCat} onChange={e => setFCat(e.target.value)}>
                    {EXTRA_CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Fecha">
                <input type="date" style={inp} value={fDate} onChange={e => setFDate(e.target.value)} />
              </Field>
              <SaveBtn onClick={() => saveTx()} disabled={saving} label={saving ? "Guardando…" : "Guardar"} />
              {/* Rápidos */}
              <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 8 }}>RÁPIDOS</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK.map(q => (
                    <button key={q.concept}
                      onClick={() => saveTx({ concept: q.concept, amount: q.amount, tx_type: q.tx_type, tx_date: todayStr() })}
                      style={{ padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                        border: `1px solid ${T.border}`, background: T.panel, color: T.text, cursor: "pointer" }}>
                      {TX_META[q.tx_type].icon} {q.concept} · {fmt(q.amount)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Últimos movimientos */}
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>Últimos movimientos</div>
              {txs.slice(0, 8).map(t => <TxRow key={t.id} t={t} onDelete={deleteTx} />)}
              {txs.length === 0 && <Empty msg="Sin movimientos aún" />}
            </div>
          </Section>
        )}

        {/* ══ MES ══ */}
        {tab === "mes" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 18 }}>
              <MonthArrow dir="‹" onClick={() => setSelMonth(shiftMonth(selMonth, -1))} />
              <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", minWidth: 170, textAlign: "center" }}>
                {monthLabel(selMonth)}
              </div>
              <MonthArrow dir="›" onClick={() => setSelMonth(shiftMonth(selMonth, 1))} />
            </div>

            <StatGrid>
              <StatCard label="Ingresos" value={fmt(selSum.ingresos)} accent={FF_CYAN} soft />
              <StatCard label="Gasto total" value={fmt(selSum.gasto)} soft />
              <StatCard label={`vs Tope ${fmt(cap)}`} value={fmt(cap - selSum.gasto)}
                accent={selSum.gasto > cap ? T.danger : FF_CYAN} soft
                sub={selSum.gasto > cap ? "Excedido" : "Disponible"} />
              <StatCard label="Retiro de cubetas" value={fmt(selSum.retiro)}
                accent={selSum.retiro > 0 ? FF_ORANGE : FF_CYAN} soft
                sub="gasto − ingresos" />
            </StatGrid>

            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <button onClick={loadRecurringIntoMonth}
                style={{ background: T.accentSoft, color: T.accentDark, border: "none", borderRadius: 9,
                  padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ⟳ Cargar recurrentes del mes
              </button>
            </div>

            {(["ingreso", ...GASTO_TYPES] as TxType[]).map(tt => {
              const list = selTxs.filter(t => t.tx_type === tt);
              if (list.length === 0) return null;
              const tot = list.reduce((s, t) => s + Number(t.amount), 0);
              return (
                <div key={tt} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TX_META[tt].color }}>
                      {TX_META[tt].icon} {TX_META[tt].label} ({list.length})
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt(tot)}</div>
                  </div>
                  {list.map(t => <TxRow key={t.id} t={t} onDelete={deleteTx} />)}
                </div>
              );
            })}
            {selTxs.length === 0 && <Empty msg="Sin movimientos este mes" />}
          </>
        )}

        {/* ══ AÑO ══ */}
        {tab === "anio" && config && (
          <>
            <StatGrid>
              <StatCard label="Patrimonio total" value={fmt(patrimonio)} soft />
              <StatCard label="Liquidez pesos" value={fmt(liquidezPesos)} soft sub="Inbursa + Allianz" />
              <StatCard label="Tope mensual" value={fmt(cap)} soft />
            </StatGrid>
            <Section title="Tablero anual" theme={T}>
              <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
                  <thead>
                    <tr style={{ color: T.muted, fontSize: 11, textAlign: "right" }}>
                      {["Mes", "Ingresos", "Gasto", "Dif vs Tope", "Retiro", "Liquidez restante"].map((h, i) => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: i === 0 ? "left" : "right",
                          borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {anual.map(r => (
                      <tr key={r.key} style={{ opacity: r.est ? 0.55 : 1,
                        background: r.key === monthKey(todayStr()) ? T.accentSoft : "transparent" }}>
                        <td style={{ padding: "9px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {monthLabel(r.key)}{r.est && <span style={{ fontSize: 10, color: T.muted }}> est.</span>}
                        </td>
                        <Td>{fmt(r.s.ingresos)}</Td>
                        <Td>{fmt(r.s.gasto)}</Td>
                        <Td color={r.s.gasto > cap ? T.danger : undefined}>{fmt(cap - r.s.gasto)}</Td>
                        <Td color={r.s.retiro > 0 ? FF_ORANGE : FF_CYAN}>{fmt(r.s.retiro)}</Td>
                        <Td>{fmt(r.liquidez)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>
                Meses sin captura se estiman con los recurrentes activos. La liquidez restante descuenta el retiro acumulado de la liquidez en pesos.
              </p>
            </Section>
          </>
        )}

        {/* ══ CONFIG ══ */}
        {tab === "config" && config && (
          <>
            <Section title="Parámetros" theme={T}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 22 }}>
                <ConfigNumber label="Tope mensual (MXN)" value={config.monthly_cap}
                  onSave={v => saveConfig({ monthly_cap: v })} />
                <ConfigNumber label="TC MXN/USD" value={config.fx_rate}
                  onSave={v => saveConfig({ fx_rate: v })} />
                {config.buckets.map((b, i) => (
                  <ConfigNumber key={b.name} label={b.name} value={b.balance_mxn}
                    onSave={v => {
                      const buckets = config.buckets.map((x, j) => j === i ? { ...x, balance_mxn: v } : x);
                      saveConfig({ buckets });
                    }} />
                ))}
              </div>
            </Section>
            <Section title="Recurrentes mensuales" theme={T}>
              {recurring.map(r => (
                <div key={r.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
                  padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
                  opacity: r.active ? 1 : 0.45 }}>
                  <span style={{ fontSize: 16 }}>{TX_META[r.tx_type].icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.concept}</div>
                    <div style={{ fontSize: 11, color: T.muted }}>{TX_META[r.tx_type].label}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(Number(r.amount))}</div>
                  <button onClick={() => updateRecurring(r, { active: !r.active })}
                    style={{ border: `1px solid ${T.border}`, background: r.active ? T.accentSoft : T.panel,
                      color: r.active ? T.accentDark : T.muted, borderRadius: 8, padding: "5px 10px",
                      fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {r.active ? "Activo" : "Pausado"}
                  </button>
                </div>
              ))}
            </Section>
          </>
        )}
      </main>

      {/* ══ CHAT FLOTANTE ══ */}
      {!chatOpen && (
        <button onClick={() => setChatOpen(true)} aria-label="Chat financiero"
          style={{ position: "fixed", bottom: 22, right: 22, width: 56, height: 56, borderRadius: "50%",
            background: `linear-gradient(135deg, ${FF_CYAN}, ${FF_ORANGE})`, border: "none", fontSize: 24,
            cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,.4)", zIndex: 90 }}>
          💬
        </button>
      )}
      {chatOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", flexDirection: "column",
          justifyContent: "flex-end", background: "rgba(6,13,20,.55)" }}
          onClick={() => setChatOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.surface, borderRadius: "18px 18px 0 0", maxWidth: 860, width: "100%",
              margin: "0 auto", height: "min(72vh, 640px)", display: "flex", flexDirection: "column",
              border: `1px solid ${T.border}`, borderBottom: "none" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`,
              display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
                💬 Chat financiero
              </div>
              <button onClick={() => setChatOpen(false)}
                style={{ background: "none", border: "none", fontSize: 22, color: T.muted, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              {chatMsgs.length === 0 && (
                <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.7 }}>
                  Pregúntame de tus finanzas o registra un gasto en lenguaje natural:
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                    {["¿En qué gasté más el mes pasado?", "¿Cuánto llevo en cafés este año?", "350 gasolina ayer"].map(s => (
                      <button key={s} onClick={() => { setChatInput(s); }}
                        style={{ textAlign: "left", background: T.panel, border: `1px solid ${T.border}`,
                          borderRadius: 10, padding: "9px 13px", fontSize: 13, color: T.text, cursor: "pointer" }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMsgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%", padding: "10px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  background: m.role === "user" ? T.accentSoft : T.panel,
                  border: `1px solid ${T.border}`, color: T.text }}>
                  {m.content}
                </div>
              ))}
              {chatBusy && <div style={{ color: T.muted, fontSize: 13 }}>Pensando…</div>}
            </div>
            <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Pregunta o registra un gasto…"
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChat(); }} />
              <button onClick={sendChat} disabled={chatBusy}
                style={{ background: chatBusy ? T.disabled : T.accent, color: "#fff", border: "none",
                  borderRadius: 10, padding: "0 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                ➤
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );

  // ── Sub-componentes ─────────────────────────────────────────────────────────
  function TxRow({ t, onDelete }: { t: Tx; onDelete: (t: Tx) => void }) {
    return (
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
        padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{TX_META[t.tx_type].icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.concept}{t.category && <span style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}> · {t.category}</span>}
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>{dayLabel(t.tx_date)}</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700,
          color: t.tx_type === "ingreso" ? FF_CYAN : T.text }}>
          {t.tx_type === "ingreso" ? "+" : "−"}{fmt(Number(t.amount))}
        </div>
        <button onClick={() => onDelete(t)} aria-label="Borrar"
          style={{ border: "none", background: "none", color: T.muted, cursor: "pointer", fontSize: 15, padding: 4 }}>
          🗑
        </button>
      </div>
    );
  }

  function MonthArrow({ dir, onClick }: { dir: string; onClick: () => void }) {
    return (
      <button onClick={onClick} style={{ width: 36, height: 36, borderRadius: 10,
        border: `1px solid ${T.border}`, background: T.surface, fontSize: 18, cursor: "pointer", color: T.text }}>
        {dir}
      </button>
    );
  }

  function Td({ children, color }: { children: React.ReactNode; color?: string }) {
    return <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap",
      borderTop: `1px solid ${T.border}`, color: color ?? T.text }}>{children}</td>;
  }

  function ConfigNumber({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
    const [v, setV] = useState(String(value));
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.muted }}>{label}</div>
        <input type="number" inputMode="decimal" value={v} onChange={e => setV(e.target.value)}
          style={{ ...inp, width: 140, textAlign: "right" }} />
        <button onClick={() => { const n = parseFloat(v); if (!isNaN(n)) onSave(n); }}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8,
            padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          OK
        </button>
      </div>
    );
  }
}
