import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'
import { withSlackAlert, notifySlack, slackEscape } from '@/lib/slack'

export const runtime = 'nodejs'

// Resumen diario de capturas de Enlace Integral Seguros.
//
// Antes cada contacto capturado disparaba su propio correo: las vendedoras llenan
// el formulario cliente por cliente, así que llegaron 89 avisos el 16-jul y 81 el
// 17-jul. Ahora sale un solo resumen al final del día con el conteo por vendedora.
// Desde el 12-oct-2026 va a Slack (#cli-enlace), ya no al correo de Rafa.
//
// Lo dispara el cron de Vercel (ver vercel.json) a las 02:00 UTC = 20:00 CDMX.
// Si no hubo capturas, no manda nada.

const TZ = 'America/Mexico_City'

type Row = {
  vendor_name: string | null
  client_name: string | null
  email: string | null
  phone: string | null
  created_at: string
}

async function handler(req: Request) {
  // El cron de Vercel manda el header Authorization con CRON_SECRET.
  // Si la variable existe, se exige; así el endpoint no queda abierto.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[cron/enlace-digest] Falta SUPABASE_URL o SERVICE_ROLE_KEY')
    return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Ventana: últimas 24 horas
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('insurance_vendor_top_clients')
    .select('vendor_name, client_name, email, phone, created_at')
    .eq('client_id', ENLACE_CLIENT_ID)
    .gte('created_at', desde)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[cron/enlace-digest] Supabase error:', error)
    return NextResponse.json({ error: 'Error al consultar' }, { status: 500 })
  }

  const rows = (data as Row[]) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: false, note: 'sin capturas en las últimas 24 h' })
  }

  // Conteo por vendedora
  const porVendedora = new Map<string, number>()
  for (const r of rows) {
    const v = (r.vendor_name || 'Sin asignar').trim()
    porVendedora.set(v, (porVendedora.get(v) ?? 0) + 1)
  }
  const ranking = [...porVendedora.entries()].sort((a, b) => b[1] - a[1])

  // Total acumulado, para dar contexto de avance
  const { count: total } = await supabase
    .from('insurance_vendor_top_clients')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', ENLACE_CLIENT_ID)

  const fecha = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })

  const ok = await notifySlack('enlace', {
    text: `Enlace — ${rows.length} contactos capturados hoy`,
    body:
      `_${fecha.charAt(0).toUpperCase() + fecha.slice(1)}_\n` +
      ranking.map(([v, n]) => `• ${slackEscape(v)}: *${n}*`).join('\n') +
      `\nBase total acumulada: *${total ?? '—'}* contactos.`,
    button: { label: 'Ver el panel', url: 'https://www.fishflow.mx/app/enlace' },
  })
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'No se pudo avisar a Slack' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: true, capturas: rows.length, vendedoras: ranking.length })
}

export const GET = withSlackAlert('cron/enlace-digest', handler)
