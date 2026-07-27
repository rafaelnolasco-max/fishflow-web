// app/api/store/rmz/checkout/route.ts
// Checkout público de la tienda RMZ. Valida precios contra la BD (nunca confía
// en el cliente), crea el pedido + transacción y despacha según método de pago:
//   stripe        → Checkout Session (tarjeta + OXXO)
//   mercadopago   → Preference
//   transferencia → instrucciones SPEI por correo, pago pendiente
// Env opcionales para modo test sin tocar producción:
//   RMZ_STRIPE_SECRET_KEY, RMZ_MP_ACCESS_TOKEN

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'
import {
  RMZ_CLIENT_ID, RMZ_BRAND, orderRef,
  notifyOwnersNewOrder, emailCustomerTransfer,
  type StoreOrder, type StoreOrderItem,
} from '@/lib/storeRmz'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CartItem = { product_id: string; color_name?: string; color_hex?: string; qty: number }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      customer_name, customer_phone, customer_email, shipping_address,
      payment_method, items,
    } = body as {
      customer_name: string; customer_phone: string; customer_email: string
      shipping_address: string; payment_method: string; items: CartItem[]
    }

    // ── Validación ────────────────────────────────────────────────────────────
    if (!customer_name?.trim() || !customer_phone?.trim() || !shipping_address?.trim())
      return NextResponse.json({ error: 'Faltan datos de entrega' }, { status: 400 })
    if (!customer_email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer_email.trim()))
      return NextResponse.json({ error: 'Correo inválido' }, { status: 400 })
    if (!['stripe', 'mercadopago', 'transferencia'].includes(payment_method))
      return NextResponse.json({ error: 'Método de pago inválido' }, { status: 400 })
    // Mercado Pago apagado: sin las llaves de prueba RMZ_MP_* caería en el token
    // live de FishFlow y cobraría de verdad. Reactivar junto con MP_ENABLED en
    // app/tienda/rmz/StoreClient.tsx cuando existan RMZ_MP_ACCESS_TOKEN + RMZ_MP_WEBHOOK_SECRET.
    if (payment_method === 'mercadopago')
      return NextResponse.json(
        { error: 'Mercado Pago no está disponible por ahora. Usa tarjeta, OXXO o transferencia.' },
        { status: 400 }
      )
    if (!Array.isArray(items) || !items.length || items.length > 30)
      return NextResponse.json({ error: 'Carrito vacío' }, { status: 400 })

    // ── Precios desde la BD ───────────────────────────────────────────────────
    const ids = [...new Set(items.map((i) => i.product_id))]
    const { data: products, error: prodErr } = await supabaseAdmin
      .from('store_products')
      .select('id, name, price, active')
      .eq('client_id', RMZ_CLIENT_ID)
      .in('id', ids)
    if (prodErr || !products) {
      console.error('[rmz/checkout] products:', prodErr)
      return NextResponse.json({ error: 'Error al leer catálogo' }, { status: 500 })
    }
    const byId = new Map(products.filter((p) => p.active).map((p) => [p.id, p]))

    const orderItems: (StoreOrderItem & { product_id: string; color_hex: string | null })[] = []
    for (const it of items) {
      const p = byId.get(it.product_id)
      const qty = Math.floor(Number(it.qty))
      if (!p || !qty || qty < 1 || qty > 20)
        return NextResponse.json({ error: 'Producto no disponible' }, { status: 400 })
      orderItems.push({
        product_id: p.id,
        product_name: p.name,
        color_name: it.color_name?.slice(0, 40) ?? null,
        color_hex: it.color_hex?.slice(0, 9) ?? null,
        unit_price: Number(p.price),
        qty,
        line_total: Number(p.price) * qty,
      })
    }
    const subtotal = orderItems.reduce((s, i) => s + i.line_total, 0)
    const total = subtotal // envío se cotiza al confirmar

    // ── Crear pedido ──────────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('store_orders')
      .insert({
        client_id: RMZ_CLIENT_ID,
        customer_name: customer_name.trim().slice(0, 120),
        customer_phone: customer_phone.trim().slice(0, 30),
        customer_email: customer_email.trim().slice(0, 120),
        shipping_address: shipping_address.trim().slice(0, 400),
        subtotal, total,
        payment_method,
        payment_status: 'pending',
      })
      .select()
      .single()
    if (orderErr || !order) {
      console.error('[rmz/checkout] insert order:', orderErr)
      return NextResponse.json({ error: 'Error al crear pedido' }, { status: 500 })
    }

    const { error: itemsErr } = await supabaseAdmin
      .from('store_order_items')
      .insert(orderItems.map((i) => ({ ...i, order_id: order.id })))
    if (itemsErr) {
      console.error('[rmz/checkout] insert items:', itemsErr)
      return NextResponse.json({ error: 'Error al crear pedido' }, { status: 500 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'
    const orderUrl = `${appUrl}/pedido/${order.token}`
    const description = `Pedido ${orderRef(order)} · ${RMZ_BRAND.name}`

    // ── Transferencia SPEI ────────────────────────────────────────────────────
    if (payment_method === 'transferencia') {
      await Promise.all([
        notifyOwnersNewOrder(order as StoreOrder, orderItems),
        emailCustomerTransfer(order as StoreOrder, orderItems),
      ])
      return NextResponse.json({ order_url: orderUrl })
    }

    // ── Transacción para pasarelas (visible en hub de cobros /admin) ─────────
    const { data: txn, error: txnErr } = await supabaseAdmin
      .from('pos_transactions')
      .insert({
        client_id: RMZ_CLIENT_ID,
        provider: payment_method,
        amount: total,
        currency: 'MXN',
        status: 'pending',
        service: description,
        metadata: { store_order_id: order.id, order_ref: orderRef(order), customer_email },
      })
      .select()
      .single()
    if (txnErr || !txn) {
      console.error('[rmz/checkout] insert txn:', txnErr)
      return NextResponse.json({ error: 'Error al iniciar pago' }, { status: 500 })
    }
    const { error: linkErr } = await supabaseAdmin
      .from('store_orders').update({ pos_transaction_id: txn.id }).eq('id', order.id)
    if (linkErr) console.error('[rmz/checkout] link txn:', linkErr)

    // ── Stripe (tarjeta + OXXO) ───────────────────────────────────────────────
    if (payment_method === 'stripe') {
      const stripe = new Stripe(
        process.env.RMZ_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY!,
        { apiVersion: '2026-04-22.dahlia' }
      )
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card', 'oxxo'],
        payment_method_options: { oxxo: { expires_after_days: 3 } },
        mode: 'payment',
        line_items: orderItems.map((i) => ({
          price_data: {
            currency: 'mxn',
            product_data: { name: i.color_name ? `${i.product_name} · ${i.color_name}` : i.product_name },
            unit_amount: Math.round(i.unit_price * 100),
          },
          quantity: i.qty,
        })),
        customer_email,
        metadata: { transaction_id: txn.id, store_order_id: order.id, client_id: RMZ_CLIENT_ID },
        success_url: `${orderUrl}?pago=ok`,
        cancel_url: `${orderUrl}?pago=cancelado`,
      })
      await supabaseAdmin.from('pos_transactions')
        .update({ external_id: session.id })
        .eq('id', txn.id)
      await notifyOwnersNewOrder(order as StoreOrder, orderItems)
      return NextResponse.json({ redirect_url: session.url, order_url: orderUrl })
    }

    // ── Mercado Pago ──────────────────────────────────────────────────────────
    const mp = new MercadoPagoConfig({
      accessToken: process.env.RMZ_MP_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    const pref = await new Preference(mp).create({
      body: {
        items: orderItems.map((i) => ({
          id: i.product_id,
          title: i.color_name ? `${i.product_name} · ${i.color_name}` : i.product_name,
          quantity: i.qty,
          unit_price: i.unit_price,
          currency_id: 'MXN',
        })),
        payer: { email: customer_email },
        external_reference: txn.id,
        notification_url: `${appUrl}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${orderUrl}?pago=ok`,
          failure: `${orderUrl}?pago=error`,
          pending: `${orderUrl}?pago=pendiente`,
        },
        auto_return: 'approved',
      },
    })
    await supabaseAdmin.from('pos_transactions')
      .update({ external_id: pref.id })
      .eq('id', txn.id)
    await notifyOwnersNewOrder(order as StoreOrder, orderItems)
    return NextResponse.json({ redirect_url: pref.init_point, order_url: orderUrl })

  } catch (err: unknown) {
    console.error('[rmz/checkout] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
