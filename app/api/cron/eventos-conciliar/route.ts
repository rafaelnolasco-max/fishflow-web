import { NextResponse } from 'next/server'
import { getEvent, reconcileEvent, sbAdmin } from '@/lib/eventos'
import { notifySlack, withSlackAlert } from '@/lib/slack'

export const runtime = 'nodejs'
export const maxDuration = 60

// Conciliación de boletos con Mercado Pago: cada 10 min (vercel.json) revisa las
// órdenes pendientes/fallidas de las últimas 48 h y las pagadas sin correo, y
// las procesa con lo que diga MP. Red de seguridad para webhooks que no llegan
// (caso 22-oct-2026: pago 184614946909 aprobado sin aviso). Avisa a #alertas
// solo cuando corrige algo.

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { data: evs } = await sbAdmin.from('evt_events').select('slug').eq('sales_open', true)
  const resumen: Record<string, unknown> = {}
  for (const { slug } of evs ?? []) {
    const ev = await getEvent(slug)
    if (!ev) continue
    const r = await reconcileEvent(ev)
    resumen[slug] = r
    if (r.corregidas.length) {
      await notifySlack('alertas', {
        text: `Conciliación ${ev.name}: ${r.corregidas.length} orden(es) corregida(s) sin webhook`,
        body: r.corregidas.map((c) => `• ${c.comprador}: ${c.antes} → ${c.ahora} (pago ${c.pago})`).join('\n'),
      })
    }
  }
  return NextResponse.json({ ok: true, resumen })
}

export const GET = withSlackAlert('cron/eventos-conciliar', handler)
