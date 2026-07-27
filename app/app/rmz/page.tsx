"use client";

// Panel de Cocinas y Closets RMZ — pedidos de la tienda en línea + catálogo.
// Flujo: Pago pendiente → Pagado → En fabricación → Enviado → Entregado.

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, TabBar, Toast, Modal as DModal,
  StatCard as DStatCard, Empty as DEmpty, Field as DField, Chip,
  type DashTheme,
} from "@/components/dashboard";
import Resumen from "./Resumen";

export const RMZ_CLIENT_ID = "80a067ff-fce7-4642-97c1-ac7f56ff4ba1";

// ─── Tema RMZ (dorado / ink) ─────────────────────────────────────────────────
const AC = "#C0923A";
const AC_D = "#9E7328";
const AC_L = "#F7EFE3";
const INK = "#241C16";
const CREAM = "#FAF7F2";
const LINE = "#EAE0D5";
const MUT = "#8A7D70";
const WH = "#FFFFFF";

const T: DashTheme = {
  accent: AC, accentDark: AC_D, accentSoft: AC_L,
  bg: CREAM, surface: WH, text: INK,
  muted: MUT, border: LINE, danger: "#B3261E", disabled: MUT,
  panel: "#F3EDE4",
};

// Wrappers a nivel módulo (nunca dentro del render)
const StatCard = (p: Omit<React.ComponentProps<typeof DStatCard>, "theme">) => <DStatCard theme={T} {...p} />;
const Empty = (p: Omit<React.ComponentProps<typeof DEmpty>, "theme">) => <DEmpty theme={T} {...p} />;
const Field = (p: Omit<React.ComponentProps<typeof DField>, "theme">) => <DField theme={T} {...p} />;
const Modal = (p: Omit<React.ComponentProps<typeof DModal>, "theme">) => <DModal theme={T} {...p} />;

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Order = {
  id: string; order_no: number; token: string;
  customer_name: string; customer_phone: string; customer_email: string | null;
  shipping_address: string; subtotal: number; total: number;
  payment_method: "stripe" | "mercadopago" | "transferencia";
  payment_status: "pending" | "paid" | "failed" | "cancelled";
  fulfillment_status: "nuevo" | "produccion" | "enviado" | "entregado" | "cancelado";
  invoice_requested: boolean; invoice_data: Record<string, string> | null;
  created_at: string;
};
type OrderItem = {
  order_id: string; product_name: string; color_name: string | null; color_hex: string | null;
  unit_price: number; qty: number; line_total: number;
};
type Product = {
  id: string; category: string; name: string; dimensions: string | null;
  price: number; active: boolean; sort_order: number;
};
type TabKey = "resumen" | "pedidos" | "catalogo";

const money = (n: number) => "$" + Number(n).toLocaleString("es-MX");
const ref = (o: Order) => `RMZ-${o.order_no}`;

const PAY_LABEL: Record<string, string> = {
  stripe: "Tarjeta/OXXO", mercadopago: "Mercado Pago", transferencia: "Transferencia",
};
const FULFILL: [Order["fulfillment_status"], string][] = [
  ["produccion", "En fabricación"], ["enviado", "Enviado"], ["entregado", "Entregado"], ["cancelado", "Cancelado"],
];
const FULFILL_LABEL: Record<string, string> = {
  nuevo: "Nuevo", produccion: "En fabricación", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado",
};

function payChip(o: Order) {
  if (o.payment_status === "paid") return <Chip label="Pagado" bg="#EAF6F0" fg="#1E5E44" />;
  if (o.payment_status === "failed") return <Chip label="Pago fallido" bg="#FDECEA" fg="#B3261E" />;
  if (o.payment_status === "cancelled") return <Chip label="Cancelado" bg="#F3EDE4" fg={MUT} />;
  return <Chip label={o.payment_method === "transferencia" ? "Depósito pendiente" : "Pago en proceso"} bg="#FFF3D9" fg="#8A6516" />;
}

