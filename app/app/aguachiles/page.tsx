"use client";

// app/app/aguachiles/page.tsx
// Panel de Los Aguachiles (Silvia "Chiva"). Tres pestañas:
//   Pedidos  — lo que entra de la página, ordenado por día y franja de entrega
//   Menú     — pausar un platillo que se acabó o ajustar su precio
//   Reseñas  — el Módulo Reputación compartido; cada pedido entregado entra solo
//
// Los pedidos llegan por /api/store/aguachiles/order (service role). Aquí todo va
// con la sesión del usuario: la RLS de store_* y review_* cuelga de
// user_has_access_to_client, así que quien no esté dado de alta no ve filas.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  DashboardHeader, TabBar, StatGrid, StatCard, Empty, Toast, Modal, type DashTheme,
} from "@/components/dashboard";
import ReviewsTab, { normalizePhone } from "@/components/reviews/ReviewsTab";
import {
  AGUACHILES_CLIENT_ID, ESTADO_LABEL, SIGUIENTE, PAGO_LABEL, type Estado,
  cdmxToday, fechaLarga, folio, pesos, ligaMapa, ligaRuta,
  AGUACHILES_COCINA, proponerRuta, ligasRuta, kmEntre, type Punto,
} from "@/lib/storeAguachiles";

// Rosa del logo sobre azul marino de su portada.
const T: DashTheme = {
  accent: "#E8207A",
  accentDark: "#C4155F",
  accentSoft: "#FFE7F1",
  bg: "#FFF7F0",
  surface: "#FFFFFF",
  text: "#12203A",
  muted: "#6B7280",
  border: "#E9E2DC",
  danger: "#DC2626",
  disabled: "#CBD5E1",
  panel: "#FFF1F6",
};

const ESTADO_COLOR: Record<Estado, { bg: string; fg: string }> = {
  nuevo: { bg: "#FFE7F1", fg: "#C4155F" },
  produccion: { bg: "#FFF0D6", fg: "#8A5A00" },
  enviado: { bg: "#DFF3FF", fg: "#0B5E86" },
  entregado: { bg: "#DFF6E6", fg: "#0B6B37" },
  cancelado: { bg: "#F1F1F1", fg: "#6B7280" },
};

type Partida = {
  id: string; product_name: string; qty: number; unit_price: number;
  line_total: number; item_note: string | null;
};
type Pedido = {
  id: string; order_no: number; customer_name: string; customer_phone: string;
  shipping_address: string; subtotal: number; shipping_cost: number; total: number;
  payment_method: string; fulfillment_status: Estado; delivery_date: string | null;
  delivery_slot: string | null; delivery_lat: number | null; delivery_lng: number | null;
  notes: string | null; created_at: string;
  store_order_items: Partida[];
};
type Producto = {
  id: string; category: string; name: string; price: number; active: boolean; sort_order: number;
};
type Tab = "pedidos" | "menu" | "resenas";
type Filtro = "hoy" | "proximos" | "todos";

