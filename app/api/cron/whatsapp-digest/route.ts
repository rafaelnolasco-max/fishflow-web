import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { escHtml } from '@/lib/emailLayout'

export const runtime = 'nodejs'

// Resumen diario de la línea WhatsApp de FishFlow (lun–vie 9:00 CDMX).
//
// El webhook solo manda correo cuando empieza una conversación nueva; todo lo
// demás (seguimientos, respuestas de reseñas) se junta aquí:
//   1. Conversaciones sin responder (el último mensaje es del cliente).
//   2. 🔥 Contactos con intención de compra desde el último resumen.
//   3. Reseñas de FishFlow que avanzaron o dieron clic a Google.
// Ventana: 24 h (72 h los lunes, para cubrir el fin de semana).
// Si no hay nada, no manda correo.
//
// Cron de Vercel: "0 15 * * 1-5" = 09:00 CDMX.

const FISHFLOW_CLIENT_ID = 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42'
const TO = process.env.WHATSAPP_NOTIFY_TO || 'raf@fishflow.mx'
const TZ = 'America/Mexico_City'
const ADMIN_URL = 'https://www.fishflow.mx/admin'

type Msg = {
  contact_wa_id: string
  contact_name: string | null
  direction: 'inbound' | 'outbound'
  body: string | null
  created_at: string
}

function hora(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function tabla(filas: string[][]) {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 20px">${filas
    .map(
      (f) =>
        `<tr>${f
          .map((c) => `<td style="border-bottom:1px solid #eee;padding:6px 8px;vertical-align:top">${c}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</table>`
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  const db = createClient(url, key)

  const diaCdmx = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
  const horas = diaCdmx === 'Mon' ? 72 : 24
  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString()

  // 1. Conversaciones pendientes: último mensaje entrante (últimos 7 días)
  const hace7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: msgs, error: e1 } = await db
    .from('whatsapp_messages')
    .select('contact_wa_id, contact_name, direction, body, created_at')
    .gte('created_at', hace7)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (e1) {
    console.error('[cron/whatsapp-digest] mensajes', e1)
    return NextResponse.json({ error: 'Error al consultar' }, { status: 500 })
  }
  const ultimo = new Map<string, Msg>()
  const nombre = new Map<string, string>()
  for (const m of (msgs as Msg[]) ?? []) {
    if (!ultimo.has(m.contact_wa_id)) ultimo.set(m.contact_wa_id, m)
    if (m.contact_name && !nombre.has(m.contact_wa_id)) nombre.set(m.contact_wa_id, m.contact_name)
  }
  const pendientes = [...ultimo.values()].filter((m) => m.direction === 'inbound')

  // 2. 🔥 intención de compra en la ventana
  const { data: fuego } = await db
    .from('whatsapp_contacts')
    .select('wa_id, name, last_intent_at')
    .gte('last_intent_at', desde)
    .order('last_intent_at', { ascending: false })

  // 3. Reseñas de FishFlow que se movieron en la ventana
  const { data: resenas } = await db
    .from('review_requests')
    .select('contact_name, stage, clicked_google_at, click_count, updated_at')
    .eq('client_id', FISHFLOW_CLIENT_ID)
    .gte('updated_at', desde)
    .order('updated_at', { ascending: false })

  const nPend = pendientes.length
  const nFuego = fuego?.length ?? 0
  const nRes = resenas?.length ?? 0
  if (nPend + nFuego + nRes === 0) {
    return NextResponse.json({ ok: true, sent: false, note: 'nada que reportar' })
  }

  const quien = (wa: string, n?: string | null) =>
    `${escHtml(n || nombre.get(wa) || '')}${n || nombre.get(wa) ? ' ' : ''}<span style="color:#888">+${escHtml(wa)}</span>`

  let html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#222;max-width:640px">
<p style="font-size:12px;color:#FF8C35;text-transform:uppercase;letter-spacing:1px;margin:0">WhatsApp FishFlow · resumen</p>
<h2 style="margin:4px 0 16px">${nPend} sin responder · ${nFuego} 🔥 · ${nRes} reseñas</h2>`

  if (nPend) {
    html += `<h3 style="margin:0">Conversaciones sin responder</h3>` +
      tabla(
        pendientes.map((m) => {
          const vence = new Date(m.created_at).getTime() + 24 * 3600 * 1000 - Date.now()
          const ventana = vence > 0 ? `${Math.floor(vence / 3600000)} h de ventana` : 'ventana cerrada (solo plantilla)'
          return [
            quien(m.contact_wa_id, m.contact_name),
            escHtml((m.body ?? '').slice(0, 140)),
            `<span style="color:#888">${escHtml(hora(m.created_at))} · ${ventana}</span>`,
          ]
        }),
      )
  }
  if (nFuego) {
    html += `<h3 style="margin:0">🔥 Intención de compra</h3>` +
      tabla(fuego!.map((c) => [quien(c.wa_id, c.name), `<span style="color:#888">${escHtml(hora(c.last_intent_at))}</span>`]))
  }
  if (nRes) {
    const etapa = (s: number) => ['Sin contactar', 'Saludo enviado', 'Seguimiento', 'Liga enviada'][s] ?? `Etapa ${s}`
    html += `<h3 style="margin:0">⭐ Reseñas FishFlow</h3>` +
      tabla(
        resenas!.map((r) => [
          escHtml(r.contact_name ?? '—'),
          escHtml(etapa(r.stage ?? 0)),
          r.clicked_google_at ? `✅ Clic a Google (${r.click_count ?? 1})` : '',
        ]),
      )
  }
  html += `<p><a href="${ADMIN_URL}" style="background:#FF8C35;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Abrir /admin → WhatsApp</a></p>
<p style="color:#888;font-size:12px">Ventana del resumen: últimas ${horas} h.</p></div>`

  const r = await sendEmail({
    from: 'fishflowNoreply',
    to: TO,
    subject: `WhatsApp FishFlow — ${nPend} sin responder${nFuego ? ` · ${nFuego} 🔥` : ''}${nRes ? ` · ${nRes} reseñas` : ''}`,
    html,
    tag: 'cron/whatsapp-digest',
  })
  return NextResponse.json({ ok: r.ok, sent: r.ok, pendientes: nPend, fuego: nFuego, resenas: nRes })
}
