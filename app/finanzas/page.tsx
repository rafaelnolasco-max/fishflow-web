"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Section,
  StatCard as DStatCard, Empty as DEmpty, Field as DField, SaveBtn as DSaveBtn,
  type DashTheme,
} from "@/components/dashboard";

// ─── FishFlow Finanzas — app universal B2C ─────────────────────────────────────
// Versión multi-usuario de /app/rafa: sin cubetas, límite mensual + rubros
// explicados. El client_id se resuelve por usuario via /api/finanzas/provision.

// ─── Tema FishFlow (dark #0D1B2A, naranja + cyan) ─────────────────────────────
const FF_ORANGE = "#FF8C35";
const FF_CYAN   = "#67D4E8";
const FF_DARK   = "#0D1B2A";
const T: DashTheme = {
  accent: FF_ORANGE, accentDark: FF_ORANGE, accentSoft: "rgba(255,140,53,.14)",
  bg: FF_DARK, surface: "#14283E", text: "#F1F5F9",
  muted: "#7E93A8", border: "#24405E", danger: "#F87171", disabled: "#41586F",
  panel: "#1B3350",
};
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
// Nota: "placer" se conserva como valor en BD; en UI se muestra "Gustos".
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
interface Config {
  monthly_cap: number; start_month: string;
  extra_labels: string[]; onboarded: boolean;
}

// ─── Rubros: qué va en cada uno (explicación al usuario) ──────────────────────
const TX_META: Record<TxType, { label: string; icon: string; color: string; desc: string; examples: string }> = {
  ingreso: {
    label: "Ingreso", icon: "💰", color: FF_CYAN,
    desc: "Todo lo que entra a tu bolsillo.",
    examples: "Nómina, honorarios, ventas, rentas, propinas",
  },
  fijo: {
    label: "Fijo", icon: "🏠", color: "#7FA6FF",
    desc: "Lo que pagas sí o sí cada mes.",
    examples: "Renta, luz, agua, internet, suscripciones, colegiaturas, seguros",
  },
  placer: {
    label: "Gustos", icon: "🎉", color: FF_ORANGE,
    desc: "Lo que eliges gastar para disfrutar.",
    examples: "Restaurantes, salidas, ropa, hobbies, streaming extra",
  },
  futuro: {
    label: "Futuro", icon: "📈", color: "#B08CFF",
    desc: "Lo que te construye mañana.",
    examples: "Ahorro, inversión, aportaciones a retiro, pagar deuda por adelantado",
  },
  extraordinario: {
    label: "Extraordinario", icon: "⚡", color: "#F87171",
    desc: "Gastos grandes que no ocurren cada mes — tú defines tus categorías.",
    examples: "Viajes, médicos, coche, escuela, remodelación, eventos",
  },
};
const GASTO_TYPES: TxType[] = ["fijo", "placer", "futuro", "extraordinario"];
const SUGGESTED_EXTRAS = ["VIAJES", "MÉDICOS", "COCHE", "ESCUELA", "REMODELACIÓN", "EVENTOS"];
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
const todayStr = () => new Date().toLocaleDateString("en-CA");
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
};
const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
// Mime de grabación: Safari/iOS no soporta webm — detectar (lección iPad/Safari)
function pickAudioMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "mp4" }, // Safari / iOS
    { mime: "audio/aac", ext: "aac" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}
