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

import {
  DashboardHeader, Chip,
  Field as DField, Modal as DModal,
  inputStyle as mkInput,
  type DashTheme,
} from "@/components/dashboard";

// ─── Brand ────────────────────────────────────────────────────────────────────
const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

// ─── Tema para componentes compartidos + wrappers locales ────────────────────
const T: DashTheme = {
  accent: FF_CYAN, accentDark: "#007a88", accentSoft: "#e4f8fb",
  bg: "#f8f8f6", surface: "#fff", text: "#1a1a1a",
  muted: "#888", border: "#e5e4df", danger: "#c0392b", disabled: "#aaa",
  panel: "#f5f4f0",
};

const Field = (p: Omit<React.ComponentProps<typeof DField>, "theme">) => <DField theme={T} {...p} />;
const Modal = (p: Omit<React.ComponentProps<typeof DModal>, "theme">) => <DModal theme={T} {...p} />;

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

// ─── Hook responsive ──────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
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

// ─── Normalización de servicios ─────────────────────────────────────────────
// El campo "service" es texto libre. Agrupamos variantes en categorías al
// mostrar, sin obligar a cambiar la captura. Reglas por prioridad: la primera
// palabra clave que aparezca define la categoría. Ajustable a gusto de Rafa.
const SERVICE_RULES: { label: string; keywords: string[] }[] = [
  { label: "Corte",       keywords: ["corte", "despunte", "fleco", "cortes"] },
  { label: "Color",       keywords: ["color", "tinte", "mech", "rayos", "diseño", "ampolleta", "iluminaci", "balayage", "decolor"] },
  { label: "Tratamiento", keywords: ["tratamiento", "hidrat", "keratina", "botox", "baño", "nutri", "alaciado", "alisado"] },
  { label: "Barba",       keywords: ["barba", "afeit", "bigote"] },
  { label: "Peinado",     keywords: ["peinado", "secado", "plancha", "ondas", "recogido"] },
];

