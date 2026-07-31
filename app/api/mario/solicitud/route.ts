import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'
import { SENDERS, getResend } from '@/lib/email'

export const runtime = 'nodejs'

// Solicitudes COMERCIALES de mariocitalan.net: alguien pidiendo un servicio.
//
// Distinto de /api/newsletter/subscribe (alta a una lista) y de
// /api/demo/mario-criterio (resultado de una evaluación). Aquí la persona está
// levantando la mano para contratar, así que además de guardarla se avisa a
// Mario y a Rafa en el momento: un prospecto comercial no puede esperar a que
// alguien se acuerde de revisar el panel.
//
// Estos cuatro formularios llevaban desde el lanzamiento del sitio diciendo
// "gracias" y tirando el dato a la basura.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/** Servicios que pueden originar una solicitud. La clave viaja como `origen`. */
const SERVICIOS: Record<string, string> = {
  asesoria: 'Asesoría personal',
  cea: 'CEA — Centro de Entrenamiento en Actitud',
  evoluciona: 'Evoluciona',
  'ciencia-en-escena': 'Ciencia en Escena',
}

const AVISO_A = ['mariocitalan@gmail.com', 'raf@fishflow.mx']

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Campos extra del formulario, normalizados.
 *
 * Cada página pregunta cosas distintas (el reto que trae, si es para su equipo,
 * el contexto del evento). En vez de una columna por campo, llegan como pares
 * etiqueta/valor y se guardan en `answers`, que ya es jsonb y es justo para esto.
 */
function limpiarExtras(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const clave = String(k).trim().slice(0, 80)
    const valor = String(v ?? '').trim().slice(0, 600)
    if (clave && valor) out[clave] = valor
  }
  return out
}

function filasHtml(pares: [string, string][]) {
  return pares
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <tr>
        <td style="padding:8px 0;color:#7B8794;width:150px;vertical-align:top">${esc(k)}</td>
        <td style="padding:8px 0;color:#0F1A24">${esc(v)}</td>
      </tr>`)
    .join('')
}

function avisoHtml(d: {
  servicio: string; nombre: string; email: string; tel: string
  extras: Record<string, string>
}) {
  const base: [string, string][] = [
    ['Nombre', d.nombre],
    ['Correo', d.email],
    ['Teléfono', d.tel || '—'],
  ]
  const extra: [string, string][] = Object.entries(d.extras)

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F1A24">
    <div style="background:#0F1A24;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67D4E8">${esc(d.servicio)}</div>
      <div style="font-family:Georgia,serif;font-size:22px;margin-top:6px">Nueva solicitud de servicio</div>
    </div>
    <div style="padding:24px 26px;border:1px solid #DCE4EC;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${filasHtml(base)}
        ${extra.length ? `<tr><td colspan="2" style="padding-top:14px"><div style="border-top:1px solid #DCE4EC"></div></td></tr>` : ''}
        ${filasHtml(extra)}
      </table>

      <div style="background:#F4F7FA;border-left:3px solid #3E86CF;padding:14px 16px;margin-top:22px;font-size:14px;color:#283845">
        Puedes responder este correo directamente: la respuesta le llega a
        <strong>${esc(d.email)}</strong>.
      </div>

      <p style="font-size:12px;color:#7B8794;margin-top:20px">
        Enviado desde mariocitalan.net · queda registrado en el panel, pestaña Solicitudes.
      </p>
    </div>
  </div>`
}

