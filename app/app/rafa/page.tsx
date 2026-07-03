"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Section,
  StatCard as DStatCard, Empty as DEmpty, Field as DField, SaveBtn as DSaveBtn,
  inputStyle, type DashTheme,
} from "@/components/dashboard";

// ─── Client ───────────────────────────────────────────────────────────────────
export const RAFA_CLIENT_ID = "40ee7b1f-ef78-4632-a9ea-0468e26320e1";

// ─── Tema (finanzas personales — esmeralda) ───────────────────────────────────
const T: DashTheme = {
  accent: "#0E9F6E", accentDark: "#046C4E", accentSoft: "#DEF7EC",
  bg: "#F8FAFC", surface: "#FFFFFF", text: "#1E293B",
  muted: "#94A3B8", border: "#E2E8F0", danger: "#EF4444", disabled: "#94A3B8",
  panel: "#F1F5F9",
};
const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Empty    = (p: Omit<React.ComponentProps<typeof DEmpty>,    "theme">) => <DEmpty    theme={T} {...p} />;
const Field    = (p: Omit<React.ComponentProps<typeof DField>,    "theme">) => <DField    theme={T} {...p} />;
const SaveBtn  = (p: Omit<React.ComponentProps<typeof DSaveBtn>,  "theme">) => <DSaveBtn  theme={T} {...p} />;

// ─── Types ────────────────────────────────────────────────────────────────────
type TxType = "ingreso" | "fijo" | "placer" | "futuro" | "extraordinario";
type TabKey = "captura" | "mes" | "anio" | "config";

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
  ingreso:        { label: "Ingreso",        icon: "💰", color: "#0E9F6E" },
  fijo:           { label: "Fijo",           icon: "🏠", color: "#3B82F6" },
  placer:         { label: "Placer",         icon: "🎉", color: "#F59E0B" },
  futuro:         { label: "Futuro",         icon: "📈", color: "#8B5CF6" },
  extraordinario: { label: "Extraordinario", icon: "⚡", color: "#EF4444" },
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
  const [tab, setTab] = useState<TabKey>("captura");
  const [toast, setToast] = useState<string | null>(null);

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
    const [txR, recR, cfgR] = await Promise.all([
      supabase.from("finance_transactions").select("*")
        .eq("client_id", RAFA_CLIENT_ID).order("tx_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("finance_recurring").select("*")
        .eq("client_id", RAFA_CLIENT_ID).order("tx_type").order("sort_order"),
      supabase.from("finance_config").select("*").eq("client_id", RAFA_CLIENT_ID).single(),
    ]);
    if (txR.error)  console.error("finance_transactions:", txR.error);
    if (recR.error) console.error("finance_recurring:", recR.error);
    if (cfgR.error) console.error("finance_config:", cfgR.error);
    if (txR.data)  setTxs(txR.data as Tx[]);
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
      <DashboardHeader theme={T} sticky icon="🐟" iconBg={T.accentSoft}
        title="Finanzas Rafa" subtitle="Gastos, cubetas y camino al retiro"
        onLogout={async () => { await supabase.auth.signOut(); router.push("/login"); }} />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "18px 16px 90px" }}>
        <TabBar theme={T} active={tab} onChange={setTab} tabs={[
          { id: "captura", label: "Captura", icon: "➕" },
          { id: "mes",     label: "Mes",     icon: "📅" },
          { id: "anio",    label: "Año",     icon: "📊" },
          { id: "config",  label: "Config",  icon: "⚙️" },
        ]} />

        {/* ══ CAPTURA ══ */}
        {tab === "captura" && (
          <Section title="Registrar movimiento" theme={T}>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
              {/* Monto grande */}
              <input inputMode="decimal" type="number" placeholder="$0" value={fAmount}
                onChange={e => setFAmount(e.target.value)} autoFocus
                style={{ width: "100%", fontSize: 40, fontWeight: 800, border: "none", outline: "none",
                  textAlign: "center", color: fType === "ingreso" ? T.accent : T.text,
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
                <input style={inputStyle(T)} placeholder="¿En qué fue?" value={fConcept}
                  onChange={e => setFConcept(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveTx(); }} />
              </Field>
              {fType === "extraordinario" && (
                <Field label="Categoría">
                  <select style={inputStyle(T)} value={fCat} onChange={e => setFCat(e.target.value)}>
                    {EXTRA_CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Fecha">
                <input type="date" style={inputStyle(T)} value={fDate} onChange={e => setFDate(e.target.value)} />
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
              <StatCard label="Ingresos" value={fmt(selSum.ingresos)} accent={T.accent} soft />
              <StatCard label="Gasto total" value={fmt(selSum.gasto)} soft />
              <StatCard label={`vs Tope ${fmt(cap)}`} value={fmt(cap - selSum.gasto)}
                accent={selSum.gasto > cap ? T.danger : T.accent} soft
                sub={selSum.gasto > cap ? "Excedido" : "Disponible"} />
              <StatCard label="Retiro de cubetas" value={fmt(selSum.retiro)}
                accent={selSum.retiro > 0 ? "#F59E0B" : T.accent} soft
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
                        <Td color={r.s.retiro > 0 ? "#B45309" : T.accentDark}>{fmt(r.s.retiro)}</Td>
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
          color: t.tx_type === "ingreso" ? T.accentDark : T.text }}>
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
          style={{ ...inputStyle(T), width: 140, textAlign: "right" }} />
        <button onClick={() => { const n = parseFloat(v); if (!isNaN(n)) onSave(n); }}
          style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8,
            padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          OK
        </button>
      </div>
    );
  }
}
