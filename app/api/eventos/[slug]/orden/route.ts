// GET /api/eventos/[slug]/orden/?t=<token>[&payment_id=<id>]
// Estado de una orden y sus boletos. Si la orden sigue pendiente y Checkout Pro
// regresó con payment_id, se consulta el pago en MP en ese momento (no esperamos
// al webhook). Lo que manda el navegador nunca se toma como prueba de pago.

import { NextRequest, NextResponse } from 'next/server'
import { getEvent, processPayment, publicTicket, sbAdmin, type EvtOrder, type EvtTicket } from '@/lib/eventos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })

  const t = req.nextUrl.searchParams.get('t') ?? ''
  if (!/^[a-f0-9]{32}$/.test(t)) return NextResponse.json({ error: 'Liga inválida' }, { status: 400 })

  const load = async () => {
    const { data } = await sbAdmin.from('evt_orders').select('*').eq('event_id', ev.id).eq('token', t).maybeSingle()
    return data as EvtOrder | null
  }
  let o = await load()
  if (!o) return NextResponse.json({ error: 'No encontramos esa compra' }, { status: 404 })

  const pid = req.nextUrl.searchParams.get('payment_id')
  if (o.status !== 'paid' && pid && /^\d{5,20}$/.test(pid)) {
    try { await processPayment(ev, pid) } catch (e) { console.error('[eventos/orden] processPayment:', e) }
    o = (await load())!
  }

  let tickets: EvtTicket[] = []
  if (o.status === 'paid') {
    const { data } = await sbAdmin.from('evt_tickets').select('*').eq('order_id', o.id).order('seq')
    tickets = (data ?? []) as EvtTicket[]
  }
  return NextResponse.json(
    {
      status: o.status,
      buyer: o.buyer_name,
      email: o.buyer_email,
      type: o.ticket_type,
      qty: o.qty,
      total: Number(o.total),
      tickets: tickets.map(publicTicket),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
