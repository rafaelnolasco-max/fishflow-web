import { NextResponse } from 'next/server'
import { withSlackAlert } from '@/lib/slack'
import { sendEnlaceWeekly } from '@/lib/enlaceWhatsApp'

export const runtime = 'nodejs'
export const maxDuration = 60

// Enlace Integral · resumen semanal de prospectos por WhatsApp a Edna e Ivonne.
// Lunes 9:02 CDMX = cron de Vercel "2 15 * * 1" (15:02 UTC; CDMX sin horario de verano).
// Prospectos de la semana anterior (lun–dom) por campaña + cuántos siguen sin asignar.
// Plantilla `resumen_prospectos_semanal` (alta en /api/whatsapp/plantillas). Decisión de Rafa, 22-nov-2026.

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const r = await sendEnlaceWeekly()
  if (r.failed.length) throw new Error(`Resumen de Enlace sin enviar a: ${r.failed.join(', ')}`)
  return NextResponse.json({ ok: true, periodo: r.periodo, total: r.total, sinAsignar: r.sinAsignar, porCampana: r.porCampana, sent: r.sent })
}

export const GET = withSlackAlert('cron/enlace-resumen-semanal', handler)