const dayLabel = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MESES[m - 1].slice(0, 3).toLowerCase()}`;
};

interface MonthSummary {
  ingresos: number; fijos: number; gustos: number; futuro: number; extra: number;
  gasto: number; balance: number;
}
function summarize(txs: Tx[]): MonthSummary {
  const s = { ingresos: 0, fijos: 0, gustos: 0, futuro: 0, extra: 0, gasto: 0, balance: 0 };
  for (const t of txs) {
    const a = Number(t.amount);
    if (t.tx_type === "ingreso") s.ingresos += a;
    else if (t.tx_type === "fijo") s.fijos += a;
    else if (t.tx_type === "placer") s.gustos += a;
    else if (t.tx_type === "futuro") s.futuro += a;
    else s.extra += a;
  }
  s.gasto = s.fijos + s.gustos + s.futuro + s.extra;
  s.balance = s.ingresos - s.gasto;
  return s;
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function FinanzasApp() {
  const router = useRouter();
  const [clientId, setClientId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("inicio");
  const [toast, setToast] = useState<string | null>(null);

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Voz
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);

  // Datos
  const [txs, setTxs] = useState<Tx[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [config, setConfig] = useState<Config | null>(null);

  // Form captura
  const [fAmount, setFAmount]   = useState("");
  const [fType, setFType]       = useState<TxType>("placer");
  const [fConcept, setFConcept] = useState("");
  const [fCat, setFCat]         = useState("");
  const [fDate, setFDate]       = useState(todayStr());
  const [saving, setSaving]     = useState(false);

  // Mes seleccionado
  const [selMonth, setSelMonth] = useState(monthKey(todayStr()));

  // ── Auth + provisión (idempotente) ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/finanzas/registro"); return; }
      const res = await fetch("/api/finanzas/provision", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { router.push("/finanzas/registro"); return; }
      const { client_id } = await res.json();
      setClientId(client_id);
    })();
  }, [router]);

  // ── Carga ───────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!clientId) return;
    // Supabase regresa máx. 1000 filas por request — paginar las transacciones
    const allTxs: Tx[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("finance_transactions").select("*")
        .eq("client_id", clientId)
        .order("tx_date", { ascending: false }).order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) { console.error("finance_transactions:", error); break; }
      allTxs.push(...((data ?? []) as Tx[]));
      if (!data || data.length < PAGE) break;
    }
    setTxs(allTxs);

    const [recR, cfgR] = await Promise.all([
      supabase.from("finance_recurring").select("*")
        .eq("client_id", clientId).order("tx_type").order("sort_order"),
      supabase.from("finance_config").select("*").eq("client_id", clientId).single(),
    ]);
    if (recR.error) console.error("finance_recurring:", recR.error);
    if (cfgR.error) console.error("finance_config:", cfgR.error);
    if (recR.data) setRecurring(recR.data as Recurring[]);
    if (cfgR.data) setConfig(cfgR.data as Config);
  }, [clientId]);
  useEffect(() => { loadAll(); }, [loadAll]);

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

  const cap = config?.monthly_cap ?? 0;
  const extraCats = useMemo(
    () => (config?.extra_labels?.length ? config.extra_labels : ["OTRO"]),
    [config]);

  // Rápidos: los 4 conceptos de gasto más frecuentes del historial
  const quick = useMemo(() => {
    const freq = new Map<string, { concept: string; tx_type: TxType; amount: number; n: number }>();
    for (const t of txs) {
      if (t.tx_type === "ingreso" || t.tx_type === "extraordinario") continue;
      const k = `${t.tx_type}|${t.concept.toLowerCase()}`;
      const cur = freq.get(k);
      if (cur) { cur.n += 1; cur.amount = Number(t.amount); }
      else freq.set(k, { concept: t.concept, tx_type: t.tx_type, amount: Number(t.amount), n: 1 });
    }
    return [...freq.values()].filter(q => q.n >= 2)
      .sort((a, b) => b.n - a.n).slice(0, 4);
  }, [txs]);

  // Estimado mensual desde recurrentes (para meses futuros)
  const recEst = useMemo(() => {
    const act = recurring.filter(r => r.active);
    const ing = act.filter(r => r.tx_type === "ingreso").reduce((s, r) => s + Number(r.amount), 0);
    const gto = act.filter(r => r.tx_type !== "ingreso").reduce((s, r) => s + Number(r.amount), 0);
    return { ing, gto, balance: ing - gto };
  }, [recurring]);

  // ── Insights (tab Inicio) ───────────────────────────────────────────────────
  const insights = useMemo(() => {
    const nowK = monthKey(todayStr());
    const prevK = shiftMonth(nowK, -1);
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    const cur = summarize(byMonth.get(nowK) ?? []);
    const prevTxs = byMonth.get(prevK) ?? [];
    const prev = summarize(prevTxs);

    // Mediana histórica de Gustos (meses con dato, antes del mes actual)
    const gustosHist = [...byMonth.entries()]
      .filter(([k, list]) => k < nowK && list.some(t => t.tx_type === "placer"))
      .map(([, list]) => summarize(list).gustos)
      .sort((a, b) => a - b);
    const medGustos = gustosHist.length
      ? gustosHist[Math.floor(gustosHist.length / 2)] : 0;

    // Proyección de cierre: fijo/futuro/extra ya cargados + gustos a ritmo diario
    const proy = cur.fijos + cur.futuro + cur.extra + (cur.gustos / dayOfMonth) * daysInMonth;
    const diasRestantes = Math.max(daysInMonth - dayOfMonth, 0);
    const dispPorDia = diasRestantes > 0 ? Math.max(cap - cur.gasto, 0) / diasRestantes : 0;
    const semaforo: "verde" | "amarillo" | "rojo" =
      cap <= 0 ? "verde" : proy <= cap * 0.85 ? "verde" : proy <= cap ? "amarillo" : "rojo";

    // Top gastos del mes anterior (sin futuro)
    const topPrev = prevTxs
      .filter(t => t.tx_type !== "ingreso" && t.tx_type !== "futuro")
      .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);

    // Frases del recap
    const frases: string[] = [];
    if (prevTxs.length > 0 && cap > 0) {
      frases.push(prev.gasto > cap
        ? `Te pasaste de tu límite por ${fmt(prev.gasto - cap)}.`
        : `Cerraste ${fmt(cap - prev.gasto)} abajo de tu límite.`);
      if (medGustos > 0 && prev.gustos > 0) {
        const d = Math.round(((prev.gustos - medGustos) / medGustos) * 100);
        frases.push(d > 10 ? `Gustos ${d}% arriba de tu mediana histórica (${fmt(medGustos)}).`
          : d < -10 ? `Gustos ${-d}% abajo de tu mediana histórica (${fmt(medGustos)}).`
          : `Gustos en línea con tu mediana histórica (${fmt(medGustos)}).`);
      }
      const partes: [string, number][] = [["fijos", prev.fijos], ["gustos", prev.gustos], ["extraordinarios", prev.extra]];
      partes.sort((a, b) => b[1] - a[1]);
      const oper = prev.fijos + prev.gustos + prev.extra;
      if (oper > 0 && partes[0][1] > 0)
        frases.push(`Donde más se fue: ${partes[0][0]} (${Math.round((partes[0][1] / oper) * 100)}% del gasto operativo).`);
    }

    return { nowK, prevK, cur, prev, prevTxs, medGustos, proy, diasRestantes, dispPorDia, semaforo, topPrev, frases, dayOfMonth, daysInMonth };
  }, [byMonth, cap]);

  // Tabla anual: 13 meses desde start_month
  const anual = useMemo(() => {
    if (!config) return [];
    const rows: { key: string; s: MonthSummary; est: boolean; acum: number }[] = [];
    let acum = 0;
    let k = monthKey(config.start_month);
    const nowK = monthKey(todayStr());
    for (let i = 0; i < 13; i++) {
      const mtxs = byMonth.get(k) ?? [];
      const est = mtxs.length === 0 && k > nowK;
      const s = est
        ? { ingresos: recEst.ing, fijos: 0, gustos: 0, futuro: 0, extra: 0, gasto: recEst.gto, balance: recEst.balance }
        : summarize(mtxs);
      acum += s.balance;
      rows.push({ key: k, s, est, acum });
      k = shiftMonth(k, 1);
    }
    return rows;
  }, [config, byMonth, recEst]);

  // ── Guardar transacción ─────────────────────────────────────────────────────
  async function saveTx(over?: Partial<Tx>) {
    if (!clientId) return;
    const amount = over?.amount ?? parseFloat(fAmount);
    const concept = (over?.concept ?? fConcept).trim();
    const tx_type = over?.tx_type ?? fType;
    if (!amount || amount <= 0 || !concept) { showToast("Falta monto o concepto"); return; }
    setSaving(true);
    const { error } = await supabase.from("finance_transactions").insert({
      client_id: clientId,
      tx_date: over?.tx_date ?? fDate,
      tx_type,
      concept,
      category: tx_type === "extraordinario" ? (over?.category ?? (fCat || extraCats[0])) : null,
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
    if (!clientId) return;
    const act = recurring.filter(r => r.active);
    if (act.length === 0) { showToast("No hay recurrentes activos"); return; }
    const existing = new Set((byMonth.get(selMonth) ?? []).map(t => `${t.tx_type}|${t.concept}`));
    const toInsert = act.filter(r => !existing.has(`${r.tx_type}|${r.concept}`));
    if (toInsert.length === 0) { showToast("Ya están cargados este mes"); return; }
    if (!window.confirm(`Cargar ${toInsert.length} recurrentes en ${monthLabel(selMonth)}?`)) return;
    const { error } = await supabase.from("finance_transactions").insert(
      toInsert.map(r => ({
        client_id: clientId, tx_date: `${selMonth}-01`,
        tx_type: r.tx_type, concept: r.concept, category: null, amount: r.amount,
      })));
    if (error) { console.error(error); showToast("Error al cargar"); return; }
    showToast(`${toInsert.length} recurrentes cargados`);
    loadAll();
  }

  // ── Chat financiero ─────────────────────────────────────────────────────────
  async function sendChat(text?: string) {
    const q = (text ?? chatInput).trim();
    if (!q || chatBusy || !clientId) return;
    const next: ChatMsg[] = [...chatMsgs, { role: "user", content: q }];
    setChatMsgs(next); setChatInput(""); setChatBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/finanzas/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ client_id: clientId, messages: next.slice(-12) }),
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

  // ── Voz: grabar → transcribir (Edge Function compartido) → enviar ──────────
  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const { mime } = pickAudioMime();
      const opts: MediaRecorderOptions = { audioBitsPerSecond: 32000 };
      if (mime) opts.mimeType = mime;
      const mr = new MediaRecorder(stream, opts);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); void transcribeVoice(); };
      mediaRef.current = mr;
      mr.start();
      setRecSeconds(0);
      setVoiceState("recording");
      recTimerRef.current = window.setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (e: unknown) {
      const err = e as { name?: string };
      showToast(err?.name === "NotAllowedError"
        ? "Sin permiso de micrófono — actívalo en Ajustes"
        : "No se pudo iniciar la grabación");
      setVoiceState("idle");
    }
  }

  function stopVoice() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setVoiceState("transcribing");
    mediaRef.current?.stop();
  }

  async function transcribeVoice() {
    if (!clientId) return;
    try {
      const { mime, ext } = pickAudioMime();
      const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
      if (blob.size < 1000) { setVoiceState("idle"); return; } // toque accidental
      const filename = `chat-${Date.now()}.${ext}`;
      const path = `${clientId}/finanzas-chat/${filename}`;
      const { error: upErr } = await supabase.storage.from("audio")
        .upload(path, blob, { contentType: blob.type, upsert: true });
      if (upErr) { console.error("voz upload:", upErr); showToast("Error al subir el audio"); setVoiceState("idle"); return; }
      const { data, error: fnErr } = await supabase.functions.invoke("transcribe-audio", {
        body: { client_id: clientId, module: "finanzas-chat", storage_path: path, filename, language: "es" },
      });
      setVoiceState("idle");
      const transcript = (data as { transcript?: string } | null)?.transcript?.trim();
      if (fnErr || !transcript) {
        console.error("voz transcribe:", fnErr ?? data);
        showToast("No se pudo transcribir — intenta de nuevo");
        return;
      }
      void sendChat(transcript);
    } catch (e) {
      console.error("voz:", e);
      showToast("Error al transcribir");
      setVoiceState("idle");
    }
  }

  // ── Config updates ──────────────────────────────────────────────────────────
  async function saveConfig(patch: Partial<Config>) {
    if (!clientId) return;
    const { error } = await supabase.from("finance_config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    if (error) { console.error(error); showToast("Error al guardar config"); return; }
    showToast("Guardado");
    loadAll();
  }

  async function updateRecurring(r: Recurring, patch: Partial<Recurring>) {
    const { error } = await supabase.from("finance_recurring").update(patch).eq("id", r.id);
    if (error) { console.error(error); showToast("Error"); return; }
    loadAll();
  }

  async function addRecurring(tx_type: TxType, concept: string, amount: number) {
    if (!clientId) return false;
    const { error } = await supabase.from("finance_recurring").insert({
      client_id: clientId, tx_type, concept, amount, active: true,
      sort_order: recurring.length,
    });
    if (error) { console.error(error); showToast("Error al agregar"); return false; }
    loadAll();
    return true;
  }

  async function deleteRecurring(r: Recurring) {
    if (!window.confirm(`¿Quitar "${r.concept}" de tus recurrentes?`)) return;
    const { error } = await supabase.from("finance_recurring").delete().eq("id", r.id);
    if (error) { console.error(error); showToast("Error"); return; }
    loadAll();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!clientId || !config) return <div style={{ minHeight: "100vh", background: T.bg }} />;

  // ══ WIZARD DE ONBOARDING ══
  if (!config.onboarded) {
    return <OnboardingWizard
      onDone={async (monthlyCap, labels, recs) => {
        for (const r of recs) await addRecurring(r.tx_type, r.concept, r.amount);
        await saveConfig({ monthly_cap: monthlyCap, extra_labels: labels, onboarded: true });
      }} />;
  }

  const selTxs = byMonth.get(selMonth) ?? [];
  const selSum = summarize(selTxs);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text,
      fontFamily: "Inter, -apple-system, sans-serif" }}>
      <DashboardHeader theme={T} sticky
        icon={<img src="/isotipo.svg" alt="FishFlow" style={{ width: 26, height: 26 }} />}
        iconBg="rgba(103,212,232,.10)"
        title="FishFlow Finanzas" subtitle="Tus gastos del mes, claros y bajo control"
        onLogout={async () => { await supabase.auth.signOut(); router.push("/finanzas/registro"); }} />

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
            <Section title={`Cómo voy — ${monthLabel(insights.nowK)}`} theme={T}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
                    background: insights.semaforo === "verde" ? "#4ADE80" : insights.semaforo === "amarillo" ? "#FACC15" : T.danger }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {insights.semaforo === "verde" ? "Vas bien" : insights.semaforo === "amarillo" ? "Cuidado con el ritmo" : "Ritmo por arriba de tu límite"}
                    <span style={{ color: T.muted, fontWeight: 500 }}> — proyección de cierre {fmt(insights.proy)} vs límite {fmt(cap)}</span>
                  </span>
                </div>
                <div style={{ background: FF_DARK, borderRadius: 8, height: 14, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ width: `${cap > 0 ? Math.min((insights.cur.gasto / cap) * 100, 100) : 0}%`, height: "100%",
                    background: insights.cur.gasto > cap ? T.danger : `linear-gradient(90deg, ${FF_CYAN}, ${FF_ORANGE})` }} />
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>
                  Gasto al día {insights.dayOfMonth}: <b style={{ color: T.text }}>{fmt(insights.cur.gasto)}</b>
                  {cap > 0 && <> ({Math.round((insights.cur.gasto / cap) * 100)}% de tu límite)</>}
                </div>
                <StatGrid>
                  <StatCard label="Disponible del mes" value={fmt(Math.max(cap - insights.cur.gasto, 0))} accent={FF_CYAN} soft />
                  <StatCard label={`Por día (${insights.diasRestantes} días restantes)`} value={fmt(insights.dispPorDia)} soft />
                  <StatCard label="Gustos del mes" value={fmt(insights.cur.gustos)} soft
                    sub={insights.medGustos > 0 ? `mediana hist. ${fmt(insights.medGustos)}` : undefined}
                    accent={insights.medGustos > 0 && insights.cur.gustos > insights.medGustos ? FF_ORANGE : FF_CYAN} />
                  <StatCard label="Futuro del mes" value={fmt(insights.cur.futuro)} soft />
                </StatGrid>
              </div>
            </Section>

            <Section title={`Cómo cerró ${monthLabel(insights.prevK)}`} theme={T}>
              {insights.prevTxs.length === 0 ? <Empty msg="Sin datos del mes anterior — tu primer recap aparece el mes que entra" /> : (
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 18 }}>
                  <StatGrid>
                    <StatCard label="Gasto total" value={fmt(insights.prev.gasto)}
                      accent={cap > 0 && insights.prev.gasto > cap ? T.danger : T.text as string} soft />
                    <StatCard label="Ingresos" value={fmt(insights.prev.ingresos)} accent={FF_CYAN} soft />
                    <StatCard label="Balance del mes" value={fmt(insights.prev.balance)}
                      accent={insights.prev.balance < 0 ? FF_ORANGE : FF_CYAN} soft sub="ingresos − gasto" />
                  </StatGrid>
                  <div style={{ marginBottom: 16 }}>
                    {insights.frases.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: T.text, marginBottom: 6, lineHeight: 1.5 }}>
                        <span style={{ color: FF_ORANGE }}>◆</span><span>{f}</span>
                      </div>
                    ))}
                  </div>
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
              <input inputMode="decimal" type="number" placeholder="$0" value={fAmount}
                onChange={e => setFAmount(e.target.value)} autoFocus
                style={{ width: "100%", fontSize: 40, fontWeight: 800, border: "none", outline: "none",
                  textAlign: "center", color: fType === "ingreso" ? FF_CYAN : T.text,
                  fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", background: "transparent",
                  padding: "6px 0 14px" }} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginBottom: 8 }}>
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
              {/* Explicación del rubro seleccionado */}
              <div style={{ fontSize: 12, color: T.muted, textAlign: "center", marginBottom: 16, lineHeight: 1.5 }}>
                {TX_META[fType].desc} <span style={{ opacity: .8 }}>Ej: {TX_META[fType].examples.toLowerCase()}.</span>
              </div>
              <Field label="Concepto">
                <input style={inp} placeholder="¿En qué fue?" value={fConcept}
                  onChange={e => setFConcept(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveTx(); }} />
              </Field>
              {fType === "extraordinario" && (
                <Field label="Categoría">
                  <select style={inp} value={fCat || extraCats[0]} onChange={e => setFCat(e.target.value)}>
                    {extraCats.map(c => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Fecha">
                <input type="date" style={inp} value={fDate} onChange={e => setFDate(e.target.value)} />
              </Field>
              <SaveBtn onClick={() => saveTx()} disabled={saving} label={saving ? "Guardando…" : "Guardar"} />
              {quick.length > 0 && (
                <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 8 }}>TUS FRECUENTES</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {quick.map(q => (
                      <button key={`${q.tx_type}|${q.concept}`}
                        onClick={() => saveTx({ concept: q.concept, amount: q.amount, tx_type: q.tx_type, tx_date: todayStr() })}
                        style={{ padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                          border: `1px solid ${T.border}`, background: T.panel, color: T.text, cursor: "pointer" }}>
                        {TX_META[q.tx_type].icon} {q.concept} · {fmt(q.amount)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.muted, marginBottom: 10 }}>Últimos movimientos</div>
              {txs.slice(0, 8).map(t => <TxRow key={t.id} t={t} onDelete={deleteTx} />)}
              {txs.length === 0 && <Empty msg="Sin movimientos aún — registra el primero arriba" />}
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
              <StatCard label={`vs Límite ${fmt(cap)}`} value={fmt(cap - selSum.gasto)}
                accent={selSum.gasto > cap ? T.danger : FF_CYAN} soft
                sub={selSum.gasto > cap ? "Excedido" : "Disponible"} />
              <StatCard label="Balance del mes" value={fmt(selSum.balance)}
                accent={selSum.balance < 0 ? FF_ORANGE : FF_CYAN} soft
                sub="ingresos − gasto" />
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
        {tab === "anio" && (
          <>
            <StatGrid>
              <StatCard label="Límite mensual" value={fmt(cap)} soft />
              <StatCard label="Balance acumulado" value={fmt(anual.length ? anual[anual.length - 1].acum : 0)}
                accent={(anual.length ? anual[anual.length - 1].acum : 0) < 0 ? FF_ORANGE : FF_CYAN} soft
                sub="suma de balances mensuales" />
            </StatGrid>
            <Section title="Tablero anual" theme={T}>
              <div style={{ overflowX: "auto", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
                  <thead>
                    <tr style={{ color: T.muted, fontSize: 11, textAlign: "right" }}>
                      {["Mes", "Ingresos", "Gasto", "Dif vs Límite", "Balance", "Acumulado"].map((h, i) => (
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
                        <Td color={r.s.balance < 0 ? FF_ORANGE : FF_CYAN}>{fmt(r.s.balance)}</Td>
                        <Td color={r.acum < 0 ? FF_ORANGE : FF_CYAN}>{fmt(r.acum)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>
                Meses sin captura se estiman con tus recurrentes activos. El acumulado suma los balances mensuales (ingresos − gasto).
              </p>
            </Section>
          </>
        )}

        {/* ══ CONFIG ══ */}
        {tab === "config" && (
          <>
            <Section title="Parámetros" theme={T}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 22 }}>
                <ConfigNumber label="Límite mensual de gasto (MXN)" value={config.monthly_cap}
                  onSave={v => saveConfig({ monthly_cap: v })} />
              </div>
            </Section>

            <Section title="Tus categorías de extraordinarios" theme={T}>
              <ExtraLabelsEditor labels={config.extra_labels}
                onSave={labels => saveConfig({ extra_labels: labels })} />
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
                  <button onClick={() => deleteRecurring(r)} aria-label="Quitar"
                    style={{ border: "none", background: "none", color: T.muted, cursor: "pointer", fontSize: 15, padding: 4 }}>
                    🗑
                  </button>
                </div>
              ))}
              {recurring.length === 0 && <Empty msg="Sin recurrentes — agrega tu renta, nómina o suscripciones abajo" />}
              <AddRecurringForm onAdd={addRecurring} />
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
                    {["¿En qué gasté más el mes pasado?", "¿Cuánto llevo en comidas este mes?", "350 gasolina ayer"].map(s => (
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
            <div style={{ padding: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center" }}>
              <style>{`@keyframes ffpulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }`}</style>
              {voiceState === "recording" ? (
                <div style={{ ...inp, flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.danger,
                    animation: "ffpulse 1.1s ease-in-out infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: T.text }}>
                    Grabando… {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")}
                  </span>
                </div>
              ) : (
                <input style={{ ...inp, flex: 1 }}
                  placeholder={voiceState === "transcribing" ? "Transcribiendo…" : "Pregunta o registra un gasto…"}
                  disabled={voiceState === "transcribing"}
                  value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") sendChat(); }} />
              )}
              <button
                onClick={voiceState === "recording" ? stopVoice : startVoice}
                disabled={chatBusy || voiceState === "transcribing"}
                aria-label={voiceState === "recording" ? "Detener grabación" : "Grabar voz"}
                style={{ width: 46, height: 46, borderRadius: "50%", border: `1.5px solid ${voiceState === "recording" ? T.danger : T.border}`,
                  background: voiceState === "recording" ? "rgba(248,113,113,.15)" : T.panel,
                  fontSize: 19, cursor: "pointer", flexShrink: 0,
                  opacity: chatBusy || voiceState === "transcribing" ? 0.5 : 1 }}>
                {voiceState === "recording" ? "■" : voiceState === "transcribing" ? "⏳" : "🎤"}
              </button>
              <button onClick={() => sendChat()} disabled={chatBusy || voiceState !== "idle"}
                style={{ background: chatBusy ? T.disabled : T.accent, color: "#fff", border: "none",
                  borderRadius: 10, padding: "0 18px", height: 46, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
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

// ─── Editor de categorías de extraordinarios ──────────────────────────────────
function ExtraLabelsEditor({ labels, onSave }: { labels: string[]; onSave: (l: string[]) => void }) {
  const [list, setList] = useState<string[]>(labels);
  const [nuevo, setNuevo] = useState("");
  const dirty = JSON.stringify(list) !== JSON.stringify(labels);

  function add() {
    const v = nuevo.trim().toUpperCase();
    if (!v || list.includes(v)) { setNuevo(""); return; }
    setList([...list, v]); setNuevo("");
  }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 22 }}>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 12, lineHeight: 1.5 }}>
        {TX_META.extraordinario.desc} Ej: {TX_META.extraordinario.examples.toLowerCase()}.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {list.map(l => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600,
            border: `1px solid ${T.border}`, background: T.panel, color: T.text }}>
            {l}
            <button onClick={() => setList(list.filter(x => x !== l))} aria-label={`Quitar ${l}`}
              style={{ border: "none", background: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
          </span>
        ))}
        {list.length === 0 && <span style={{ fontSize: 13, color: T.muted }}>Sin categorías — agrega al menos una</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...inp, flex: 1 }} placeholder="Nueva categoría (ej. VIAJES)" value={nuevo}
          onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }} />
        <button onClick={add} style={{ background: T.panel, color: T.text, border: `1px solid ${T.border}`,
          borderRadius: 9, padding: "0 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Agregar</button>
      </div>
      {dirty && (
        <button onClick={() => onSave(list)} style={{ marginTop: 12, width: "100%", background: T.accent,
          color: "#fff", border: "none", borderRadius: 9, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Guardar categorías
        </button>
      )}
    </div>
  );
}

// ─── Form para agregar recurrente (Config) ────────────────────────────────────
function AddRecurringForm({ onAdd }: { onAdd: (t: TxType, c: string, a: number) => Promise<boolean> }) {
  const [tipo, setTipo] = useState<TxType>("fijo");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");

  return (
    <div style={{ background: T.surface, border: `1px dashed ${T.border}`, borderRadius: 12,
      padding: 14, marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select style={{ ...inp, width: 130 }} value={tipo} onChange={e => setTipo(e.target.value as TxType)}>
        {(["ingreso", "fijo", "placer", "futuro"] as TxType[]).map(tt => (
          <option key={tt} value={tt}>{TX_META[tt].icon} {TX_META[tt].label}</option>
        ))}
      </select>
      <input style={{ ...inp, flex: 1, minWidth: 140 }} placeholder="Concepto (ej. Renta)" value={concepto}
        onChange={e => setConcepto(e.target.value)} />
      <input style={{ ...inp, width: 110 }} type="number" inputMode="decimal" placeholder="$" value={monto}
        onChange={e => setMonto(e.target.value)} />
      <button onClick={async () => {
        const a = parseFloat(monto);
        if (!concepto.trim() || !a || a <= 0) return;
        if (await onAdd(tipo, concepto.trim(), a)) { setConcepto(""); setMonto(""); }
      }}
        style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 9,
          padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        + Agregar
      </button>
    </div>
  );
}

// ─── Wizard de onboarding (3 pasos) ───────────────────────────────────────────
interface WizRec { tx_type: TxType; concept: string; amount: number; }
function OnboardingWizard({ onDone }: {
  onDone: (monthlyCap: number, labels: string[], recs: WizRec[]) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [capStr, setCapStr] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [customLabel, setCustomLabel] = useState("");
  const [recs, setRecs] = useState<WizRec[]>([]);
  const [rTipo, setRTipo] = useState<TxType>("fijo");
  const [rConcepto, setRConcepto] = useState("");
  const [rMonto, setRMonto] = useState("");
  const [busy, setBusy] = useState(false);

  const capNum = parseFloat(capStr);
  const capOk = !isNaN(capNum) && capNum > 0;

  function toggleLabel(l: string) {
    setLabels(labels.includes(l) ? labels.filter(x => x !== l) : [...labels, l]);
  }
  function addCustomLabel() {
    const v = customLabel.trim().toUpperCase();
    if (!v || labels.includes(v)) { setCustomLabel(""); return; }
    setLabels([...labels, v]); setCustomLabel("");
  }
  function addRec() {
    const a = parseFloat(rMonto);
    if (!rConcepto.trim() || !a || a <= 0) return;
    setRecs([...recs, { tx_type: rTipo, concept: rConcepto.trim(), amount: a }]);
    setRConcepto(""); setRMonto("");
  }

  const btn = (enabled: boolean): React.CSSProperties => ({
    width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
    background: enabled ? `linear-gradient(90deg, ${FF_CYAN}, ${FF_ORANGE})` : T.disabled,
    color: "#0D1B2A", fontSize: 15, fontWeight: 800, cursor: enabled ? "pointer" : "default",
  });

  return (
    <div style={{ minHeight: "100vh", background: FF_DARK, color: T.text, padding: "40px 20px",
      fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/isotipo.svg" alt="FishFlow" style={{ width: 40, height: 40, marginBottom: 10 }} />
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            Configura tu cuenta
          </h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>Paso {step} de 3</div>
        </div>

        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 22 }}>
          {/* ── Paso 1: rubros + límite ── */}
          {step === 1 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 0, marginBottom: 6 }}>Así organizamos tu dinero</h2>
              <p style={{ fontSize: 13, color: T.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
                Cada movimiento que registres cae en uno de estos 5 rubros:
              </p>
              {(Object.keys(TX_META) as TxType[]).map(tt => (
                <div key={tt} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{TX_META[tt].icon}</span>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <b style={{ color: TX_META[tt].color }}>{TX_META[tt].label}</b>
                    <span style={{ color: T.muted }}> — {TX_META[tt].desc} Ej: {TX_META[tt].examples.toLowerCase()}.</span>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 16, paddingTop: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 }}>
                  ¿Cuánto quieres gastar máximo al mes? (MXN)
                </label>
                <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>
                  Es tu límite mensual de gasto total. Lo puedes cambiar cuando quieras en Config.
                </p>
                <input style={{ ...inp, fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 16 }}
                  type="number" inputMode="decimal" placeholder="ej. 25000"
                  value={capStr} onChange={e => setCapStr(e.target.value)} />
                <button disabled={!capOk} onClick={() => capOk && setStep(2)} style={btn(capOk)}>Siguiente</button>
              </div>
            </>
          )}

          {/* ── Paso 2: extraordinarios ── */}
          {step === 2 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 0, marginBottom: 6 }}>⚡ Tus extraordinarios</h2>
              <p style={{ fontSize: 13, color: T.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
                Son los gastos grandes que no pasan cada mes. Elige las categorías que aplican a tu vida — o crea las tuyas:
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {[...SUGGESTED_EXTRAS, ...labels.filter(l => !SUGGESTED_EXTRAS.includes(l))].map(l => {
                  const on = labels.includes(l);
                  return (
                    <button key={l} onClick={() => toggleLabel(l)}
                      style={{ padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: `1.5px solid ${on ? FF_ORANGE : T.border}`,
                        background: on ? "rgba(255,140,53,.14)" : "transparent",
                        color: on ? FF_ORANGE : T.muted }}>
                      {on ? "✓ " : ""}{l}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <input style={{ ...inp, flex: 1 }} placeholder="Otra categoría (ej. MASCOTAS)" value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addCustomLabel(); }} />
                <button onClick={addCustomLabel} style={{ background: T.panel, color: T.text,
                  border: `1px solid ${T.border}`, borderRadius: 9, padding: "0 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+</button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setStep(1)} style={{ ...btn(true), width: 110, background: T.panel, color: T.text }}>Atrás</button>
                <button onClick={() => setStep(3)} style={btn(true)}>
                  {labels.length > 0 ? "Siguiente" : "Saltar por ahora"}
                </button>
              </div>
            </>
          )}

          {/* ── Paso 3: recurrentes ── */}
          {step === 3 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 0, marginBottom: 6 }}>⟳ Tus recurrentes (opcional)</h2>
              <p style={{ fontSize: 13, color: T.muted, marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
                Ingresos y gastos que se repiten igual cada mes — nómina, renta, internet. Los cargas al mes con un clic en vez de capturarlos uno por uno.
              </p>
              {recs.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                  padding: "8px 12px", background: T.panel, borderRadius: 9, marginBottom: 6 }}>
                  <span>{TX_META[r.tx_type].icon}</span>
                  <span style={{ flex: 1 }}>{r.concept}</span>
                  <b>{fmt(r.amount)}</b>
                  <button onClick={() => setRecs(recs.filter((_, j) => j !== i))}
                    style={{ border: "none", background: "none", color: T.muted, cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, marginBottom: 18 }}>
                <select style={{ ...inp, width: 120 }} value={rTipo} onChange={e => setRTipo(e.target.value as TxType)}>
                  {(["ingreso", "fijo", "placer", "futuro"] as TxType[]).map(tt => (
                    <option key={tt} value={tt}>{TX_META[tt].icon} {TX_META[tt].label}</option>
                  ))}
                </select>
                <input style={{ ...inp, flex: 1, minWidth: 120 }} placeholder="Concepto" value={rConcepto}
                  onChange={e => setRConcepto(e.target.value)} />
                <input style={{ ...inp, width: 90 }} type="number" inputMode="decimal" placeholder="$" value={rMonto}
                  onChange={e => setRMonto(e.target.value)} />
                <button onClick={addRec} style={{ background: T.panel, color: T.text, border: `1px solid ${T.border}`,
                  borderRadius: 9, padding: "0 13px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+</button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setStep(2)} style={{ ...btn(true), width: 110, background: T.panel, color: T.text }}>Atrás</button>
                <button disabled={busy} onClick={async () => {
                  setBusy(true);
                  await onDone(capNum, labels, recs);
                  setBusy(false);
                }} style={btn(!busy)}>
                  {busy ? "Guardando…" : "¡Listo, empezar!"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
