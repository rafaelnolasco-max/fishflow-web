// Demo DIMEX: webhook de Mercado Pago. Cuando un pago cambia de estado,
// se consulta el pago real en la API de Mercado Pago (así nadie puede fingir
// un pago llamando a esta ruta) y se avisa al comprador y a #demoenslack.
import { NextRequest, NextResponse } from 'next/server'
import { notifyDemoOrder, type DemoOrder } from '../notify'

export const runtime = 'nodejs'

// Mercado Pago a veces repite la notificación; evita avisos dobles en la misma instancia
const SEEN = new Set<string>()

type MpPayment = {
  id: number
  status: string
  external_reference?: string
  transaction_amount?: number
  metadata?: Record<string, unknown>
  payer?: { email?: string }
  additional_info?: { items?: { title: string; quantity: string | number; unit_price: string | number }[] }
}

export async function POST(req: NextRequest) {
  const token =
    process.env.DIMEX_MP_ACCESS_TOKEN ?? process.env.MERCADOPAGO_TEST_ACCESS_TOKEN ?? process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) return NextResponse.json({ ok: false }, { status: 200 })

  const url = new URL(req.url)
  let body: { type?: string; topic?: string; data?: { id?: string | number } } = {}
  try { body = await req.json() } catch {}
  const type = body.type ?? body.topic ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
  const id = String(body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '')
  if (type !== 'payment' || !/^\d+$/.test(id)) return NextResponse.json({ ok: true, ignored: true })

  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) return NextResponse.json({ ok: true, ignored: 'payment_not_found' })
  const p = (await r.json()) as MpPayment
  if (!p.external_reference?.startsWith('DMX-')) return NextResponse.json({ ok: true, ignored: 'not_dimex' })

  const stage = p.status === 'approved' ? 'aprobado' : p.status === 'pending' || p.status === 'in_process' ? 'pendiente' : null
  if (!stage) return NextResponse.json({ ok: true, status: p.status })
  const key = `${p.id}:${stage}`
  if (SEEN.has(key)) return NextResponse.json({ ok: true, duplicate: true })
  SEEN.add(key)

  type Meta = { canal?: string; nombre?: string; empresa?: string; email?: string; direccion?: string; factura?: DemoOrder['factura'] }
  const m = (p.metadata ?? {}) as Meta
  const items = (p.additional_info?.items ?? []).map((i) => ({
    title: String(i.title),
    quantity: Number(i.quantity),
    unit_price: Number(i.unit_price),
  }))
  const order: DemoOrder = {
    ref: p.external_reference,
    canal: m.canal === 'mayoreo' ? 'mayoreo' : 'menudeo',
    nombre: m.nombre,
    empresa: m.empresa,
    email: m.email || p.payer?.email,
    direccion: m.direccion,
    items,
    total: p.transaction_amount ?? items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
    factura: m.factura?.rfc ? m.factura : null,
    pagoId: String(p.id),
  }
  await notifyDemoOrder(order, stage)
  return NextResponse.json({ ok: true, stage })
}
