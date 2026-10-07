// POST /api/eventos/[slug]/checkout/
// Valida la compra contra la BD (precios, cupo, coach), crea la orden pendiente
// y una preferencia de Checkout Pro en la cuenta de Mercado Pago del organizador.
// Devuelve { redirect_url } para mandar al comprador a pagar.

import { NextRequest, NextResponse } from 'next/server'
import { Preference } from 'mercadopago'
import { APP_URL, getEvent, mpConfig, sbAdmin, soldAndHeld, svcFor } from '@/lib/eventos'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Solo regresamos a páginas nuestras. */
function safeReturn(raw: unknown, slug: string): string {
  try {
    const u = new URL(String(raw))
    const okHost = u.hostname === 'localhost' || u.hostname === 'fishflow.mx' || u.hostname.endsWith('.fishflow.mx')
    if (okHost && (u.protocol === 'https:' || u.hostname === 'localhost')) return u.origin + u.pathname
  } catch {}
  return `${APP_URL}/eventos/${slug}/`
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const ev = await getEvent(slug)
    if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 })
    const mp = mpConfig(ev)
    if (!ev.sales_open || !mp)
      return NextResponse.json({ error: 'La venta en línea abre muy pronto. Vuelve a intentarlo en unas horas.' }, { status: 503 })

    const b = await req.json().catch(() => ({}))
    const type = String(b.type ?? '')
    const tt = ev.ticket_types[type]
    const qty = Math.floor(Number(b.qty))
    const name = String(b.name ?? '').trim().slice(0, 120)
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 160)
    const phone = String(b.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20)
    const socio = String(b.socio ?? '').trim().slice(0, 40)
    const coachRaw = String(b.coach ?? '').trim().toUpperCase().slice(0, 20)
    const attendees: string[] = Array.isArray(b.attendees) ? b.attendees.map((x: unknown) => String(x ?? '').trim().slice(0, 120)) : []

    if (!tt) return NextResponse.json({ error: 'Tipo de boleto inválido' }, { status: 400 })
    if (!qty || qty < 1 || qty > ev.max_per_order) return NextResponse.json({ error: 'Cantidad inválida' }, { status: 400 })
    if (name.length < 3) return NextResponse.json({ error: 'Escribe tu nombre completo.' }, { status: 400 })
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Revisa tu correo: ahí te llega el boleto.' }, { status: 400 })
    if (phone.replace(/\D/g, '').length < 10) return NextResponse.json({ error: 'Escribe tu WhatsApp a 10 dígitos.' }, { status: 400 })
    if (type === 'ymca' && socio.length < 3) return NextResponse.json({ error: 'Escribe tu número de usuario YMCA.' }, { status: 400 })
    for (let i = 1; i < qty; i++)
      if (!attendees[i]) return NextResponse.json({ error: `Falta el nombre de la persona ${i + 1}.` }, { status: 400 })

    let coach: string | null = null
    if (coachRaw) {
      const { data: c } = await sbAdmin.from('evt_coaches').select('code').eq('event_id', ev.id).eq('code', coachRaw).maybeSingle()
      if (!c) return NextResponse.json({ error: 'El código de instructor no existe. Revísalo o déjalo vacío.' }, { status: 400 })
      coach = c.code
    }

    const { sold, held } = await soldAndHeld(ev)
    const left = ev.capacity - sold - held
    if (qty > left)
      return NextResponse.json({ error: left > 0 ? `Ya no hay lugares suficientes para ${qty} boletos. Prueba con menos.` : 'Boletos agotados.' }, { status: 409 })

    const svc = svcFor(tt.price, ev)
    const total = qty * (tt.price + svc)
    const atts = [name, ...attendees.slice(1, qty)]

    const { data: order, error: oErr } = await sbAdmin
      .from('evt_orders')
      .insert({
        event_id: ev.id,
        buyer_name: name,
        buyer_email: email,
        buyer_phone: phone,
        ticket_type: type,
        socio: type === 'ymca' ? socio : null,
        coach_code: coach,
        qty,
        unit_price: tt.price,
        unit_svc: svc,
        total,
        attendees: atts,
      })
      .select('id, token')
      .single()
    if (oErr || !order) {
      console.error('[eventos/checkout] insert:', oErr)
      return NextResponse.json({ error: 'No pudimos iniciar tu compra. Intenta de nuevo.' }, { status: 500 })
    }

    const back = `${safeReturn(b.return_url, slug)}?orden=${order.token}`
    const [first, ...rest] = name.split(' ')
    const pref = await new Preference(mp).create({
      body: {
        items: [
          { id: `${slug}-${type}`, title: `${ev.name} · ${tt.label}`, quantity: qty, unit_price: tt.price, currency_id: 'MXN', category_id: 'tickets' },
          // Sin cargo por servicio (precio todo incluido) no se manda la línea: MP rechaza montos en 0
          ...(svc > 0 ? [{ id: `${slug}-svc`, title: 'Cargo por servicio', quantity: qty, unit_price: svc, currency_id: 'MXN' }] : []),
        ],
        payer: { email, name: first, surname: rest.join(' ') || undefined },
        external_reference: order.id,
        notification_url: `${APP_URL}/api/eventos/${slug}/webhook/`,
        back_urls: { success: back, pending: back, failure: back },
        auto_return: 'approved',
        statement_descriptor: ev.name.slice(0, 22),
        payment_methods: {
          installments: Math.max(1, ev.installments),
          excluded_payment_types: ev.excluded_payment_types.map((id) => ({ id })),
        },
        metadata: { evento: slug, orden: order.id },
      },
    })
    await sbAdmin.from('evt_orders').update({ mp_preference_id: pref.id }).eq('id', order.id)

    return NextResponse.json({ redirect_url: pref.init_point, token: order.token })
  } catch (err) {
    console.error('[eventos/checkout] error:', err)
    return NextResponse.json({ error: 'No pudimos conectar con Mercado Pago. Intenta de nuevo.' }, { status: 500 })
  }
}
