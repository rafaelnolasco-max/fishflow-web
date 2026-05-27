"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  supabase,
  type BelangeTransaction,
  type BelangeInventoryProduct,
  type PaymentMethod,
  type PosTransaction,
  BELANGE_CLIENT_ID,
  posToBelangeTransaction,
  isBelangeLowStock,
} from "@/lib/supabase";

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

// ─── Helpers de período ───────────────────────────────────────────────────────
function startOf(period: "day" | "week" | "month"): Date {
  const now = new Date();
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const d = now.getDay();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - d + (d === 0 ? -6 : 1));
  }
  // Período mensual: del 27 de cada mes al 26 del siguiente
  const day = now.getDate();
  if (day >= 27) return new Date(now.getFullYear(), now.getMonth(), 27);
  return new Date(now.getFullYear(), now.getMonth() - 1, 27);
}

function monthTabLabel(): string {
  const now = new Date();
  const day = now.getDate();
  const start = day >= 27
    ? new Date(now.getFullYear(), now.getMonth(), 27)
    : new Date(now.getFullYear(), now.getMonth() - 1, 27);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 26);
  const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toRows(rows: BelangeTransaction[]) {
  return [
    ["Fecha", "Cliente", "Servicio", "$ Servicio", "Producto", "Cant.", "$ Producto", "Total", "Método de pago"],
    ...rows.map(t => [
      fmtDate(t.created_at),
      t.client_name,
      t.service,
      t.price,
      t.producto || "",
      (t.metadata as Record<string,unknown>)?.qty ?? 1,
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
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(toRows(filter(startOf("month")))), monthTabLabel());
  xlsx.writeFile(wb, `belange_${now.toISOString().slice(0, 10)}.xlsx`);
}

// ─── Constants ────────────────────────────────────────────────────────────────
type Tab = "day" | "week" | "month";
const TAB_LABELS: Record<Tab, string> = { day: "Hoy", week: "Semana", month: monthTabLabel() };

const PM: Record<PaymentMethod, { label: string; bg: string; color: string }> = {
  efectivo:      { label: "Efectivo",      bg: "#eaf3de", color: "#3b6d11" },
  tarjeta:       { label: "Tarjeta",       bg: "#e6f1fb", color: "#185fa5" },
  transferencia: { label: "Transferencia", bg: "#faeeda", color: "#854f0b" },
};

const BAR_COLOR: Record<PaymentMethod, string> = {
  efectivo: "#639922", tarjeta: FF_CYAN, transferencia: FF_ORANGE,
};

// ─── ProductSearch — buscador con dropdown ────────────────────────────────────
function ProductSearch({
  products,
  value,
  onSelect,
  onManual,
}: {
  products: BelangeInventoryProduct[];
  value: string;
  onSelect: (p: BelangeInventoryProduct) => void;
  onManual: (name: string) => void;
}) {
  const [query, setQuery]   = useState(value);
  const [open,  setOpen]    = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim().length === 0
    ? products
    : products.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        (p.brand ?? "").toLowerCase().includes(query.toLowerCase())
      );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        placeholder="Buscar producto del catálogo…"
        style={inp}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#fff", border: "0.5px solid #ddd", borderRadius: 10,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)", maxHeight: 220, overflowY: "auto",
        }}>
          {filtered.length === 0 && (
            <p style={{ padding: "10px 14px", fontSize: 13, color: "#aaa", margin: 0 }}>
              Sin resultados
            </p>
          )}
          {filtered.map(p => (
            <button key={p.id} type="button"
              onMouseDown={() => { onSelect(p); setQuery(p.name); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "9px 14px", background: "transparent",
                border: "none", borderBottom: "0.5px solid #f0efeb", cursor: "pointer",
                textAlign: "left",
              }}>
              <span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>{p.name}</span>
                {p.brand && <span style={{ fontSize: 11, color: "#aaa", marginLeft: 6 }}>{p.brand}</span>}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {p.stock_qty <= p.min_stock && (
                  <span style={{ fontSize: 10, background: "#fff3e0", color: "#e65100", padding: "2px 6px", borderRadius: 10, fontWeight: 600 }}>
                    ⚠ {p.stock_qty} uds
                  </span>
                )}
                <span style={{ fontSize: 13, fontWeight: 700, color: FF_ORANGE }}>{fmt(p.suggested_price ?? 0)}</span>
              </span>
            </button>
          ))}
          {/* Opción manual si el producto no está en el catálogo */}
          {query.trim().length > 0 && (
            <button type="button"
              onMouseDown={() => { onManual(query.trim()); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "9px 14px", background: "#fffaf5",
                border: "none", cursor: "pointer", textAlign: "left",
              }}>
              <span style={{ fontSize: 13, color: FF_ORANGE }}>＋</span>
              <span style={{ fontSize: 13, color: FF_ORANGE, fontWeight: 600 }}>
                Agregar "{query.trim()}" como producto nuevo
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BelangePage() {
  const router = useRouter();

  // ── Form state ──
  const [clientName,      setClientName]      = useState("");
  const [service,         setService]         = useState("");
  const [price,           setPrice]           = useState("");
  const [productoName,    setProductoName]    = useState("");
  const [productoId,      setProductoId]      = useState<string | null>(null);
  const [precioProducto,  setPrecioProducto]  = useState("");
  const [precioSugerido,  setPrecioSugerido]  = useState<number | null>(null);
  const [qty,             setQty]             = useState("1");
  const [payment,         setPayment]         = useState<PaymentMethod>("efectivo");
  const [saving,          setSaving]          = useState(false);
  const [ok,              setOk]              = useState("");
  const [err,             setErr]             = useState("");
  const [stockToast,      setStockToast]      = useState<string | null>(null);

  // ── Data state ──
  const [tab,          setTab]          = useState<Tab>("day");
  const [transactions, setTransactions] = useState<BelangeTransaction[]>([]);
  const [products,     setProducts]     = useState<BelangeInventoryProduct[]>([]);
  const [loading,      setLoading]      = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch transacciones ──
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("pos_transactions")
      .select("*")
      .eq("client_id", BELANGE_CLIENT_ID)
      .order("created_at", { ascending: false });
    if (data) setTransactions((data as PosTransaction[]).map(posToBelangeTransaction));
    setLoading(false);
  }, []);

  // ── Fetch catálogo de productos ──
  const fetchProducts = useCallback(async () => {
    const res = await fetch("/api/belange/inventory");
    if (res.ok) {
      const json = await res.json();
      setProducts(json.products ?? []);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchProducts();
  }, [fetchAll, fetchProducts]);

  // ── Seleccionar producto del catálogo ──
  function handleSelectProduct(p: BelangeInventoryProduct) {
    setProductoName(p.name);
    setProductoId(p.id);
    setPrecioSugerido(p.suggested_price ?? null);
    setPrecioProducto(p.suggested_price ? String(p.suggested_price) : "");
  }

  // ── Producto manual (no está en el catálogo) ──
  function handleManualProduct(name: string) {
    setProductoName(name);
    setProductoId(null);
    setPrecioSugerido(null);
    setPrecioProducto("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numServ = price ? parseFloat(price.replace(/,/g, "")) : null;
    const numProd = precioProducto ? parseFloat(precioProducto.replace(/,/g, "")) : null;
    const numQty  = qty ? Math.max(1, parseInt(qty, 10)) : 1;

    if (!clientName.trim()) { setErr("Agrega el nombre del cliente."); return; }
    if (!service.trim() && !productoName.trim()) { setErr("Agrega al menos un servicio o un producto."); return; }
    if (service.trim() && (numServ === null || isNaN(numServ) || numServ <= 0)) { setErr("Agrega el precio del servicio."); return; }
    if (productoName.trim() && (numProd === null || isNaN(numProd) || numProd <= 0)) { setErr("Agrega el precio del producto."); return; }

    setSaving(true); setErr("");

    const totalProd = numProd !== null ? numProd * numQty : 0;

    const { error } = await supabase.from("pos_transactions").insert({
      client_id:      BELANGE_CLIENT_ID,
      provider:       "manual",
      amount:         (numServ ?? 0) + totalProd,
      currency:       "MXN",
      status:         "paid",
      payment_method: payment,
      service:        service.trim() || null,
      vertical:       "estetica",
      product_id:     productoId,
      metadata: {
        client_name:      clientName.trim(),
        price_service:    numServ ?? 0,
        producto:         productoName.trim() || null,
        precio_producto:  numProd,
        qty:              numQty,
        precio_sugerido:  precioSugerido,
      },
    });

    if (error) { setSaving(false); setErr("Error al guardar. Intenta de nuevo."); return; }

    // ── Descontar stock si el producto viene del catálogo ──
    if (productoId && numQty > 0) {
      try {
        const res = await fetch("/api/belange/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "adjust_stock", product_id: productoId, delta: -numQty }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.low_stock) {
            setStockToast(`⚠️ ${productoName} quedó con ${json.product.stock_qty} unidad${json.product.stock_qty !== 1 ? "es" : ""} en inventario`);
            setTimeout(() => setStockToast(null), 6000);
          }
          // Refrescar catálogo para reflejar nuevo stock
          fetchProducts();
        }
      } catch (e) {
        console.error("Error ajustando stock:", e);
      }
    }

    setSaving(false);
    setOk(`✓ Transacción de ${clientName.trim()} registrada`);
    setClientName(""); setService(""); setPrice("");
    setProductoName(""); setProductoId(null); setPrecioProducto(""); setPrecioSugerido(null); setQty("1");
    setPayment("efectivo");
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

  // Productos con stock crítico
  const lowStockProducts = products.filter(isBelangeLowStock);

  // Precio especial (por debajo del sugerido)
  const numProdActual = precioProducto ? parseFloat(precioProducto.replace(/,/g, "")) : null;
  const esPrecioEspecial = precioSugerido !== null && numProdActual !== null && numProdActual < precioSugerido;

  return (
    <div style={{ minHeight: "100vh", background: "#f8f8f6", fontFamily: "var(--font-outfit, system-ui, sans-serif)" }}>

      {/* ── Toast de stock bajo ── */}
      {stockToast && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 10,
          padding: "12px 20px", zIndex: 100, fontSize: 13, fontWeight: 600, color: "#e65100",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", whiteSpace: "nowrap",
        }}>
          {stockToast}
        </div>
      )}

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
                    placeholder="Ej. Tinte completo + hidratación" style={inp} />
                </Field>
                <Field label="Precio de servicio ($)">
                  <PriceInput value={price} onChange={setPrice} required={false} />
                </Field>
              </div>

              {/* Producto */}
              <div style={{ border: "1px solid #ffe0c2", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#fffaf5" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#b05200", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>🧴</span> Producto
                  <span style={{ marginLeft: "auto", fontSize: 10, background: "#ffe8d0", color: "#b05200", padding: "2px 8px", borderRadius: 20, fontWeight: 500 }}>si aplica</span>
                </p>

                <Field label="Producto adquirido">
                  <ProductSearch
                    products={products}
                    value={productoName}
                    onSelect={handleSelectProduct}
                    onManual={handleManualProduct}
                  />
                </Field>

                {/* Cantidad + Precio en fila */}
                <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8 }}>
                  <Field label="Cantidad">
                    <input
                      type="number" value={qty} min="1" step="1"
                      onChange={e => setQty(e.target.value)}
                      style={{ ...inp, textAlign: "center" }}
                    />
                  </Field>
                  <Field label={precioSugerido ? `Precio ($) — lista: ${fmt(precioSugerido)}` : "Precio por unidad ($)"}>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#aaa", fontSize: 14 }}>$</span>
                      <input
                        type="number" value={precioProducto} min="1" step="1"
                        onChange={e => setPrecioProducto(e.target.value)}
                        placeholder="0"
                        style={{ ...inp, paddingLeft: 26, borderColor: esPrecioEspecial ? "#FFB74D" : undefined }}
                      />
                    </div>
                    {esPrecioEspecial && (
                      <p style={{ fontSize: 11, color: FF_ORANGE, margin: "4px 0 0", fontWeight: 600 }}>
                        🏷 Precio especial — {fmt((precioSugerido! - numProdActual!) * (parseInt(qty) || 1))} de descuento
                      </p>
                    )}
                  </Field>
                </div>
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

            {/* Alerta stock bajo */}
            {lowStockProducts.length > 0 && (
              <div style={{ ...card, marginBottom: "1rem", borderLeft: `3px solid ${FF_ORANGE}`, background: "#fffaf5" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#b05200", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                  ⚠️ Productos con stock bajo ({lowStockProducts.length})
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {lowStockProducts.map(p => (
                    <span key={p.id} style={{
                      fontSize: 12, padding: "4px 10px", borderRadius: 20,
                      background: p.stock_qty === 0 ? "#fde8e8" : "#fff3e0",
                      color: p.stock_qty === 0 ? "#c0392b" : "#e65100",
                      fontWeight: 600,
                    }}>
                      {p.name} — {p.stock_qty === 0 ? "Sin stock" : `${p.stock_qty} ud${p.stock_qty !== 1 ? "s" : ""}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

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
                    {["Fecha", "Cliente", "Servicio", "$ Serv.", "Producto", "Cant.", "$ Prod.", "Pago", "Total"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 15).map(t => {
                    const meta = (t as unknown as { metadata?: Record<string,unknown> }).metadata ?? {};
                    const qtyVal = Number(meta.qty ?? 1);
                    const esPrecEsp = meta.precio_sugerido && t.precio_producto && (t.precio_producto as number) < (meta.precio_sugerido as number);
                    return (
                      <tr key={t.id} style={{ borderBottom: "0.5px solid #f0efeb" }}>
                        <td style={{ padding: "10px 12px", color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(t.created_at)}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{t.client_name}</td>
                        <td style={{ padding: "10px 12px", color: "#555", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Tag color="cyan" />{t.service}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#007a88", whiteSpace: "nowrap" }}>{fmt(t.price)}</td>
                        <td style={{ padding: "10px 12px", color: "#555", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.producto
                            ? <><Tag color="orange" />{t.producto}{esPrecEsp && <span style={{ marginLeft: 4, fontSize: 10, color: FF_ORANGE }}>🏷</span>}</>
                            : <span style={{ color: "#ccc" }}>—</span>}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#888", textAlign: "center" }}>{t.producto ? qtyVal : "—"}</td>
                        <td style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap", color: t.precio_producto ? FF_ORANGE : "#ccc" }}>
                          {t.precio_producto ? fmt(t.precio_producto) : "—"}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: (PM[t.payment_method] ?? PM.tarjeta).bg, color: (PM[t.payment_method] ?? PM.tarjeta).color }}>
                            {(PM[t.payment_method] ?? PM.tarjeta).label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {fmt(t.price + (t.precio_producto ?? 0))}
                        </td>
                      </tr>
                    );
                  })}
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
