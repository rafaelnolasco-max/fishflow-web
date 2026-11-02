// Demo DIMEX: al regresar de Stripe, la tienda manda el session_id. Se consulta
// la sesión directo en Stripe (no se confía en el navegador) y, si está pagada,
// se manda el correo de "Pago confirmado" y el aviso a #demoenslack.
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { notifyDemoOrder, type DemoOrder } from '../notify'

export const runtime = 'nodejs'
const DONE = new Set<string>()

export async function POST(req: NextRequest) {
  const sk = [process.env.DIMEX_STRIPE_SECRET_KEY, process.env.STRIPE_TEST_SECRET_KEY, process.env.STRIPE_SECRET_KEY]
    .find((k) => k?.startsWith('sk_test_'))
  if (!sk) return NextResponse.json({ ok: false }, { status: 500 })
  let sid = ''
  try { sid = String((await req.json()).session_id ?? '') } catch {}
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sid)) return NextResponse.json({ ok: false, error: 'Sesión inválida' }, { status: 400 })

  const stripe = new Stripe(sk, { apiVersion: '2026-04-22.dahlia' })
  const s = await stripe.checkout.sessions.retrieve(sid)
  const m = s.metadata ?? {}
  if (!m.ref?.startsWith('DMX-')) return NextResponse.json({ ok: false }, { status: 404 })
  if (s.payment_status !== 'paid') return NextResponse.json({ ok: true, paid: false, ref: m.ref })
  if (DONE.has(sid)) return NextResponse.json({ ok: true, paid: true, ref: m.ref, duplicate: true })
  DONE.add(sid)

  const li = await stripe.checkout.sessions.listLineItems(sid, { limit: 100 })
  let factura: DemoOrder['factura'] = null
  try { factura = m.factura ? JSON.parse(m.factura) : null } catch {}
  const order: DemoOrder = {
    ref: m.ref,
    canal: m.canal === 'mayoreo' ? 'mayoreo' : 'menudeo',
    nombre: m.nombre,
    empresa: m.empresa || undefined,
    email: m.email || s.customer_details?.email || undefined,
    direccion: m.direccion,
    mapa: m.mapa || undefined,
    items: li.data.map((i) => ({
      title: i.description ?? 'Producto',
      quantity: i.quantity ?? 1,
      unit_price: (i.amount_total ?? 0) / 100 / (i.quantity ?? 1),
    })),
    total: (s.amount_total ?? 0) / 100,
    factura,
    pagoId: `Stripe ${s.payment_intent ?? sid}`.slice(0, 80),
  }
  await notifyDemoOrder(order, 'aprobado')
  return NextResponse.json({ ok: true, paid: true, ref: m.ref })
}