export default function RmzDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("resumen");
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Record<string, OrderItem[]>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Order | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editPrice, setEditPrice] = useState("");

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const load = useCallback(async () => {
    // Supabase devuelve máximo 1000 filas por request → paginar con .range()
    const PAGE = 1000;
    const allOrders: Order[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("store_orders").select("*")
        .eq("client_id", RMZ_CLIENT_ID)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) { console.error("[rmz] orders:", error); break; }
      allOrders.push(...((data ?? []) as Order[]));
      if (!data || data.length < PAGE) break;
    }

    const { data: prods, error: e2 } = await supabase
      .from("store_products").select("id, category, name, dimensions, price, active, sort_order")
      .eq("client_id", RMZ_CLIENT_ID).order("sort_order");
    if (e2) console.error("[rmz] products:", e2);

    setOrders(allOrders);
    setProducts((prods ?? []) as Product[]);

    const ids = allOrders.map((o) => o.id);
    const grouped: Record<string, OrderItem[]> = {};
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      for (let from = 0; ; from += PAGE) {
        const { data: its, error: e3 } = await supabase
          .from("store_order_items")
          .select("order_id, product_name, color_name, color_hex, unit_price, qty, line_total")
          .in("order_id", chunk)
          .range(from, from + PAGE - 1);
        if (e3) { console.error("[rmz] items:", e3); break; }
        for (const it of (its ?? []) as OrderItem[]) (grouped[it.order_id] ??= []).push(it);
        if (!its || its.length < PAGE) break;
      }
    }
    setItems(grouped);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stats del mes ───────────────────────────────────────────────────────────
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const monthOrders = orders.filter((o) => new Date(o.created_at) >= monthStart && o.payment_status !== "cancelled");
  const paidMonth = monthOrders.filter((o) => o.payment_status === "paid");
  const salesMonth = paidMonth.reduce((s, o) => s + Number(o.total), 0);
  const pendingTransfers = orders.filter((o) => o.payment_method === "transferencia" && o.payment_status === "pending");
  const avgTicket = paidMonth.length ? salesMonth / paidMonth.length : 0;

  // ── Acciones ────────────────────────────────────────────────────────────────
  async function confirmDeposit(o: Order) {
    setConfirming(o.id);
    try {
      const res = await fetch("/api/store/rmz/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: o.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al confirmar");
      toast(`Depósito de ${ref(o)} confirmado — se avisó al cliente ✅`);
      setConfirmTarget(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al confirmar");
    } finally {
      setConfirming(null);
    }
  }

  async function setFulfillment(o: Order, status: Order["fulfillment_status"]) {
    const { error } = await supabase
      .from("store_orders").update({ fulfillment_status: status }).eq("id", o.id);
    if (error) {
      console.error("[rmz] fulfillment:", error);
      toast("Error al actualizar el estado");
      return;
    }
    toast(`${ref(o)} → ${FULFILL_LABEL[status]}`);
    setOrders((os) => os.map((x) => (x.id === o.id ? { ...x, fulfillment_status: status } : x)));
  }

  async function saveProduct() {
    if (!editProduct) return;
    const price = Number(editPrice);
    if (!price || price <= 0) { toast("Precio inválido"); return; }
    const { error } = await supabase
      .from("store_products").update({ price }).eq("id", editProduct.id);
    if (error) {
      console.error("[rmz] product price:", error);
      toast("Error al guardar el precio");
      return;
    }
    toast(`Precio de "${editProduct.name}" actualizado`);
    setProducts((ps) => ps.map((p) => (p.id === editProduct.id ? { ...p, price } : p)));
    setEditProduct(null);
  }

  async function toggleProduct(p: Product) {
    const { error } = await supabase
      .from("store_products").update({ active: !p.active }).eq("id", p.id);
    if (error) {
      console.error("[rmz] product toggle:", error);
      toast("Error al actualizar");
      return;
    }
    toast(p.active ? `"${p.name}" pausado — ya no aparece en la tienda` : `"${p.name}" visible en la tienda`);
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/rmz");
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: CREAM, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      <DashboardHeader
        icon="🪑" iconBg={INK} theme={T} sticky onLogout={logout}
        title="Cocinas y Closets RMZ"
        subtitle="Pedidos de la tienda en línea"
        right={
          <a href="/tienda/rmz" target="_blank" rel="noreferrer"
            style={{ fontSize: 13, fontWeight: 700, color: AC_D, textDecoration: "none", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 14px", background: WH }}>
            Ver tienda ↗
          </a>
        }
      />

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "20px clamp(14px, 3vw, 28px) 60px" }}>
        {/* Los KPIs del mes viven arriba salvo en Resumen, que trae los suyos por periodo */}
        {tab !== "resumen" && (
          <StatGrid>
            <StatCard label="Ventas cobradas (mes)" value={money(salesMonth)} icon="💰" highlight />
            <StatCard label="Pedidos del mes" value={String(monthOrders.length)} icon="🛒" />
            <StatCard label="Depósitos por confirmar" value={String(pendingTransfers.length)} icon="🏦"
              accent={pendingTransfers.length ? "#8A6516" : undefined} />
            <StatCard label="Ticket promedio" value={money(Math.round(avgTicket))} icon="📈" />
          </StatGrid>
        )}

        <div style={{ margin: "18px 0" }}>
          <TabBar<TabKey>
            theme={T} active={tab} onChange={setTab}
            tabs={[
              { id: "resumen", label: "Resumen", icon: "📊" },
              { id: "pedidos", label: `Pedidos${pendingTransfers.length ? ` · ${pendingTransfers.length} ⚠️` : ""}`, icon: "📦" },
              { id: "catalogo", label: "Catálogo", icon: "🪑" },
            ]}
          />
        </div>

        {loading && <Empty msg="Cargando…" />}

        {/* ── RESUMEN ── */}
        {!loading && tab === "resumen" && (
          <Resumen orders={orders} items={items} products={products}
            theme={T} accent={AC} accentDark={AC_D} />
        )}

        {/* ── PEDIDOS ── */}
        {!loading && tab === "pedidos" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!orders.length && <Empty msg="Aún no hay pedidos. Comparte la tienda para recibir el primero." />}
            {orders.map((o) => {
              const its = items[o.id] ?? [];
              const needsConfirm = o.payment_method === "transferencia" && o.payment_status === "pending";
              return (
                <div key={o.id} style={{
                  background: WH, border: `1px solid ${needsConfirm ? "#EFD9A8" : LINE}`,
                  borderRadius: 16, padding: "16px 18px",
                  boxShadow: needsConfirm ? "0 0 0 2px #FFF3D9" : "none",
                }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <b style={{ fontSize: 16 }}>{ref(o)}</b>
                    {payChip(o)}
                    <Chip label={FULFILL_LABEL[o.fulfillment_status]} bg={AC_L} fg={AC_D} />
                    <Chip label={PAY_LABEL[o.payment_method]} bg="#F3EDE4" fg={MUT} />
                    {o.invoice_requested && <Chip label="🧾 Factura solicitada" bg="#EDE7F6" fg="#5E35B1" />}
                    <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 17 }}>{money(o.total)}</span>
                  </div>

                  <div style={{ fontSize: 14, color: MUT, marginTop: 8 }}>
                    {new Date(o.created_at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    <b style={{ color: INK }}>{o.customer_name}</b>
                    {" · "}
                    <a href={`https://wa.me/52${o.customer_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" style={{ color: AC_D, fontWeight: 600 }}>
                      {o.customer_phone}
                    </a>
                    {o.customer_email && <> · {o.customer_email}</>}
                  </div>

                  <div style={{ fontSize: 14, marginTop: 6 }}>
                    {its.map((it, i) => (
                      <span key={i}>
                        {it.qty}× {it.product_name}{it.color_name ? ` (${it.color_name})` : ""}
                        {i < its.length - 1 ? " · " : ""}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: MUT, marginTop: 4 }}>📍 {o.shipping_address}</div>

                  {o.invoice_requested && o.invoice_data && (
                    <div style={{ fontSize: 13, marginTop: 8, background: "#F6F2FB", border: "1px solid #E3D9F3", borderRadius: 10, padding: "8px 12px" }}>
                      🧾 <b>{o.invoice_data.rfc}</b> · {o.invoice_data.razon_social} · CP {o.invoice_data.cp || "—"} · {o.invoice_data.cfdi_use}
                    </div>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    {needsConfirm && (
                      <button
                        onClick={() => setConfirmTarget(o)}
                        disabled={confirming === o.id}
                        style={{
                          background: AC, color: "#fff", border: 0, borderRadius: 10,
                          padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
                          fontFamily: "inherit", opacity: confirming === o.id ? 0.6 : 1,
                        }}>
                        {confirming === o.id ? "Confirmando…" : "✓ Confirmar depósito"}
                      </button>
                    )}
                    {o.payment_status === "paid" && o.fulfillment_status !== "entregado" && o.fulfillment_status !== "cancelado" &&
                      FULFILL.filter(([k]) => k !== o.fulfillment_status && k !== "cancelado").map(([k, label]) => (
                        <button key={k} onClick={() => setFulfillment(o, k)}
                          style={{
                            background: WH, color: INK, border: `1px solid ${LINE}`, borderRadius: 10,
                            padding: "9px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                          }}>
                          → {label}
                        </button>
                      ))}
                    <a href={`/pedido/${o.token}`} target="_blank" rel="noreferrer"
                      style={{ marginLeft: "auto", alignSelf: "center", fontSize: 13, color: AC_D, fontWeight: 700, textDecoration: "none" }}>
                      Ver orden de compra ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── CATÁLOGO ── */}
        {!loading && tab === "catalogo" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {products.map((p) => (
              <div key={p.id} style={{
                background: WH, border: `1px solid ${LINE}`, borderRadius: 14,
                padding: "13px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
                opacity: p.active ? 1 : 0.55,
              }}>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <b>{p.name}</b>
                  <div style={{ fontSize: 13, color: MUT }}>{p.category}{p.dimensions ? ` · ${p.dimensions}` : ""}</div>
                </div>
                <span style={{ fontWeight: 800, fontSize: 16 }}>{money(Number(p.price))}</span>
                <button onClick={() => { setEditProduct(p); setEditPrice(String(p.price)); }}
                  style={{ background: WH, border: `1px solid ${LINE}`, borderRadius: 9, padding: "8px 13px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                  ✏️ Precio
                </button>
                <button onClick={() => toggleProduct(p)}
                  style={{
                    background: p.active ? "#FDECEA" : "#EAF6F0",
                    color: p.active ? "#B3261E" : "#1E5E44",
                    border: 0, borderRadius: 9, padding: "8px 13px", fontWeight: 700, fontSize: 13,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  {p.active ? "Pausar" : "Publicar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal confirmar depósito */}
      {confirmTarget && (
        <Modal title={`Confirmar depósito · ${ref(confirmTarget)}`} onClose={() => setConfirmTarget(null)}>
          <p style={{ fontSize: 14, margin: "0 0 6px" }}>
            ¿Ya viste reflejada la transferencia de <b>{money(confirmTarget.total)}</b> de{" "}
            <b>{confirmTarget.customer_name}</b> en la cuenta?
          </p>
          <p style={{ fontSize: 13, color: MUT, margin: "0 0 16px" }}>
            Al confirmar, el pedido pasa a fabricación y el cliente recibe su confirmación por correo automáticamente.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => confirmDeposit(confirmTarget)} disabled={confirming === confirmTarget.id}
              style={{ flex: 1, background: AC, color: "#fff", border: 0, borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              {confirming === confirmTarget.id ? "Confirmando…" : "Sí, depósito recibido"}
            </button>
            <button onClick={() => setConfirmTarget(null)}
              style={{ background: WH, border: `1px solid ${LINE}`, borderRadius: 10, padding: "12px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              Aún no
            </button>
          </div>
        </Modal>
      )}

      {/* Modal editar precio */}
      {editProduct && (
        <Modal title={`Precio · ${editProduct.name}`} onClose={() => setEditProduct(null)}>
          <Field label="Precio (MXN)">
            <input
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              inputMode="decimal"
              style={{ width: "100%", border: `1px solid ${LINE}`, borderRadius: 10, padding: "11px 13px", fontSize: 15, fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </Field>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={saveProduct}
              style={{ flex: 1, background: AC, color: "#fff", border: 0, borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              Guardar
            </button>
            <button onClick={() => setEditProduct(null)}
              style={{ background: WH, border: `1px solid ${LINE}`, borderRadius: 10, padding: "12px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}

      <Toast msg={toastMsg} theme={T} />
    </div>
  );
}
