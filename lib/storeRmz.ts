// lib/storeRmz.ts
// Tienda B2C RMZ — constantes, correos transaccionales y confirmación de pago.
// Server-side only (usa service role + Resend).

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const RMZ_CLIENT_ID = '80a067ff-fce7-4642-97c1-ac7f56ff4ba1'

// CLABE de demo (dummy) — cambiar por la real de Antonio cuando contrate
export const RMZ_CLABE = '0121 8000 1234 5678 90'
export const RMZ_BANCO = 'BBVA'
export const RMZ_BENEFICIARIO = 'Cocinas y Closets RMZ'

export const RMZ_BRAND = {
  name: 'Cocinas y Closets RMZ',
  accent: '#C0923A',
  accentDark: '#9E7328',
  ink: '#241C16',
  cream: '#FAF7F2',
  tel: '55 1144 2279',
  deliveryDays: '5 a 7 días hábiles',
}

// Destinatarios del aviso de pedido: Rafa + Antonio (override con RMZ_ORDER_TO)
const NOTIFY_TO = (process.env.RMZ_ORDER_TO ?? 'raf@fishflow.mx,antoniorp8501@hotmail.com')
  .split(',').map((s) => s.trim()).filter(Boolean)

const FROM = 'Cocinas y Closets RMZ <recibos@fishflow.mx>'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type StoreOrder = {
  id: string
  order_no: number
  token: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  shipping_address: string
  subtotal: number
  shipping_cost: number
  total: number
  payment_method: 'stripe' | 'mercadopago' | 'transferencia'
  payment_status: 'pending' | 'paid' | 'failed' | 'cancelled'
  fulfillment_status: string
  invoice_requested: boolean
  invoice_data: Record<string, string> | null
  created_at: string
}

export type StoreOrderItem = {
  product_name: string
  color_name: string | null
  unit_price: number
  qty: number
  line_total: number
}

export const money = (n: number) => '$' + Number(n).toLocaleString('es-MX')
export const orderRef = (o: { order_no: number }) => `RMZ-${o.order_no}`

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'
}

// ─── Plantillas ───────────────────────────────────────────────────────────────

function itemsTable(items: StoreOrderItem[]) {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #EAE0D5">${esc(it.product_name)}${it.color_name ? ` <span style="color:#6E645C">· ${esc(it.color_name)}</span>` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EAE0D5;text-align:center">${it.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EAE0D5;text-align:right"><b>${money(it.line_total)}</b></td>
    </tr>`).join('')
  return `
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
    <tr style="color:#6E645C;font-size:12px;text-transform:uppercase;letter-spacing:.05em">
      <td style="padding-bottom:6px">Producto</td><td style="padding-bottom:6px;text-align:center">Cant.</td><td style="padding-bottom:6px;text-align:right">Importe</td>
    </tr>
    ${rows}
  </table>`
}

function shell(title: string, inner: string) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#241C16;background:#FAF7F2">
    <div style="background:#241C16;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#C0923A">Cocinas y Closets RMZ</div>
      <div style="font-size:21px;margin-top:6px;font-weight:800">${title}</div>
    </div>
    <div style="padding:22px 26px;border:1px solid #EAE0D5;border-top:none;background:#fff">
      ${inner}
      <p style="font-size:12px;color:#6E645C;margin-top:22px">Aviso automático de la tienda en línea · Hecho con FishFlow</p>
    </div>
  </div>`
}

const PAY_LABEL: Record<string, string> = {
  stripe: 'Tarjeta / OXXO',
  mercadopago: 'Mercado Pago',
  transferencia: 'Transferencia SPEI',
}

// ─── Envíos ───────────────────────────────────────────────────────────────────