function acuseHtml(nombre: string, servicio: string) {
  const primer = nombre.trim().split(/\s+/)[0]
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F1A24">
    <div style="background:#0F1A24;color:#fff;padding:26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67D4E8">${esc(servicio)}</div>
      <div style="font-family:Georgia,serif;font-size:24px;margin-top:8px">Recibí tu solicitud</div>
    </div>
    <div style="padding:26px;border:1px solid #DCE4EC;border-top:none">
      <p style="font-size:16px;margin:0 0 16px">${primer ? `Hola ${esc(primer)},` : 'Hola,'}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 20px">
        Ya me llegó lo que me escribiste. Te respondo personalmente en menos de
        24 horas hábiles para ver si esto es lo que necesitas; si no lo es, te lo
        digo con la misma claridad.
      </p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 22px">
        Mientras tanto puedes responder este correo si quieres agregar contexto.
      </p>
      <p style="font-size:14px;color:#283845;margin:0">Un abrazo,<br><strong>Mario Citalán</strong></p>
      <p style="font-size:11px;color:#7B8794;line-height:1.5;margin-top:24px;border-top:1px solid #DCE4EC;padding-top:16px">
        Tus datos se tratan únicamente para atender esta solicitud. No quedaste suscrito a ninguna lista de correo.
        Consulta el <a href="https://mariocitalan.net/aviso-de-privacidad.html" style="color:#7B8794;text-decoration:underline">Aviso de privacidad</a>.
      </p>
    </div>
  </div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const origen = (body.origen ?? '').toString().trim().toLowerCase()
    const servicio = SERVICIOS[origen]
    if (!servicio) {
      return NextResponse.json({ error: 'Origen no reconocido.' }, { status: 400, headers: CORS_HEADERS })
    }

    const nombre = (body.nombre ?? '').toString().trim().slice(0, 120)
    const email = (body.email ?? '').toString().trim().toLowerCase().slice(0, 200)
    const tel = (body.tel ?? '').toString().trim().slice(0, 40)
    const extras = limpiarExtras(body.extras)

    if (nombre.length < 2 || !/.+@.+\..+/.test(email)) {
      return NextResponse.json(
        { error: 'Falta tu nombre o un correo válido.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      console.error('[mario/solicitud] Falta SUPABASE_URL o SERVICE_ROLE_KEY')
      return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 500, headers: CORS_HEADERS })
    }
    const supabase = createClient(supabaseUrl, serviceKey)

    // Resumen legible del primer campo libre, para que el panel muestre algo
    // útil en la lista sin tener que abrir el detalle.
    const contexto = Object.values(extras)[0] ?? ''

    // A diferencia del newsletter, aquí SIEMPRE se inserta fila nueva aunque el
    // correo ya exista: dos solicitudes de la misma persona en momentos
    // distintos son dos asuntos que atender, no un duplicado.
    const { error: insErr } = await supabase.from('leads').insert({
      name: nombre,
      email,
      phone: tel || null,
      problem: `[Solicitud: ${servicio}]${contexto ? ` ${contexto}` : ''}`,
      answers: Object.keys(extras).length ? extras : null,
      // No pidió newsletter: llenar un formulario de servicio no es suscribirse.
      opt_in: false,
      status: 'nuevo',
      source: origen,
      client_id: CRITERIO_CLIENT_ID,
    })
    if (insErr) {
      console.error('[mario/solicitud] insert error:', insErr)
      return NextResponse.json({ error: 'No se pudo registrar la solicitud.' }, { status: 500, headers: CORS_HEADERS })
    }

    // Los correos son best-effort: si Resend falla, la solicitud ya quedó
    // guardada y no tiene sentido mostrarle un error a quien la envió.
    const resend = getResend()
    if (resend) {
      const { error: avisoErr } = await resend.emails.send({
        from: SENDERS.fishflow,
        to: AVISO_A,
        // Responder el aviso escribe directo al prospecto, sin copiar y pegar.
        replyTo: email,
        subject: `Solicitud de ${servicio} — ${nombre}`,
        html: avisoHtml({ servicio, nombre, email, tel, extras }),
      })
      if (avisoErr) console.error('[mario/solicitud] aviso error:', avisoErr)

      const { error: acuseErr } = await resend.emails.send({
        from: SENDERS.marioCitalan,
        to: [email],
        replyTo: 'mariocitalan@gmail.com',
        subject: 'Recibí tu solicitud',
        html: acuseHtml(nombre, servicio),
      })
      if (acuseErr) console.error('[mario/solicitud] acuse error:', acuseErr)
    } else {
      console.error('[mario/solicitud] RESEND_API_KEY no configurada')
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (err: unknown) {
    console.error('[mario/solicitud] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: CORS_HEADERS })
  }
}
