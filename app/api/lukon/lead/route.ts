import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { corsHeaders, preflight } from '@/lib/cors'
import { revisarAntibot, logDescarte } from '@/lib/antibot'
import { notifySlack, slackEscape } from '@/lib/slack'

export const runtime = 'nodejs'

/**
 * Prospectos de la landing de Lukon (hoy /demos/lukon-sitio, después gpslukon.com).
 *
 * 1) Guarda el prospecto en `leads` (client_id de Lukon, source 'lukon_landing').
 *    Si el mismo teléfono o correo ya escribió en los últimos 30 días, no se
 *    crea otro: se anota el reenvío en `notes` (mismo criterio que Enlace).
 * 2) Avisa a Alejandro por correo (aalmarazmo@lukon.com.mx) con la marca Lukon.
 *    Responder ese correo le escribe directo al prospecto.
 * 3) Avisa en Slack #cli-lukon. Si es flotilla (3+ vehículos) sale marcado.
 * 4) Si el prospecto dejó correo, le manda un acuse con la marca Lukon,
 *    desde gpslukon.com y sin mencionar a FishFlow.
 *
 * La landing también abre WhatsApp con el mensaje armado; esto no lo sustituye.
 */

export async function OPTIONS(req: Request) {
  return preflight(req)
}

const LUKON_CLIENT_ID = '1aa4a82b-e524-40f4-808e-c02e87e82427'
/** Quién recibe el aviso. Por ahora solo Alejandro (decisión de Rafa, 5-nov-2026). */
const LUKON_NOTIFY_TO = (process.env.LUKON_NOTIFY_TO || 'aalmarazmo@lukon.com.mx')
  .split(',').map((s) => s.trim()).filter(Boolean)
const LUKON_WA = '525513285555'
const PANEL_URL = 'https://www.fishflow.mx/app/lukon/?tab=prospectos'

const DUP_DIAS = 30
const CDMX_OFFSET_MS = -6 * 60 * 60 * 1000
const soloDigitos = (v: string) => v.replace(/\D/g, '')
const ult10 = (v: string) => soloDigitos(v).slice(-10)
const corta = (v: unknown, n = 200) => {
  const s = (v ?? '').toString().trim()
  return s ? s.slice(0, n) : ''
}