export default function AguachilesPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"cargando" | "listo" | "sin-acceso">("cargando");
  const [tab, setTab] = useState<Tab>("pedidos");

  const verificar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login?next=/app/aguachiles");
      return;
    }
    // Fail closed: si la consulta falla, se trata como sin acceso.
    const { data, error } = await supabase
      .from("user_client_access")
      .select("client_id")
      .eq("user_id", user.id)
      .eq("client_id", AGUACHILES_CLIENT_ID)
      .maybeSingle();
    setEstado(!error && data ? "listo" : "sin-acceso");
  }, [router]);

  useEffect(() => { void verificar(); }, [verificar]);

  async function salir() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (estado === "cargando") {
    return <main style={{ ...pagina, display: "grid", placeItems: "center" }}>
      <p style={{ color: T.muted, fontSize: 14 }}>Cargando…</p>
    </main>;
  }
  if (estado === "sin-acceso") {
    return <main style={{ ...pagina, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px" }}>Sin acceso a este panel</h1>
        <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6, margin: "0 0 18px" }}>
          Tu cuenta no está dada de alta en Los Aguachiles. Si crees que es un error, escríbele a FishFlow.
        </p>
        <button onClick={() => void salir()} style={botonLinea}>Cambiar de cuenta</button>
      </div>
    </main>;
  }

  return (
    <main style={pagina}>
      <DashboardHeader
        icon="🦐"
        title="Los Aguachiles"
        subtitle="Pedidos a domicilio · jueves a domingo, 12:00 a 17:00"
        theme={T}
        onLogout={() => void salir()}
        iconBg={T.accentSoft}
        sticky
      />
      <div style={contenido}>
        <TabBar<Tab>
          theme={T}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "pedidos", label: "Pedidos", icon: "🧾" },
            { id: "menu", label: "Menú", icon: "🌶️" },
            { id: "resenas", label: "Reseñas", icon: "⭐" },
          ]}
        />
        {tab === "pedidos" && <PedidosTab />}
        {tab === "menu" && <MenuTab />}
        {tab === "resenas" && (
          <ReviewsTab
            clientId={AGUACHILES_CLIENT_ID}
            theme={T}
            personLabel="cliente"
            personLabelPlural="clientes"
            emptyHint="Cada pedido que marcas como Entregado entra solo a esta lista."
          />
        )}
      </div>
    </main>
  );
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────
function PedidosTab() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("proximos");
  const [toast, setToast] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [ruta, setRuta] = useState<{ titulo: string; pedidos: Pedido[] } | null>(null);

  const avisar = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const cargar = useCallback(async () => {
    const desde = new Date(`${cdmxToday()}T00:00:00Z`);
    desde.setUTCDate(desde.getUTCDate() - 60);
    const { data, error } = await supabase
      .from("store_orders")
      .select("id, order_no, customer_name, customer_phone, shipping_address, subtotal, shipping_cost, total, payment_method, fulfillment_status, delivery_date, delivery_slot, delivery_lat, delivery_lng, notes, created_at, store_order_items(id, product_name, qty, unit_price, line_total, item_note)")
      .eq("client_id", AGUACHILES_CLIENT_ID)
      .gte("delivery_date", desde.toISOString().slice(0, 10))
      .order("delivery_date", { ascending: true })
      .order("delivery_slot", { ascending: true })
      .order("created_at", { ascending: true })
      .range(0, 999);
    if (error) {
      console.error("[aguachiles] pedidos:", error);
      avisar("No se pudieron cargar los pedidos");
    } else {
      setPedidos((data as unknown as Pedido[]) ?? []);
      setActualizado(new Date());
    }
    setCargando(false);
  }, []);

  // Refresco cada 30 s: el fin de semana Chiva tiene el panel abierto en el celular.
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 30_000);
    return () => clearInterval(t);
  }, [cargar]);

  const hoy = cdmxToday();
  const visibles = useMemo(() => {
    if (filtro === "hoy") return pedidos.filter((p) => p.delivery_date === hoy);
    if (filtro === "proximos") return pedidos.filter((p) => (p.delivery_date ?? "") >= hoy);
    return [...pedidos].reverse();
  }, [pedidos, filtro, hoy]);

  const deHoy = pedidos.filter((p) => p.delivery_date === hoy && p.fulfillment_status !== "cancelado");
  const porEntregar = pedidos.filter(
    (p) => (p.delivery_date ?? "") >= hoy && !["entregado", "cancelado"].includes(p.fulfillment_status),
  );
  const vendidoHoy = deHoy.reduce((s, p) => s + Number(p.total), 0);

  const grupos = useMemo(() => {
    const m = new Map<string, Pedido[]>();
    for (const p of visibles) {
      const k = `${p.delivery_date ?? "sin fecha"}|${p.delivery_slot ?? ""}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()];
  }, [visibles]);

  async function cambiar(p: Pedido, nuevo: Estado) {
    setOcupado(p.id);
    const { error } = await supabase
      .from("store_orders")
      .update({ fulfillment_status: nuevo, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) {
      console.error("[aguachiles] estado:", error);
      avisar(`Error: ${error.message}`);
      setOcupado(null);
      return;
    }
    if (nuevo === "entregado") {
      // Entra a la cola de reseñas. Se invita a TODOS los entregados (sin review
      // gating: filtrar va contra la política de Google). 23505 = ya estaba activo.
      const { error: rErr } = await supabase.from("review_requests").insert({
        client_id: AGUACHILES_CLIENT_ID,
        contact_name: p.customer_name,
        contact_phone: normalizePhone(p.customer_phone),
        source: "pedido",
        notes: `Pedido ${folio(p.order_no)}`,
      });
      if (rErr && rErr.code !== "23505") console.error("[aguachiles] reseña:", rErr);
      avisar(`${folio(p.order_no)} entregado · ya está en Reseñas`);
    } else {
      avisar(`${folio(p.order_no)} → ${ESTADO_LABEL[nuevo]}`);
    }
    setPedidos((prev) => prev.map((x) => (x.id === p.id ? { ...x, fulfillment_status: nuevo } : x)));
    setOcupado(null);
  }

  async function cancelar(p: Pedido) {
    if (!window.confirm(`¿Cancelar el pedido ${folio(p.order_no)} de ${p.customer_name}?`)) return;
    await cambiar(p, "cancelado");
  }

  return (
    <div>
      <StatGrid>
        <StatCard theme={T} label="Pedidos de hoy" value={deHoy.length} icon="🧾" />
        <StatCard theme={T} label="Por entregar" value={porEntregar.length} icon="🛵" highlight={porEntregar.length > 0} />
        <StatCard theme={T} label="Vendido hoy" value={pesos(vendidoHoy)} icon="💵" sub="Con envío, sin cancelados" />
      </StatGrid>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        {(["proximos", "hoy", "todos"] as Filtro[]).map((f) => (
          <button key={f} onClick={() => setFiltro(f)} style={chip(filtro === f)}>
            {f === "proximos" ? "Próximos" : f === "hoy" ? "Hoy" : "Todos"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>
          {actualizado ? `Actualizado ${actualizado.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
        <button onClick={() => void cargar()} style={botonLinea}>Actualizar</button>
      </div>

      {cargando ? (
        <Empty theme={T} msg="Cargando pedidos…" />
      ) : grupos.length === 0 ? (
        <Empty theme={T} msg={filtro === "hoy" ? "Todavía no hay pedidos para hoy." : "No hay pedidos por ahora. Los que entren por la página aparecen aquí solos."} />
      ) : (
        grupos.map(([k, lista]) => {
          const [fecha, franja] = k.split("|");
          return (
            <section key={k} style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase",
                color: T.muted, margin: "0 0 10px" }}>
                {fecha === hoy ? "Hoy" : fecha === "sin fecha" ? "Sin fecha" : fechaLarga(fecha)}
                {franja ? ` · ${franja}` : ""}
                <span style={{ fontWeight: 600, marginLeft: 8 }}>({lista.length})</span>
                {(() => {
                  const pendientes = lista.filter((p) => !["entregado", "cancelado"].includes(p.fulfillment_status));
                  if (!pendientes.length) return null;
                  const titulo = `${fecha === hoy ? "Hoy" : fechaLarga(fecha)}${franja ? ` · ${franja}` : ""}`;
                  return (
                    <button onClick={() => setRuta({ titulo, pedidos: pendientes })}
                      style={{ ...botonLinea, marginLeft: 12, padding: "5px 12px", fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                      🛵 Ruta de entrega
                    </button>
                  );
                })()}
              </h3>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}>
                {lista.map((p) => (
                  <TarjetaPedido key={p.id} p={p} ocupado={ocupado === p.id}
                    onAvanzar={(e) => void cambiar(p, e)} onCancelar={() => void cancelar(p)} />
                ))}
              </div>
            </section>
          );
        })
      )}
      {ruta && <RutaModal titulo={ruta.titulo} pedidos={ruta.pedidos} onClose={() => setRuta(null)} />}
      <Toast theme={T} msg={toast} />
    </div>
  );
}

function TarjetaPedido({ p, ocupado, onAvanzar, onCancelar }: {
  p: Pedido; ocupado: boolean; onAvanzar: (e: Estado) => void; onCancelar: () => void;
}) {
  const sig = SIGUIENTE[p.fulfillment_status];
  const c = ESTADO_COLOR[p.fulfillment_status] ?? ESTADO_COLOR.nuevo;
  const cerrado = p.fulfillment_status === "entregado" || p.fulfillment_status === "cancelado";
  const conPin = p.delivery_lat != null && p.delivery_lng != null;
  const mapa = ligaMapa(p.delivery_lat, p.delivery_lng, p.shipping_address);
  return (
    <article style={{
      background: T.surface, borderRadius: 14, padding: 16,
      border: `1.5px solid ${p.fulfillment_status === "nuevo" ? T.accent : T.border}`,
      opacity: p.fulfillment_status === "cancelado" ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <b style={{ fontSize: 15 }}>{folio(p.order_no)}</b>
        <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, background: c.bg, color: c.fg }}>
          {ESTADO_LABEL[p.fulfillment_status]}
        </span>
        <b style={{ marginLeft: "auto", fontSize: 16 }}>{pesos(p.total)}</b>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 14 }}>
        {p.store_order_items.map((i) => (
          <li key={i.id} style={{ padding: "3px 0" }}>
            <b>{i.qty}x</b> {i.product_name}
            {i.item_note ? <span style={{ color: T.accentDark, fontWeight: 600 }}> · {i.item_note.replace("Picor: ", "")}</span> : null}
          </li>
        ))}
      </ul>
      {p.notes ? <p style={{ margin: "0 0 10px", fontSize: 13, background: T.panel, padding: "8px 10px", borderRadius: 8 }}>📝 {p.notes}</p> : null}

      <div style={{ fontSize: 13, lineHeight: 1.55, color: T.text, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <div><b>{p.customer_name}</b> · <a href={`https://wa.me/52${p.customer_phone}`} target="_blank" rel="noreferrer" style={{ color: "#128C4A", fontWeight: 700 }}>{p.customer_phone}</a></div>
        <div>{p.shipping_address}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 2px" }}>
          <a href={mapa} target="_blank" rel="noreferrer" style={{ color: T.accentDark, fontWeight: 700 }}>
            {conPin ? "📍 Ver pin en Google Maps" : "Buscar dirección en Maps"}
          </a>
          {conPin && (
            <a href={ligaRuta(p.delivery_lat!, p.delivery_lng!)} target="_blank" rel="noreferrer" style={{ color: T.accentDark, fontWeight: 700 }}>
              Cómo llegar
            </a>
          )}
        </div>
        {!conPin && <div style={{ fontSize: 12, color: T.muted }}>Sin pin: el cliente no confirmó en el mapa.</div>}
        <div style={{ color: T.muted }}>{PAGO_LABEL[p.payment_method] ?? p.payment_method}</div>
      </div>

      {!cerrado && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {sig && (
            <button disabled={ocupado} onClick={() => onAvanzar(sig)} style={{ ...botonRosa, flex: 1, opacity: ocupado ? 0.6 : 1 }}>
              {sig === "entregado" ? "Marcar entregado" : `Pasar a ${ESTADO_LABEL[sig]}`}
            </button>
          )}
          <button disabled={ocupado} onClick={onCancelar} style={botonLinea}>Cancelar</button>
        </div>
      )}
    </article>
  );
}

