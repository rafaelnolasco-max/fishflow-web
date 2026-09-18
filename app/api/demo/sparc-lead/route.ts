import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS, sparcNotifyTo, SPARC_DEFAULT_TO } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { corsHeaders, preflight } from '@/lib/cors'
import { revisarAntibot, logDescarte } from '@/lib/antibot'

export const runtime = 'nodejs'

/**
 * Captura de prospectos de la landing de SPARC (www.sparcgroup.mx).
 *
 * La landing es estatica y vive en otro proyecto de Vercel (repo
 * `fishflow-clients`, carpeta `sparcgroup`), asi que esta ruta se llama
 * cross-origin. Ver lib/cors.ts — y OJO: fishflow-web corre con
 * `trailingSlash: true`, la landing DEBE pegarle a `/api/demo/sparc-lead/`
 * con diagonal final o el preflight se pierde en el 308.
 *
 * Hace tres cosas:
 *   1. Guarda el prospecto en `leads` (visible en /app/sparc).
 *   2. Avisa por correo a SPARC + Rafa.
 *   3. Manda acuse de recibo al prospecto desde contacto@sparcgroup.mx.
 *
 * ANTIBOT: aqui se exige `_ts` desde el dia uno (a diferencia de las rutas de
 * Mario). La landing se despliega junto con este API, asi que no hay ventana
 * de formularios viejos en cache. Importa mas que en otros lados porque esta
 * ruta manda un acuse automatico a una direccion que escribe el visitante:
 * es exactamente el vector de list-bombing del 12-sep-2026.
 */

export async function OPTIONS(req: Request) {
  return preflight(req)
}

/** client_id de Sparc — Eduardo Curiel en la tabla `clients`. */
const SPARC_CLIENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

/**
 * Horario de SPARC en CDMX (UTC-6 fijo, sin horario de verano).
 * La landing promete "menos de 24 horas habiles"; aqui se traduce a una frase
 * concreta para que el acuse y la pantalla de gracias digan lo mismo.
 */
const CDMX_OFFSET_MS = -6 * 60 * 60 * 1000
function siguienteContacto(nowUtc: Date = new Date()): string {
  const cdmx = new Date(nowUtc.getTime() + CDMX_OFFSET_MS)
  const dia = cdmx.getUTCDay()
  const hora = cdmx.getUTCHours()
  if (dia === 0) return 'mañana lunes, a partir de las 9:00'
  if (dia === 6) return 'el lunes, a partir de las 9:00'
  if (hora < 9) return 'hoy mismo, a partir de las 9:00'
  if (hora < 18) return 'hoy mismo, dentro del horario de oficina'
  if (dia === 5) return 'el lunes, a partir de las 9:00'
  return 'mañana, a partir de las 9:00'
}

/** Acuse para el PROSPECTO. Marca SPARC — ver EMAIL_BRANDS.sparc en lib/emailLayout.ts. */
function prospectoHtml(d: { nombre: string; inmueble: string; cuando: string }) {
  const ui = emailUI('sparc')
  const primerNombre = d.nombre.trim().split(/\s+/)[0] || ''
  return ui.layout({
    audiencia: 'externo',
    preheader: `Un ejecutivo de cuenta te contacta ${d.cuando}.`,
    titulo: `Recibimos tu solicitud${primerNombre ? ', ' + primerNombre : ''}`,
    cuerpo:
      ui.p('Gracias por contactarnos. Registramos tu solicitud de cotización para:') +
      ui.dato('Inmueble', d.inmueble || 'Tu inmueble') +
      ui.p(
        `<strong>Un ejecutivo de cuenta te contacta ${escHtml(d.cuando)}</strong> para conocer ` +
          'la situación de tu condominio y preparar una propuesta cerrada, por escrito y sin cargos ocultos.'
      ) +
      ui.p(`Si es una urgencia, puedes llamarnos al ${ui.link('55 5990 2906', 'tel:+525559902906')}.`),
    nota: 'Tus datos se usan únicamente para atender esta solicitud, conforme a nuestro Aviso de Privacidad.',
  })
}