/** Aviso de pedido nuevo a Rafa + Antonio (todos los métodos de pago). */
export async function notifyOwnersNewOrder(order: StoreOrder, items: StoreOrderItem[]) {
  if (!process.env.RESEND_API_KEY) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const pendingNote = order.payment_method === 'transferencia'
    ? `<div style="margin-top:16px;background:#FFF7E8;border:1px solid #EFD9A8;border-radius:10px;padding:12px 14px;font-size:13px;color:#8A6516">
         <b>Pago pendiente por transferencia.</b> Cuando veas el depósito en la cuenta, confírmalo en el
         <a href="${appUrl()}/app/rmz" style="color:#9E7328;font-weight:700">panel de pedidos</a> para avisarle al cliente.
       </div>`
    : `<div style="margin-top:16px;font-size:13px;color:#6E645C">Pago en proceso vía ${PAY_LABEL[order.payment_method]}. Se confirma automáticamente.</div>`

  const inner = `
    <p style="font-size:15px;margin:0 0 4px"><b>Pedido ${orderRef(order)}</b> · ${money(order.total)} · ${PAY_LABEL[order.payment_method]}</p>
    ${itemsTable(items)}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:14px">
      <tr><td style="padding:5px 0;color:#6E645C;width:130px">Cliente</td><td><b>${esc(order.customer_name)}</b></td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Teléfono</td><td><a href="https://wa.me/52${esc(order.customer_phone).replace(/\D/g, '')}" style="color:#9E7328;font-weight:600">${esc(order.customer_phone)}</a></td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Correo</td><td>${esc(order.customer_email) || '—'}</td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Entrega</td><td>${esc(order.shipping_address)}</td></tr>
    </table>
    ${pendingNote}
    <a href="${appUrl()}/app/rmz" style="display:inline-block;margin-top:18px;background:#C0923A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ver en el panel</a>`

  const { error } = await resend.emails.send({
    from: FROM,
    to: NOTIFY_TO,
    subject: `🛒 Nuevo pedido ${orderRef(order)} · ${money(order.total)} · ${esc(order.customer_name)}`,
    html: shell('Nuevo pedido en la tienda', inner),
  })
  if (error) console.error('[storeRmz] notifyOwnersNewOrder:', error)
}

/** Instrucciones de transferencia SPEI al cliente final. */
export async function emailCustomerTransfer(order: StoreOrder, items: StoreOrderItem[]) {
  if (!process.env.RESEND_API_KEY || !order.customer_email) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const inner = `
    <p style="font-size:15px">Hola ${esc(order.customer_name.split(' ')[0])}, recibimos tu pedido <b>${orderRef(order)}</b>. Para confirmarlo, realiza tu transferencia:</p>
    <div style="background:#FAF7F2;border:1px solid #EAE0D5;border-radius:12px;padding:16px 18px;font-size:14px">
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 14px 4px 0;color:#6E645C">Banco</td><td><b>${RMZ_BANCO}</b></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6E645C">Beneficiario</td><td><b>${RMZ_BENEFICIARIO}</b></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6E645C">CLABE</td><td><b style="font-size:16px;letter-spacing:.03em">${RMZ_CLABE}</b></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6E645C">Monto</td><td><b>${money(order.total)}</b></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6E645C">Referencia</td><td><b>${orderRef(order)}</b></td></tr>
      </table>
    </div>
    ${itemsTable(items)}
    <p style="font-size:14px;color:#6E645C;margin-top:14px">En cuanto confirmemos tu depósito, tu pedido pasa a fabricación y te avisamos por este medio. Entrega estimada: ${RMZ_BRAND.deliveryDays} después de la confirmación.</p>
    <a href="${appUrl()}/pedido/${order.token}" style="display:inline-block;margin-top:12px;background:#C0923A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ver mi pedido</a>`

  const { error } = await resend.emails.send({
    from: FROM,
    to: order.customer_email,
    subject: `Tu pedido ${orderRef(order)} — datos para tu transferencia`,
    html: shell('Recibimos tu pedido', inner),
  })
  if (error) console.error('[storeRmz] emailCustomerTransfer:', error)
}