function avisoHtml(d: {
  nombre: string; tel: string; email: string; vehiculo: string; unidades: string
  plan: string; cp: string; origen: string; repetido: string; estadoPrevio: string
}) {
  const ui = emailUI('lukon')
  const flotilla = d.vehiculo === 'Flotilla'
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.repetido ? 'Prospecto repetido · ' : ''}${d.nombre} · ${d.vehiculo}${d.plan ? ' · ' + d.plan : ''}`,
    etiqueta: d.repetido ? 'Prospecto repetido' : flotilla ? 'Nuevo prospecto · FLOTILLA' : 'Nuevo prospecto',
    titulo: d.repetido ? 'Un prospecto volvió a escribir' : 'Llegó un prospecto desde tu página',
    cuerpo:
      ui.tabla([
        ...(d.repetido ? ([['Aviso', d.repetido], ['Estado actual', d.estadoPrevio || 'nuevo']] as [string, string][]) : []),
        ['Nombre', d.nombre],
        ['WhatsApp', d.tel],
        ['Correo', d.email || '—'],
        ['Quiere proteger', d.vehiculo + (d.unidades ? ` (${d.unidades} unidades)` : '')],
        ['Paquete elegido', d.plan || '—'],
        ['Código postal', d.cp || '—'],
        ['Origen', d.origen],
      ]) +
      ui.botones([
        {
          texto: 'Escribirle por WhatsApp',
          href: `https://wa.me/52${ult10(d.tel)}?text=${encodeURIComponent(
            `Hola ${d.nombre.split(/\s+/)[0]}, te escribo de Lukon por la cotización que pediste.`
          )}`,
        },
        { texto: 'Ver en el panel', href: PANEL_URL, estilo: 'secundario' },
      ]),
    nota: 'Si respondes este correo, le escribes directo al prospecto (si dejó su correo).',
  })
}

function acuseHtml(d: { nombre: string; vehiculo: string; plan: string }) {
  const ui = emailUI('lukon')
  const primer = d.nombre.trim().split(/\s+/)[0] || ''
  const wa = `https://wa.me/${LUKON_WA}?text=${encodeURIComponent(
    `Hola Lukon, soy ${d.nombre}. Acabo de pedir mi cotización en su página.`
  )}`
  return ui.layout({
    audiencia: 'externo',
    preheader: 'Recibimos tu solicitud. Un asesor de Lukon te escribe por WhatsApp.',
    titulo: `Recibimos tu solicitud${primer ? ', ' + escHtml(primer) : ''}`,
    cuerpo:
      ui.p('Gracias por tu interés en Lukon. Esto es lo que nos pediste:') +
      ui.dato('Quieres proteger', d.vehiculo + (d.plan ? ` · ${d.plan}` : '')) +
      ui.p('<strong>Un asesor de Lukon te escribe por WhatsApp muy pronto</strong> con tu cotización y para resolver tus dudas, sin compromiso.') +
      ui.p('¿Prefieres adelantarlo? Escríbenos directo:') +
      ui.botones([{ texto: 'Escribir por WhatsApp', href: wa }]),
    nota: 'Usamos tus datos solo para enviarte tu cotización. Si no deseas que te contactemos, responde este correo.',
  })
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'))
  try {
    const b = await req.json().catch(() => ({}))

    const veredicto = revisarAntibot(req, b, { exigirTs: true })
    if (!veredicto.ok) {
      logDescarte('lukon/lead', veredicto.motivo, b.email)
      return NextResponse.json({ ok: true }, { headers: cors })
    }

    const nombre = corta(b.nombre, 120)
    const tel = corta(b.tel, 30)
    const email = corta(b.email, 160).toLowerCase()
    const vehiculo = corta(b.vehiculo, 30) || '—'
    const unidades = vehiculo === 'Flotilla' ? corta(b.unidades, 30) : ''
    const plan = corta(b.plan, 120)
    const cp = soloDigitos(corta(b.cp, 10)).slice(0, 5)

    if (!nombre || ult10(tel).length < 10) {
      return NextResponse.json({ error: 'Falta nombre o WhatsApp.' }, { status: 400, headers: cors })
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Correo inválido.' }, { status: 400, headers: cors })
    }

    const utmSource = corta(b.utm_source) || null
    const utmMedium = corta(b.utm_medium) || null
    const utmCampaign = corta(b.utm_campaign) || null
    const utmContent = corta(b.utm_content) || null
    const utmTerm = corta(b.utm_term) || null
    const landingUrl = corta(b.landing_url, 500) || null
    const referrer = corta(b.referrer, 500) || null
    const origen = utmCampaign
      ? `${utmSource || 'desconocido'} / ${utmCampaign}${utmContent ? ' / ' + utmContent : ''}`
      : b.fbclid ? 'Meta (sin UTM)' : 'Orgánico (sin UTM)'

    const resumen = [
      '[Landing Lukon]',
      `Vehículo: ${vehiculo}${unidades ? ` (${unidades} unidades)` : ''}`,
      plan ? `Paquete: ${plan}` : '',
      cp ? `C.P.: ${cp}` : '',
    ].filter(Boolean).join(' · ')

    // 1) Guardar (best-effort: si falla, igual se avisa a Alejandro).
    let repetido: { veces: number; status: string | null } | null = null
    try {
      const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const desde = new Date(Date.now() - DUP_DIAS * 86400_000).toISOString()
      const { data: recientes, error: errBusca } = await supabase
        .from('leads')
        .select('id, email, phone, status, notes')
        .eq('client_id', LUKON_CLIENT_ID)
        .eq('source', 'lukon_landing')
        .gte('created_at', desde)
        .limit(2000)
      if (errBusca) console.error('[lukon/lead] búsqueda de duplicado:', errBusca)

      const tel10 = ult10(tel)
      const previo = (recientes ?? []).find(
        (r) =>
          ult10(r.phone ?? '') === tel10 ||
          (email && !(r.email ?? '').endsWith('@lukon.local') && (r.email ?? '').toLowerCase() === email)
      )

      if (previo) {
        const veces = ((previo.notes ?? '').match(/\[Reenvi[oó] #/g) ?? []).length + 1
        const stamp = new Date(Date.now() + CDMX_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
        const nota = `[Reenvió #${veces}] ${stamp} CDMX · ${resumen}${utmCampaign ? ' · campaña: ' + utmCampaign : ''}`
        const { error: errUp } = await supabase
          .from('leads')
          .update({ notes: [previo.notes, nota].filter(Boolean).join('\n') })
          .eq('id', previo.id)
        if (errUp) console.error('[lukon/lead] update de repetido:', errUp)
        repetido = { veces, status: previo.status ?? null }
      } else {
        const { error } = await supabase.from('leads').insert({
          name: nombre,
          email: email || `wa-${soloDigitos(tel)}@lukon.local`,
          phone: tel,
          problem: resumen,
          ai_response: plan ? `Paquete elegido: ${plan}` : null,
          answers: { vehiculo, unidades: unidades || null, plan: plan || null, cp: cp || null },
          status: 'nuevo',
          source: 'lukon_landing',
          client_id: LUKON_CLIENT_ID,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
          utm_content: utmContent,
          utm_term: utmTerm,
          landing_url: landingUrl,
          referrer,
        })
        if (error) console.error('[lukon/lead] insert:', error)
      }
    } catch (e) {
      console.error('[lukon/lead] Supabase:', e)
    }

    const repetidoTxt = repetido ? `Ya había escrito; es su envío #${repetido.veces + 1}. No se creó otro prospecto.` : ''

    // 2) Slack #cli-lukon
    await notifySlack('lukon', {
      text: `${repetido ? 'Prospecto repetido' : vehiculo === 'Flotilla' ? '🚚 FLOTILLA · Nuevo prospecto' : 'Nuevo prospecto'} — ${nombre}`,
      body: [
        `*Quiere proteger:* ${slackEscape(vehiculo)}${unidades ? ` (${slackEscape(unidades)} unidades)` : ''}`,
        plan ? `*Paquete:* ${slackEscape(plan)}` : '',
        `*WhatsApp:* ${slackEscape(tel)}`,
        email ? `*Correo:* ${slackEscape(email)}` : '',
        cp ? `*C.P.:* ${cp}` : '',
        `*Origen:* ${slackEscape(origen)}`,
        repetidoTxt ? `_${repetidoTxt}_` : '',
      ].filter(Boolean).join('\n'),
      button: { label: 'Ver en el panel', url: PANEL_URL },
    })

    // 3) Correos
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)
      const { error: mailErr } = await resend.emails.send({
        from: SENDERS.lukonVentas,
        to: LUKON_NOTIFY_TO,
        replyTo: email || undefined,
        subject: `${repetido ? 'Prospecto repetido' : vehiculo === 'Flotilla' ? 'Nuevo prospecto · FLOTILLA' : 'Nuevo prospecto'} — ${nombre} · ${vehiculo}`,
        html: avisoHtml({ nombre, tel, email, vehiculo, unidades, plan, cp, origen, repetido: repetidoTxt, estadoPrevio: repetido?.status ?? '' }),
      })
      if (mailErr) console.error('[lukon/lead] aviso a Lukon:', mailErr)

      if (email && !repetido) {
        const { error: ackErr } = await resend.emails.send({
          from: SENDERS.lukonVentas,
          to: email,
          replyTo: LUKON_NOTIFY_TO[0],
          subject: 'Recibimos tu solicitud — Lukon',
          html: acuseHtml({ nombre, vehiculo, plan }),
        })
        if (ackErr) console.error('[lukon/lead] acuse al prospecto:', ackErr)
      }
    } else {
      console.error('[lukon/lead] RESEND_API_KEY no configurada')
    }

    return NextResponse.json({ ok: true }, { headers: cors })
  } catch (err: any) {
    console.error('[lukon/lead] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: cors })
  }
}
