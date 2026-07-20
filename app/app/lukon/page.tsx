"use client";

// ─── Lukon · Panel de Pagos y Facturación ─────────────────────────────────────
// Ruta: /app/lukon  (autenticado: rafaelnolasco@gmail.com | aalmarazmo@lukon.com.mx)

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { supabase, LUKON_CLIENT_ID } from "@/lib/supabase";
import ReviewsTab from "@/components/reviews/ReviewsTab";
import type { DashTheme } from "@/components/dashboard";

// ─── Brand tokens de Lukon ────────────────────────────────────────────────────
const L = {
  ink:    "#0B0F14",
  ink2:   "#131820",
  ink3:   "#1C232C",
  paper:  "#F2EEE6",
  paper2: "#E9E3D6",
  line:   "#2A323D",
  lineL:  "#CFC5AE",
  muted:  "#8A98A6",
  mutedL: "#6E6655",
  signal: "#C8FF3D",
  amber:  "#F6A623",
  crimson:"#E04E2A",
  fBody:  "'Inter Tight', system-ui, sans-serif",
  fMono:  "'JetBrains Mono', ui-monospace, monospace",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function statusColor(s: string) {
  const map: Record<string, string> = {
    pending:  L.amber,
    paid:     L.signal,
    valid:    L.signal,
    failed:   L.crimson,
    error:    L.crimson,
    cancelled:"#888",
    refunded: "#888",
  };
  return map[s] ?? L.muted;
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending:  "Pendiente",
    paid:     "Pagado",
    valid:    "Vigente",
    failed:   "Fallido",
    error:    "Error",
    cancelled:"Cancelado",
    refunded: "Reembolsado",
  };
  return map[s] ?? s;
}

// ─── Componente principal ─────────────────────────────────────────────────────
type Tab = "cobrar" | "facturar" | "historial" | "resenas";

// Tema para el módulo compartido de Reseñas, en clave Lukon (página crema, ink)
const REVIEWS_THEME: DashTheme = {
  accent: L.ink, accentDark: L.ink, accentSoft: L.paper2,
  bg: L.paper, surface: "#FBF9F3", text: L.ink,
  muted: L.mutedL, border: L.lineL, danger: L.crimson, disabled: "#999",
};

interface PayResult {
  transaction_id: string;
  payment_url:    string;
  sandbox_url:    string;
  preference_id:  string;
}

interface InvoiceResult {
  invoice_id:   string;
  uuid_sat:     string;
  pdf_url:      string | null;
  xml_url:      string | null;
}

interface TxRecord {
  id:         string;
  amount:     number;
  currency:   string;
  status:     string;
  service:    string | null;
  provider:   string;
  created_at: string;
  metadata:   Record<string, unknown> | null;
}

interface InvRecord {
  id:          string;
  uuid_sat:    string | null;
  status:      string;
  amount:      number | null;
  currency:    string | null;
  pdf_url:     string | null;
  xml_url:     string | null;
  created_at:  string;
}

export default function LukonPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#F2EEE6" }} />}>
      <LukonDashboard />
    </Suspense>
  );
}

function LukonDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("cobrar");
  const [userEmail, setEmail]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Estado del tab Cobrar ────────────────────────────────────────────────────
  const [payDesc,  setPayDesc]  = useState("");
  const [payAmt,   setPayAmt]   = useState("");
  const [payerEmail,setPayerEmail] = useState("");
  const [payResult, setPayResult]  = useState<PayResult | null>(null);

  // ── Estado del tab Facturar ─────────────────────────────────────────────────
  const [invRFC,    setInvRFC]    = useState("");
  const [invRazon,  setInvRazon]  = useState("");
  const [invEmail,  setInvEmail]  = useState("");
  const [invCP,     setInvCP]     = useState("");
  const [invReg,    setInvReg]    = useState("616");
  const [invConc,   setInvConc]   = useState("");
  const [invAmt,    setInvAmt]    = useState("");
  const [invUse,    setInvUse]    = useState("G03");
  const [invForm,   setInvForm]   = useState("03");
  const [invResult, setInvResult] = useState<InvoiceResult | null>(null);

  // ── Estado del tab Historial ────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [invoices,     setInvoices]     = useState<InvRecord[]>([]);
  const [histLoading,  setHistLoading]  = useState(false);

  // ── Verificar sesión y notificación de retorno de pago ──────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login?next=/app/lukon"); return; }
      setEmail(user.email ?? "");
    });
    const params = new URLSearchParams(window.location.search);
    const pago   = params.get("pago");
    if (pago === "ok")        showToast("✅ Pago completado exitosamente", true);
    if (pago === "error")     showToast("❌ El pago no pudo completarse", false);
    if (pago === "pendiente") showToast("⏳ Pago pendiente de confirmación", false);
  }, []);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  // ── Cargar historial ─────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await fetch("/api/lukon/history");
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions ?? []);
        setInvoices(data.invoices ?? []);
      }
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "historial") loadHistory();
  }, [tab]);

  // ── Generar link de pago ─────────────────────────────────────────────────────
  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!payDesc.trim() || !payAmt || Number(payAmt) <= 0) {
      showToast("Ingresa una descripción y monto válido", false); return;
    }
    setLoading(true);
    setPayResult(null);
    try {
      const res = await fetch("/api/payments/lukon/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: payDesc, amount: Number(payAmt), payer_email: payerEmail || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Error al generar link", false); return; }
      setPayResult(data);
      showToast("✅ Link de pago generado", true);
    } catch {
      showToast("Error de conexión", false);
    } finally {
      setLoading(false);
    }
  }

  // ── Generar factura CFDI ─────────────────────────────────────────────────────
  async function handleInvoice(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setInvResult(null);
    try {
      const res = await fetch("/api/invoices/lukon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rfc:           invRFC.toUpperCase(),
          razon_social:  invRazon,
          email:         invEmail || undefined,
          cp:            invCP,
          regimen_fiscal: invReg,
          concepto:      invConc,
          amount:        Number(invAmt),
          payment_form:  invForm,
          cfdi_use:      invUse,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "FACTURAPI_NOT_CONFIGURED") {
          showToast("⚠️ Facturapi no está configurado todavía", false);
        } else {
          showToast(data.error ?? "Error al timbrar", false);
        }
        return;
      }
      setInvResult(data);
      showToast("✅ CFDI timbrado exitosamente", true);
    } catch {
      showToast("Error de conexión", false);
    } finally {
      setLoading(false);
    }
  }

  // ── Cerrar sesión ────────────────────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/lukon");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: L.paper,
      color: L.ink,
      fontFamily: L.fBody,
      WebkitFontSmoothing: "antialiased",
    }}>

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 999,
          background: toast.ok ? L.ink3 : "#3d1010",
          color: toast.ok ? L.signal : "#ffaaaa",
          border: `1px solid ${toast.ok ? L.signal : L.crimson}`,
          padding: "12px 20px", borderRadius: 8,
          fontFamily: L.fMono, fontSize: 13,
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          transition: "all 0.2s ease",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 32px",
        background: L.ink,
        borderBottom: `1px solid ${L.line}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Lukon wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: L.signal,
              boxShadow: `0 0 0 3px rgba(200,255,61,0.25)`,
            }} />
            <span style={{
              fontFamily: L.fMono, fontSize: 18, fontWeight: 600,
              color: "#F2EEE6", letterSpacing: "0.12em",
            }}>LUKON</span>
          </div>
          <span style={{
            fontFamily: L.fMono, fontSize: 10, letterSpacing: "0.2em",
            color: L.muted, textTransform: "uppercase", paddingLeft: 12,
            borderLeft: `1px solid ${L.line}`,
          }}>
            Panel de Operaciones
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: L.fMono, fontSize: 11, color: L.muted }}>
            {userEmail}
          </span>
          <button onClick={handleSignOut} style={{
            background: "transparent",
            border: `1px solid ${L.line}`,
            color: L.muted, borderRadius: 6,
            padding: "6px 12px", cursor: "pointer",
            fontFamily: L.fMono, fontSize: 11,
            letterSpacing: "0.08em",
            transition: "all 0.15s",
          }}
          onMouseOver={e => (e.currentTarget.style.borderColor = L.muted)}
          onMouseOut={e  => (e.currentTarget.style.borderColor = L.line)}
          >
            Salir
          </button>
        </div>
      </header>

      {/* ── Tabs nav ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 4, padding: "20px 32px 0",
        borderBottom: `1px solid ${L.lineL}`,
      }}>
        {(["cobrar", "facturar", "historial", "resenas"] as Tab[]).map(t => {
          const labels: Record<Tab, string> = {
            cobrar:    "💳  Cobrar",
            facturar:  "🧾  Facturar",
            historial: "📋  Historial",
            resenas:   "⭐  Reseñas",
          };
          const active = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              background: active ? L.ink : "transparent",
              color:      active ? L.signal : L.mutedL,
              border:     "none",
              padding:    "10px 20px", borderRadius: "6px 6px 0 0",
              cursor:     "pointer",
              fontFamily: L.fBody, fontWeight: 600, fontSize: 14,
              letterSpacing: "0.02em",
              borderBottom: active ? `2px solid ${L.signal}` : "2px solid transparent",
              transition: "all 0.15s",
            }}>
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 32px" }}>

        {/* ════ TAB: COBRAR ════════════════════════════════════════════════════ */}
        {tab === "cobrar" && (
          <div>
            <h2 style={{ fontFamily: L.fMono, fontSize: 13, fontWeight: 500, color: L.mutedL, letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 28px" }}>
              — Generar link de cobro · MercadoPago
            </h2>

            <form onSubmit={handleCheckout} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <Field label="Concepto / Descripción del servicio" required>
                <input
                  value={payDesc}
                  onChange={e => setPayDesc(e.target.value)}
                  placeholder="Ej: Suscripción GPS mensual — unidad XJ-004"
                  style={inputStyle}
                  required
                />
              </Field>

              <Field label="Monto (MXN)" required>
                <div style={{ position: "relative" }}>
                  <span style={{
                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                    fontFamily: L.fMono, fontSize: 13, color: L.mutedL,
                  }}>$</span>
                  <input
                    type="number" min="1" step="0.01"
                    value={payAmt}
                    onChange={e => setPayAmt(e.target.value)}
                    placeholder="0.00"
                    style={{ ...inputStyle, paddingLeft: 32 }}
                    required
                  />
                </div>
              </Field>

              <Field label="Email del pagador (opcional)">
                <input
                  type="email"
                  value={payerEmail}
                  onChange={e => setPayerEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  style={inputStyle}
                />
              </Field>

              <button type="submit" disabled={loading} style={btnPrimaryStyle(loading)}>
                {loading ? "Generando…" : "Generar link de pago →"}
              </button>
            </form>

            {/* Resultado */}
            {payResult && (
              <div style={{
                marginTop: 32, padding: 24,
                background: L.ink, borderRadius: 10,
                border: `1px solid ${L.signal}`,
              }}>
                <div style={{ fontFamily: L.fMono, fontSize: 11, color: L.signal, letterSpacing: "0.18em", marginBottom: 16 }}>
                  — LINK GENERADO EXITOSAMENTE
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: L.fMono, fontSize: 11, color: L.muted, marginBottom: 6 }}>LINK DE PRUEBA (sandbox)</div>
                  <a
                    href={payResult.sandbox_url ?? payResult.payment_url}
                    target="_blank" rel="noopener"
                    style={{
                      display: "inline-block",
                      background: L.signal, color: L.ink,
                      padding: "10px 20px", borderRadius: 8,
                      fontFamily: L.fBody, fontWeight: 700, fontSize: 14,
                      textDecoration: "none",
                    }}
                  >
                    Abrir checkout de prueba →
                  </a>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: L.fMono, fontSize: 11, color: L.muted, marginBottom: 6 }}>LINK DE PRODUCCIÓN</div>
                  <div style={{
                    background: L.ink3, borderRadius: 6, padding: "10px 14px",
                    fontFamily: L.fMono, fontSize: 11, color: "#F2EEE6",
                    wordBreak: "break-all",
                  }}>
                    {payResult.payment_url}
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(payResult.payment_url).then(() => showToast("Link copiado", true))}
                    style={{ ...btnGhostStyle, marginTop: 8 }}
                  >
                    Copiar link
                  </button>
                </div>

                <div style={{ fontFamily: L.fMono, fontSize: 10, color: L.muted, borderTop: `1px solid ${L.line}`, paddingTop: 12, marginTop: 8 }}>
                  ID transacción: {payResult.transaction_id}
                  &nbsp;·&nbsp;
                  Preference: {payResult.preference_id}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ TAB: FACTURAR ══════════════════════════════════════════════════ */}
        {tab === "facturar" && (
          <div>
            <h2 style={{ fontFamily: L.fMono, fontSize: 13, fontWeight: 500, color: L.mutedL, letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 8px" }}>
              — Timbrar CFDI · Facturapi
            </h2>
            <p style={{ fontSize: 13, color: L.mutedL, margin: "0 0 28px" }}>
              Clave SAT preconfigurada: <span style={{ fontFamily: L.fMono, color: L.amber }}>81161500</span> — Servicios de rastreo satelital de vehículos.
            </p>

            <form onSubmit={handleInvoice} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Field label="RFC del receptor" required>
                  <input
                    value={invRFC}
                    onChange={e => setInvRFC(e.target.value.toUpperCase())}
                    placeholder="XAXX010101000"
                    maxLength={13}
                    style={inputStyle}
                    required
                  />
                </Field>
                <Field label="Código Postal del receptor" required>
                  <input
                    value={invCP}
                    onChange={e => setInvCP(e.target.value)}
                    placeholder="06600"
                    maxLength={5}
                    style={inputStyle}
                    required
                  />
                </Field>
              </div>

              <Field label="Razón social del receptor" required>
                <input
                  value={invRazon}
                  onChange={e => setInvRazon(e.target.value)}
                  placeholder="EMPRESA SA DE CV"
                  style={inputStyle}
                  required
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Field label="Email (para enviar la factura)">
                  <input
                    type="email"
                    value={invEmail}
                    onChange={e => setInvEmail(e.target.value)}
                    placeholder="facturacion@empresa.com"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Régimen fiscal" required>
                  <select value={invReg} onChange={e => setInvReg(e.target.value)} style={selectStyle}>
                    <option value="601">601 — General de Ley Personas Morales</option>
                    <option value="603">603 — Personas Morales con Fines no Lucrativos</option>
                    <option value="605">605 — Sueldos y Salarios e Ingresos Asimilados a Salarios</option>
                    <option value="606">606 — Arrendamiento</option>
                    <option value="612">612 — Personas Físicas con Actividades Empresariales</option>
                    <option value="616">616 — Sin obligaciones fiscales (público en general)</option>
                    <option value="621">621 — Incorporación Fiscal</option>
                    <option value="626">626 — Régimen Simplificado de Confianza (RESICO)</option>
                  </select>
                </Field>
              </div>

              <Field label="Concepto de la factura" required>
                <input
                  value={invConc}
                  onChange={e => setInvConc(e.target.value)}
                  placeholder="Ej: Servicio de rastreo GPS — unidad XJ-004 — Junio 2026"
                  style={inputStyle}
                  required
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <Field label="Monto sin IVA (MXN)" required>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontFamily: L.fMono, fontSize: 13, color: L.mutedL }}>$</span>
                    <input
                      type="number" min="1" step="0.01"
                      value={invAmt}
                      onChange={e => setInvAmt(e.target.value)}
                      placeholder="0.00"
                      style={{ ...inputStyle, paddingLeft: 32 }}
                      required
                    />
                  </div>
                </Field>
                <Field label="Forma de pago">
                  <select value={invForm} onChange={e => setInvForm(e.target.value)} style={selectStyle}>
                    <option value="01">01 — Efectivo</option>
                    <option value="02">02 — Cheque nominativo</option>
                    <option value="03">03 — Transferencia electrónica</option>
                    <option value="04">04 — Tarjeta de crédito</option>
                    <option value="28">28 — Tarjeta de débito</option>
                    <option value="99">99 — Por definir</option>
                  </select>
                </Field>
                <Field label="Uso del CFDI">
                  <select value={invUse} onChange={e => setInvUse(e.target.value)} style={selectStyle}>
                    <option value="G01">G01 — Adquisición de mercancias</option>
                    <option value="G03">G03 — Gastos en general</option>
                    <option value="I03">I03 — Equipo de transporte</option>
                    <option value="S01">S01 — Sin efectos fiscales</option>
                  </select>
                </Field>
              </div>

              {invAmt && Number(invAmt) > 0 && (
                <div style={{
                  background: L.paper2, borderRadius: 8, padding: "12px 16px",
                  fontFamily: L.fMono, fontSize: 12, color: L.ink3,
                }}>
                  Subtotal: {fmt(Number(invAmt))} &nbsp;·&nbsp;
                  IVA 16%: {fmt(Number(invAmt) * 0.16)} &nbsp;·&nbsp;
                  <strong>Total: {fmt(Number(invAmt) * 1.16)}</strong>
                </div>
              )}

              <button type="submit" disabled={loading} style={btnPrimaryStyle(loading)}>
                {loading ? "Timbrando…" : "Timbrar CFDI →"}
              </button>
            </form>

            {/* Resultado factura */}
            {invResult && (
              <div style={{
                marginTop: 32, padding: 24,
                background: L.ink, borderRadius: 10,
                border: `1px solid ${L.signal}`,
              }}>
                <div style={{ fontFamily: L.fMono, fontSize: 11, color: L.signal, letterSpacing: "0.18em", marginBottom: 16 }}>
                  — CFDI TIMBRADO EXITOSAMENTE
                </div>
                <div style={{ fontFamily: L.fMono, fontSize: 11, color: L.muted, marginBottom: 4 }}>UUID SAT</div>
                <div style={{ fontFamily: L.fMono, fontSize: 13, color: "#F2EEE6", marginBottom: 20 }}>{invResult.uuid_sat}</div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {invResult.pdf_url && (
                    <a href={invResult.pdf_url} target="_blank" rel="noopener" style={{
                      background: L.signal, color: L.ink,
                      padding: "10px 20px", borderRadius: 8,
                      fontFamily: L.fBody, fontWeight: 700, fontSize: 14,
                      textDecoration: "none",
                    }}>
                      Descargar PDF
                    </a>
                  )}
                  {invResult.xml_url && (
                    <a href={invResult.xml_url} target="_blank" rel="noopener" style={{
                      ...btnGhostStyle,
                      display: "inline-block", textDecoration: "none",
                    }}>
                      Descargar XML
                    </a>
                  )}
                  {!invResult.pdf_url && !invResult.xml_url && (
                    <span style={{ fontFamily: L.fMono, fontSize: 11, color: L.muted }}>
                      Factura timbrada — descarga disponible en Facturapi
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ TAB: HISTORIAL ═════════════════════════════════════════════════ */}
        {tab === "historial" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
              <h2 style={{ fontFamily: L.fMono, fontSize: 13, fontWeight: 500, color: L.mutedL, letterSpacing: "0.2em", textTransform: "uppercase", margin: 0 }}>
                — Historial de operaciones
              </h2>
              <button onClick={loadHistory} disabled={histLoading} style={btnGhostStyle}>
                {histLoading ? "Cargando…" : "↻ Actualizar"}
              </button>
            </div>

            {/* Transacciones */}
            <SectionTitle>Pagos · MercadoPago</SectionTitle>
            {transactions.length === 0 ? (
              <EmptyState text="Aún no hay transacciones registradas" />
            ) : (
              <div style={{ overflowX: "auto", marginBottom: 40 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: L.fBody, fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${L.lineL}` }}>
                      {["Fecha", "Servicio", "Monto", "Estado"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontFamily: L.fMono, fontSize: 10, color: L.mutedL, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id} style={{ borderBottom: `1px solid ${L.paper2}` }}>
                        <td style={{ padding: "12px 12px", fontFamily: L.fMono, fontSize: 11, color: L.mutedL }}>{fmtDate(tx.created_at)}</td>
                        <td style={{ padding: "12px 12px", color: L.ink3 }}>{tx.service ?? "—"}</td>
                        <td style={{ padding: "12px 12px", fontFamily: L.fMono, fontWeight: 600 }}>{fmt(tx.amount)}</td>
                        <td style={{ padding: "12px 12px" }}>
                          <span style={{
                            background: statusColor(tx.status) + "22",
                            color: statusColor(tx.status),
                            border: `1px solid ${statusColor(tx.status)}44`,
                            borderRadius: 4, padding: "2px 8px",
                            fontFamily: L.fMono, fontSize: 10, fontWeight: 600,
                          }}>
                            {statusLabel(tx.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Facturas */}
            <SectionTitle>Facturas · CFDI</SectionTitle>
            {invoices.length === 0 ? (
              <EmptyState text="Aún no hay facturas timbradas" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: L.fBody, fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${L.lineL}` }}>
                      {["Fecha", "UUID SAT", "Monto", "Estado", "Archivos"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontFamily: L.fMono, fontSize: 10, color: L.mutedL, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr key={inv.id} style={{ borderBottom: `1px solid ${L.paper2}` }}>
                        <td style={{ padding: "12px 12px", fontFamily: L.fMono, fontSize: 11, color: L.mutedL }}>{fmtDate(inv.created_at)}</td>
                        <td style={{ padding: "12px 12px", fontFamily: L.fMono, fontSize: 10, color: L.ink3 }}>{inv.uuid_sat?.slice(0, 18) ?? "—"}…</td>
                        <td style={{ padding: "12px 12px", fontFamily: L.fMono, fontWeight: 600 }}>{inv.amount ? fmt(inv.amount) : "—"}</td>
                        <td style={{ padding: "12px 12px" }}>
                          <span style={{
                            background: statusColor(inv.status) + "22",
                            color: statusColor(inv.status),
                            border: `1px solid ${statusColor(inv.status)}44`,
                            borderRadius: 4, padding: "2px 8px",
                            fontFamily: L.fMono, fontSize: 10, fontWeight: 600,
                          }}>
                            {statusLabel(inv.status)}
                          </span>
                        </td>
                        <td style={{ padding: "12px 12px", display: "flex", gap: 8 }}>
                          {inv.pdf_url && <a href={inv.pdf_url} target="_blank" rel="noopener" style={{ color: L.signal, fontFamily: L.fMono, fontSize: 10 }}>PDF</a>}
                          {inv.xml_url && <a href={inv.xml_url} target="_blank" rel="noopener" style={{ color: L.amber,  fontFamily: L.fMono, fontSize: 10 }}>XML</a>}
                          {!inv.pdf_url && !inv.xml_url && <span style={{ color: L.muted, fontFamily: L.fMono, fontSize: 10 }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ════ TAB: RESEÑAS ═══════════════════════════════════════════════════ */}
        {tab === "resenas" && (
          <ReviewsTab
            clientId={LUKON_CLIENT_ID}
            theme={REVIEWS_THEME}
            personLabel="cliente"
            personLabelPlural="clientes"
            smartReplies
          />
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer style={{
        textAlign: "center", padding: "24px 32px",
        borderTop: `1px solid ${L.lineL}`,
        fontFamily: L.fMono, fontSize: 10,
        color: L.mutedL, letterSpacing: "0.12em",
      }}>
        Powered by <strong style={{ color: L.ink }}>FishFlow</strong> · fishflow.mx
      </footer>
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────
function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: "#6E6655", fontWeight: 500,
      }}>
        {label}{required && <span style={{ color: "#C8FF3D", marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase",
      color: "#F6A623", marginBottom: 12, fontWeight: 500,
    }}>
      — {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      padding: "32px 16px", textAlign: "center",
      color: "#8A98A6", fontSize: 13,
      border: "1px dashed #CFC5AE", borderRadius: 8, marginBottom: 40,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    }}>
      {text}
    </div>
  );
}

// ─── Estilos reutilizables ────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "#E9E3D6",
  border: "1px solid #CFC5AE",
  borderRadius: 8, padding: "11px 14px",
  fontFamily: "'Inter Tight', system-ui, sans-serif",
  fontSize: 14, color: "#0B0F14",
  width: "100%", boxSizing: "border-box",
  outline: "none", transition: "border 0.15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236E6655' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 32,
  cursor: "pointer",
};

function btnPrimaryStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#8A98A6" : "#C8FF3D",
    color: "#0B0F14",
    border: "none", borderRadius: 8,
    padding: "13px 24px",
    fontFamily: "'Inter Tight', system-ui, sans-serif",
    fontWeight: 700, fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.15s", alignSelf: "flex-start",
  };
}

const btnGhostStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #CFC5AE",
  color: "#6E6655", borderRadius: 8,
  padding: "9px 16px", cursor: "pointer",
  fontFamily: "'Inter Tight', system-ui, sans-serif",
  fontWeight: 600, fontSize: 13,
  transition: "all 0.15s",
};