/** Confirmación de pago al cliente final (webhook o depósito confirmado). */
export async function emailCustomerPaid(order: StoreOrder, items: StoreOrderItem[]) {
  if (!process.env.RESEND_API_KEY || !order.customer_email) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const inner = `
    <p style="font-size:15px">Hola ${esc(order.customer_name.split(' ')[0])}, tu pago del pedido <b>${orderRef(order)}</b> está confirmado. Ya está en fabricación. 🎉</p>
    ${itemsTable(items)}
    <table style="width:100%;font-size:14px;margin-top:10px"><tr><td style="color:#6E645C">Total pagado</td><td style="text-align:right;font-size:17px"><b>${money(order.total)}</b></td></tr></table>
    <p style="font-size:14px;color:#6E645C;margin-top:14px">Entrega estimada: ${RMZ_BRAND.deliveryDays}. Te contactamos al ${esc(order.customer_phone)} para coordinar. En tu orden de compra puedes solicitar factura.</p>
    <a href="${appUrl()}/pedido/${order.token}" style="display:inline-block;margin-top:12px;background:#C0923A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ver mi orden de compra</a>`

  const { error } = await resend.emails.send({
    from: FROM,
    to: order.customer_email,
    subject: `✅ Pago confirmado — pedido ${orderRef(order)} en fabricación`,
    html: shell('Pago confirmado', inner),
  })
  if (error) console.error('[storeRmz] emailCustomerPaid:', error)
}

/** Aviso de solicitud de factura a Rafa + Antonio. */
export async function notifyOwnersInvoiceRequest(order: StoreOrder) {
  if (!process.env.RESEND_API_KEY) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const d = order.invoice_data ?? {}
  const inner = `
    <p style="font-size:15px;margin:0 0 8px">El cliente del pedido <b>${orderRef(order)}</b> (${money(order.total)}) solicitó factura:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:5px 0;color:#6E645C;width:140px">RFC</td><td><b>${esc(d.rfc)}</b></td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Razón social</td><td><b>${esc(d.razon_social)}</b></td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">CP fiscal</td><td>${esc(d.cp) || '—'}</td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Uso CFDI</td><td>${esc(d.cfdi_use) || 'G03'}</td></tr>
      <tr><td style="padding:5px 0;color:#6E645C">Correo</td><td>${esc(d.email ?? order.customer_email) || '—'}</td></tr>
    </table>
    <a href="${appUrl()}/app/rmz" style="display:inline-block;margin-top:16px;background:#C0923A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ver en el panel</a>`

  const { error } = await resend.emails.send({
    from: FROM,
    to: NOTIFY_TO,
    subject: `🧾 Solicitud de factura — pedido ${orderRef(order)}`,
    html: shell('Solicitud de factura', inner),
  })
  if (error) console.error('[storeRmz] notifyOwnersInvoiceRequest:', error)
}

// ─── Confirmación de pago desde webhooks ─────────────────────────────────────

/**
 * Llamado por los webhooks de Stripe y Mercado Pago cuando una pos_transaction
 * pasa a 'paid'. Si la transacción pertenece a un pedido de tienda, marca el
 * pedido como pagado y envía la confirmación al cliente. Idempotente.
 */
export async function markStoreOrderPaidByTxn(txnId: string) {
  const { data: order, error } = await supabaseAdmin
    .from('store_orders')
    .select('*')
    .eq('pos_transaction_id', txnId)
    .maybeSingle()

  if (error) { console.error('[storeRmz] markStoreOrderPaidByTxn select:', error); return }
  if (!order || order.payment_status === 'paid') return

  const { error: upErr } = await supabaseAdmin
    .from('store_orders')
    .update({ payment_status: 'paid', fulfillment_status: order.fulfillment_status === 'nuevo' ? 'produccion' : order.fulfillment_status })
    .eq('id', order.id)
  if (upErr) { console.error('[storeRmz] markStoreOrderPaidByTxn update:', upErr); return }

  const { data: items } = await supabaseAdmin
    .from('store_order_items')
    .select('product_name, color_name, unit_price, qty, line_total')
    .eq('order_id', order.id)

  await emailCustomerPaid({ ...order, payment_status: 'paid' } as StoreOrder, (items ?? []) as StoreOrderItem[])
  console.log(`[storeRmz] pedido ${orderRef(order)} confirmado como pagado (txn ${txnId})`)
}
