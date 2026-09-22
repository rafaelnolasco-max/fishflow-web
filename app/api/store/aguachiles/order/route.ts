// app/api/store/aguachiles/order/route.ts
// Pedido público de Los Aguachiles. La página (public/demos/losaguachiles/) manda
// el carrito aquí ANTES de abrir WhatsApp, para que el pedido quede en el panel
// /app/aguachiles aunque el cliente nunca le dé "enviar" al mensaje.
//
// Nunca confía en el cliente: precio y disponibilidad salen de store_products,
// y el día/franja se revalidan contra el horario en hora CDMX. Sin cobro en
// línea: se paga en efectivo o transferencia al entregar.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, REPLY_TO } from "@/lib/email";
import {
  AGUACHILES_CLIENT_ID, ENVIO_MXN, PAGOS, PAGO_LABEL,
  motivoFranjaInvalida, folio, telefono10, pesos, fechaLarga, ubicacionValida, ligaMapa,
} from "@/lib/storeAguachiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PICORES = ["Sin picante", "Poquito", "Normal", "Bien picoso"];

type Item = { product_id: string; qty: number; picor?: string };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  // Honeypot: un campo que la persona no ve. Si viene lleno, es un bot.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const nombre = String(body.nombre ?? "").trim().slice(0, 80);
  const tel = telefono10(String(body.telefono ?? ""));
  // Dirección por partes (calle, número, interior, colonia, C.P.). Se arma una sola
  // línea para shipping_address; el C.P. se guarda aparte para definir zonas después.
  // Si llega solo `direccion` (página vieja en caché), se acepta tal cual.
  const txt = (k: string, max: number) => String(body[k] ?? "").trim().slice(0, max);
  const calle = txt("calle", 120), numero = txt("numero", 20), interior = txt("interior", 30), colonia = txt("colonia", 80);
  const cp = String(body.cp ?? "").replace(/\D/g, "");
  const porPartes = !!(calle || numero || colonia || cp);
  const direccion = porPartes
    ? `${calle} ${numero}${interior ? ` int. ${interior}` : ""}, Col. ${colonia}, C.P. ${cp}`
    : txt("direccion", 300);
  const nota = String(body.nota ?? "").trim().slice(0, 300);
  const fecha = String(body.fecha ?? "");
  const franja = String(body.franja ?? "");
  const pago = String(body.pago ?? "");
  const items = body.items as Item[];
  // Pin del mapa: opcional (si el mapa no cargó en el navegador del cliente, llega sin él).
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;

  if (nombre.length < 2) return NextResponse.json({ error: "Escribe tu nombre" }, { status: 400 });
  if (tel.length !== 10) return NextResponse.json({ error: "El teléfono debe tener 10 dígitos" }, { status: 400 });
  if (porPartes) {
    if (calle.length < 3) return NextResponse.json({ error: "Escribe la calle" }, { status: 400 });
    if (!numero) return NextResponse.json({ error: "Escribe el número de la casa o edificio" }, { status: 400 });
    if (colonia.length < 3) return NextResponse.json({ error: "Escribe la colonia" }, { status: 400 });
    if (!/^\d{5}$/.test(cp)) return NextResponse.json({ error: "El código postal debe tener 5 dígitos" }, { status: 400 });
  } else if (direccion.length < 8) {
    return NextResponse.json({ error: "Escribe la dirección completa" }, { status: 400 });
  }
  if (!(PAGOS as readonly string[]).includes(pago))
    return NextResponse.json({ error: "Escoge cómo vas a pagar" }, { status: 400 });

  if ((lat != null || lng != null) && !ubicacionValida(lat, lng))
    return NextResponse.json({ error: "La ubicación del mapa quedó fuera de la Ciudad de México. Vuelve a poner el pin en tu casa." }, { status: 400 });

  const motivo = motivoFranjaInvalida(fecha, franja);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 400 });

  if (!Array.isArray(items) || items.length < 1 || items.length > 30)
    return NextResponse.json({ error: "Tu pedido está vacío" }, { status: 400 });

  // Instanciar dentro del handler: a nivel de módulo tumba `next build` sin env.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const ids = [...new Set(items.map((i) => String(i?.product_id ?? "")))];
  const { data: productos, error: prodErr } = await db
    .from("store_products")
    .select("id, name, price, active")
    .eq("client_id", AGUACHILES_CLIENT_ID)
    .in("id", ids);
  if (prodErr || !productos) {
    console.error("[aguachiles/order] productos:", prodErr);
    return NextResponse.json({ error: "No pudimos leer el menú. Intenta de nuevo." }, { status: 500 });
  }
  const porId = new Map(productos.filter((p) => p.active).map((p) => [p.id, p]));

  const partidas: {
    product_id: string; product_name: string; unit_price: number; qty: number;
    line_total: number; item_note: string | null;
  }[] = [];
  for (const it of items) {
    const p = porId.get(String(it?.product_id ?? ""));
    const qty = Math.floor(Number(it?.qty));
    if (!p) return NextResponse.json({ error: "Uno de tus platillos ya no está disponible hoy" }, { status: 400 });
    if (!qty || qty < 1 || qty > 20) return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
    const picor = typeof it.picor === "string" && PICORES.includes(it.picor) ? it.picor : null;
    const precio = Number(p.price);
    partidas.push({
      product_id: p.id, product_name: p.name, unit_price: precio, qty,
      line_total: precio * qty, item_note: picor ? `Picor: ${picor}` : null,
    });
  }
  const subtotal = partidas.reduce((s, i) => s + i.line_total, 0);
  const total = subtotal + ENVIO_MXN;

  const { data: pedido, error: pedErr } = await db
    .from("store_orders")
    .insert({
      client_id: AGUACHILES_CLIENT_ID,
      customer_name: nombre,
      customer_phone: tel,
      customer_email: null,
      shipping_address: direccion,
      subtotal,
      shipping_cost: ENVIO_MXN,
      total,
      payment_method: pago,
      payment_status: "pending",
      fulfillment_status: "nuevo",
      delivery_date: fecha,
      delivery_slot: franja,
      delivery_lat: lat,
      delivery_lng: lng,
      delivery_cp: porPartes ? cp : null,
      notes: nota || null,
    })
    .select("id, order_no")
    .single();
  if (pedErr || !pedido) {
    console.error("[aguachiles/order] insert pedido:", pedErr);
    return NextResponse.json({ error: "No pudimos guardar tu pedido. Intenta de nuevo." }, { status: 500 });
  }

  const { error: partErr } = await db
    .from("store_order_items")
    .insert(partidas.map((p) => ({ ...p, order_id: pedido.id })));
  if (partErr) {
    console.error("[aguachiles/order] insert partidas:", partErr);
    // Sin partidas el pedido no sirve en el panel: se borra para no dejar basura.
    const { error: delErr } = await db.from("store_orders").delete().eq("id", pedido.id);
    if (delErr) console.error("[aguachiles/order] rollback:", delErr);
    return NextResponse.json({ error: "No pudimos guardar tu pedido. Intenta de nuevo." }, { status: 500 });
  }

  const f = folio(pedido.order_no);

  // Aviso interno. No bloquea: si el correo falla, el pedido ya quedó guardado.
  const to = (process.env.AGUACHILES_ORDER_TO ?? REPLY_TO).split(",").map((s) => s.trim()).filter(Boolean);
  const filas = partidas
    .map((p) => `<tr><td style="padding:4px 0">${p.qty}x ${esc(p.product_name)}${p.item_note ? ` <span style="color:#6B7280">· ${esc(p.item_note)}</span>` : ""}</td><td style="text-align:right">${pesos(p.line_total)}</td></tr>`)
    .join("");
  void sendEmail({
    from: "aguachiles",
    to,
    subject: `Pedido ${f} · ${pesos(total)} · ${fechaLarga(fecha)} ${franja}`,
    tag: "aguachiles/order",
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#12203A">
      <h2 style="margin:0 0 4px;color:#E8207A">Pedido ${f}</h2>
      <p style="margin:0 0 14px"><b>Entrega:</b> ${esc(fechaLarga(fecha))}, ${esc(franja)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${filas}
        <tr><td style="padding:4px 0;color:#6B7280">Envío</td><td style="text-align:right">${pesos(ENVIO_MXN)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:800">Total</td><td style="text-align:right;font-weight:800">${pesos(total)}</td></tr></table>
      <p style="margin:14px 0 4px"><b>${esc(nombre)}</b> · <a href="https://wa.me/52${tel}">${tel}</a></p>
      <p style="margin:0 0 4px">${esc(direccion)} · <a href="${ligaMapa(lat, lng, direccion)}">${lat != null ? "Ver pin en Google Maps" : "Buscar en Google Maps"}</a></p>
      <p style="margin:0 0 4px">Pago: ${esc(PAGO_LABEL[pago])}</p>
      ${nota ? `<p style="margin:0 0 4px">Nota: ${esc(nota)}</p>` : ""}
      <p style="margin:18px 0 0"><a href="https://www.fishflow.mx/app/aguachiles/" style="background:#E8207A;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700">Ver en el panel</a></p>
    </div>`,
  });

  return NextResponse.json({ ok: true, folio: f, order_no: pedido.order_no, total });
}