/** Aviso para el equipo de SPARC (y Rafa). */
function adminHtml(d: Record<string, string>) {
  const ui = emailUI('sparc')
  const tel = String(d.telefono ?? '').replace(/\D/g, '')
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.nombre}${d.inmueble ? ' · ' + d.inmueble : ''} pidió cotización.`,
    etiqueta: 'Nuevo prospecto',
    titulo: 'Alguien pidió cotización desde la página',
    cuerpo:
      ui.tabla([
        ['Nombre', d.nombre],
        ['Teléfono', d.telefono],
        ['Correo', d.email],
        ['Desarrollo o inmueble', d.inmueble],
        ['Tipo', d.tipo],
        ['Unidades / locales', d.unidades],
        ['Qué necesita resolver', d.mensaje],
        ['Origen', d.origen],
      ]) +
      ui.botones([
        { texto: 'Escribirle por WhatsApp', href: tel ? `https://wa.me/52${tel}` : '' },
        { texto: 'Ver en el panel', href: 'https://www.fishflow.mx/app/sparc', estilo: 'secundario' },
      ]),
    nota: 'Llegó desde el formulario de www.sparcgroup.mx.',
  })
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'))
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>

    const veredicto = revisarAntibot(req, b, { exigirTs: true })
    if (!veredicto.ok) {
      logDescarte('demo/sparc-lead', veredicto.motivo, b.email)
      // 200 con el mismo cuerpo que un alta buena: un 400 le ensena al bot
      // que campo cambiar. Ver lib/antibot.ts.
      return NextResponse.json({ ok: true, cuando: siguienteContacto() }, { headers: cors })
    }

    const str = (k: string, max = 300) => (b[k] ?? '').toString().trim().slice(0, max)
    const nombre = str('nombre', 120)
    const email = str('email', 160).toLowerCase()
    const telefono = str('telefono', 40)
    const inmueble = str('inmueble', 160)
    const tipo = str('tipo', 80)
    const unidades = str('unidades', 40)
    const mensaje = str('mensaje', 1500)

    if (!nombre || !telefono || !email) {
      return NextResponse.json(
        { error: 'Faltan nombre, telefono o correo.' },
        { status: 400, headers: cors }
      )
    }

    const utm = (k: string) => {
      const v = (b[k] ?? '').toString().trim()
      return v ? v.slice(0, 200) : null
    }
    const utmSource = utm('utm_source')
    const utmCampaign = utm('utm_campaign')
    const utmContent = utm('utm_content')
    const landingUrl = (b.landing_url ?? '').toString().trim().slice(0, 500) || null
    const referrer = (b.referrer ?? '').toString().trim().slice(0, 500) || null
    const origen = utmCampaign
      ? `${utmSource || 'desconocido'} / ${utmCampaign}${utmContent ? ' / ' + utmContent : ''}`
      : 'Organico (sin UTM)'

    const cuando = siguienteContacto()

    /* `problem` es NOT NULL en `leads` y es lo que se ve en la lista del panel.
       Se arma un resumen de una linea; el detalle estructurado va en `answers`
       para que no haya que parsear texto despues. */
    const resumen = [
      '[Landing SPARC]',
      inmueble && `Inmueble: ${inmueble}`,
      tipo && `Tipo: ${tipo}`,
      unidades && `Unidades: ${unidades}`,
      mensaje && `Necesita: ${mensaje}`,
    ].filter(Boolean).join(' · ')

    // 1) Guardar. Best-effort: si Supabase falla, el correo igual sale y el
    //    prospecto no se pierde.
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { error } = await supabase.from('leads').insert({
        name: nombre,
        email,
        phone: telefono || null,
        problem: resumen,
        answers: { inmueble, tipo, unidades, mensaje },
        source: 'sparc_landing',
        client_id: SPARC_CLIENT_ID,
        utm_source: utmSource,
        utm_medium: utm('utm_medium'),
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utm('utm_term'),
        landing_url: landingUrl,
        referrer,
      })
      if (error) console.error('[demo/sparc-lead] Supabase insert error:', error)
    } catch (e) {
      console.error('[demo/sparc-lead] Supabase error:', e)
    }

    // 2) y 3) Correos
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)

      const { error: mailErr } = await resend.emails.send({
        from: SENDERS.sparc,
        to: sparcNotifyTo(),
        replyTo: email,
        subject: `Nuevo prospecto — ${nombre}${inmueble ? ' · ' + inmueble : ''}`,
        html: adminHtml({ nombre, telefono, email, inmueble, tipo, unidades, mensaje, origen }),
      })
      if (mailErr) console.error('[demo/sparc-lead] email a SPARC error:', mailErr)

      const { error: ackErr } = await resend.emails.send({
        from: SENDERS.sparc,
        to: email,
        replyTo: SPARC_DEFAULT_TO,
        subject: 'Recibimos tu solicitud — SPARC Administración',
        html: prospectoHtml({ nombre, inmueble, cuando }),
      })
      if (ackErr) console.error('[demo/sparc-lead] acuse al prospecto error:', ackErr)
    } else {
      console.error('[demo/sparc-lead] RESEND_API_KEY no configurada')
    }

    return NextResponse.json({ ok: true, cuando }, { headers: cors })
  } catch (err: any) {
    console.error('[demo/sparc-lead] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: cors })
  }
}
