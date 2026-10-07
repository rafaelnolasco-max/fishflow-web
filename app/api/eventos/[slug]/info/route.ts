// GET /api/eventos/[slug]/info/ — datos públicos del evento: precios, cupo y coaches.
import { NextRequest, NextResponse } from 'next/server'
import { getEvent, sbAdmin, soldAndHeld, svcFor, mpToken } from '@/lib/eventos'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })

  const [{ sold, held }, { data: coaches }] = await Promise.all([
    soldAndHeld(ev),
    sbAdmin.from('evt_coaches').select('code, name').eq('event_id', ev.id).order('code'),
  ])
  const types = Object.fromEntries(
    Object.entries(ev.ticket_types).map(([k, t]) => [k, { ...t, svc: svcFor(t.price, ev) }])
  )
  return NextResponse.json(
    {
      name: ev.name,
      capacity: ev.capacity,
      max_per_order: ev.max_per_order,
      sold,
      left: Math.max(0, ev.capacity - sold - held),
      types,
      fee_pct: ev.fee_pct,
      fee_fix: ev.fee_fix,
      coach_pct: ev.coach_pct,
      installments: ev.installments,
      excluded_payment_types: ev.excluded_payment_types,
      last_chance: ev.last_chance_open,
      coaches: coaches ?? [],
      // La venta solo abre cuando el organizador conectó su Mercado Pago
      sales_open: ev.sales_open && !!mpToken(ev),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
