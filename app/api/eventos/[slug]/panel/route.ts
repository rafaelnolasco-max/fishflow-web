// POST /api/eventos/[slug]/panel/ — panel del organizador (PIN de panel).
// Body: { pin, action: 'data' } | { pin, action: 'coach', code, name }

import { NextRequest, NextResponse } from 'next/server'
import { getEvent, pinOk, sbAdmin } from '@/lib/eventos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  if (!pinOk(ev, 'panel', b.pin)) return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 })

  if (b.action === 'coach') {
    const code = String(b.code ?? '').toUpperCase()
    const name = String(b.name ?? '').trim().slice(0, 80)
    if (!name) return NextResponse.json({ error: 'Nombre vacío' }, { status: 400 })
    const { error } = await sbAdmin.from('evt_coaches').update({ name }).eq('event_id', ev.id).eq('code', code)
    if (error) return NextResponse.json({ error: 'No se guardó' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Última oportunidad: abre los lugares extra (una sola vez)
  if (b.action === 'last_chance') {
    if (ev.last_chance_open || ev.last_chance_extra <= 0) return NextResponse.json({ error: 'No hay lugares extra por abrir' }, { status: 400 })
    const { error } = await sbAdmin.from('evt_events').update({ last_chance_open: true }).eq('id', ev.id)
    if (error) return NextResponse.json({ error: 'No se guardó' }, { status: 500 })
    return NextResponse.json({ ok: true, capacity: ev.capacity + ev.last_chance_extra })
  }

  const [{ data: tickets }, { data: orders }, { data: coaches }] = await Promise.all([
    sbAdmin.from('evt_tickets').select('folio, attendee, ticket_type, price, svc, coach_code, checked_in_at, created_at, order_id')
      .eq('event_id', ev.id).order('seq'),
    sbAdmin.from('evt_orders').select('id, buyer_name, buyer_email, buyer_phone, socio, pay_method, qty, total, mp_fee, net_received, status, paid_at, created_at')
      .eq('event_id', ev.id).order('created_at'),
    sbAdmin.from('evt_coaches').select('code, name').eq('event_id', ev.id).order('code'),
  ])
  const byId = new Map((orders ?? []).map((o) => [o.id, o]))
  const rows = (tickets ?? []).map((t) => {
    const o = byId.get(t.order_id)
    return {
      folio: t.folio, attendee: t.attendee, type: t.ticket_type,
      price: Number(t.price), svc: Number(t.svc), coach: t.coach_code ?? '',
      checkedIn: t.checked_in_at, ts: o?.paid_at ?? t.created_at,
      buyer: o?.buyer_name ?? '', email: o?.buyer_email ?? '', phone: o?.buyer_phone ?? '',
      socio: o?.socio ?? '', pay: o?.pay_method ?? '',
      // Comisión real de MP prorrateada por boleto
      mpFee: o?.mp_fee != null ? Number(o.mp_fee) / Math.max(1, o.qty) : null,
    }
  })
  const pendientes = (orders ?? []).filter((o) => o.status === 'pending').length
  return NextResponse.json({ tickets: rows, coaches: coaches ?? [], pending_orders: pendientes, capacity: ev.capacity,
    base_capacity: ev.base_capacity, last_chance_extra: ev.last_chance_extra, last_chance_open: ev.last_chance_open,
    platform_fee: ev.platform_fee, coach_pct: ev.coach_pct,
    fixed_costs: ev.fixed_costs ?? [],
  })
}
