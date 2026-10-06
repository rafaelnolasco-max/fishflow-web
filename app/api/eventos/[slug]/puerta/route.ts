// POST /api/eventos/[slug]/puerta/ — validación en la entrada (PIN de puerta).
// Body: { pin, action: 'stats' } | { pin, action: 'scan', code, device? }
// La entrada se marca con un UPDATE condicionado (checked_in_at is null): si
// dos celulares escanean el mismo QR al mismo tiempo, solo uno gana.

import { NextRequest, NextResponse } from 'next/server'
import { getEvent, parseCode, pinOk, sbAdmin } from '@/lib/eventos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function stats(eventId: string) {
  const [{ count: sold }, { count: inside }, { data: recent }] = await Promise.all([
    sbAdmin.from('evt_tickets').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    sbAdmin.from('evt_tickets').select('id', { count: 'exact', head: true }).eq('event_id', eventId).not('checked_in_at', 'is', null),
    sbAdmin.from('evt_tickets').select('folio, attendee, checked_in_at').eq('event_id', eventId)
      .not('checked_in_at', 'is', null).order('checked_in_at', { ascending: false }).limit(6),
  ])
  return { sold: sold ?? 0, inside: inside ?? 0, recent: recent ?? [] }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
  const b = await req.json().catch(() => ({}))
  if (!pinOk(ev, 'door', b.pin)) return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 })

  if (b.action === 'stats') return NextResponse.json(await stats(ev.id))

  const { folio, sigOk } = parseCode(b.code)
  if (!folio || !sigOk) return NextResponse.json({ result: 'bad', folio, ...(await stats(ev.id)) })

  const now = new Date().toISOString()
  const { data: won } = await sbAdmin
    .from('evt_tickets')
    .update({ checked_in_at: now, checked_in_by: String(b.device ?? 'puerta').slice(0, 40) })
    .eq('event_id', ev.id).eq('folio', folio).is('checked_in_at', null)
    .select('folio, attendee, ticket_type, checked_in_at, order_id')

  const { data: t } = won?.length
    ? { data: won[0] }
    : await sbAdmin.from('evt_tickets').select('folio, attendee, ticket_type, checked_in_at, order_id')
        .eq('event_id', ev.id).eq('folio', folio).maybeSingle()

  if (!t) return NextResponse.json({ result: 'bad', folio, ...(await stats(ev.id)) })

  const { data: o } = await sbAdmin.from('evt_orders').select('socio, pay_method').eq('id', t.order_id).maybeSingle()
  return NextResponse.json({
    result: won?.length ? 'ok' : 'dup',
    folio: t.folio,
    attendee: t.attendee,
    type: t.ticket_type,
    type_label: ev.ticket_types[t.ticket_type]?.label ?? t.ticket_type,
    socio: o?.socio ?? null,
    pay_method: o?.pay_method ?? null,
    checked_in_at: t.checked_in_at,
    ...(await stats(ev.id)),
  })
}
