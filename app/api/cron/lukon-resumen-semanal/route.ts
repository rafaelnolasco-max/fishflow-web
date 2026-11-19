import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withSlackAlert } from '@/lib/slack'
import { sendEmail, REPLY_TO } from '@/lib/email'
import { LUKON_ID, LUKON_OPS_EMAIL } from '@/lib/installations'
import { buildWeekly } from '@/lib/fleetWeekly'

export const runtime = 'nodejs'
export const maxDuration = 300

// Recorridos LUKON · resumen semanal de cada flotilla por correo, los lunes ~8:00 CDMX.
// Cron de Vercel "7 14 * * 1" (14:07 UTC). Un correo por flotilla con datos.
// Destinatarios por ahora: Alex (LUKON) y Rafa (decisión de Rafa, 19-nov-2026).
// Más adelante: al jefe de flotilla de cada cliente y por WhatsApp de LUKON.

const TO = [LUKON_OPS_EMAIL, REPLY_TO]
const PANEL = 'https://www.fishflow.mx/app/lukon'

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: fleets, error } = await db.from('clients').select('id, name').eq('parent_client_id', LUKON_ID).order('name')
  if (error) throw new Error(error.message)

  const sent: string[] = [], skipped: string[] = [], failed: string[] = []
  for (const f of fleets ?? []) {
    const r = await buildWeekly(db, f.id, { link: PANEL })
    if (!r || !r.hasData) { skipped.push(f.name); continue }
    const res = await sendEmail({ from: 'lukonReportes', to: TO, subject: r.subject, html: r.html, replyTo: REPLY_TO, tag: 'cron/lukon-resumen-semanal' })
    ;(res.ok ? sent : failed).push(f.name)
  }
  if (failed.length) throw new Error(`No se mandó el resumen de: ${failed.join(', ')}`)
  return NextResponse.json({ ok: true, sent, skipped })
}

export const GET = withSlackAlert('cron/lukon-resumen-semanal', handler)