function normalizeService(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  for (const rule of SERVICE_RULES) {
    if (rule.keywords.some(k => s.includes(k))) return rule.label;
  }
  // Sin coincidencia: devolvemos el texto original con mayúscula inicial.
  return raw!.trim().charAt(0).toUpperCase() + raw!.trim().slice(1);
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
      t.qty ?? 1,
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
  const isMobile = useIsMobile();

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
  const [view,         setView]         = useState<"ingresos" | "inventario">("ingresos");
  const [invSearch,    setInvSearch]    = useState("");

  // ── Edit payment method inline ──
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editPayment,  setEditPayment]  = useState<PaymentMethod>("efectivo");
  const [editSaving,   setEditSaving]   = useState(false);

  // ── Modal: ajuste de stock ──
  const [stockModal,      setStockModal]      = useState<{ id: string; name: string; current: number } | null>(null);
  const [stockDelta,      setStockDelta]      = useState("");
  const [stockModalSaving, setStockModalSaving] = useState(false);

  // ── Modal: nuevo producto ──
  const [newProdModal,    setNewProdModal]    = useState(false);
  const [npName,          setNpName]          = useState("");
  const [npBrand,         setNpBrand]         = useState("");
  const [npCategory,      setNpCategory]      = useState("");
  const [npCost,          setNpCost]          = useState("");
  const [npPrice,         setNpPrice]         = useState("");
  const [npStock,         setNpStock]         = useState("0");
  const [npMinStock,      setNpMinStock]      = useState("2");
  const [npSaving,        setNpSaving]        = useState(false);
  const [npErr,           setNpErr]           = useState("");

  // ── Modal: editar producto ──
  const [editProdModal,   setEditProdModal]   = useState<BelangeInventoryProduct | null>(null);
  const [epName,          setEpName]          = useState("");
  const [epBrand,         setEpBrand]         = useState("");
  const [epCategory,      setEpCategory]      = useState("");
  const [epCost,          setEpCost]          = useState("");
  const [epPrice,         setEpPrice]         = useState("");
  const [epMinStock,      setEpMinStock]      = useState("2");
  const [epSaving,        setEpSaving]        = useState(false);
  const [epErr,           setEpErr]           = useState("");

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

  // ── Guardar cambio de método de pago ──
  async function handleSavePayment(id: string) {
    setEditSaving(true);
    const { error } = await supabase
      .from("pos_transactions")
      .update({ payment_method: editPayment })
      .eq("id", id);
    if (!error) {
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, payment_method: editPayment } : t));
    }
    setEditingId(null);
    setEditSaving(false);
  }

  // ── Guardar ajuste de stock ──
  async function handleSaveStock() {
    if (!stockModal) return;
    const delta = parseInt(stockDelta, 10);
    if (isNaN(delta) || delta === 0) return;
    setStockModalSaving(true);
    const res = await fetch("/api/belange/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "adjust_stock", product_id: stockModal.id, delta }),
    });
    if (res.ok) {
      await fetchProducts();
      setStockModal(null);
      setStockDelta("");
    }
    setStockModalSaving(false);
  }

  // ── Guardar nuevo producto ──
  async function handleSaveNewProduct() {
    if (!npName.trim()) { setNpErr("El nombre es obligatorio."); return; }
    setNpSaving(true); setNpErr("");
    const res = await fetch("/api/belange/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_product",
        name: npName,
        brand: npBrand || null,
        category: npCategory || null,
        cost: npCost ? parseFloat(npCost) : null,
        suggested_price: npPrice ? parseFloat(npPrice) : null,
        stock_qty: parseInt(npStock, 10) || 0,
        min_stock: parseInt(npMinStock, 10) || 2,
      }),
    });
    if (res.ok) {
      await fetchProducts();
      setNewProdModal(false);
      setNpName(""); setNpBrand(""); setNpCategory(""); setNpCost(""); setNpPrice(""); setNpStock("0"); setNpMinStock("2");
    } else {
      setNpErr("Error al guardar. Intenta de nuevo.");
    }
    setNpSaving(false);
  }

  // ── Abrir modal editar producto ──
  function openEditProd(p: BelangeInventoryProduct) {
    setEditProdModal(p);
    setEpName(p.name);
    setEpBrand(p.brand ?? "");
    setEpCategory(p.category ?? "");
    setEpCost("");        // cost no se expone en el tipo cliente
    setEpPrice(p.suggested_price ? String(p.suggested_price) : "");
    setEpMinStock(String(p.min_stock));
    setEpErr("");
  }

  // ── Guardar edición de producto ──
  async function handleSaveEditProduct() {
    if (!editProdModal) return;
    if (!epName.trim()) { setEpErr("El nombre es obligatorio."); return; }
    setEpSaving(true); setEpErr("");
    const body: Record<string, unknown> = {
      action: "update_product",
      product_id: editProdModal.id,
      name: epName,
      brand: epBrand || null,
      category: epCategory || null,
      suggested_price: epPrice ? parseFloat(epPrice) : null,
      min_stock: parseInt(epMinStock, 10) || 2,
    };
    if (epCost) body.cost = parseFloat(epCost);
    const res = await fetch("/api/belange/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await fetchProducts();
      setEditProdModal(null);
    } else {
      setEpErr("Error al guardar. Intenta de nuevo.");
    }
    setEpSaving(false);
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

  // ── Inteligencia del negocio (calculada sobre el período filtrado) ──
  // Top clientes: visitas + gasto total
  const topClients = (() => {
    const m = new Map<string, { visitas: number; total: number }>();
    for (const t of filtered) {
      const name = (t.client_name ?? "").trim();
      if (!name) continue;
      const cur = m.get(name) ?? { visitas: 0, total: 0 };
      cur.visitas += 1;
      cur.total += t.price + (t.precio_producto ?? 0);
      m.set(name, cur);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.visitas - a.visitas || b.total - a.total)
      .slice(0, 5);
  })();

  // Top servicios: por categoría normalizada
  const topServices = (() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const t of filtered) {
      const cat = normalizeService(t.service);
      if (!cat) continue;
      const cur = m.get(cat) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += t.price;
      m.set(cat, cur);
    }
    return [...m.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 5);
  })();

  // Top productos: por unidades vendidas + monto
  const topProducts = (() => {
    const m = new Map<string, { qty: number; total: number }>();
    for (const t of filtered) {
      const name = (t.producto ?? "").trim();
      if (!name) continue;
      const cur = m.get(name) ?? { qty: 0, total: 0 };
      cur.qty += t.qty ?? 1;
      cur.total += t.precio_producto ?? 0;
      m.set(name, cur);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.qty - a.qty || b.total - a.total)
      .slice(0, 5);
  })();

  const uniqueClients = new Set(filtered.map(t => (t.client_name ?? "").trim()).filter(Boolean)).size;
  const cortesCount   = filtered.filter(t => normalizeService(t.service) === "Corte").length;
  const maxSvc        = Math.max(1, ...topServices.map(s => s.count));

  // Productos con stock crítico
  const lowStockProducts = products.filter(isBelangeLowStock);
  const outOfStockCount = products.filter(p => p.stock_qty === 0).length;
  const lowStockCount   = products.filter(p => p.stock_qty > 0 && p.stock_qty <= p.min_stock).length;

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
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          width: isMobile ? "calc(100% - 24px)" : "auto",
          maxWidth: isMobile ? "none" : "90vw",
          textAlign: "center",
        }}>
          {stockToast}
        </div>
      )}

      {/* ── Header ── */}
      <DashboardHeader
        icon={<span style={{ fontSize: 13, fontWeight: 700, color: "#72243e" }}>BS</span>}
        iconShape="circle"
        iconBg="#fbeaf0"
        title="Belange Studio"
        subtitle="Panel de ingresos"
        theme={T}
        right={
          <a href="https://fishflow.mx" target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", opacity: 0.45 }}>
            <FishFlowMark size={22} />
            <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>FishFlow</span>
          </a>
        }
        onLogout={async () => { await supabase.auth.signOut(); router.push("/login?next=/app/belange"); }}
        logoutLabel="⎋ Salir"
      />

      {/* ── Body ── */}
      <main style={{ maxWidth: 1140, margin: "0 auto", padding: isMobile ? "1rem 0.875rem" : "1.5rem 1.25rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "360px 1fr", gap: isMobile ? "1.25rem" : "1.5rem", alignItems: "start" }}>

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

            {/* ── Toggle de vista ── */}
            <div style={{ display: "flex", gap: 4, background: "#eeede9", borderRadius: 8, padding: 4, marginBottom: "1rem" }}>
              {([
                { id: "ingresos",    label: "📊 Ingresos" },
                { id: "inventario",  label: "🧴 Inventario" },
              ] as { id: "ingresos" | "inventario"; label: string }[]).map(v => (
                <button key={v.id} onClick={() => setView(v.id)} style={{
                  flex: 1, padding: "7px 0",
                  border: view === v.id ? "0.5px solid #ddd" : "none",
                  borderRadius: 6,
                  background: view === v.id ? "#fff" : "transparent",
                  color: view === v.id ? "#222" : "#777",
                  fontSize: 13, fontWeight: view === v.id ? 700 : 400, cursor: "pointer",
                }}>
                  {v.label}
                </button>
              ))}
            </div>

            {/* Alerta stock bajo — resumen compacto, solo en vista Ingresos */}
            {view === "ingresos" && lowStockProducts.length > 0 && (
              <button
                onClick={() => setView("inventario")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  background: "#fffaf5", border: "0.5px solid #ffe0c2", borderLeft: `3px solid ${FF_ORANGE}`,
                  borderRadius: 10, padding: "9px 12px", marginBottom: "1rem", cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 14 }}>⚠️</span>
                <span style={{ fontSize: 13, color: "#b05200", fontWeight: 600 }}>
                  {outOfStockCount > 0 && `${outOfStockCount} agotado${outOfStockCount !== 1 ? "s" : ""}`}
                  {outOfStockCount > 0 && lowStockCount > 0 && " · "}
                  {lowStockCount > 0 && `${lowStockCount} por reponer`}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: FF_ORANGE, fontWeight: 700, whiteSpace: "nowrap" }}>
                  Ver inventario →
                </span>
              </button>
            )}

            {view === "ingresos" && (<>
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

              {/* Tabs período */}
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
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3,1fr)" : "repeat(3,1fr)", gap: isMobile ? 7 : 10, marginBottom: "1rem" }}>
                    <MCard label="Total del período"  value={fmt(total)}          sub={`${countServ} transacción${countServ !== 1 ? "es" : ""}`} accent="#1a1a1a" compact={isMobile} />
                    <MCard label="Servicios"           value={fmt(totalServicios)} sub={`ticket prom. ${fmt(avgServ)}`}                          accent={FF_CYAN}   compact={isMobile} />
                    <MCard label="Productos"           value={fmt(totalProductos)} sub={`${countProd} venta${countProd !== 1 ? "s" : ""}`}        accent={FF_ORANGE} compact={isMobile} />
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

                  {/* ── Inteligencia del negocio ── */}
                  <p style={{ ...secLabel, marginTop: "1.5rem" }}>Inteligencia del negocio</p>

                  {/* Stats rápidas */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: isMobile ? 7 : 10, marginBottom: "1rem" }}>
                    <MCard label="Clientes únicos" value={String(uniqueClients)} sub="en el período"        accent={FF_CYAN}   compact={isMobile} />
                    <MCard label="Cortes"          value={String(cortesCount)}   sub="servicios de corte"  accent={FF_ORANGE} compact={isMobile} />
                  </div>

                  {filtered.length === 0 ? (
                    <div style={card}>
                      <p style={{ textAlign: "center", color: "#bbb", fontSize: 13, margin: 0, padding: "1rem 0" }}>Sin datos en este período</p>
                    </div>
                  ) : (<>
                    {/* Clientes más frecuentes */}
                    <div style={{ ...card, marginBottom: "1rem" }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 12 }}>Clientes más frecuentes</p>
                      {topClients.length === 0 ? (
                        <p style={{ fontSize: 13, color: "#bbb", margin: 0 }}>Sin clientes registrados.</p>
                      ) : topClients.map((c, i) => (
                        <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i === topClients.length - 1 ? 0 : 9 }}>
                          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#f0efeb", color: "#888", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>{c.visitas} visita{c.visitas !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#444", minWidth: 64, textAlign: "right" }}>{fmt(c.total)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Servicios + Productos */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "1rem" }}>
                      {/* Servicios más realizados */}
                      <div style={card}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 12 }}>Servicios más realizados</p>
                        {topServices.length === 0 ? (
                          <p style={{ fontSize: 13, color: "#bbb", margin: 0 }}>Sin servicios registrados.</p>
                        ) : topServices.map((s, i) => (
                          <div key={s.label} style={{ marginBottom: i === topServices.length - 1 ? 0 : 11 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontSize: 13, color: "#555" }}>{s.label}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#444" }}>{s.count}</span>
                            </div>
                            <div style={{ height: 6, background: "#f0efeb", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.round((s.count / maxSvc) * 100)}%`, background: FF_CYAN, borderRadius: 4, transition: "width .4s" }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Productos más vendidos */}
                      <div style={card}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#888", marginBottom: 12 }}>Productos más vendidos</p>
                        {topProducts.length === 0 ? (
                          <p style={{ fontSize: 13, color: "#bbb", margin: 0 }}>Aún no hay ventas de producto en este período.</p>
                        ) : topProducts.map((p, i) => (
                          <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: i === topProducts.length - 1 ? 0 : 9 }}>
                            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff1e6", color: "#b05200", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                            <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>{p.qty} ud{p.qty !== 1 ? "s" : ""}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: FF_ORANGE, minWidth: 56, textAlign: "right" }}>{fmt(p.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>)}
                </>
              )}
            </>)}

            {view === "inventario" && (<>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <p style={secLabel}>Inventario disponible</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "#aaa" }}>{products.length} producto{products.length !== 1 ? "s" : ""}</span>
                  <button
                    onClick={() => { setNewProdModal(true); setNpErr(""); }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 8, border: "none", background: FF_CYAN, color: "#fff", cursor: "pointer" }}
                  >
                    + Agregar producto
                  </button>
                </div>
              </div>

              {/* Resumen rápido */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: isMobile ? 7 : 10, marginBottom: "1rem" }}>
                <MCard
                  label="Total productos"
                  value={String(products.length)}
                  sub="en catálogo"
                  accent="#1a1a1a"
                  compact={isMobile}
                />
                <MCard
                  label="Stock bajo"
                  value={String(products.filter(p => p.stock_qty > 0 && p.stock_qty <= p.min_stock).length)}
                  sub="por reponer"
                  accent={FF_ORANGE}
                  compact={isMobile}
                />
                <MCard
                  label="Sin stock"
                  value={String(products.filter(p => p.stock_qty === 0).length)}
                  sub="agotados"
                  accent="#c0392b"
                  compact={isMobile}
                />
              </div>

              {/* Buscador */}
              <div style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  value={invSearch}
                  onChange={e => setInvSearch(e.target.value)}
                  placeholder="Buscar por nombre o marca…"
                  style={{ ...inp, background: "#fff" }}
                />
              </div>

              {/* Tabla de inventario / tarjetas en móvil */}
              {isMobile ? (
                (() => {
                  const inv = products.filter(p => {
                    const q = invSearch.toLowerCase();
                    return !q || p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q);
                  });
                  if (inv.length === 0) {
                    return <div style={{ ...card }}><p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14, margin: 0 }}>Sin resultados</p></div>;
                  }
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {inv.map(p => {
                        const isOut = p.stock_qty === 0;
                        const isLow = !isOut && p.stock_qty <= p.min_stock;
                        const statusBg    = isOut ? "#fde8e8" : isLow ? "#fff3e0" : "#eaf5e9";
                        const statusColor = isOut ? "#c0392b" : isLow ? "#e65100" : "#2e7d32";
                        const statusLabel = isOut ? "Sin stock" : isLow ? "Stock bajo" : "Disponible";
                        return (
                          <div key={p.id} style={{ ...card, padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a", margin: 0 }}>{p.name}</p>
                                {p.brand && <p style={{ fontSize: 12, color: "#aaa", margin: "1px 0 0" }}>{p.brand}</p>}
                              </div>
                              <span style={{ flexShrink: 0 }}>
                                <Chip label={statusLabel} bg={statusBg} fg={statusColor} />
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "10px 0", fontSize: 13 }}>
                              <span style={{ color: "#888" }}>Stock: <strong style={{ color: isOut ? "#c0392b" : isLow ? "#e65100" : "#333", fontSize: 15 }}>{p.stock_qty}</strong></span>
                              <span style={{ fontWeight: 700, color: FF_ORANGE }}>{fmt(p.suggested_price ?? 0)}</span>
                            </div>
                            <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "0.5px solid #f0efeb" }}>
                              <button
                                onClick={() => { setStockModal({ id: p.id, name: p.name, current: p.stock_qty }); setStockDelta(""); }}
                                style={{ flex: 1, fontSize: 13, padding: "7px 0", borderRadius: 6, border: "1px solid #ddd", background: "#fafaf8", cursor: "pointer", color: "#555", fontWeight: 600 }}>
                                ± Stock
                              </button>
                              <button
                                onClick={() => openEditProd(p)}
                                style={{ flex: 1, fontSize: 13, padding: "7px 0", borderRadius: 6, border: "1px solid #e5e4df", background: "#fafaf8", cursor: "pointer", color: "#888" }}>
                                ✏️ Editar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                      {["Producto", "Marca", "Stock", "Precio", "Estado", ""].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products
                      .filter(p => {
                        const q = invSearch.toLowerCase();
                        return !q || p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q);
                      })
                      .map(p => {
                        const isOut = p.stock_qty === 0;
                        const isLow = !isOut && p.stock_qty <= p.min_stock;
                        const statusBg    = isOut ? "#fde8e8" : isLow ? "#fff3e0" : "#eaf5e9";
                        const statusColor = isOut ? "#c0392b" : isLow ? "#e65100" : "#2e7d32";
                        const statusLabel = isOut ? "Sin stock" : isLow ? "Stock bajo" : "Disponible";
                        return (
                          <tr key={p.id} style={{ borderBottom: "0.5px solid #f0efeb" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1a1a1a" }}>{p.name}</td>
                            <td style={{ padding: "10px 12px", color: "#888", fontSize: 12 }}>{p.brand ?? "—"}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: isOut ? "#c0392b" : isLow ? "#e65100" : "#333", textAlign: "center" }}>
                              {p.stock_qty}
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: FF_ORANGE, whiteSpace: "nowrap" }}>
                              {fmt(p.suggested_price ?? 0)}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <Chip label={statusLabel} bg={statusBg} fg={statusColor} />
                            </td>
                            <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => { setStockModal({ id: p.id, name: p.name, current: p.stock_qty }); setStockDelta(""); }}
                                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fafaf8", cursor: "pointer", color: "#555", fontWeight: 600 }}
                                  title="Ajustar stock"
                                >
                                  ±&nbsp;Stock
                                </button>
                                <button
                                  onClick={() => openEditProd(p)}
                                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #e5e4df", background: "#fafaf8", cursor: "pointer", color: "#888" }}
                                  title="Editar producto"
                                >
                                  ✏️
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
                {products.filter(p => {
                  const q = invSearch.toLowerCase();
                  return !q || p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q);
                }).length === 0 && (
                  <p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14 }}>Sin resultados</p>
                )}
              </div>
              )}
            </>)}
          </div>
        </div>

        {/* ────────────────── TABLA ────────────────── */}
        <div style={{ marginTop: "1.5rem" }}>
          <p style={secLabel}>Últimas transacciones</p>
          {loading ? (
            <div style={{ ...card }}><p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14, margin: 0 }}>Cargando…</p></div>
          ) : transactions.length === 0 ? (
            <div style={{ ...card }}><p style={{ padding: "2rem", textAlign: "center", color: "#bbb", fontSize: 14, margin: 0 }}>Aún no hay transacciones. ¡Registra la primera!</p></div>
          ) : isMobile ? (
            /* ── Vista móvil: tarjetas apiladas ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {transactions.slice(0, 15).map(t => {
                const qtyVal = t.qty ?? 1;
                const esPrecEsp = t.precio_sugerido && t.precio_producto && t.precio_producto < t.precio_sugerido;
                const isEditing = editingId === t.id;
                const pm = PM[t.payment_method] ?? PM.tarjeta;
                return (
                  <div key={t.id} style={{ ...card, padding: "12px 14px", background: isEditing ? "#fffbf5" : "#fff" }}>
                    {/* Encabezado: cliente + total */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#1a1a1a" }}>{t.client_name}</span>
                      <span style={{ fontWeight: 700, fontSize: 16, color: "#1a1a1a", whiteSpace: "nowrap" }}>{fmt(t.price + (t.precio_producto ?? 0))}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#aaa", margin: "2px 0 10px" }}>{fmtDate(t.created_at)}</p>

                    {/* Líneas: servicio / producto */}
                    {t.service && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 13, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Tag color="cyan" />{t.service}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#007a88", whiteSpace: "nowrap" }}>{fmt(t.price)}</span>
                      </div>
                    )}
                    {t.producto && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 13, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Tag color="orange" />{t.producto}
                          {qtyVal > 1 && <span style={{ color: "#aaa" }}> ×{qtyVal}</span>}
                          {esPrecEsp && <span style={{ marginLeft: 4, fontSize: 11, color: FF_ORANGE }}>🏷</span>}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: FF_ORANGE, whiteSpace: "nowrap" }}>
                          {t.precio_producto ? fmt(t.precio_producto) : "—"}
                        </span>
                      </div>
                    )}

                    {/* Pie: método de pago + editar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "0.5px solid #f0efeb" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                          <select
                            value={editPayment}
                            onChange={e => setEditPayment(e.target.value as PaymentMethod)}
                            style={{ fontSize: 13, padding: "5px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", flex: 1 }}
                          >
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="transferencia">Transferencia</option>
                          </select>
                          <button onClick={() => handleSavePayment(t.id)} disabled={editSaving}
                            style={{ fontSize: 13, padding: "5px 12px", borderRadius: 6, border: "none", background: FF_CYAN, color: "#fff", cursor: editSaving ? "default" : "pointer", fontWeight: 700 }}>
                            {editSaving ? "…" : "Guardar"}
                          </button>
                          <button onClick={() => setEditingId(null)} disabled={editSaving}
                            style={{ fontSize: 13, padding: "5px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#888" }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <Chip label={pm.label} bg={pm.bg} fg={pm.color} />
                          <button onClick={() => { setEditingId(t.id); setEditPayment(t.payment_method); }}
                            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e4df", background: "#fafaf8", cursor: "pointer", color: "#888" }}
                            title="Editar método de pago">
                            ✏️ Pago
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ ...card, padding: 0, overflow: "hidden", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "0.5px solid #e5e4df" }}>
                    {["Fecha", "Cliente", "Servicio", "$ Serv.", "Producto", "Cant.", "$ Prod.", "Pago", "Total", ""].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 15).map(t => {
                    const qtyVal = t.qty ?? 1;
                    const esPrecEsp = t.precio_sugerido && t.precio_producto && t.precio_producto < t.precio_sugerido;
                    const isEditing = editingId === t.id;
                    return (
                      <tr key={t.id} style={{ borderBottom: "0.5px solid #f0efeb", background: isEditing ? "#fffbf5" : undefined }}>
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
                          {isEditing ? (
                            <select
                              value={editPayment}
                              onChange={e => setEditPayment(e.target.value as PaymentMethod)}
                              style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
                            >
                              <option value="efectivo">Efectivo</option>
                              <option value="tarjeta">Tarjeta</option>
                              <option value="transferencia">Transferencia</option>
                            </select>
                          ) : (
                            <Chip
                              label={(PM[t.payment_method] ?? PM.tarjeta).label}
                              bg={(PM[t.payment_method] ?? PM.tarjeta).bg}
                              fg={(PM[t.payment_method] ?? PM.tarjeta).color}
                            />
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {fmt(t.price + (t.precio_producto ?? 0))}
                        </td>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => handleSavePayment(t.id)}
                                disabled={editSaving}
                                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "none", background: FF_CYAN, color: "#fff", cursor: editSaving ? "default" : "pointer", fontWeight: 700 }}
                              >
                                {editSaving ? "…" : "Guardar"}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                disabled={editSaving}
                                style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#888" }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingId(t.id); setEditPayment(t.payment_method); }}
                              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, border: "1px solid #e5e4df", background: "#fafaf8", cursor: "pointer", color: "#888" }}
                              title="Editar método de pago"
                            >
                              ✏️
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Modal: Ajuste de stock ── */}
        {stockModal && (
          <Modal title="Ajustar stock" onClose={() => setStockModal(null)}>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>{stockModal.name} — actual: <strong>{stockModal.current} uds</strong></p>
              <Field label="Unidades a sumar o restar (ej: +5 o -3)">
                <input
                  type="number"
                  value={stockDelta}
                  onChange={e => setStockDelta(e.target.value)}
                  placeholder="Ej: 10 para sumar, -2 para restar"
                  style={{ ...inp, background: "#fff" }}
                  autoFocus
                />
              </Field>
              {stockDelta && !isNaN(parseInt(stockDelta, 10)) && (
                <p style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>
                  Nuevo stock: <strong>{Math.max(0, stockModal.current + parseInt(stockDelta, 10))} uds</strong>
                </p>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setStockModal(null)} disabled={stockModalSaving} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#888" }}>Cancelar</button>
                <button onClick={handleSaveStock} disabled={stockModalSaving || !stockDelta || isNaN(parseInt(stockDelta, 10)) || parseInt(stockDelta, 10) === 0} style={{ fontSize: 13, fontWeight: 700, padding: "6px 18px", borderRadius: 8, border: "none", background: FF_CYAN, color: "#fff", cursor: "pointer", opacity: (!stockDelta || isNaN(parseInt(stockDelta, 10)) || parseInt(stockDelta, 10) === 0) ? 0.5 : 1 }}>
                  {stockModalSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
          </Modal>
        )}

        {/* ── Modal: Nuevo producto ── */}
        {newProdModal && (
          <Modal title="Agregar producto" onClose={() => setNewProdModal(false)}>
              <Field label="Nombre *">
                <input value={npName} onChange={e => setNpName(e.target.value)} placeholder="Ej: Shampoo Nioxin #2" style={{ ...inp, background: "#fff" }} autoFocus />
              </Field>
              <Field label="Marca">
                <input value={npBrand} onChange={e => setNpBrand(e.target.value)} placeholder="Ej: Nioxin" style={{ ...inp, background: "#fff" }} />
              </Field>
              <Field label="Categoría">
                <select value={npCategory} onChange={e => setNpCategory(e.target.value)} style={{ ...inp, background: "#fff", cursor: "pointer" }}>
                  <option value="">Sin categoría</option>
                  <option value="capilares">Capilares</option>
                  <option value="afeitado">Afeitado</option>
                  <option value="tratamientos">Tratamientos</option>
                  <option value="coloracion">Coloración</option>
                </select>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Costo (MXN)">
                  <PriceInput value={npCost} onChange={setNpCost} />
                </Field>
                <Field label="Precio de venta (MXN)">
                  <PriceInput value={npPrice} onChange={setNpPrice} />
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Stock inicial">
                  <input type="number" min="0" value={npStock} onChange={e => setNpStock(e.target.value)} style={{ ...inp, background: "#fff" }} />
                </Field>
                <Field label="Stock mínimo">
                  <input type="number" min="0" value={npMinStock} onChange={e => setNpMinStock(e.target.value)} style={{ ...inp, background: "#fff" }} />
                </Field>
              </div>
              {npErr && <p style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{npErr}</p>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setNewProdModal(false)} disabled={npSaving} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#888" }}>Cancelar</button>
                <button onClick={handleSaveNewProduct} disabled={npSaving} style={{ fontSize: 13, fontWeight: 700, padding: "6px 18px", borderRadius: 8, border: "none", background: FF_CYAN, color: "#fff", cursor: "pointer" }}>
                  {npSaving ? "Guardando…" : "Agregar"}
                </button>
              </div>
          </Modal>
        )}

        {/* ── Modal: Editar producto ── */}
        {editProdModal && (
          <Modal title="Editar producto" onClose={() => setEditProdModal(null)}>
              <Field label="Nombre *">
                <input value={epName} onChange={e => setEpName(e.target.value)} style={{ ...inp, background: "#fff" }} autoFocus />
              </Field>
              <Field label="Marca">
                <input value={epBrand} onChange={e => setEpBrand(e.target.value)} style={{ ...inp, background: "#fff" }} />
              </Field>
              <Field label="Categoría">
                <select value={epCategory} onChange={e => setEpCategory(e.target.value)} style={{ ...inp, background: "#fff", cursor: "pointer" }}>
                  <option value="">Sin categoría</option>
                  <option value="capilares">Capilares</option>
                  <option value="afeitado">Afeitado</option>
                  <option value="tratamientos">Tratamientos</option>
                  <option value="coloracion">Coloración</option>
                </select>
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Actualizar costo (MXN)">
                  <PriceInput value={epCost} onChange={setEpCost} />
                </Field>
                <Field label="Precio de venta (MXN)">
                  <PriceInput value={epPrice} onChange={setEpPrice} />
                </Field>
              </div>
              <Field label="Stock mínimo para alerta">
                <input type="number" min="0" value={epMinStock} onChange={e => setEpMinStock(e.target.value)} style={{ ...inp, background: "#fff" }} />
              </Field>
              {epErr && <p style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{epErr}</p>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setEditProdModal(null)} disabled={epSaving} style={{ fontSize: 13, padding: "6px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", color: "#888" }}>Cancelar</button>
                <button onClick={handleSaveEditProduct} disabled={epSaving} style={{ fontSize: 13, fontWeight: 700, padding: "6px 18px", borderRadius: 8, border: "none", background: FF_CYAN, color: "#fff", cursor: "pointer" }}>
                  {epSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
          </Modal>
        )}

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
function MCard({ label, value, sub, accent, compact }: { label: string; value: string; sub: string; accent: string; compact?: boolean }) {
  return (
    <div style={{ background: "#f5f4f0", borderRadius: 8, padding: compact ? "0.625rem 0.625rem" : "0.875rem 1rem", borderTop: `2px solid ${accent}` }}>
      <p style={{ fontSize: compact ? 10 : 11, color: "#999", marginBottom: 4, lineHeight: 1.2 }}>{label}</p>
      <p style={{ fontSize: compact ? 16 : 22, fontWeight: 700, color: "#1a1a1a", margin: 0, lineHeight: 1.15 }}>{value}</p>
      <p style={{ fontSize: compact ? 10 : 11, color: "#bbb", marginTop: 3, lineHeight: 1.2 }}>{sub}</p>
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
  ...mkInput(T),
  outline: "none", boxSizing: "border-box",
};
