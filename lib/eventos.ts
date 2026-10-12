// lib/eventos.ts
// Módulo de venta de boletos para eventos (primer cliente: VIBRA MX · megaclase).
//
// Piezas:
//   - evt_events / evt_coaches / evt_orders / evt_tickets en Supabase (RLS sin
//     políticas: solo la service role, desde /api/eventos/[slug]/*).
//   - Cobro con Mercado Pago Checkout Pro en la cuenta DEL ORGANIZADOR: sus
//     llaves viven en env como MP_<mp_env>_ACCESS_TOKEN / MP_<mp_env>_WEBHOOK_SECRET.
//     No pasan por pos_transactions (ese hub es de FishFlow y factura solo).
//   - Cargo por servicio opcional (fee_pct/fee_fix): si es 0 el precio es todo
//     incluido y el organizador absorbe la comisión de MP (VIBRA MX, 7-oct-2026).
//   - platform_fee: lo que cobra FishFlow por boleto (solo se reporta en el panel).
//   - Última oportunidad: last_chance_extra lugares que el organizador abre desde
//     el panel; getEvent() ya devuelve `capacity` con ese extra sumado.
//   - Boleto = folio + QR firmado con HMAC. La puerta valida contra la BD y
//     marca la entrada de forma atómica (un QR, un acceso).

