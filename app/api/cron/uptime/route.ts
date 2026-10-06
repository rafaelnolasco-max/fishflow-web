import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifySlack, withSlackAlert } from '@/lib/slack'

export const runtime = 'nodejs'
export const maxDuration = 60

// Monitoreo de sitios: cada 5 min (vercel.json) revisa que respondan y avisa a
// #alertas en Slack solo cuando un sitio CAE (2 fallas seguidas, para no
// avisar por un parpadeo) y cuando VUELVE. El estado vive en public.site_monitor.
//
// Para agregar un sitio: súmalo a SITIOS. No hace falta tocar la tabla.

const SITIOS = [
  'https://www.fishflow.mx',
  'https://cane-neurofeedback.com.mx',
  'https://studiojomay.com.mx',
  'https://mariocitalan.net',
]

const FALLAS_PARA_AVISAR = 2

async function revisar(url: string): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': 'FishFlow-Monitor/1.0 (+https://www.fishflow.mx)' },
      signal: AbortSignal.timeout(15000),
    })
    return { ok: res.status < 400, status: res.status, error: res.status < 400 ? null : `HTTP ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { ok: false, status: null, error: msg.slice(0, 300) }
  }
}

function duracion(desde: string): string {
  const min = Math.round((Date.now() - new Date(desde).getTime()) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: previos, error } = await db.from('site_monitor').select('*').in('url', SITIOS)
  if (error) {
    console.error('[cron/uptime] lectura', error)
    return NextResponse.json({ error: 'Error al consultar site_monitor' }, { status: 500 })
  }
  const estado = new Map((previos ?? []).map((r) => [r.url as string, r]))

  const resultados = await Promise.all(SITIOS.map(async (url) => ({ url, ...(await revisar(url)) })))
  const ahora = new Date().toISOString()

  for (const r of resultados) {
    const prev = estado.get(r.url)
    const estabaArriba = prev ? prev.is_up : true
    const fails = r.ok ? 0 : (prev?.fails ?? 0) + 1
    let isUp = estabaArriba
    let changedAt: string = prev?.changed_at ?? ahora

    if (estabaArriba && !r.ok && fails >= FALLAS_PARA_AVISAR) {
      isUp = false
      changedAt = ahora
      await notifySlack('alertas', {
        text: `:red_circle: Sitio caído: ${r.url.replace('https://', '')}`,
        body: `${r.error ?? 'sin respuesta'} · ${fails} revisiones seguidas fallando`,
        button: { label: 'Abrir sitio', url: r.url },
      })
    } else if (!estabaArriba && r.ok) {
      isUp = true
      await notifySlack('alertas', {
        text: `:large_green_circle: Sitio de vuelta: ${r.url.replace('https://', '')}`,
        body: `Estuvo caído ${duracion(prev!.changed_at)}.`,
      })
      changedAt = ahora
    }

    const { error: upErr } = await db.from('site_monitor').upsert({
      url: r.url,
      is_up: isUp,
      fails,
      last_status: r.status,
      last_error: r.error,
      changed_at: changedAt,
      checked_at: ahora,
    })
    if (upErr) console.error('[cron/uptime] upsert', r.url, upErr)
  }

  return NextResponse.json({ ok: true, resultados: resultados.map(({ url, ok, status }) => ({ url, ok, status })) })
}

export const GET = withSlackAlert('cron/uptime', handler)
