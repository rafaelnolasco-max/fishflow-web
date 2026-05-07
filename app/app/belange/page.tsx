"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, type BelangeTransaction, type PaymentMethod } from "@/lib/supabase";

// ─── Brand ────────────────────────────────────────────────────────────────────
const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

function FishFlowMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none" aria-label="FishFlow">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z"
        stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z"
        stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26"
        stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function startOf(period: "day" | "week" | "month"): Date {
  const now = new Date();
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const d = now.getDay();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - d + (d === 0 ? -6 : 1));
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toRows(rows: BelangeTransaction[]) {
  return [
    ["Fecha", "Cliente", "Servicio", "$ Servicio", "Producto", "$ Producto", "Total", "Método de pago"],
    ...rows.map(t => [
      fmtDate(t.created_at),
      t.client_name,
      t.service,
      t.price,
      t.producto || "",
      t.precio_producto ?? "",
      t.price + (t.precio_producto ?? 0),
      t.payment_method,
    ]),
  ];
}

async function downloadExcel(all: BelangeTransaction[]) {
  const xlsx = await import("xlsx");
  const now  = new Date();
  const wb   = xlsx.utils.book_new();
  const filter = (start: Date) => all.filter(t => new Date(t.created_at) >= start);
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(toRows(filter(startOf("day")))),   "Hoy");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(toRows(filter(startOf("week")))),  "Semana");
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(toRows(filter(startOf("month")))), "Mes");
  xlsx.writeFile(wb, `belange_${now.toISOString().slice(0, 10)}.xlsx`);
}

// ─── Constants ────────────────────────────────────────────────────────────────
type Tab = "day" | "week" | "month";
const TAB_LABELS: Record<Tab, string> = { day: "Hoy", week: "Semana", month: "Mes" };

const PM: Record<PaymentMethod, { label: string; bg: string; color: string }> = {
  efectivo:      { label: "Efectivo",      bg: "#eaf3de", color: "#3b6d11" },
  tarjeta:       { label: "Tarjeta",       bg: "#e6f1fb", color: "#185fa5" },
  transferencia: { label: "Transferencia", bg: "#faeeda", color: "#854f0b" },
};