// ─── Ruta de entrega ─────────────────────────────────────────────────────────
// Propone el orden de las entregas pendientes de una franja con el pin que dejó
// cada cliente. Distancias en línea recta: sirven para ordenar, no para prometer
// tiempos. El tiempo real lo da Google Maps al abrir la liga.
type Parada = Pedido & Punto;

function RutaModal({ titulo, pedidos, onClose }: { titulo: string; pedidos: Pedido[]; onClose: () => void }) {
  const [origen, setOrigen] = useState<Punto | null>(AGUACHILES_COCINA);
  const [gps, setGps] = useState<string | null>(null);

  const conPin: Parada[] = pedidos
    .filter((p) => p.delivery_lat != null && p.delivery_lng != null)
    .map((p) => ({ ...p, lat: p.delivery_lat!, lng: p.delivery_lng! }));
  const sinPin = pedidos.filter((p) => p.delivery_lat == null || p.delivery_lng == null);

  const { orden, km } = useMemo(() => proponerRuta(conPin, origen), [conPin.map((p) => p.id).join(","), origen]); // eslint-disable-line react-hooks/exhaustive-deps
  const ligas = ligasRuta(orden, origen);

  function desdeAqui() {
    if (!navigator.geolocation) { setGps("Este teléfono no comparte ubicación."); return; }
    setGps("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOrigen({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGps("La ruta sale de donde estás."); },
      () => setGps("No se pudo leer tu ubicación. La ruta sale de la primera entrega."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <Modal title={`Ruta de entrega · ${titulo}`} onClose={onClose} theme={T}>
      {conPin.length === 0 ? (
        <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.55 }}>
          Ningún pedido de esta franja trae pin en el mapa, así que no se puede armar la ruta.
          Usa la dirección escrita de cada uno.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: T.muted, margin: "0 0 12px", lineHeight: 1.55 }}>
            Orden sugerido para entregar lo pendiente de esta franja con el menor recorrido.
            {origen ? "" : " Sin punto de salida, arranca por la entrega que deja el camino más corto."}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <button onClick={desdeAqui} style={botonLinea}>📍 Salir desde donde estoy</button>
            {gps && <span style={{ fontSize: 12, color: T.muted }}>{gps}</span>}
          </div>
          <ol style={{ listStyle: "none", padding: 0, margin: "0 0 14px" }}>
            {orden.map((p, i) => {
              const previo = i === 0 ? origen : orden[i - 1];
              const tramo = previo ? kmEntre(previo, p) : null;
              return (
                <li key={p.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", background: T.accent, color: "#fff",
                    display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13 }}>{i + 1}</span>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <b>{folio(p.order_no)} · {p.customer_name}</b>
                    <div>{p.shipping_address}</div>
                    <div style={{ color: T.muted }}>
                      {tramo != null ? `a ${tramo.toFixed(1)} km ${i === 0 ? "de la salida" : "de la anterior"} · ` : ""}
                      <a href={`https://wa.me/52${p.customer_phone}`} target="_blank" rel="noreferrer" style={{ color: "#128C4A", fontWeight: 700 }}>
                        Avisar que voy
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 12px" }}>
            ≈ {km.toFixed(1)} km en línea recta. Google Maps te da la distancia y el tiempo reales.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {ligas.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer"
                style={{ ...botonRosa, display: "block", textAlign: "center", textDecoration: "none", padding: "12px 14px" }}>
                Abrir ruta en Google Maps{ligas.length > 1 ? ` · tramo ${i + 1} de ${ligas.length}` : ""}
              </a>
            ))}
          </div>
          {ligas.length > 1 && (
            <p style={{ fontSize: 12, color: T.muted, margin: "8px 0 0" }}>
              Google Maps en el celular solo acepta pocas paradas por ruta: al terminar un tramo, abre el siguiente.
            </p>
          )}
        </>
      )}
      {sinPin.length > 0 && (
        <div style={{ marginTop: 16, background: T.panel, borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
          <b>Sin pin, no entran a la ruta:</b>
          {sinPin.map((p) => (
            <div key={p.id} style={{ marginTop: 4 }}>
              {folio(p.order_no)} · {p.shipping_address} ·{" "}
              <a href={ligaMapa(null, null, p.shipping_address)} target="_blank" rel="noreferrer" style={{ color: T.accentDark, fontWeight: 700 }}>Buscar</a>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─── Menú ────────────────────────────────────────────────────────────────────
function MenuTab() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const avisar = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from("store_products")
      .select("id, category, name, price, active, sort_order")
      .eq("client_id", AGUACHILES_CLIENT_ID)
      .order("sort_order");
    if (error) { console.error("[aguachiles] menu:", error); avisar("No se pudo cargar el menú"); }
    const lista = (data as Producto[]) ?? [];
    setProductos(lista);
    setPrecios(Object.fromEntries(lista.map((p) => [p.id, String(Number(p.price))])));
    setCargando(false);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(p: Producto, cambios: Partial<Producto>) {
    const { error } = await supabase.from("store_products")
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) { console.error("[aguachiles] guardar:", error); avisar(`Error: ${error.message}`); return; }
    setProductos((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)));
    avisar("Guardado. La página ya lo muestra así.");
  }

  if (cargando) return <Empty theme={T} msg="Cargando menú…" />;

  const cats = [...new Set(productos.map((p) => p.category))];
  return (
    <div>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 18px", lineHeight: 1.55 }}>
        Si algo se acabó, ponlo en <b>Pausado</b>: desaparece de la página al momento y nadie lo puede pedir.
        Los precios que cambies aquí son los que cobra la página.
      </p>
      {cats.map((cat) => (
        <section key={cat} style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: T.muted, margin: "0 0 10px" }}>{cat}</h3>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14 }}>
            {productos.filter((p) => p.category === cat).map((p, i, arr) => {
              const valor = precios[p.id] ?? "";
              const cambio = Number(valor) !== Number(p.price);
              const valido = /^\d{1,5}$/.test(valor) && Number(valor) > 0;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  padding: "12px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
                  opacity: p.active ? 1 : 0.6 }}>
                  <div style={{ flex: "1 1 160px", fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                    $<input inputMode="numeric" value={valor}
                      onChange={(e) => setPrecios((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, "") }))}
                      style={{ width: 70, padding: "7px 8px", border: `1.5px solid ${T.border}`, borderRadius: 8, fontSize: 14, fontFamily: "inherit" }} />
                  </label>
                  {cambio && (
                    <button disabled={!valido} onClick={() => void guardar(p, { price: Number(valor) })}
                      style={{ ...botonRosa, padding: "8px 12px", opacity: valido ? 1 : 0.5 }}>Guardar</button>
                  )}
                  <button onClick={() => void guardar(p, { active: !p.active })}
                    style={{ ...chip(p.active), minWidth: 92 }}>
                    {p.active ? "Disponible" : "Pausado"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <Toast theme={T} msg={toast} />
    </div>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────
const pagina: React.CSSProperties = {
  minHeight: "100vh",
  background: T.bg,
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: T.text,
};
const contenido: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "22px clamp(14px, 3vw, 28px) 60px",
};
const botonLinea: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 999, border: `1.5px solid ${T.border}`, background: "#fff",
  color: T.text, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const botonRosa: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 999, border: 0, background: T.accent, color: "#fff",
  fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
function chip(activo: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
    fontFamily: "inherit", border: `1.5px solid ${activo ? T.text : T.border}`,
    background: activo ? T.text : "#fff", color: activo ? "#fff" : T.text,
  };
}
