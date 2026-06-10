"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  supabase,
  type TBAOpportunity,
  type TBAOpportunityLog,
  type OpportunityStage,
  type ProductType,
  type Currency,
} from "@/lib/supabase";

// ─── Brand colors ──────────────────────────────────────────────────────────────
const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

// ─── User identity ────────────────────────────────────────────────────────────
const RAFA_EMAIL   = "rafaelnolasco@gmail.com";
const CHARLY_EMAIL = "carlosnolascocas@gmail.com";

const USER_LABELS: Record<string, string> = {
  [RAFA_EMAIL]:   "Rafa",
  [CHARLY_EMAIL]: "Gran Charly",
};

function userLabel(email: string | undefined | null): string {
  if (!email) return "—";
  return USER_LABELS[email] ?? email.split("@")[0];
}

function userColor(email: string | undefined | null): string {
  if (email === RAFA_EMAIL)   return "#1a56cc";
  if (email === CHARLY_EMAIL) return "#7c3aed";
  return "#999";
}

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 760): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

// ─── Stage metadata ───────────────────────────────────────────────────────────
const STAGE_META: Record<
  OpportunityStage,
  { label: string; bg: string; color: string; prob: number }
> = {
  prospecto:       { label: "Prospecto",   bg: "#ededfc", color: "#4040b0", prob: 0.20 },
  propuesta:       { label: "Propuesta",   bg: "#e4f8fb", color: "#0a7a8a", prob: 0.40 },
  negociacion:     { label: "Negociación", bg: "#fff3e0", color: "#b35900", prob: 0.70 },
  cerrado_ganado:  { label: "✓ Ganado",   bg: "#eaf3de", color: "#3b6d11", prob: 1.00 },
  cerrado_perdido: { label: "Perdido",     bg: "#fce4e4", color: "#b00020", prob: 0.00 },
};

const STAGE_ORDER: OpportunityStage[] = [
  "prospecto", "propuesta", "negociacion", "cerrado_ganado", "cerrado_perdido",
];

const PRODUCT_META: Record<ProductType, { label: string }> = {
  hardware:          { label: "Hardware" },
  licencia:          { label: "Licencia" },
  hardware_licencia: { label: "HW + Lic" },
};

// ─── Field display names for the audit log ───────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  opportunity_name:     "Nombre de oportunidad",
  company_name:         "Empresa",
  contact_name:         "Contacto",
  product_type:         "Tipo de producto",
  vendor:               "Vendor",
  amount:               "Monto",
  currency:             "Moneda",
  stage:                "Etapa",
  close_date:           "Fecha cierre",
  notes:                "Notas",
  commission_rafa:      "Comisión Rafa",
  commission_charly:    "Comisión Gran Charly",
  commission_currency:  "Moneda comisión",
  commission_paid_date: "Fecha de pago",
};

function fieldLabel(f: string): string {
  return FIELD_LABELS[f] ?? f;
}

function formatLogValue(field: string, val: string | null): string {
  if (val === null || val === "") return "vacío";
  if (field === "stage") {
    const meta = STAGE_META[val as OpportunityStage];
    return meta ? meta.label : val;
  }
  if (field === "amount") {
    const n = parseFloat(val);
    return isNaN(n) ? val : n.toLocaleString("es-MX");
  }
  if (field === "close_date" || field === "commission_paid_date") {
    return formatCloseDate(val);
  }
  return val;
}

// ─── Filter types ─────────────────────────────────────────────────────────────
type StageFilter = OpportunityStage | "todas" | "activas";
type UserFilter  = "todas" | "rafa" | "charly";

const FILTER_TABS: { key: StageFilter; label: string }[] = [
  { key: "todas",           label: "Todas" },
  { key: "activas",         label: "Activo" },
  { key: "prospecto",       label: "Prospecto" },
  { key: "propuesta",       label: "Propuesta" },
  { key: "negociacion",     label: "Negociación" },
  { key: "cerrado_ganado",  label: "Ganadas" },
  { key: "cerrado_perdido", label: "Perdidas" },
];

