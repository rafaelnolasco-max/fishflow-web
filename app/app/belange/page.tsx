"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, type BelangeTransaction, type PaymentMethod } from "@/lib/supabase";

// ─── FishFlow brand colors ────────────────────────────────────────────────────
const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

// ─── FishFlow lemniscate mark ─────────────────────────────────────────────────
function FishFlowMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.52}
      viewBox="0 0 68 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="FishFlow"
    >
      <path
        d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z"
        stroke={FF_CYAN}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z"
        stroke={FF_ORANGE}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M64 14 L68 10 M64 22 L68 26"
        stroke={FF_ORANGE}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function startOf(period: "day" | "week" | "month"): Date {
  const now = new Date();
  if (period === "day")   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const d = now.getDay();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - d + (d === 0 ? -6 : 1));
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function formatMXN(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function downloadCSV(rows: BelangeTransaction[], label: string) {
  const header = ["Fecha", "Cliente", "Servicio", "Precio", "Método de pago"];
  const body   = rows.map(t => [formatDate(t.created_at), t.client_name, t.service, t.price.toFixed(2), t.payment_method]);
  const csv    = [header, ...body].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob   = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url    = URL.createObjectURL(blob);
  const a      = Object.assign(document.createElement("a"), { href: url, download: `belange_${label}_${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

type Tab = "day" | "week" | "month";
const TAB_LABELS: Record<Tab, string> = { day: "Hoy", week: "Semana", month: "Mes" };

const PAYMENT_META: Record<PaymentMethod, { label: string; bg: string; color: string }> = {
  efectivo:      { label: "Efectivo",      bg: "#eaf3de", color: "#3b6d11" },
  tarjeta:       { label: "Tarjeta",       bg: "#e6f1fb", color: "#185fa5" },
  transferencia: { label: "Transferencia", bg: "#faeeda", color: "#854f0b" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BelangePage() {
  const [clientName, setClientName] = useState("");
  const [service,    setService]    = useState("");
  const [price,      setPrice]      = useState("");
  const [payment,    setPayment]    = useState<PaymentMethod>("efectivo");
  const [saving,     setSaving]     = useState(false);
  const [ok,         setOk]         = useState("");
  const [err,        setErr]        = useState("");

  const [tab,          setTab]          = useState<Tab>("day");
  const [transactions, setTransactions] = useState<BelangeTransaction[]>([]);
  const [loading,      setLoading]      = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from("belange_transactions")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setTransactions(data as BelangeTransaction[]);
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(price.replace(/,/g, ""));
    if (!clientName.trim() || !service.trim() || isNaN(num) || num <= 0) {
      setErr("Completa todos los campos correctamente.");
      return;
    }
    setSaving(true); setErr("");
    const { error } = await supabase.from("belange_transactions").insert({
      client_name: clientName.trim(), service: service.trim(), price: num, payment_method: payment,
    });
    setSaving(false);
    if (error) { setErr("Error al guardar. Intenta de nuevo."); return; }
    setOk(`✓ Servicio de ${clientName.trim()} registrado`);
    setClientName(""); setService(""); setPrice(""); setPayment("efectivo");
    inputRef.current?.focus();
    fetchAll();
    setTimeout(() => setOk(""), 3500);
  }

  const cutoff   = startOf(tab);
  const filtered = transactions.filter(t => new Date(t.created_at) >= cutoff);
  const total    = filtered.reduce((s, t) => s + t.price, 0);
  const count    = filtered.length;
  const avg      = count ? total / count : 0;

  const byM = (m: PaymentMethod) => filtered.filter(t => t.payment_method === m).reduce((s, t) => s + t.price, 0);
  const ef = byM("efectivo"), ta = byM("tarjeta"), tr = byM("transferencia");
  const maxBar = Math.max(ef, ta, tr, 1);

  const barColor: Record<PaymentMethod, string> = { efectivo: "#639922", tarjeta: FF_CYAN, transferencia: FF_ORANGE };

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f6", fontFamily: "var(--font-outfit, system-ui, sans-serif)" }}>

      {/* Header */}
      <header style={{ background: "#fff", borderBottom: "0.5px solid #e5e4df", height: 56, padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#fbeaf0,#f4c0d1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#72243e" }}>BS</div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Belange Studio</p>
            <p style={{ fontSize: 11, color: "#888", margin: 0 }}>Panel de ingresos</p>
          </div>
        </div>
        <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.5 }}>
          <FishFlowMark size={22} />
          <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>FishFlow</span>
        </a>
      </header>

      {/* Body */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1.25rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* ── Formulario ── */}
          <div>
            <p style={sectionLabel}>Registrar servicio</p>
            <form onSubmit={handleSubmit} style={card}>

              <Field label="Nombre del cliente">
                <input ref={inputRef} type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                  placeholder="Ej. María González" style={inputStyle} required />
              </Field>

              <Field label="Servicio realizado">
                <input type="text" value={service} onChange={e => setService(e.target.value)}
                  placeholder="Ej. Corte + tinte raíz" style={inputStyle} required />
              </Field>

              <Field label="Precio cobrado ($)">
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 14 }}>$</span>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                    placeholder="0" min="1" step="1" style={{ ...inputStyle, paddingLeft: 26 }} required />
                </div>
              </Field>

              <Field label="Método de pago">
                <div style={{ display: "flex", gap: 6 }}>
                  {(["efectivo","tarjeta","transferencia"] as PaymentMethod[]).map(m => (
                    <button key={m} type="button" onClick={() => setPayment(m)} style={{
                      flex: 1, padding: "9px 4px",
                      border: payment === m ? `1.5px solid ${FF_CYAN}` : "0.5px solid #ddd",
                      borderRadius: 8,
                      background: payment === m ? "#e4f8fb" : "#fff",
                      color: payment === m ? "#0a7a8a" : "#555",
                      fontSize: 12, fontWeight: payment === m ? 700 : 400, cursor: "pointer",
                    }}>
                      {PAYMENT_META[m].label}
                    </button>
                  ))}
                </div>
              </Field>

              {err && <p style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</p>}
              {ok  && <p style={{ fontSize: 12, color: "#27ae60", marginBottom: 8 }}>{ok}</p>}

              <button type="submit" disabled={saving} style={{
                width: "100%", padding: "11px 0",
                background: saving ? "#aaa" : FF_CYAN,
                border: "none", borderRadius: 8, color: "#fff",
                fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", marginTop: 2,
              }}>
                {saving ? "Guardando…" : "Registrar servicio"}
              </button>
            </form>
          </div>

          {/* ── Dashboard ── */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p style={sectionLabel}>Ingresos</p>
              <button onClick={() => downloadCSV(filtered, TAB_LABELS[tab].toLowerCase())} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px", border: "0.5px solid #ddd", borderRadius: 8,
                background: "#fff", color: "#555", fontSize: 12, cursor: "pointer",
              }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Descargar Excel
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, background: "#eeede9", borderRadius: 8, padding: 4, marginBottom: "1rem" }}>
              {(["day","week","month"] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: "7px 0",
                  border: tab === t ? "0.5px solid #ddd" : "none",
                  borderRadius: 6,
                  background: tab === t ? "#fff" : "transparent",
                  color: tab === t ? "#222" : "#777",
                  fontSize: 13, fontWeight: tab === t ? 700 : 400, cursor: "pointer",
                }}>
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {loading ? (
              <p style={{ color: "#bbb", fontSize: 14, textAlign: "center", padding: "2rem 0" }}>Cargando…</p>
            ) : (
              <>
                {/* Metric cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: "1rem" }}>
                  <MetricCard label="Total" value={formatMXN(total)} sub={`${count} servicio${count !== 1 ? "s" : ""}`} />
                  <MetricCard label="Ticket promedio" value={formatMXN(avg)} sub="por servicio" />
                  <MetricCard
                    label="Método principal"
                    value={ef >= ta && ef >= tr ? "Efectivo" : ta >= tr ? "Tarjeta" : "Transferencia"}
                    sub={count ? `${Math.round((Math.max(ef,ta,tr) / (total||1)) * 100)}% del total` : "—"}
                  />
                </div>

                {/* Breakdown */}
                <div style={card}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 12 }}>Desglose por método de pago</p>
                  {([["efectivo", ef],["tarjeta", ta],["transferencia", tr]] as [PaymentMethod, number][]).map(([m, val]) => (
                    <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 90, fontSize: 12, color: "#666" }}>{PAYMENT_META[m].label}</span>
                      <div style={{ flex: 1, height: 6, background: "#f0efeb", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.round((val/maxBar)*100)}%`, background: barColor[m], borderRadius: 4, transition: "width .4s" }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#444", minWidth: 64, textAlign: "right" }}>{formatMXN(val)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Tabla recientes ── */}
        <div style={{ marginTop: "1.5rem" }}>
          <p style={sectionLabel}>Últimos servicios registrados</p>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {loading ? (
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14 }}>Cargando…</p>
            ) : transactions.length === 0 ? (
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14 }}>Aún no hay servicios. ¡Registra el primero!</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                    {["Fecha","Cliente","Servicio","Pago","Precio"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0,12).map(t => (
                    <tr key={t.id} style={{ borderBottom: "0.5px solid #f0efeb" }}>
                      <td style={{ padding: "10px 16px", color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>{formatDate(t.created_at)}</td>
                      <td style={{ padding: "10px 16px", fontWeight: 700 }}>{t.client_name}</td>
                      <td style={{ padding: "10px 16px", color: "#555" }}>{t.service}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: PAYMENT_META[t.payment_method].bg, color: PAYMENT_META[t.payment_method].color }}>
                          {PAYMENT_META[t.payment_method].label}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", fontWeight: 700 }}>{formatMXN(t.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer style={{ marginTop: "2rem", paddingTop: "1.25rem", borderTop: "0.5px solid #e5e4df", display: "flex", justifyContent: "center" }}>
          <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.35 }}>
            <FishFlowMark size={18} />
            <span style={{ fontSize: 11, color: "#666" }}>Potenciado por FishFlow</span>
          </a>
        </footer>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "#f5f4f0", borderRadius: 8, padding: "0.875rem 1rem" }}>
      <p style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>{value}</p>
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

// ─── Shared styles ────────────────────────────────────────────────────────────
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 10,
};

const card: React.CSSProperties = {
  background: "#fff", border: "0.5px solid #e5e4df",
  borderRadius: 12, padding: "1.25rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "0.5px solid #ddd", borderRadius: 8,
  background: "#fff", color: "#1a1a1a",
  fontSize: 14, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
