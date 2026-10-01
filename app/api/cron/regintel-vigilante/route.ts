import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { escHtml } from '@/lib/emailLayout'

export const runtime = 'nodejs'

// Vigilante externo del monitor normativo de /app/regintel.
//
// El monitor (Edge Function regintel-normativo + pg_cron en Supabase) avisa
// solo cuando una fuente falla. Si el que no corre es el propio monitor
// (pg_cron detenido, función caída, Supabase con problemas) no puede avisar de
// sí mismo: este cron vive en Vercel, otro sistema, y lo vigila desde fuera.
//
// Regla: debe existir una corrida TERMINADA desde la última programada
// (lun–vie 21:15 CDMX). Si no, correo a Rafa. Se repite cada mañana hasta que
// se resuelva.
//
// Cron de Vercel: "30 15 * * 1-5" = 09:30 CDMX.

const REGINTEL_CLIENT_ID = 'c2b2a692-7f39-42a1-841a-5ae31e21e851'
const TO = 'raf@fishflow.mx'
const TZ = 'America/Mexico_City'

/** Última corrida programada (lun–vie 21:15 CDMX = 03:15 UTC del día siguiente) antes de `ahora`. */
function ultimaCorridaProgramada(ahora: Date): Date {
  for (let i = 0; i < 8; i++) {
    const c = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() - i, 3, 15))
    const diaCdmx = new Date(c.getTime() - 6 * 3600_000).getUTCDay()
    if (c <= ahora && diaCdmx >= 1 && diaCdmx <= 5) return c
  }
  throw new Error('sin corrida programada en 8 días')
}

const hora = (d: string | Date) => new Date(d).toLocaleString('es-MX', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  const db = createClient(url, key)

  const programada = ultimaCorridaProgramada(new Date())
  const desde = new Date(programada.getTime() - 10 * 60_000).toISOString() // margen por reloj

  const [{ data: terminadas, error }, { data: ultima }, { data: fuentes }] = await Promise.all([
    db.from('regintel_norm_corridas').select('id').eq('client_id', REGINTEL_CLIENT_ID)
      .gte('inicio', desde).not('fin', 'is', null).limit(1),
    db.from('regintel_norm_corridas').select('inicio, fin, disparo').eq('client_id', REGINTEL_CLIENT_ID)
      .order('inicio', { ascending: false }).limit(1),
    db.from('regintel_norm_fuentes').select('nombre, last_checked, consecutive_failures, last_check_error')
      .eq('client_id', REGINTEL_CLIENT_ID).eq('activo', true),
  ])

  // Si ni siquiera se puede consultar la base, eso también es una falla que hay que saber.
  const sinBase = !!error
  const corrio = !sinBase && (terminadas?.length ?? 0) > 0
  if (corrio) return NextResponse.json({ ok: true, corrio: true, programada: programada.toISOString() })

  const u = ultima?.[0]
  const causa = sinBase
    ? `No se pudo consultar la base de datos de Supabase (${escHtml(error!.message)}).`
    : !u
      ? 'No hay ninguna corrida registrada.'
      : !u.fin
        ? `La última corrida empezó el ${hora(u.inicio)} y nunca terminó (se quedó a medias).`
        : `La última corrida terminada fue el ${hora(u.inicio)}; la programada del ${hora(programada)} no corrió.`

  const filas = (fuentes ?? []).map((f) =>
    `<li>${escHtml(f.nombre)} — última lectura buena: ${f.last_checked ? hora(f.last_checked) : 'nunca'}${f.consecutive_failures ? ` · ${f.consecutive_failures} falla(s): ${escHtml(f.last_check_error ?? '')}` : ''}</li>`).join('')

  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#152430;line-height:1.5">
    <p>Aviso técnico del vigilante externo (solo para ti; Yaz no lo recibe).</p>
    <p><b>El monitor normativo de Inteligencia Regulatoria no corrió.</b> ${causa}</p>
    <p>Mientras no corra, DOF, COFEPRIS y ARCSA no se están revisando. Qué revisar, en orden:</p>
    <ol>
      <li>Supabase → Integrations → Cron: que el job <code>regintel-normativo-diario</code> esté activo.</li>
      <li>Supabase → Edge Functions → <code>regintel-normativo</code> → Logs: errores de la última corrida.</li>
      <li>En el panel, pestaña Normativo → "Revisar ahora" para correrlo a mano.</li>
    </ol>
    ${filas ? `<p>Estado de las fuentes:</p><ul>${filas}</ul>` : ''}
    <p><a href="https://www.fishflow.mx/app/regintel/">Abrir el panel</a></p></div>`

  const r = await sendEmail({
    from: 'fishflowNoreply',
    to: TO,
    subject: 'Alerta técnica · El monitor normativo de RegIntel no corrió',
    html,
    tag: 'cron/regintel-vigilante',
  })
  return NextResponse.json({ ok: r.ok, corrio: false, causa, programada: programada.toISOString() }, { status: 200 })
}