const BAR_COLOR: Record<PaymentMethod, string> = {
  efectivo: "#639922", tarjeta: FF_CYAN, transferencia: FF_ORANGE,
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BelangePage() {
  const router = useRouter();

  // Form
  const [clientName,     setClientName]     = useState("");
  const [service,        setService]        = useState("");
  const [price,          setPrice]          = useState("");
  const [producto,       setProducto]       = useState("");
  const [precioProducto, setPrecioProducto] = useState("");
  const [payment,        setPayment]        = useState<PaymentMethod>("efectivo");
  const [saving,         setSaving]         = useState(false);
  const [ok,             setOk]             = useState("");
  const [err,            setErr]            = useState("");

  // Data
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
    const numServ = price ? parseFloat(price.replace(/,/g, "")) : null;
    const numProd = precioProducto ? parseFloat(precioProducto.replace(/,/g, "")) : null;

    if (!clientName.trim()) {
      setErr("Agrega el nombre del cliente.");
      return;
    }
    if (!service.trim() && !producto.trim()) {
      setErr("Agrega al menos un servicio o un producto.");
      return;
    }
    if (service.trim() && (numServ === null || isNaN(numServ) || numServ <= 0)) {
      setErr("Agrega el precio del servicio.");
      return;
    }
    if (producto.trim() && (numProd === null || isNaN(numProd) || numProd <= 0)) {
      setErr("Agrega el precio del producto.");
      return;
    }
    setSaving(true); setErr("");
    const { error } = await supabase.from("belange_transactions").insert({
      client_name:     clientName.trim(),
      service:         service.trim() || null,
      price:           numServ ?? 0,
      payment_method:  payment,
      producto:        producto.trim() || null,
      precio_producto: numProd,
    });
    setSaving(false);
    if (error) { setErr("Error al guardar. Intenta de nuevo."); return; }
    setOk(`✓ Transacción de ${clientName.trim()} registrada`);
    setClientName(""); setService(""); setPrice(""); setProducto(""); setPrecioProducto(""); setPayment("efectivo");
    inputRef.current?.focus();
    fetchAll();
    setTimeout(() => setOk(""), 3500);
  }

  // ── Derived ──
  const cutoff   = startOf(tab);
  const filtered = transactions.filter(t => new Date(t.created_at) >= cutoff);

  const totalServicios = filtered.reduce((s, t) => s + t.price, 0);
  const totalProductos = filtered.reduce((s, t) => s + (t.precio_producto ?? 0), 0);
  const total          = totalServicios + totalProductos;
  const countServ      = filtered.length;
  const countProd      = filtered.filter(t => (t.precio_producto ?? 0) > 0).length;
  const avgServ        = countServ ? totalServicios / countServ : 0;

  const byM   = (m: PaymentMethod) => filtered.filter(t => t.payment_method === m).reduce((s, t) => s + t.price + (t.precio_producto ?? 0), 0);
  const ef    = byM("efectivo"), ta = byM("tarjeta"), tr = byM("transferencia");
  const maxBar = Math.max(ef, ta, tr, 1);

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f6", fontFamily: "var(--font-outfit, system-ui, sans-serif)" }}>

      {/* ── Header ── */}
      <header style={{ background: "#fff", borderBottom: "0.5px solid #e5e4df", height: 56, padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#fbeaf0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#72243e" }}>BS</div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Belange Studio</p>
            <p style={{ fontSize: 11, color: "#888", margin: 0 }}>Panel de ingresos</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.45 }}>
            <FishFlowMark size={22} />
            <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>FishFlow</span>
          </a>
          <button
            onClick={async () => { await supabase.auth.signOut(); router.push("/login?next=/app/belange"); }}
            style={{ background: "transparent", border: "0.5px solid #e5e4df", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#aaa", cursor: "pointer" }}>
            ⎋ Salir
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <main style={{ maxWidth: 1140, margin: "0 auto", padding: "1.5rem 1.25rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "1.5rem", alignItems: "start" }}>

          {/* ────────────────── FORMULARIO ────────────────── */}
          <div>
            <p style={secLabel}>Registrar transacción</p>
            <form onSubmit={handleSubmit} style={card}>

              <Field label="Nombre del cliente">
                <input ref={inputRef} type="text" value={clientName} onChange={e => setClientName(e.target.value)}
                  placeholder="Ej. María González" style={inp} required />
              </Field>

              {/* Servicio */}
              <div style={{ border: "1px solid #caf4f8", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#f7fdfe" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#007a88", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>💈</span> Servicio
                  <span style={{ marginLeft: "auto", fontSize: 10, background: "#d6f4f8", color: "#007a88", padding: "2px 8px", borderRadius: 20, fontWeight: 500 }}>si aplica</span>
                </p>
                <Field label="Servicio realizado">
                  <input type="text" value={service} onChange={e => setService(e.target.value)}
                    placeholder="Ej. Tinte completo + hidratación" style={inp} required />
                </Field>
                <Field label="Precio de servicio ($)">
                  <PriceInput value={price} onChange={setPrice} required />
                </Field>
              </div>

              {/* Producto */}
              <div style={{ border: "1px solid #ffe0c2", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#fffaf5" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#b05200", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>🧴</span> Producto
                  <span style={{ marginLeft: "auto", fontSize: 10, background: "#ffe8d0", color: "#b05200", padding: "2px 8px", borderRadius: 20, fontWeight: 500 }}>si aplica</span>
                </p>
                <Field label="Producto adquirido">
                  <input type="text" value={producto} onChange={e => setProducto(e.target.value)}
                    placeholder="Ej. Shampoo Kerastase 250ml" style={inp} />
                </Field>
                <Field label="Precio de producto ($)">
                  <PriceInput value={precioProducto} onChange={setPrecioProducto} required={false} />
                </Field>
              </div>

              <Field label="Método de pago">
                <div style={{ display: "flex", gap: 6 }}>
                  {(["efectivo", "tarjeta", "transferencia"] as PaymentMethod[]).map(m => (
                    <button key={m} type="button" onClick={() => setPayment(m)} style={{
                      flex: 1, padding: "9px 4px",
                      border: payment === m ? `1.5px solid ${FF_CYAN}` : "0.5px solid #ddd",
                      borderRadius: 8,
                      background: payment === m ? "#e4f8fb" : "#fff",
                      color: payment === m ? "#0a7a8a" : "#555",
                      fontSize: 12, fontWeight: payment === m ? 700 : 400, cursor: "pointer",
                    }}>
                      {PM[m].label}
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
                {saving ? "Guardando…" : "Registrar transacción"}
              </button>
            </form>
          </div>

          {/* ────────────────── DASHBOARD ────────────────── */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p style={secLabel}>Ingresos</p>
              <button onClick={() => downloadExcel(transactions)} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", border: "0.5px solid #ddd", borderRadius: 8,
                background: "#fff", color: "#555", fontSize: 12, cursor: "pointer",
              }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Excel — 3 hojas
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, background: "#eeede9", borderRadius: 8, padding: 4, marginBottom: "1rem" }}>
              {(["day", "week", "month"] as Tab[]).map(t => (
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
                {/* Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: "1rem" }}>
                  <MCard label="Total del período"  value={fmt(total)}          sub={`${countServ} transacción${countServ !== 1 ? "es" : ""}`} accent="#1a1a1a" />
                  <MCard label="Servicios"           value={fmt(totalServicios)} sub={`ticket prom. ${fmt(avgServ)}`}                          accent={FF_CYAN}   />
                  <MCard label="Productos"           value={fmt(totalProductos)} sub={`${countProd} venta${countProd !== 1 ? "s" : ""}`}        accent={FF_ORANGE} />
                </div>

                {/* Payment breakdown */}
                <div style={card}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 12 }}>Desglose por método de pago</p>
                  {(["efectivo", "tarjeta", "transferencia"] as PaymentMethod[]).map(m => {
                    const val = m === "efectivo" ? ef : m === "tarjeta" ? ta : tr;
                    return (
                      <div key={m} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ width: 92, fontSize: 12, color: "#666" }}>{PM[m].label}</span>
                        <div style={{ flex: 1, height: 6, background: "#f0efeb", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.round((val / maxBar) * 100)}%`, background: BAR_COLOR[m], borderRadius: 4, transition: "width .4s" }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#444", minWidth: 68, textAlign: "right" }}>{fmt(val)}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ────────────────── TABLA ────────────────── */}
        <div style={{ marginTop: "1.5rem" }}>
          <p style={secLabel}>Últimas transacciones</p>
          <div style={{ ...card, padding: 0, overflow: "hidden", overflowX: "auto" }}>
            {loading ? (
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14 }}>Cargando…</p>
            ) : transactions.length === 0 ? (
              <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14 }}>Aún no hay transacciones. ¡Registra la primera!</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                    {["Fecha", "Cliente", "Servicio", "$ Serv.", "Producto", "$ Prod.", "Pago", "Total"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 15).map(t => (
                    <tr key={t.id} style={{ borderBottom: "0.5px solid #f0efeb" }}>
                      <td style={{ padding: "10px 12px", color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(t.created_at)}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{t.client_name}</td>
                      <td style={{ padding: "10px 12px", color: "#555", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Tag color="cyan" />
                        {t.service}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: "#007a88", whiteSpace: "nowrap" }}>{fmt(t.price)}</td>
                      <td style={{ padding: "10px 12px", color: "#555", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.producto
                          ? <><Tag color="orange" />{t.producto}</>
                          : <span style={{ color: "#ccc" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap", color: t.precio_producto ? FF_ORANGE : "#ccc" }}>
                        {t.precio_producto ? fmt(t.precio_producto) : "—"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: PM[t.payment_method].bg, color: PM[t.payment_method].color }}>
                          {PM[t.payment_method].label}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {fmt(t.price + (t.precio_producto ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
function MCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{ background: "#f5f4f0", borderRadius: 8, padding: "0.875rem 1rem", borderTop: `2px solid ${accent}` }}>
      <p style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>{value}</p>
      <p style={{ fontSize: 11, color: "#bbb", marginTop: 3 }}>{sub}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: "#777", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function PriceInput({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 14 }}>$</span>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder="0" min="1" step="1" required={required}
        style={{ ...inp, paddingLeft: 26 }} />
    </div>
  );
}

function Tag({ color }: { color: "cyan" | "orange" }) {
  const styles = {
    cyan:   { background: "#d6f4f8", color: "#007a88" },
    orange: { background: "#ffe8d0", color: "#b05200" },
  }[color];
  const label = color === "cyan" ? "serv" : "prod";
  return (
    <span style={{ display: "inline-block", padding: "1px 5px", borderRadius: 10, fontSize: 10, fontWeight: 600, marginRight: 4, ...styles }}>{label}</span>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const secLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#aaa",
  letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10,
};

const card: React.CSSProperties = {
  background: "#fff", border: "0.5px solid #e5e4df",
  borderRadius: 12, padding: "1.25rem",
};

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  border: "0.5px solid #ddd", borderRadius: 8,
  background: "#fff", color: "#1a1a1a",
  fontSize: 14, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
