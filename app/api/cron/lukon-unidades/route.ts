import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifySlack, slackEscape, withSlackAlert } from '@/lib/slack'

export const runtime = 'nodejs'

// Recorridos LUKON · aviso a #cli-lukon cuando una unidad deja de reportar y cuando vuelve.
//
// Una unidad estacionada sigue mandando un punto cada ~2 h, así que 24 h sin
// ningún dato casi siempre es GPS desconectado, sin corriente o manipulado.
// Solo cuenta en flotillas con descarga automática de RedGPS encendida (redgps-sync).
//
// La detección y el registro de lo ya avisado viven en Supabase:
//   telematica_unidades_silencio(24)            → unidades 'callada' / 'volvio'
//   telematica_unidades_silencio_marcar(...)     → guarda silent_alerted_at / silent_last_ts
// Un aviso por unidad al callarse y otro al volver, sin recordatorios.
// Todas las novedades de una corrida salen en un solo mensaje.
//
// Corre aquí y no en pg_cron porque el webhook de #cli-lukon (SLACK_WEBHOOK_LUKON)
// solo existe en Vercel. Cron de Vercel: "20 * * * *" (cada hora).

const HORAS = 24
const TZ = 'America/Mexico_City'
const PANEL = 'https://www.fishflow.mx/app/lukon'

interface Fila {
  vehicle_id: string
  estado: 'callada' | 'volvio'
  flotilla: string
  client_slug: string
  alias: string | null
  plate: string | null
  device_id: string
  last_ts: string | null
  silent_last_ts: string | null
  last_address: string | null
  last_batt_v: number | string | null
  last_ignition: boolean | null
}

const fecha = (d: string) =>
  new Date(d).toLocaleString('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

function hace(d: string): string {
  const h = (Date.now() - new Date(d).getTime()) / 3600_000
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} días`
}

function lecturaBateria(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return 'Batería: sin dato en su último reporte'
  const n = Number(v)
  if (n === 0) return 'Batería: su último reporte llegó *sin corriente del vehículo* (0 V), batería o GPS desconectado'
  if (n < 10.5) return `Batería: *muy baja* (${n.toFixed(1)} V), probablemente se descargó`
  if (n < 12) return `Batería: baja (${n.toFixed(1)} V)`
  return `Batería: normal (${n.toFixed(1)} V), puede ser el equipo GPS o falta de señal`
}

const nombre = (f: Fila) => `*${slackEscape(f.alias ?? f.device_id)}*${f.plate ? ` (${slackEscape(f.plate)})` : ''}`

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  const db = createClient(url, key)

  const { data, error } = await db.rpc('telematica_unidades_silencio', { p_horas: HORAS })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const filas = (data ?? []) as Fila[]
  if (!filas.length) return NextResponse.json({ ok: true, calladas: 0, volvieron: 0 })

  const calladas = filas.filter((f) => f.estado === 'callada')
  const volvieron = filas.filter((f) => f.estado === 'volvio')
  const partes: string[] = []

  if (calladas.length) {
    const porFlotilla = new Map<string, Fila[]>()
    for (const f of calladas) porFlotilla.set(f.flotilla, [...(porFlotilla.get(f.flotilla) ?? []), f])
    for (const [flotilla, fs] of porFlotilla) {
      partes.push(`*${slackEscape(flotilla)}*\n` + fs.map((f) => {
        const desde = f.last_ts ? `sin reportar desde el ${fecha(f.last_ts)} (${hace(f.last_ts)})` : 'nunca ha reportado'
        const donde = f.last_address ? `\n   Última ubicación: ${slackEscape(f.last_address)}` : ''
        return `• ${nombre(f)}: ${desde}.${donde}\n   ${lecturaBateria(f.last_batt_v)}.`
      }).join('\n'))
    }
  }

  if (volvieron.length) {
    partes.push(':white_check_mark: *Volvieron a reportar*\n' + volvieron.map((f) => {
      const callada = f.silent_last_ts && new Date(f.silent_last_ts).getTime() > 0
        ? `, después de ${hace(f.silent_last_ts)} sin datos`
        : ''
      return `• ${nombre(f)} · ${slackEscape(f.flotilla)}${callada}.`
    }).join('\n'))
  }

  const text = calladas.length
    ? `:electric_plug: ${calladas.length === 1 ? '1 unidad dejó' : `${calladas.length} unidades dejaron`} de reportar (${HORAS} h o más sin datos)`
      + (volvieron.length ? ` · ${volvieron.length} volvi${volvieron.length === 1 ? 'ó' : 'eron'}` : '')
    : `:white_check_mark: ${volvieron.length === 1 ? '1 unidad volvió' : `${volvieron.length} unidades volvieron`} a reportar`

  // Slack corta las secciones de más de 3,000 caracteres
  let body = partes.join('\n\n')
  if (body.length > 2900) body = body.slice(0, 2850).replace(/\n[^\n]*$/, '') + '\n…y más en el panel.'

  const enviado = await notifySlack('lukon', {
    text,
    body,
    button: { label: 'Abrir Recorridos', url: PANEL },
  })
  // Si Slack no recibió el aviso, no se marca: se reintenta en la siguiente corrida.
  if (!enviado) return NextResponse.json({ error: 'No se pudo avisar a #cli-lukon', pendientes: filas.length }, { status: 502 })

  const { error: mErr } = await db.rpc('telematica_unidades_silencio_marcar', {
    p_calladas: calladas.map((f) => f.vehicle_id),
    p_volvieron: volvieron.map((f) => f.vehicle_id),
  })
  if (mErr) return NextResponse.json({ error: `Aviso enviado pero no se registró: ${mErr.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, calladas: calladas.length, volvieron: volvieron.length })
}

export const GET = withSlackAlert('cron/lukon-unidades', handler)
