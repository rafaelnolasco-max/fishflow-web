import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS, sparcNotifyTo, SPARC_DEFAULT_TO } from '@/lib/email'
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

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
  if (dia === 0) return 'manana lunes, a partir de las 9:00'
  if (dia === 6) return 'el lunes, a partir de las 9:00'
  if (hora < 9) return 'hoy mismo, a partir de las 9:00'
  if (hora < 18) return 'hoy mismo, dentro del horario de oficina'
  if (dia === 5) return 'el lunes, a partir de las 9:00'
  return 'manana, a partir de las 9:00'
}

/** Acuse para el PROSPECTO. Marca SPARC: azul PMS 641C, verde PMS 7739C. */
function prospectoHtml(d: { nombre: string; inmueble: string; cuando: string }) {
  const primerNombre = esc(d.nombre.trim().split(/\s+/)[0] || '')
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0E1D28">
    <div style="background:#0065A1;color:#fff;padding:26px">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#A9D8EF">SPARC Administracion</div>
      <div style="font-size:23px;font-weight:700;margin-top:8px;line-height:1.25">Recibimos tu solicitud, ${primerNombre}</div>
    </div>
    <div style="padding:26px;background:#fff;border:1px solid #E1E9F0;border-top:none">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
        Gracias por contactarnos. Registramos tu solicitud de cotizacion para:
      </p>
      <div style="background:#EDF5FA;border-left:3px solid #2C9A42;padding:14px 18px;margin-bottom:18px">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5C6E7C">Inmueble</div>
        <div style="font-size:19px;font-weight:700;margin-top:4px">${esc(d.inmueble) || 'Tu inmueble'}</div>
      </div>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
        <strong>Un ejecutivo de cuenta te contacta ${esc(d.cuando)}</strong> para conocer
        la situacion de tu condominio y preparar una propuesta cerrada, por escrito y
        sin cargos ocultos.
      </p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6">
        Si es una urgencia, puedes llamarnos al
        <a href="tel:+525559902906" style="color:#0065A1;font-weight:600">55 5990 2906</a>.
      </p>
      <p style="margin:0;font-size:12.5px;line-height:1.6;color:#5C6E7C;border-top:1px solid #E1E9F0;padding-top:16px">
        SPARC &middot; Servicios Profesionales en Administracion Residencial y Comercial<br>
        Tus datos se usan unicamente para atender esta solicitud, conforme a nuestro
        <a href="https://www.sparcgroup.mx/aviso-de-privacidad.html" style="color:#0065A1">Aviso de Privacidad</a>.
      </p>
    </div>
  </div>`
}

/** Aviso para SPARC. */
function adminHtml(d: Record<string, string>) {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 0;color:#5C6E7C;width:170px">${k}</td><td style="padding:7px 0"><strong>${esc(v) || '—'}</strong></td></tr>`
  const tel = esc(d.telefono).replace(/\D/g, '')
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0E1D28">
    <div style="background:#00405F;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7FD494">SPARC &middot; Nuevo prospecto</div>
      <div style="font-size:22px;margin-top:6px;font-weight:800">Alguien pidio cotizacion desde la pagina</div>
    </div>
    <div style="padding:22px 26px;border:1px solid #E1E9F0;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Nombre', d.nombre)}
        ${row('Telefono', d.telefono)}
        ${row('Correo', d.email)}
        ${row('Desarrollo o inmueble', d.inmueble)}
        ${row('Tipo', d.tipo)}
        ${row('Unidades / locales', d.unidades)}
        ${row('Que necesita resolver', d.mensaje)}
        ${row('Origen', d.origen)}
      </table>
      ${tel ? `<a href="https://wa.me/52${tel}" style="display:inline-block;margin-top:18px;background:#2C9A42;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">Escribirle por WhatsApp</a>` : ''}
      <p style="font-size:12px;color:#5C6E7C;margin-top:20px">Aviso automatico de www.sparcgroup.mx &middot; FishFlow</p>
    </div>
  </div>`
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
        subject: 'Recibimos tu solicitud — SPARC Administracion',
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