import { createHmac, createHash, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { sendEmail, REPLY_TO } from '@/lib/email'

export const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.fishflow.mx').replace(/\/$/, '')

export type TicketType = { label: string; short?: string; price: number }
export type EvtEvent = {
  id: string
  slug: string
  name: string
  capacity: number
  max_per_order: number
  ticket_types: Record<string, TicketType>
  fee_pct: number
  fee_fix: number
  coach_pct: number
  installments: number
  folio_prefix: string
  mp_env: string
  door_pin_hash: string | null
  panel_pin_hash: string | null
  notify_emails: string[]
  sales_open: boolean
  platform_fee: number
  excluded_payment_types: string[]
  last_chance_extra: number
  last_chance_open: boolean
  /** Costos fijos del organizador (artista, renta…) que el panel resta al final */
  fixed_costs: { label: string; amount: number }[]
  /** Cupo base, sin la última oportunidad */
  base_capacity: number
}
export type EvtOrder = {
  id: string
  event_id: string
  token: string
  buyer_name: string
  buyer_email: string
  buyer_phone: string | null
  ticket_type: string
  socio: string | null
  coach_code: string | null
  qty: number
  unit_price: number
  unit_svc: number
  total: number
  attendees: string[]
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
  mp_payment_id: string | null
  pay_method: string | null
  paid_at: string | null
  tickets_issued_at: string | null
  email_sent_at: string | null
  created_at: string
}
export type EvtTicket = {
  id: string
  order_id: string
  seq: number
  folio: string
  attendee: string
  ticket_type: string
  price: number
  svc: number
  coach_code: string | null
  checked_in_at: string | null
  checked_in_by: string | null
  created_at: string
}

// Datos fijos de cada evento que solo usa el correo (la página trae los suyos).
const EVENT_COPY: Record<string, { titulo: string; fecha: string; lugar: string; acceso: string; pagina: string; marca: 'vibramx' }> = {
  megaclase: {
    titulo: 'VIBRA MX con Mike Gavilán',
    fecha: 'Viernes 18 de diciembre de 2026 · 8:00 p. m.',
    lugar: 'YMCA Mallorca · C. Laboristas 49, Zacahuitzco, Iztapalapa, CDMX',
    acceso: 'Acceso desde las 7:00 p. m.',
    pagina: 'https://megaclase.fishflow.mx/',
    marca: 'vibramx',
  },
}

export async function getEvent(slug: string): Promise<EvtEvent | null> {
  const { data, error } = await sbAdmin.from('evt_events').select('*').eq('slug', slug).maybeSingle()
  if (error) console.error('[eventos] getEvent:', error)
  if (!data) return null
  const extra = data.last_chance_open ? Number(data.last_chance_extra ?? 0) : 0
  return {
    ...data,
    fee_pct: Number(data.fee_pct), fee_fix: Number(data.fee_fix), coach_pct: Number(data.coach_pct),
    platform_fee: Number(data.platform_fee ?? 0),
    excluded_payment_types: data.excluded_payment_types ?? [],
    last_chance_extra: Number(data.last_chance_extra ?? 0),
    base_capacity: data.capacity,
    capacity: data.capacity + extra,
  } as EvtEvent
}

/** Cargo por servicio: cubre la comisión de MP para que el organizador reciba `price` completo. */
export function svcFor(price: number, ev: Pick<EvtEvent, 'fee_pct' | 'fee_fix'>): number {
  if (!ev.fee_pct && !ev.fee_fix) return 0
  return Math.ceil((price + ev.fee_fix) / (1 - ev.fee_pct)) - price
}

// ── Mercado Pago del organizador ─────────────────────────────────────────────
export function mpToken(ev: EvtEvent): string | null {
  return process.env[`MP_${ev.mp_env}_ACCESS_TOKEN`] || null
}
export function mpWebhookSecret(ev: EvtEvent): string | null {
  return process.env[`MP_${ev.mp_env}_WEBHOOK_SECRET`] || null
}
export function mpConfig(ev: EvtEvent): MercadoPagoConfig | null {
  const t = mpToken(ev)
  return t ? new MercadoPagoConfig({ accessToken: t }) : null
}

// ── QR firmado ───────────────────────────────────────────────────────────────
function qrSecret(): string {
  return process.env.EVENTOS_QR_SECRET || `evt-qr:${process.env.SUPABASE_SERVICE_ROLE_KEY}`
}
export function qrSig(folio: string): string {
  return createHmac('sha256', qrSecret()).update(folio).digest('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase()
}
export function qrPayload(folio: string): string {
  return `EVT|${folio}|${qrSig(folio)}`
}
/** Acepta el texto del QR o un folio tecleado a mano. */
export function parseCode(raw: string): { folio: string; sigOk: boolean } {
  const s = String(raw || '').trim().toUpperCase()
  if (s.includes('|')) {
    const [, folio = '', sig = ''] = s.split('|')
    return { folio, sigOk: sig === qrSig(folio) }
  }
  return { folio: s, sigOk: true }
}

// ── PINs de puerta y panel ───────────────────────────────────────────────────
export function pinOk(ev: EvtEvent, kind: 'door' | 'panel', pin: unknown): boolean {
  const want = kind === 'door' ? ev.door_pin_hash : ev.panel_pin_hash
  if (!want || typeof pin !== 'string' || !pin.trim()) return false
  const got = createHash('sha256').update(pin.trim().toUpperCase()).digest('hex')
  const a = Buffer.from(got), b = Buffer.from(want)
  if (a.length !== b.length) return false
  const ok = timingSafeEqual(a, b)
  // El panel también acepta el PIN de panel en la puerta (organizadores)
  if (!ok && kind === 'door') return pinOk(ev, 'panel', pin)
  return ok
}

// ── Cupo ─────────────────────────────────────────────────────────────────────
/** Boletos emitidos + lugares apartados por órdenes pendientes recientes (20 min). */
export async function soldAndHeld(ev: EvtEvent): Promise<{ sold: number; held: number }> {
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const [{ count: sold }, { data: pend }] = await Promise.all([
    sbAdmin.from('evt_tickets').select('id', { count: 'exact', head: true }).eq('event_id', ev.id),
    sbAdmin.from('evt_orders').select('qty').eq('event_id', ev.id).eq('status', 'pending').gte('created_at', since),
  ])
  const held = (pend ?? []).reduce((a, o) => a + (o.qty as number), 0)
  return { sold: sold ?? 0, held }
}

// ── Procesar un pago (webhook o regreso de Checkout Pro) ─────────────────────
function mapStatus(s: string | undefined): EvtOrder['status'] {
  switch (s) {
    case 'approved': return 'paid'
    case 'rejected': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'refunded':
    case 'charged_back': return 'refunded'
    default: return 'pending'
  }
}

/**
 * Consulta el pago en Mercado Pago (cuenta del organizador) y actualiza la
 * orden. Si quedó aprobado: emite boletos (idempotente) y manda correos una
 * sola vez. Nunca confía en lo que diga el navegador: todo sale del API de MP.
 */
export async function processPayment(ev: EvtEvent, paymentId: string): Promise<{ ok: boolean; status?: string; reason?: string }> {
  const mp = mpConfig(ev)
  if (!mp) return { ok: false, reason: 'sin_token' }

  const pay = await new Payment(mp).get({ id: paymentId })
  const orderId = pay.external_reference
  if (!orderId) return { ok: false, reason: 'sin_external_reference' }

  const { data: order } = await sbAdmin.from('evt_orders').select('*').eq('id', orderId).eq('event_id', ev.id).maybeSingle()
  if (!order) return { ok: false, reason: 'orden_no_existe' }
  const o = order as EvtOrder

  let status = mapStatus(pay.status)
  // Monto: lo cobrado debe cubrir el total de la orden
  if (status === 'paid' && Number(pay.transaction_amount ?? 0) + 0.5 < Number(o.total)) {
    console.error(`[eventos] monto no cuadra: pago ${paymentId} ${pay.transaction_amount} vs orden ${o.total}`)
    return { ok: false, reason: 'monto_no_cuadra' }
  }
  // Un pago rechazado posterior no tumba una orden ya pagada (reintentos con otra tarjeta)
  if (o.status === 'paid' && status !== 'paid' && status !== 'refunded') status = 'paid'

  const fee = (pay.fee_details ?? []).reduce((a, f) => a + Number(f.amount ?? 0), 0)
  const upd: Record<string, unknown> = {
    status,
    mp_status_detail: pay.status_detail ?? null,
  }
  if (pay.status === 'approved' || o.status !== 'paid') {
    upd.mp_payment_id = String(paymentId)
    upd.pay_method = pay.payment_type_id ?? pay.payment_method_id ?? null
    upd.mp_fee = fee || null
    upd.net_received = pay.transaction_details?.net_received_amount ?? null
  }
  if (status === 'paid' && !o.paid_at) upd.paid_at = pay.date_approved ?? new Date().toISOString()

  const { error: uErr } = await sbAdmin.from('evt_orders').update(upd).eq('id', o.id)
  if (uErr) { console.error('[eventos] update orden:', uErr); return { ok: false, reason: 'db' } }

  if (status === 'paid') {
    const { data: tickets, error: tErr } = await sbAdmin.rpc('evt_issue_tickets', { p_order: o.id })
    if (tErr) { console.error('[eventos] issue tickets:', tErr); return { ok: false, reason: 'emitir' } }
    // Correo una sola vez: el que gana el update manda
    const { data: claim } = await sbAdmin
      .from('evt_orders').update({ email_sent_at: new Date().toISOString() })
      .eq('id', o.id).is('email_sent_at', null).select('id')
    if (claim?.length) {
      await sendTicketEmails(ev, { ...o, ...upd } as EvtOrder, (tickets ?? []) as EvtTicket[])
    }
  }
  return { ok: true, status }
}

// ── Correos ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')

export function orderUrl(ev: EvtEvent, o: Pick<EvtOrder, 'token'>): string {
  const base = EVENT_COPY[ev.slug]?.pagina ?? `${APP_URL}/eventos/${ev.slug}/`
  return `${base}?orden=${o.token}#boleto`
}

async function sendTicketEmails(ev: EvtEvent, o: EvtOrder, tickets: EvtTicket[]) {
  const copy = EVENT_COPY[ev.slug]
  const ui = emailUI(copy?.marca ?? 'vibramx')
  const url = orderUrl(ev, o)
  const tipo = ev.ticket_types[o.ticket_type]?.label ?? o.ticket_type
  const ymca = o.ticket_type === 'ymca'

  const qrs = tickets.map((t) => {
    const src = `${APP_URL}/api/eventos/${ev.slug}/qr/?f=${encodeURIComponent(t.folio)}&s=${qrSig(t.folio)}`
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid #E7E2EC;border-radius:12px">
      <tr>
        <td style="padding:14px 16px;vertical-align:middle;font-family:Inter,Arial,sans-serif">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6B6475">Asistente</div>
          <div style="font-size:16px;font-weight:600;color:#16121E;padding:2px 0 8px">${escHtml(t.attendee)}</div>
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6B6475">Folio</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#FF4D2E">${escHtml(t.folio)}</div>
        </td>
        <td width="150" style="width:150px;padding:10px;text-align:right">
          <img src="${src}" width="140" height="140" alt="QR ${escHtml(t.folio)}" style="display:inline-block;border:0">
        </td>
      </tr>
    </table>`
  }).join('')

  const cuerpo =
    ui.p(`Hola ${escHtml(o.buyer_name.split(' ')[0])}, tu pago quedó confirmado. Aquí ${tickets.length > 1 ? `están tus ${tickets.length} boletos` : 'está tu boleto'}: cada QR es para una persona y se usa una sola vez.`) +
    ui.tabla([
      ['Evento', copy?.titulo ?? ev.name],
      ['Fecha', copy?.fecha ?? ''],
      ['Lugar', copy?.lugar ?? ''],
      ['Boleto', `${tickets.length} × ${tipo}`],
      ['Total pagado', fmt(Number(o.total))],
    ]) +
    ui.rotulo('Tus boletos') + qrs +
    (ymca ? ui.bloque(ui.p('<strong>Precio de usuario YMCA:</strong> en la entrada te pedimos tu credencial YMCA vigente junto con tu QR.'), 'aviso') : '') +
    ui.botones([{ texto: 'Ver mis boletos', href: url }]) +
    ui.p(`${escHtml(copy?.acceso ?? '')}. Lleva el QR en tu celular o impreso.`)

  const html = ui.layout({
    audiencia: 'externo',
    preheader: `Tus boletos: ${tickets.map((t) => t.folio).join(', ')}`,
    etiqueta: 'Pago confirmado',
    titulo: tickets.length > 1 ? 'Tus boletos están listos' : 'Tu boleto está listo',
    subtitulo: copy?.titulo,
    cuerpo,
    nota: 'Si no ves los QR, toca "Ver mis boletos": ahí están siempre disponibles.',
  })

  await sendEmail({
    from: 'vibramx',
    to: o.buyer_email,
    subject: `Tu boleto para ${ev.name} · ${tickets.map((t) => t.folio).join(', ')}`,
    html,
    replyTo: REPLY_TO,
    tag: `eventos/${ev.slug}`,
  })

  // Aviso interno al organizador / Rafa
  if (ev.notify_emails?.length) {
    const coach = o.coach_code ? ` · coach ${o.coach_code}` : ''
    const htmlInt = ui.layout({
      audiencia: 'interno',
      preheader: `${tickets.length} boleto(s) · ${fmt(Number(o.total))}${coach}`,
      etiqueta: 'Venta nueva',
      titulo: `${tickets.length} × ${tipo}`,
      cuerpo: ui.tabla([
        ['Comprador', o.buyer_name],
        ['Correo', o.buyer_email],
        ['WhatsApp', o.buyer_phone],
        ['Folios', tickets.map((t) => t.folio).join(', ')],
        ['Coach', o.coach_code],
        ['Forma de pago', o.pay_method],
        ['Total cobrado', fmt(Number(o.total))],
      ]),
    })
    await sendEmail({
      from: 'vibramx',
      to: ev.notify_emails,
      subject: `Venta ${ev.name}: ${tickets.length} boleto(s) · ${fmt(Number(o.total))}${coach}`,
      html: htmlInt,
      tag: `eventos/${ev.slug}/aviso`,
    })
  }
}

/** Boletos de una orden con su QR, para la página "Mis boletos". */
export function publicTicket(t: EvtTicket) {
  return {
    folio: t.folio,
    attendee: t.attendee,
    type: t.ticket_type,
    qr: qrPayload(t.folio),
    checked_in_at: t.checked_in_at,
  }
}
