import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withSlackAlert } from '@/lib/slack'
import { REPLY_TO } from '@/lib/email'
import { LUKON_OPS_EMAIL } from '@/lib/installations'
import { sendWeeklyAll } from '@/lib/fleetWeekly'
import { sendWeeklyWhatsApp } from '@/lib/fleetWhatsApp'

export const runtime = 'nodejs'
export const maxDuration = 300

// Recorridos LUKON · resumen semanal de cada flotilla por correo, los lunes ~8:00 CDMX.
// Cron de Vercel "7 14 * * 1" (14:07 UTC). Un correo por flotilla con datos.
// Destinatarios por ahora: Alex (LUKON) y Rafa (decisión de Rafa, 19-nov-2026).
// Además, plantilla de WhatsApp a los contactos de telematica_wa_contacts.

const WEEKLY_TO = [LUKON_OPS_EMAIL, REPLY_TO]
const WEEKLY_LINK = 'https://www.fishflow.mx/app/lukon'

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const r = await sendWeeklyAll(db, { to: WEEKLY_TO, link: WEEKLY_LINK })
  // WhatsApp (línea FishFlow): plantilla a los contactos de cada flotilla.
  const wa = await sendWeeklyWhatsApp(db, r.reports)
  if (r.failed.length || wa.failed.length) {
    throw new Error(`Resumen semanal con fallas. Correo: ${r.failed.join(', ') || 'ok'} · WhatsApp: ${wa.failed.join(', ') || 'ok'}`)
  }
  return NextResponse.json({ ok: true, sent: r.sent, skipped: r.skipped, whatsapp: wa.sent })
}

export const GET = withSlackAlert('cron/lukon-resumen-semanal', handler)