const USER_FILTER_TABS: { key: UserFilter; label: string; activeColor: string; activeBg: string }[] = [
  { key: "todas",  label: "Todos",       activeColor: "#555",    activeBg: "#f5f4f0" },
  { key: "rafa",   label: "Rafa",        activeColor: "#1a56cc", activeBg: "#e8f0fe" },
  { key: "charly", label: "Gran Charly", activeColor: "#7c3aed", activeBg: "#f3e8ff" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatAmount(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatCloseDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function sumAmount(list: TBAOpportunity[], cur: Currency): number {
  return list.filter(o => o.currency === cur).reduce((s, o) => s + o.amount, 0);
}

function pipelineLabel(usd: number, mxn: number): string {
  if (usd > 0 && mxn > 0) return `${formatAmount(usd, "USD")} + ${formatAmount(mxn, "MXN")}`;
  if (usd > 0) return formatAmount(usd, "USD");
  if (mxn > 0) return formatAmount(mxn, "MXN");
  return "—";
}

function commissionLabel(usd: number, mxn: number): string {
  if (usd === 0 && mxn === 0) return "—";
  if (usd > 0 && mxn > 0) return `${formatAmount(usd, "USD")} + ${formatAmount(mxn, "MXN")}`;
  if (usd > 0) return formatAmount(usd, "USD");
  return formatAmount(mxn, "MXN");
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d) < new Date();
}

// ─── FishFlow mark ────────────────────────────────────────────────────────────
function FishFlowMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="FishFlow">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z" stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z" stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26" stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TBAPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  // ── Form state ──
  const [oppName,     setOppName]     = useState("");
  const [company,     setCompany]     = useState("");
  const [contact,     setContact]     = useState("");
  const [productType, setProductType] = useState<ProductType>("hardware");
  const [vendor,      setVendor]      = useState("");
  const [amount,      setAmount]      = useState("");
  const [currency,    setCurrency]    = useState<Currency>("USD");
  const [stage,       setStage]       = useState<OpportunityStage>("prospecto");
  const [closeDate,   setCloseDate]   = useState("");
  const [notes,       setNotes]       = useState("");
  const [saving,      setSaving]      = useState(false);
  const [ok,          setOk]          = useState("");
  const [err,         setErr]         = useState("");

  // ── Mobile: collapse the "new opportunity" form by default ──
  const [formOpen, setFormOpen] = useState(false);

  // ── Data state ──
  const [opps,        setOpps]        = useState<TBAOpportunity[]>([]);
  const [auditLog,    setAuditLog]    = useState<TBAOpportunityLog[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState<StageFilter>("activas");
  const [userFilter,  setUserFilter]  = useState<UserFilter>("todas");
  const [expandedOpp, setExpandedOpp] = useState<string | null>(null);

  // ── Commission editing state (keyed by opportunity id) ──
  const [commEdits, setCommEdits] = useState<Record<string, {
    rafa: string; charly: string; currency: Currency; paidDate: string; fulfillmentNotes: string;
  }>>({});
  const [commSaving, setCommSaving] = useState<Record<string, boolean>>({});

  // ── Inline row editing state (keyed by opportunity id) ──
  const [rowEdits, setRowEdits] = useState<Record<string, {
    oppName: string; closeDate: string; amount: string; currency: Currency; notes: string;
  }>>({});
  const [rowSaving, setRowSaving] = useState<Record<string, boolean>>({});

  const firstInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch opportunities ──
  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from("tba_opportunities")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setOpps(data as TBAOpportunity[]);
    setLoading(false);
  }

  // ── Fetch audit log ──
  async function fetchLog() {
    const { data } = await supabase
      .from("tba_opportunities_log")
      .select("*")
      .order("changed_at", { ascending: false });
    if (data) setAuditLog(data as TBAOpportunityLog[]);
  }

  useEffect(() => {
    fetchAll();
    fetchLog();
  }, []);

  // ── Derived: opp_id → { createdByEmail, updatedByEmail }
  // Log is ordered DESC → first "updated" entry per opp encountered is the most recent
  const oppUserMap = useMemo(() => {
    const map: Record<string, { createdByEmail?: string; updatedByEmail?: string }> = {};
    auditLog.forEach(entry => {
      if (!map[entry.opportunity_id]) map[entry.opportunity_id] = {};
      if (entry.action === "created" && !map[entry.opportunity_id].createdByEmail) {
        map[entry.opportunity_id].createdByEmail = entry.changed_by_email;
      }
      if (entry.action === "updated" && !map[entry.opportunity_id].updatedByEmail) {
        map[entry.opportunity_id].updatedByEmail = entry.changed_by_email;
      }
    });
    return map;
  }, [auditLog]);

  // ── Initialize commission edit state when opps load ──
  useEffect(() => {
    const initial: typeof commEdits = {};
    opps.filter(o => o.stage === "cerrado_ganado").forEach(o => {
      if (!commEdits[o.id]) {
        initial[o.id] = {
          rafa:             o.commission_rafa?.toString()   ?? "",
          charly:           o.commission_charly?.toString() ?? "",
          currency:         o.commission_currency ?? o.currency,
          paidDate:         o.commission_paid_date ?? "",
          fulfillmentNotes: o.fulfillment_notes ?? "",
        };
      }
    });
    if (Object.keys(initial).length > 0) {
      setCommEdits(prev => ({ ...initial, ...prev }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps]);

  // ── Initialize row inline edit state when opps load ──
  useEffect(() => {
    const initial: typeof rowEdits = {};
    opps.forEach(o => {
      if (!rowEdits[o.id]) {
        initial[o.id] = {
          oppName:   o.opportunity_name ?? "",
          closeDate: o.close_date ?? "",
          amount:    o.amount?.toString() ?? "",
          currency:  o.currency,
          notes:     o.notes ?? "",
        };
      }
    });
    if (Object.keys(initial).length > 0) {
      setRowEdits(prev => ({ ...initial, ...prev }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(amount.replace(/,/g, ""));
    if (!oppName.trim() || !company.trim() || !contact.trim() || !vendor.trim() || isNaN(num) || num <= 0) {
      setErr("Completa todos los campos obligatorios (*).");
      return;
    }
    setSaving(true); setErr("");
    const { error } = await supabase.from("tba_opportunities").insert({
      opportunity_name: oppName.trim(),
      company_name: company.trim(), contact_name: contact.trim(),
      product_type: productType, vendor: vendor.trim(),
      amount: num, currency, stage,
      close_date: closeDate || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) { setErr("Error al guardar. Intenta de nuevo."); return; }
    setOk(`✓ "${oppName.trim()}" registrada`);
    setOppName(""); setCompany(""); setContact(""); setVendor(""); setAmount("");
    setCloseDate(""); setNotes("");
    setProductType("hardware"); setCurrency("USD"); setStage("prospecto");
    firstInputRef.current?.focus();
    await fetchAll();
    await fetchLog();
    setTimeout(() => setOk(""), 3500);
  }

  async function handleStageChange(id: string, newStage: OpportunityStage) {
    await supabase
      .from("tba_opportunities")
      .update({ stage: newStage, updated_at: new Date().toISOString() })
      .eq("id", id);
    setOpps(prev => prev.map(o => o.id === id ? { ...o, stage: newStage } : o));
    await fetchLog();
  }

  async function handleSaveRowFields(id: string) {
    const edit = rowEdits[id];
    if (!edit) return;
    setRowSaving(prev => ({ ...prev, [id]: true }));
    const num = parseFloat(edit.amount.replace(/,/g, ""));
    const payload: Partial<TBAOpportunity> = {
      opportunity_name: edit.oppName.trim() || undefined,
      close_date:       edit.closeDate || null,
      amount:           isNaN(num) ? undefined : num,
      currency:         edit.currency,
      notes:            edit.notes.trim() || null,
      updated_at:       new Date().toISOString(),
    };
    await supabase.from("tba_opportunities").update(payload).eq("id", id);
    setOpps(prev => prev.map(o => o.id === id ? { ...o, ...payload } : o));
    setRowSaving(prev => ({ ...prev, [id]: false }));
    await fetchLog();
  }

  async function handleSaveCommission(id: string) {
    const edit = commEdits[id];
    if (!edit) return;
    setCommSaving(prev => ({ ...prev, [id]: true }));
    const payload = {
      commission_rafa:      edit.rafa   ? parseFloat(edit.rafa)   : null,
      commission_charly:    edit.charly ? parseFloat(edit.charly) : null,
      commission_currency:  edit.currency,
      commission_paid_date: edit.paidDate || null,
      fulfillment_notes:    edit.fulfillmentNotes.trim() || null,
      updated_at:           new Date().toISOString(),
    };
    await supabase.from("tba_opportunities").update(payload).eq("id", id);
    setOpps(prev => prev.map(o => o.id === id ? { ...o, ...payload } : o));
    setCommSaving(prev => ({ ...prev, [id]: false }));
    await fetchLog();
  }

  function updateCommEdit(id: string, field: string, value: string) {
    setCommEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  function updateRowEdit(id: string, field: string, value: string) {
    setRowEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  async function handleToggleFulfillment(id: string, field: "shipped" | "delivered" | "invoiced" | "paid", current: boolean) {
    const newVal = !current;
    await supabase.from("tba_opportunities")
      .update({ [field]: newVal, updated_at: new Date().toISOString() })
      .eq("id", id);
    setOpps(prev => prev.map(o => o.id === id ? { ...o, [field]: newVal } : o));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/tba");
  }

  function toggleExpand(id: string) {
    setExpandedOpp(prev => prev === id ? null : id);
  }

  // ── Metrics ──
  const activeOpps = opps.filter(o => o.stage !== "cerrado_ganado" && o.stage !== "cerrado_perdido");
  const wonOpps    = opps.filter(o => o.stage === "cerrado_ganado");

  const pipelineUSD = sumAmount(activeOpps, "USD");
  const pipelineMXN = sumAmount(activeOpps, "MXN");
  const forecastUSD = activeOpps.filter(o => o.currency === "USD")
    .reduce((s, o) => s + o.amount * STAGE_META[o.stage].prob, 0);
  const forecastMXN = activeOpps.filter(o => o.currency === "MXN")
    .reduce((s, o) => s + o.amount * STAGE_META[o.stage].prob, 0);
  const wonUSD = sumAmount(wonOpps, "USD");
  const wonMXN = sumAmount(wonOpps, "MXN");

  function sumComm(person: "rafa" | "charly", cur: Currency): number {
    return wonOpps
      .filter(o => (o.commission_currency ?? o.currency) === cur)
      .reduce((s, o) => s + (person === "rafa" ? (o.commission_rafa ?? 0) : (o.commission_charly ?? 0)), 0);
  }
  const commRafaUSD   = sumComm("rafa",   "USD");
  const commRafaMXN   = sumComm("rafa",   "MXN");
  const commCharlyUSD = sumComm("charly", "USD");
  const commCharlyMXN = sumComm("charly", "MXN");

  // Funnel
  const funnelStages: OpportunityStage[] = ["prospecto", "propuesta", "negociacion"];
  const maxFunnelVal = Math.max(
    ...funnelStages.map(s =>
      opps.filter(o => o.stage === s && o.currency === "USD").reduce((sum, o) => sum + o.amount, 0)
    ), 1
  );

  // ── Filtering ──
  // 1. User filter
  const userFiltered =
    userFilter === "todas"  ? opps :
    userFilter === "rafa"   ? opps.filter(o => oppUserMap[o.id]?.createdByEmail === RAFA_EMAIL) :
    opps.filter(o => oppUserMap[o.id]?.createdByEmail === CHARLY_EMAIL);

  // 2. Stage filter
  const filtered =
    filter === "todas"   ? userFiltered :
    filter === "activas" ? userFiltered.filter(o => o.stage !== "cerrado_ganado" && o.stage !== "cerrado_perdido") :
    userFiltered.filter(o => o.stage === filter);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f6", fontFamily: "var(--font-outfit, system-ui, sans-serif)" }}>

      {/* Header */}
      <header style={{
        background: "#fff", borderBottom: "0.5px solid #e5e4df",
        minHeight: 56, padding: isMobile ? "0 1rem" : "0 1.5rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 30,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            background: "linear-gradient(135deg,#e8f0fe,#c7d8fc)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "#1a56cc", flexShrink: 0,
          }}>TBA</div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>TBA Telecom</p>
            <p style={{ fontSize: 11, color: "#888", margin: 0 }}>CRM de oportunidades</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12 }}>
          {!isMobile && (
            <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.5 }}>
              <FishFlowMark size={22} />
              <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>FishFlow</span>
            </a>
          )}
          <button onClick={handleLogout} style={{
            background: "transparent", border: "0.5px solid #e5e4df",
            borderRadius: 6, padding: "7px 12px", fontSize: 11, color: "#aaa", cursor: "pointer",
          }}>⎋ Salir</button>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "1rem 0.875rem" : "1.5rem 1.25rem" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "360px 1fr",
          gap: isMobile ? "1.25rem" : "1.5rem",
          alignItems: "start",
        }}>

          {/* ── Formulario ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={sectionLabel}>Nueva oportunidad</p>
              {isMobile && (
                <button onClick={() => setFormOpen(o => !o)} style={{
                  background: formOpen ? "#f0efeb" : FF_CYAN,
                  border: "none", borderRadius: 8,
                  padding: "7px 14px", fontSize: 13, fontWeight: 700,
                  color: formOpen ? "#444" : "#fff", cursor: "pointer", marginBottom: 10,
                }}>
                  {formOpen ? "Cerrar ✕" : "+ Registrar"}
                </button>
              )}
            </div>

            {(!isMobile || formOpen) && (
            <form onSubmit={handleSubmit} style={card}>

              <Field label="Nombre de la oportunidad *">
                <input ref={firstInputRef} type="text" value={oppName}
                  onChange={e => setOppName(e.target.value)}
                  placeholder="Ej. Renovación switches campus, Proyecto Red Core 2026" style={inputStyle} required />
              </Field>

              <Field label="Empresa / Prospect *">
                <input type="text" value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="Ej. Telmex, Banorte, PEMEX" style={inputStyle} required />
              </Field>

              <Field label="Contacto *">
                <input type="text" value={contact} onChange={e => setContact(e.target.value)}
                  placeholder="Nombre del comprador o decisor" style={inputStyle} required />
              </Field>

              <Field label="Tipo de producto">
                <div style={{ display: "flex", gap: 5 }}>
                  {(["hardware", "licencia", "hardware_licencia"] as ProductType[]).map(pt => (
                    <button key={pt} type="button" onClick={() => setProductType(pt)} style={{
                      flex: 1, padding: "10px 4px",
                      border: productType === pt ? `1.5px solid ${FF_CYAN}` : "0.5px solid #ddd",
                      borderRadius: 8,
                      background: productType === pt ? "#e4f8fb" : "#fff",
                      color: productType === pt ? "#0a7a8a" : "#555",
                      fontSize: 11, fontWeight: productType === pt ? 700 : 400, cursor: "pointer",
                    }}>
                      {PRODUCT_META[pt].label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Vendor / Marca *">
                <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
                  placeholder="Ej. Cisco, Juniper, Fortinet, HP" style={inputStyle} required />
              </Field>

              <Field label="Monto de la oportunidad *">
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 13 }}>$</span>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                      placeholder="0" min="1" step="0.01"
                      style={{ ...inputStyle, paddingLeft: 24 }} required />
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {(["USD", "MXN"] as Currency[]).map(c => (
                      <button key={c} type="button" onClick={() => setCurrency(c)} style={{
                        padding: "9px 12px",
                        border: currency === c ? `1.5px solid ${FF_ORANGE}` : "0.5px solid #ddd",
                        borderRadius: 8,
                        background: currency === c ? "#fff5ec" : "#fff",
                        color: currency === c ? "#b35900" : "#555",
                        fontSize: 12, fontWeight: currency === c ? 700 : 400, cursor: "pointer",
                      }}>{c}</button>
                    ))}
                  </div>
                </div>
              </Field>

              <Field label="Etapa del pipeline">
                <select value={stage} onChange={e => setStage(e.target.value as OpportunityStage)}
                  style={{ ...inputStyle, cursor: "pointer" }}>
                  {STAGE_ORDER.map(s => (
                    <option key={s} value={s}>{STAGE_META[s].label} ({Math.round(STAGE_META[s].prob * 100)}% prob.)</option>
                  ))}
                </select>
              </Field>

              <Field label="Fecha estimada de cierre">
                <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} style={inputStyle} />
              </Field>

              <Field label="Notas (opcional)">
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Situación del deal, competidores, siguiente paso…"
                  rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 68 }} />
              </Field>

              {err && <p style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</p>}
              {ok  && <p style={{ fontSize: 12, color: "#27ae60", marginBottom: 8 }}>{ok}</p>}

              <button type="submit" disabled={saving} style={{
                width: "100%", padding: "13px 0",
                background: saving ? "#aaa" : FF_CYAN,
                border: "none", borderRadius: 8, color: "#fff",
                fontSize: 15, fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer", marginTop: 2,
              }}>
                {saving ? "Guardando…" : "Registrar oportunidad"}
              </button>
            </form>
            )}
          </div>

          {/* ── Dashboard ── */}
          <div>
            <p style={sectionLabel}>Pipeline</p>

            {/* Metric cards — row 1: pipeline */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 10 }}>
              <MetricCard
                label="Pipeline activo"
                value={pipelineLabel(pipelineUSD, pipelineMXN)}
                sub={`${activeOpps.length} opp${activeOpps.length !== 1 ? "s" : ""} activa${activeOpps.length !== 1 ? "s" : ""}`}
                accentColor={FF_CYAN}
              />
              <MetricCard
                label="Forecast ponderado"
                value={pipelineLabel(forecastUSD, forecastMXN)}
                sub="Probabilidad × monto"
                accentColor={FF_ORANGE}
              />
              <MetricCard
                label="Cerrado ganado"
                value={wonOpps.length > 0 ? pipelineLabel(wonUSD, wonMXN) : "—"}
                sub={`${wonOpps.length} deal${wonOpps.length !== 1 ? "s" : ""} ganado${wonOpps.length !== 1 ? "s" : ""}`}
                accentColor="#27ae60"
              />
            </div>

            {/* Metric cards — row 2: comisiones */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: "1.25rem" }}>
              <MetricCard
                label="💰 Comisión Rafa"
                value={commissionLabel(commRafaUSD, commRafaMXN)}
                sub="Total acumulado ganado"
                accentColor="#1a56cc"
              />
              <MetricCard
                label="💰 Comisión Gran Charly"
                value={commissionLabel(commCharlyUSD, commCharlyMXN)}
                sub="Total acumulado ganado"
                accentColor="#7c3aed"
              />
            </div>

            {/* Funnel */}
            <div style={card}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 14 }}>Embudo de pipeline</p>
              {funnelStages.map((s, i) => {
                const stageOpps = opps.filter(o => o.stage === s);
                const stageUSD  = stageOpps.filter(o => o.currency === "USD").reduce((sum, o) => sum + o.amount, 0);
                const stageMXN  = stageOpps.filter(o => o.currency === "MXN").reduce((sum, o) => sum + o.amount, 0);
                const barPct    = Math.round((stageUSD / maxFunnelVal) * 100);
                const colors    = [STAGE_META.prospecto.color, FF_CYAN, FF_ORANGE];
                return (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, marginBottom: i < 2 ? 12 : 0 }}>
                    <span style={{ width: isMobile ? 66 : 88, fontSize: isMobile ? 11 : 12, color: "#666", flexShrink: 0 }}>{STAGE_META[s].label}</span>
                    <div style={{ flex: 1, height: 8, background: "#f0efeb", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${stageOpps.length > 0 ? Math.max(barPct, 4) : 0}%`,
                        background: colors[i], borderRadius: 4, transition: "width .4s",
                      }} />
                    </div>
                    <div style={{ minWidth: isMobile ? 96 : 160, textAlign: "right" }}>
                      <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 700, color: "#444" }}>
                        {pipelineLabel(stageUSD, stageMXN)}
                      </span>
                      <span style={{ fontSize: 11, color: "#bbb", marginLeft: 6 }}>({stageOpps.length})</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Tabla de oportunidades ── */}
        <div style={{ marginTop: "1.75rem" }}>
          <p style={sectionLabel}>Oportunidades</p>

          {/* Stage filter */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", background: "#eeede9", borderRadius: 8, padding: 4, marginBottom: 8 }}>
            {FILTER_TABS.map(({ key, label }) => {
              const count = key === "activas" ? activeOpps.length
                : key === "todas" ? undefined
                : opps.filter(o => o.stage === key).length;
              return (
                <button key={key} onClick={() => setFilter(key)} style={{
                  padding: "7px 13px",
                  border: filter === key ? "0.5px solid #ddd" : "none",
                  borderRadius: 6,
                  background: filter === key ? "#fff" : "transparent",
                  color: filter === key ? "#222" : "#777",
                  fontSize: 12, fontWeight: filter === key ? 700 : 400,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}>
                  {label}
                  {count !== undefined && (
                    <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700,
                      color: filter === key
                        ? (key === "activas" ? FF_CYAN : key !== "todas" ? STAGE_META[key as OpportunityStage].color : "#888")
                        : "#bbb" }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* User filter */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0 }}>
              Vendedor
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {USER_FILTER_TABS.map(({ key, label, activeColor, activeBg }) => (
                <button key={key} onClick={() => setUserFilter(key)} style={{
                  padding: "6px 14px",
                  border: userFilter === key ? `1.5px solid ${activeColor}` : "0.5px solid #ddd",
                  borderRadius: 20,
                  background: userFilter === key ? activeBg : "#fff",
                  color: userFilter === key ? activeColor : "#aaa",
                  fontSize: 11, fontWeight: userFilter === key ? 700 : 400,
                  cursor: "pointer",
                }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ ...card }}>
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14, margin: 0 }}>Cargando…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ ...card }}>
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14, margin: 0 }}>
                {opps.length === 0 ? "Aún no hay oportunidades. ¡Registra la primera!" : "No hay oportunidades en esta vista."}
              </p>
            </div>
          ) : isMobile ? (
            /* ── MOBILE: opportunity cards ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {filtered.map(o => {
                const userInfo   = oppUserMap[o.id];
                const oppLog     = auditLog.filter(e => e.opportunity_id === o.id);
                const isExpanded = expandedOpp === o.id;
                const re = rowEdits[o.id];
                return (
                  <div key={o.id} style={{ ...card, padding: "1rem" }}>
                    {/* Top: company + stage */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{o.company_name}</span>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{o.contact_name}</div>
                      </div>
                      <select value={o.stage}
                        onChange={e => handleStageChange(o.id, e.target.value as OpportunityStage)}
                        style={{
                          padding: "5px 10px", border: "none", borderRadius: 20,
                          background: STAGE_META[o.stage].bg, color: STAGE_META[o.stage].color,
                          fontSize: 11, fontWeight: 700, cursor: "pointer", outline: "none", appearance: "none", flexShrink: 0,
                        }}>
                        {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
                      </select>
                    </div>

                    {/* Tags: tipo + vendor */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                      <span style={{ fontSize: 11, color: "#888", background: "#f5f4f0", borderRadius: 4, padding: "3px 8px" }}>
                        {PRODUCT_META[o.product_type].label}
                      </span>
                      <span style={{ fontSize: 11, color: "#888", background: "#f5f4f0", borderRadius: 4, padding: "3px 8px" }}>
                        {o.vendor}
                      </span>
                    </div>

                    {/* Editable fields */}
                    <MobileLabel>Nombre de la oportunidad</MobileLabel>
                    <input type="text" value={re?.oppName ?? ""}
                      onChange={e => updateRowEdit(o.id, "oppName", e.target.value)}
                      placeholder="Nombre de la oportunidad…"
                      style={{ ...inputStyle, fontSize: 13, marginBottom: 10 }} />

                    <MobileLabel>Notas</MobileLabel>
                    <input type="text" value={re?.notes ?? ""}
                      onChange={e => updateRowEdit(o.id, "notes", e.target.value)}
                      placeholder="Descripción / notas…"
                      style={{ ...inputStyle, fontSize: 13, marginBottom: 10, color: "#555" }} />

                    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <MobileLabel>Monto</MobileLabel>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <div style={{ position: "relative", flex: 1 }}>
                            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 13 }}>$</span>
                            <input type="number" value={re?.amount ?? ""}
                              onChange={e => updateRowEdit(o.id, "amount", e.target.value)}
                              min="1" step="0.01"
                              style={{ ...inputStyle, paddingLeft: 22, fontSize: 13 }} />
                          </div>
                          <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                            {(["USD", "MXN"] as Currency[]).map(c => (
                              <button key={c} type="button"
                                onClick={() => updateRowEdit(o.id, "currency", c)}
                                style={{
                                  padding: "8px 9px",
                                  border: (re?.currency ?? o.currency) === c ? `1.5px solid ${FF_ORANGE}` : "0.5px solid #ddd",
                                  borderRadius: 6,
                                  background: (re?.currency ?? o.currency) === c ? "#fff5ec" : "#fff",
                                  color: (re?.currency ?? o.currency) === c ? "#b35900" : "#888",
                                  fontSize: 11, fontWeight: (re?.currency ?? o.currency) === c ? 700 : 400,
                                  cursor: "pointer",
                                }}>{c}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <MobileLabel>Fecha de cierre</MobileLabel>
                    <input type="date" value={re?.closeDate ?? ""}
                      onChange={e => updateRowEdit(o.id, "closeDate", e.target.value)}
                      style={{ ...inputStyle, fontSize: 13, marginBottom: 12 }} />

                    {/* Meta: creó / modificó */}
                    <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#999", marginBottom: 12 }}>
                      <span>Creó: <strong style={{ color: userColor(userInfo?.createdByEmail), fontWeight: 600 }}>{userLabel(userInfo?.createdByEmail)}</strong></span>
                      {userInfo?.updatedByEmail && (
                        <span>Modificó: <strong style={{ color: userColor(userInfo.updatedByEmail), fontWeight: 600 }}>{userLabel(userInfo.updatedByEmail)}</strong></span>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => handleSaveRowFields(o.id)} disabled={rowSaving[o.id]}
                        style={{
                          flex: 1, padding: "11px 0",
                          background: rowSaving[o.id] ? "#aaa" : "#1a1a1a",
                          border: "none", borderRadius: 8,
                          color: "#fff", fontSize: 14, fontWeight: 700,
                          cursor: rowSaving[o.id] ? "not-allowed" : "pointer",
                        }}>
                        {rowSaving[o.id] ? "Guardando…" : "Guardar"}
                      </button>
                      <button onClick={() => toggleExpand(o.id)}
                        style={{
                          background: isExpanded ? "#f0efeb" : "transparent",
                          border: "0.5px solid #e5e4df", borderRadius: 8,
                          padding: "11px 16px", fontSize: 13, color: isExpanded ? "#444" : "#999",
                          cursor: "pointer", whiteSpace: "nowrap",
                        }}>
                        {isExpanded ? "▲ Cerrar" : `⏱ Historial${oppLog.length > 0 ? ` (${oppLog.length})` : ""}`}
                      </button>
                    </div>

                    {/* Audit history */}
                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: "0.5px solid #eee", paddingTop: 12 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                          Historial de cambios
                        </p>
                        {oppLog.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#ccc" }}>Sin registros de auditoría aún.</p>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {oppLog.map(entry => (
                              <div key={entry.id} style={{ fontSize: 12, padding: "8px 10px", background: "#fafaf8", borderRadius: 8, border: "0.5px solid #eee" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                                  <span style={{ fontSize: 13 }}>{entry.action === "created" ? "🟢" : "✏️"}</span>
                                  <strong style={{ color: userColor(entry.changed_by_email), fontSize: 12 }}>{userLabel(entry.changed_by_email)}</strong>
                                  <span style={{ fontSize: 10, color: "#bbb", marginLeft: "auto" }}>{formatDateTime(entry.changed_at)}</span>
                                </div>
                                <div style={{ color: "#777", paddingLeft: 20 }}>
                                  {entry.action === "created" ? "creó la oportunidad" : (
                                    <>
                                      cambió <strong style={{ color: "#444" }}>{fieldLabel(entry.field ?? "")}</strong>{": "}
                                      <span style={{ color: "#c0392b", textDecoration: "line-through" }}>{formatLogValue(entry.field ?? "", entry.old_value)}</span>
                                      {" → "}
                                      <span style={{ color: "#27ae60", fontWeight: 600 }}>{formatLogValue(entry.field ?? "", entry.new_value)}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── DESKTOP: opportunity table ── */
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                      {["Empresa", "Contacto", "Tipo", "Vendor", "Monto", "Etapa", "Cierre", "Creó", "Modificó", ""].map((h, i) => (
                        <th key={i} style={{
                          padding: "10px 14px", textAlign: "left",
                          fontSize: 11, fontWeight: 700, color: "#999",
                          textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(o => {
                      const userInfo   = oppUserMap[o.id];
                      const oppLog     = auditLog.filter(e => e.opportunity_id === o.id);
                      const isExpanded = expandedOpp === o.id;

                      return (
                        <Fragment key={o.id}>
                          <tr style={{ borderBottom: isExpanded ? "none" : "0.5px solid #f0efeb" }}>
                            <td style={{ padding: "10px 14px", minWidth: 200 }}>
                              <span style={{ fontWeight: 700 }}>{o.company_name}</span>
                              <br />
                              <input
                                type="text"
                                value={rowEdits[o.id]?.oppName ?? ""}
                                onChange={e => updateRowEdit(o.id, "oppName", e.target.value)}
                                placeholder="Nombre de la oportunidad…"
                                style={{ ...inputStyle, fontSize: 12, padding: "4px 8px", marginTop: 4, fontWeight: 500 }}
                              />
                              <input
                                type="text"
                                value={rowEdits[o.id]?.notes ?? ""}
                                onChange={e => updateRowEdit(o.id, "notes", e.target.value)}
                                placeholder="Descripción / notas…"
                                style={{ ...inputStyle, fontSize: 11, padding: "4px 8px", marginTop: 4, color: "#666" }}
                              />
                            </td>
                            <td style={{ padding: "10px 14px", color: "#555", whiteSpace: "nowrap" }}>{o.contact_name}</td>
                            <td style={{ padding: "10px 14px" }}>
                              <span style={{ fontSize: 11, color: "#888", background: "#f5f4f0", borderRadius: 4, padding: "2px 7px" }}>
                                {PRODUCT_META[o.product_type].label}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px", color: "#555", whiteSpace: "nowrap" }}>{o.vendor}</td>
                            <td style={{ padding: "8px 14px" }}>
                              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <div style={{ position: "relative" }}>
                                  <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 12 }}>$</span>
                                  <input
                                    type="number"
                                    value={rowEdits[o.id]?.amount ?? ""}
                                    onChange={e => updateRowEdit(o.id, "amount", e.target.value)}
                                    min="1" step="0.01"
                                    style={{ ...inputStyle, paddingLeft: 18, fontSize: 12, padding: "5px 6px 5px 18px", width: 96 }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  {(["USD", "MXN"] as Currency[]).map(c => (
                                    <button key={c} type="button"
                                      onClick={() => updateRowEdit(o.id, "currency", c)}
                                      style={{
                                        padding: "2px 6px",
                                        border: (rowEdits[o.id]?.currency ?? o.currency) === c ? `1.5px solid ${FF_ORANGE}` : "0.5px solid #ddd",
                                        borderRadius: 4,
                                        background: (rowEdits[o.id]?.currency ?? o.currency) === c ? "#fff5ec" : "#fff",
                                        color: (rowEdits[o.id]?.currency ?? o.currency) === c ? "#b35900" : "#888",
                                        fontSize: 10, fontWeight: (rowEdits[o.id]?.currency ?? o.currency) === c ? 700 : 400,
                                        cursor: "pointer", lineHeight: 1.5,
                                      }}>{c}</button>
                                  ))}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <select value={o.stage}
                                onChange={e => handleStageChange(o.id, e.target.value as OpportunityStage)}
                                style={{
                                  padding: "4px 10px", border: "none", borderRadius: 20,
                                  background: STAGE_META[o.stage].bg, color: STAGE_META[o.stage].color,
                                  fontSize: 11, fontWeight: 700, cursor: "pointer", outline: "none", appearance: "none",
                                }}>
                                {STAGE_ORDER.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: "8px 14px" }}>
                              <input
                                type="date"
                                value={rowEdits[o.id]?.closeDate ?? ""}
                                onChange={e => updateRowEdit(o.id, "closeDate", e.target.value)}
                                style={{ ...inputStyle, fontSize: 12, padding: "5px 8px", width: 140 }}
                              />
                            </td>
                            {/* Creó */}
                            <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: userColor(userInfo?.createdByEmail) }}>
                                {userLabel(userInfo?.createdByEmail)}
                              </span>
                            </td>
                            {/* Modificó */}
                            <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                              {userInfo?.updatedByEmail ? (
                                <span style={{ fontSize: 11, color: userColor(userInfo.updatedByEmail) }}>
                                  {userLabel(userInfo.updatedByEmail)}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: "#ddd" }}>—</span>
                              )}
                            </td>
                            {/* Guardar + Historial toggle */}
                            <td style={{ padding: "8px 14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <button
                                  onClick={() => handleSaveRowFields(o.id)}
                                  disabled={rowSaving[o.id]}
                                  style={{
                                    padding: "5px 12px",
                                    background: rowSaving[o.id] ? "#aaa" : "#1a1a1a",
                                    border: "none", borderRadius: 6,
                                    color: "#fff", fontSize: 11, fontWeight: 700,
                                    cursor: rowSaving[o.id] ? "not-allowed" : "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {rowSaving[o.id] ? "…" : "Guardar"}
                                </button>
                                <button
                                  onClick={() => toggleExpand(o.id)}
                                  title={isExpanded ? "Ocultar historial" : "Ver historial"}
                                  style={{
                                    background: isExpanded ? "#f0efeb" : "transparent",
                                    border: "0.5px solid #e5e4df",
                                    borderRadius: 6, padding: "4px 9px",
                                    fontSize: 11, color: isExpanded ? "#444" : "#bbb",
                                    cursor: "pointer", whiteSpace: "nowrap",
                                    textAlign: "center",
                                  }}
                                >
                                  {isExpanded ? "▲ Cerrar" : "⏱"}
                                  {!isExpanded && oppLog.length > 0 && (
                                    <span style={{ marginLeft: 3, fontSize: 10, color: "#ccc" }}>
                                      {oppLog.length}
                                    </span>
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* ── Audit history panel ── */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} style={{ padding: "0 14px 14px 14px", background: "#fafaf8", borderBottom: "0.5px solid #f0efeb" }}>
                                <div style={{ borderTop: "0.5px solid #eee", paddingTop: 12 }}>
                                  <p style={{
                                    fontSize: 11, fontWeight: 700, color: "#bbb",
                                    textTransform: "uppercase", letterSpacing: "0.05em",
                                    marginBottom: 10,
                                  }}>
                                    Historial de cambios
                                  </p>
                                  {oppLog.length === 0 ? (
                                    <p style={{ fontSize: 12, color: "#ccc" }}>Sin registros de auditoría aún.</p>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                      {oppLog.map(entry => (
                                        <div key={entry.id} style={{
                                          display: "flex", alignItems: "center", gap: 10,
                                          fontSize: 12, padding: "7px 10px",
                                          background: "#fff", borderRadius: 6,
                                          border: "0.5px solid #eee",
                                        }}>
                                          <span style={{ fontSize: 13, flexShrink: 0 }}>
                                            {entry.action === "created" ? "🟢" : "✏️"}
                                          </span>
                                          <span style={{
                                            fontWeight: 700, flexShrink: 0, fontSize: 12,
                                            color: userColor(entry.changed_by_email),
                                          }}>
                                            {userLabel(entry.changed_by_email)}
                                          </span>
                                          <span style={{ flex: 1, color: "#777" }}>
                                            {entry.action === "created"
                                              ? "creó la oportunidad"
                                              : (
                                                <>
                                                  cambió <strong style={{ color: "#444" }}>{fieldLabel(entry.field ?? "")}</strong>
                                                  {": "}
                                                  <span style={{ color: "#c0392b", textDecoration: "line-through" }}>
                                                    {formatLogValue(entry.field ?? "", entry.old_value)}
                                                  </span>
                                                  {" → "}
                                                  <span style={{ color: "#27ae60", fontWeight: 600 }}>
                                                    {formatLogValue(entry.field ?? "", entry.new_value)}
                                                  </span>
                                                </>
                                              )
                                            }
                                          </span>
                                          <span style={{ fontSize: 11, color: "#bbb", flexShrink: 0, whiteSpace: "nowrap" }}>
                                            {formatDateTime(entry.changed_at)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Sección Comisiones ── */}
        <div style={{ marginTop: "1.75rem" }}>
          <p style={sectionLabel}>Comisiones — deals ganados</p>

          {wonOpps.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "#bbb", fontSize: 14, padding: "2rem" }}>
              Las comisiones aparecerán aquí cuando marques una oportunidad como ganada.
            </div>
          ) : isMobile ? (
            /* ── MOBILE: commission cards ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Totals summary */}
              <div style={{ ...card, padding: "1rem", background: "#fafaf8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: "#888" }}>Total ganado</span>
                  <strong style={{ color: "#3b6d11" }}>{pipelineLabel(wonUSD, wonMXN)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: "#888" }}>Comisión Rafa</span>
                  <strong style={{ color: "#1a56cc" }}>{commissionLabel(commRafaUSD, commRafaMXN)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#888" }}>Comisión Gran Charly</span>
                  <strong style={{ color: "#7c3aed" }}>{commissionLabel(commCharlyUSD, commCharlyMXN)}</strong>
                </div>
              </div>

              {wonOpps.map(o => {
                const edit    = commEdits[o.id] ?? { rafa: "", charly: "", currency: o.currency, paidDate: "", fulfillmentNotes: "" };
                const cSaving = commSaving[o.id] ?? false;
                const overdue = o.commission_paid_date ? isOverdue(o.commission_paid_date) : false;
                const steps: { key: "shipped" | "delivered" | "invoiced" | "paid"; icon: string; label: string }[] = [
                  { key: "shipped",   icon: "📦", label: "Embarcado" },
                  { key: "delivered", icon: "🏢", label: "En cliente" },
                  { key: "invoiced",  icon: "🧾", label: "Facturado" },
                  { key: "paid",      icon: "💰", label: "Pagado" },
                ];
                const allDone = steps.every(s => o[s.key]);
                return (
                  <div key={o.id} style={{ ...card, padding: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{o.company_name}</span>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{o.opportunity_name}</div>
                      </div>
                      <span style={{ fontWeight: 700, color: "#3b6d11", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {formatAmount(o.amount, o.currency)}
                      </span>
                    </div>

                    {/* Fulfillment */}
                    <MobileLabel>Entrega</MobileLabel>
                    {allDone && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#3b6d11", background: "#eaf3de", borderRadius: 20, padding: "2px 10px", display: "inline-block", marginBottom: 6 }}>✓ Completo</div>
                    )}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      {steps.map(s => {
                        const done = o[s.key] as boolean;
                        return (
                          <button key={s.key} type="button"
                            onClick={() => handleToggleFulfillment(o.id, s.key, done)}
                            style={{
                              display: "flex", alignItems: "center", gap: 3,
                              padding: "6px 10px",
                              border: done ? "1.5px solid #4caf50" : "0.5px solid #ddd",
                              borderRadius: 20,
                              background: done ? "#eaf3de" : "#f5f4f0",
                              color: done ? "#3b6d11" : "#aaa",
                              fontSize: 11, fontWeight: done ? 700 : 400,
                              cursor: "pointer", whiteSpace: "nowrap",
                            }}>
                            <span>{s.icon}</span><span>{s.label}</span>{done && <span style={{ fontSize: 10 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    <input type="text" value={edit.fulfillmentNotes ?? ""}
                      onChange={e => updateCommEdit(o.id, "fulfillmentNotes", e.target.value)}
                      placeholder="Notas de entrega…"
                      style={{ ...inputStyle, fontSize: 12, marginBottom: 12, color: "#555" }} />

                    {/* Comisiones */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <MobileLabel>Comisión Rafa</MobileLabel>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 13 }}>$</span>
                          <input type="number" min="0" step="0.01" value={edit.rafa}
                            onChange={e => updateCommEdit(o.id, "rafa", e.target.value)} placeholder="0"
                            style={{ ...inputStyle, paddingLeft: 22, fontSize: 13 }} />
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <MobileLabel>Comisión Charly</MobileLabel>
                        <div style={{ position: "relative" }}>
                          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 13 }}>$</span>
                          <input type="number" min="0" step="0.01" value={edit.charly}
                            onChange={e => updateCommEdit(o.id, "charly", e.target.value)} placeholder="0"
                            style={{ ...inputStyle, paddingLeft: 22, fontSize: 13 }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-end" }}>
                      <div>
                        <MobileLabel>Moneda</MobileLabel>
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["USD", "MXN"] as Currency[]).map(c => (
                            <button key={c} type="button" onClick={() => updateCommEdit(o.id, "currency", c)}
                              style={{
                                padding: "8px 11px",
                                border: edit.currency === c ? `1.5px solid ${FF_ORANGE}` : "0.5px solid #ddd",
                                borderRadius: 6,
                                background: edit.currency === c ? "#fff5ec" : "#fff",
                                color: edit.currency === c ? "#b35900" : "#888",
                                fontSize: 11, fontWeight: edit.currency === c ? 700 : 400, cursor: "pointer",
                              }}>{c}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <MobileLabel>Fecha de pago</MobileLabel>
                        <input type="date" value={edit.paidDate}
                          onChange={e => updateCommEdit(o.id, "paidDate", e.target.value)}
                          style={{ ...inputStyle, fontSize: 13 }} />
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {!edit.paidDate ? (
                        <span style={{ fontSize: 11, color: "#bbb" }}>Sin fecha</span>
                      ) : overdue ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#fce4e4", borderRadius: 20, padding: "4px 10px" }}>⚠ Vencido</span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#3b6d11", background: "#eaf3de", borderRadius: 20, padding: "4px 10px" }}>⏳ Pendiente</span>
                      )}
                      <button onClick={() => handleSaveCommission(o.id)} disabled={cSaving}
                        style={{
                          flex: 1, padding: "11px 0",
                          background: cSaving ? "#aaa" : "#1a1a1a",
                          border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 700,
                          cursor: cSaving ? "not-allowed" : "pointer",
                        }}>
                        {cSaving ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── DESKTOP: commission table ── */
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                      {["Empresa", "Deal", "Entrega", "Comisión Rafa", "Comisión Gran Charly", "Moneda", "Fecha de pago", "Estado", ""].map(h => (
                        <th key={h} style={{
                          padding: "10px 14px", textAlign: "left",
                          fontSize: 11, fontWeight: 700, color: "#999",
                          textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wonOpps.map(o => {
                      const edit    = commEdits[o.id] ?? { rafa: "", charly: "", currency: o.currency, paidDate: "", fulfillmentNotes: "" };
                      const cSaving = commSaving[o.id] ?? false;
                      const overdue = o.commission_paid_date ? isOverdue(o.commission_paid_date) : false;

                      return (
                        <tr key={o.id} style={{ borderBottom: "0.5px solid #f0efeb" }}>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ fontWeight: 700 }}>{o.company_name}</span>
                            <br />
                            <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>{o.opportunity_name}</span>
                          </td>
                          <td style={{ padding: "10px 14px", fontWeight: 700, color: "#3b6d11", whiteSpace: "nowrap" }}>
                            {formatAmount(o.amount, o.currency)}
                          </td>

                          {/* ── Fulfillment tracker ── */}
                          <td style={{ padding: "8px 14px", minWidth: 220 }}>
                            {(() => {
                              const steps: { key: "shipped" | "delivered" | "invoiced" | "paid"; icon: string; label: string }[] = [
                                { key: "shipped",   icon: "📦", label: "Embarcado" },
                                { key: "delivered", icon: "🏢", label: "En cliente" },
                                { key: "invoiced",  icon: "🧾", label: "Facturado" },
                                { key: "paid",      icon: "💰", label: "Pagado" },
                              ];
                              const allDone = steps.every(s => o[s.key]);
                              return (
                                <div>
                                  {allDone && (
                                    <div style={{
                                      fontSize: 11, fontWeight: 700, color: "#3b6d11",
                                      background: "#eaf3de", borderRadius: 20,
                                      padding: "2px 10px", display: "inline-block", marginBottom: 6,
                                    }}>✓ Completo</div>
                                  )}
                                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                    {steps.map(s => {
                                      const done = o[s.key] as boolean;
                                      return (
                                        <button key={s.key} type="button"
                                          onClick={() => handleToggleFulfillment(o.id, s.key, done)}
                                          title={done ? `Desmarcar: ${s.label}` : `Marcar: ${s.label}`}
                                          style={{
                                            display: "flex", alignItems: "center", gap: 3,
                                            padding: "3px 8px",
                                            border: done ? "1.5px solid #4caf50" : "0.5px solid #ddd",
                                            borderRadius: 20,
                                            background: done ? "#eaf3de" : "#f5f4f0",
                                            color: done ? "#3b6d11" : "#aaa",
                                            fontSize: 11, fontWeight: done ? 700 : 400,
                                            cursor: "pointer", whiteSpace: "nowrap",
                                            transition: "all .15s",
                                          }}>
                                          <span>{s.icon}</span>
                                          <span>{s.label}</span>
                                          {done && <span style={{ fontSize: 10 }}>✓</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <input
                                    type="text"
                                    value={edit.fulfillmentNotes ?? ""}
                                    onChange={e => updateCommEdit(o.id, "fulfillmentNotes", e.target.value)}
                                    placeholder="Notas de entrega…"
                                    style={{ ...inputStyle, fontSize: 11, padding: "4px 8px", marginTop: 6, color: "#666" }}
                                  />
                                </div>
                              );
                            })()}
                          </td>

                          <td style={{ padding: "8px 14px" }}>
                            <div style={{ position: "relative" }}>
                              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 12 }}>$</span>
                              <input
                                type="number" min="0" step="0.01"
                                value={edit.rafa}
                                onChange={e => updateCommEdit(o.id, "rafa", e.target.value)}
                                placeholder="0"
                                style={{ ...inputStyle, paddingLeft: 20, fontSize: 13, padding: "6px 8px 6px 20px", width: 110 }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "8px 14px" }}>
                            <div style={{ position: "relative" }}>
                              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 12 }}>$</span>
                              <input
                                type="number" min="0" step="0.01"
                                value={edit.charly}
                                onChange={e => updateCommEdit(o.id, "charly", e.target.value)}
                                placeholder="0"
                                style={{ ...inputStyle, paddingLeft: 20, fontSize: 13, padding: "6px 8px 6px 20px", width: 110 }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "8px 14px" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              {(["USD", "MXN"] as Currency[]).map(c => (
                                <button key={c} type="button"
                                  onClick={() => updateCommEdit(o.id, "currency", c)}
                                  style={{
                                    padding: "4px 8px",
                                    border: edit.currency === c ? `1.5px solid ${FF_ORANGE}` : "0.5px solid #ddd",
                                    borderRadius: 6,
                                    background: edit.currency === c ? "#fff5ec" : "#fff",
                                    color: edit.currency === c ? "#b35900" : "#888",
                                    fontSize: 11, fontWeight: edit.currency === c ? 700 : 400,
                                    cursor: "pointer",
                                  }}>{c}</button>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: "8px 14px" }}>
                            <input
                              type="date"
                              value={edit.paidDate}
                              onChange={e => updateCommEdit(o.id, "paidDate", e.target.value)}
                              style={{ ...inputStyle, fontSize: 12, padding: "6px 10px", width: 140 }}
                            />
                          </td>
                          <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                            {!edit.paidDate ? (
                              <span style={{ fontSize: 11, color: "#bbb" }}>Sin fecha</span>
                            ) : overdue ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#b00020", background: "#fce4e4", borderRadius: 20, padding: "3px 10px" }}>
                                ⚠ Vencido
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#3b6d11", background: "#eaf3de", borderRadius: 20, padding: "3px 10px" }}>
                                ⏳ Pendiente
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 14px" }}>
                            <button
                              onClick={() => handleSaveCommission(o.id)}
                              disabled={cSaving}
                              style={{
                                padding: "6px 14px",
                                background: cSaving ? "#aaa" : "#1a1a1a",
                                border: "none", borderRadius: 6,
                                color: "#fff", fontSize: 12, fontWeight: 700,
                                cursor: cSaving ? "not-allowed" : "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {cSaving ? "…" : "Guardar"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                  {/* Totals footer */}
                  <tfoot>
                    <tr style={{ borderTop: "1px solid #e5e4df", background: "#fafaf8" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, fontSize: 12, color: "#666" }}>Total</td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#3b6d11" }}>
                        {pipelineLabel(wonUSD, wonMXN)}
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#1a56cc" }}>
                        {commissionLabel(commRafaUSD, commRafaMXN)}
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#7c3aed" }}>
                        {commissionLabel(commCharlyUSD, commCharlyMXN)}
                      </td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ marginTop: "2rem", paddingTop: "1.25rem", borderTop: "0.5px solid #e5e4df", display: "flex", justifyContent: "center" }}>
          <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.35 }}>
            <FishFlowMark size={18} />
            <span style={{ fontSize: 11, color: "#666" }}>Potenciado por FishFlow</span>
          </a>
        </footer>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accentColor }: {
  label: string; value: string; sub: string; accentColor?: string;
}) {
  return (
    <div style={{ background: "#f5f4f0", borderRadius: 8, padding: "0.875rem 1rem" }}>
      <p style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: accentColor ?? "#1a1a1a", margin: 0, lineHeight: 1.3, wordBreak: "break-word" }}>
        {value}
      </p>
      <p style={{ fontSize: 11, color: "#bbb", marginTop: 3 }}>{sub}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, color: "#777", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
      {children}
    </p>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#aaa",
  letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10,
};

const card: React.CSSProperties = {
  background: "#fff", border: "0.5px solid #e5e4df", borderRadius: 12, padding: "1.25rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "0.5px solid #ddd", borderRadius: 8,
  background: "#fff", color: "#1a1a1a",
  fontSize: 14, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
