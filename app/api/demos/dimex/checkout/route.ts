// Demo DIMEX (prospecto Elizabeth): crea una preferencia de Checkout Pro de Mercado Pago.
// Siempre en MODO PRUEBA: se devuelve sandbox_init_point, nunca se cobra dinero real.
// Token: DIMEX_MP_ACCESS_TOKEN (TEST-...) o, si no existe, MERCADOPAGO_TEST_ACCESS_TOKEN / MERCADOPAGO_ACCESS_TOKEN.
import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import PRICES from './prices.json'
import { notifyDemoOrder, type DemoOrder } from '../notify'

export const runtime = 'nodejs'

type Item = { id: string; opt?: string | null; qty: number }
type Fiscal = { rfc?: string; razon?: string; cpf?: string; regimen?: string; uso?: string }
type Price = { n: string; p: number; c: string; i: string }
const CATALOG = PRICES as Record<string, Price>
const SHIP_FREE = 500
const SHIP = 149
const BASE = 'https://www.fishflow.mx/demos/dimex/index.html'
const MAY_MIN = 3000
// Mismas reglas que la tienda: descuento por volumen solo en modo mayoreo
const tiersFor = (price: number): [number, number][] =>
  price >= 1500 ? [[3, 0.08], [10, 0.15], [30, 0.22]] : [[6, 0.1], [24, 0.18], [100, 0.25]]
function unitPrice(price: number, qty: number, mayoreo: boolean) {
  if (!mayoreo) return price
  let d = 0
  for (const [m, x] of tiersFor(price)) if (qty >= m) d = x
  return Math.round(price * (1 - d))
}
// Freno simple para que nadie use el demo para mandar correos en masa
const SENT = new Map<string, number[]>()
function allowEmail(ip: string) {
  const now = Date.now()
  const list = (SENT.get(ip) ?? []).filter((t) => now - t < 10 * 60_000)
  if (list.length >= 5) return false
  list.push(now)
  SENT.set(ip, list)
  return true
}
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

export async function POST(req: NextRequest) {
  const token =
    process.env.DIMEX_MP_ACCESS_TOKEN ??
    process.env.MERCADOPAGO_TEST_ACCESS_TOKEN ??
    process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Falta configurar Mercado Pago' }, { status: 500 })

  let body: { items?: Item[]; buyer?: Record<string, string>; mode?: string; invoice?: Fiscal | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }
  const buyer = body.buyer ?? {}
  const mayoreo = body.mode === 'mayoreo'
  const inv = body.invoice
  if (inv && !RFC_RE.test(String(inv.rfc ?? '').toUpperCase()))
    return NextResponse.json({ error: 'RFC inválido' }, { status: 400 })

  // Precios siempre desde el catálogo del servidor
  const items = (body.items ?? [])
    .filter((i) => CATALOG[i.id] && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 99)
    .map((i) => {
      const p = CATALOG[i.id]
      return {
        id: i.id,
        title: (p.n + (i.opt ? ' — ' + String(i.opt).slice(0, 60) : '') + (mayoreo ? ' (mayoreo)' : '')).slice(0, 250),
        quantity: i.qty,
        unit_price: unitPrice(p.p, i.qty, mayoreo),
        currency_id: 'MXN',
        category_id: p.c,
        ...(p.i.startsWith('http') ? { picture_url: p.i } : {}),
      }
    })
  if (!items.length) return NextResponse.json({ error: 'El carrito está vacío' }, { status: 400 })

  const subtotal = items.reduce((s, l) => s + l.unit_price * l.quantity, 0)
  if (mayoreo && subtotal < MAY_MIN)
    return NextResponse.json({ error: 'El pedido mínimo de mayoreo es de $3,000' }, { status: 400 })
  if (subtotal < (mayoreo ? MAY_MIN : SHIP_FREE))
    items.push({ id: 'envio', title: 'Envío', quantity: 1, unit_price: SHIP, currency_id: 'MXN', category_id: 'envio' })

  const ref = 'DMX-' + Date.now().toString(36).toUpperCase()
  const factura = inv
    ? { rfc: String(inv.rfc).toUpperCase().slice(0, 13), razon: inv.razon?.slice(0, 200), cp: inv.cpf?.slice(0, 5), regimen: inv.regimen, uso: inv.uso }
    : null
  const order: DemoOrder = {
    ref,
    canal: mayoreo ? 'mayoreo' : 'menudeo',
    nombre: buyer.name?.slice(0, 80),
    empresa: buyer.company?.slice(0, 120),
    email: buyer.email?.slice(0, 120),
    telefono: buyer.phone?.slice(0, 20),
    direccion: [buyer.street, buyer.zip, buyer.city].filter(Boolean).join(', ').slice(0, 200),
    items: items.map((i) => ({ title: i.title, quantity: i.quantity, unit_price: i.unit_price })),
    total: items.reduce((s, l) => s + l.unit_price * l.quantity, 0),
    factura,
  }
  try {
    const pref = await new Preference(new MercadoPagoConfig({ accessToken: token })).create({
      body: {
        items,
        payer: {
          name: buyer.name?.slice(0, 80),
          email: buyer.email?.slice(0, 120),
          phone: buyer.phone ? { number: buyer.phone.slice(0, 20) } : undefined,
          address: { zip_code: buyer.zip?.slice(0, 10), street_name: buyer.street?.slice(0, 120) },
        },
        back_urls: {
          success: BASE + '?status=approved',
          pending: BASE + '?status=pending',
          failure: BASE + '?status=failure',
        },
        auto_return: 'approved',
        external_reference: ref,
        statement_descriptor: 'DIMEX DEMO',
        notification_url: 'https://www.fishflow.mx/api/demos/dimex/webhook/',
        payment_methods: { installments: 6 },
        metadata: {
          canal: mayoreo ? 'mayoreo' : 'menudeo',
          ref,
          empresa: order.empresa,
          nombre: order.nombre,
          email: order.email,
          telefono: order.telefono,
          direccion: order.direccion,
          factura,
        },
      },
    })
    // Pedido recibido: correo al comprador + aviso a #demoenslack
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'anon'
    if (allowEmail(ip)) await notifyDemoOrder(order, 'recibido')
    return NextResponse.json({ url: pref.sandbox_init_point ?? pref.init_point, ref, id: pref.id })
  } catch (e) {
    console.error('[demos/dimex/checkout]', e)
    return NextResponse.json({ error: 'Mercado Pago rechazó la solicitud' }, { status: 502 })
  }
}
