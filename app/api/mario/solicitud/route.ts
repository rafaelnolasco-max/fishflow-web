import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'
import { SENDERS, getResend } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { revisarAntibot, logDescarte } from '@/lib/antibot'

export const runtime = 'nodejs'

// Solicitudes COMERCIALES de mariocitalan.net: alguien pidiendo un servicio.
//
// Distinto de /api/newsletter/subscribe (alta a una lista) y de
// /api/demo/mario-criterio (resultado de una evaluación). Aquí la persona está
// levantando la mano para contratar, así que además de guardarla se avisa a
// Mario y a Rafa en el momento: un prospecto comercial no puede esperar a que
// alguien se acuerde de revisar el panel.
//
// Los formularios originales llevaban desde el lanzamiento del sitio diciendo
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
  // DERVIAC (sep-2026): Arquitectura Mental y del Criterio evolucionó a DERVIAC.
  // Las claves viejas se quedan para leer solicitudes históricas.
  'programa-personal': 'Programa Personal DERVIAC',
  empresas: 'DERVIAC Empresas',
  conferencias: 'Conferencias DERVIAC',
  talleres: 'Talleres DERVIAC',
  'conferencias-y-talleres': 'Conferencias y Talleres DERVIAC',
}

const AVISO_A = ['mariocitalan@gmail.com', 'raf@fishflow.mx']

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

/** Aviso interno → Mario + Rafa. Marca de Mario (lib/emailLayout.ts). */
function avisoHtml(d: {
  servicio: string; nombre: string; email: string; tel: string
  extras: Record<string, string>
}) {
  const ui = emailUI('mario')
  const extras = Object.entries(d.extras)
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.nombre} pidió ${d.servicio}.`,
    etiqueta: d.servicio,
    titulo: 'Nueva solicitud de servicio',
    cuerpo:
      ui.tabla([
        ['Nombre', d.nombre],
        ['Correo', d.email],
        ['Teléfono', d.tel],
      ]) +
      (extras.length ? ui.tabla(extras) : '') +
      ui.bloque(
        ui.p(`Puedes responder este correo directamente: la respuesta le llega a <strong>${escHtml(d.email)}</strong>.`)
      ) +
      ui.botones([{ texto: 'Ver en el panel', href: 'https://www.fishflow.mx/app/mariocitalan' }]),
    nota: 'Enviado desde mariocitalan.net · queda registrado en el panel, pestaña Solicitudes.',
  })
}

/** Acuse → quien pidió el servicio. */
function acuseHtml(nombre: string, servicio: string) {
  const ui = emailUI('mario')
  const primer = nombre.trim().split(/\s+/)[0] || ''
  return ui.layout({
    audiencia: 'externo',
    preheader: 'Te respondo personalmente en menos de 24 horas hábiles.',
    etiqueta: servicio,
    titulo: 'Recibí tu solicitud',
    cuerpo:
      ui.p(primer ? `Hola ${escHtml(primer)},` : 'Hola,') +
      ui.p(
        'Ya me llegó lo que me escribiste. Te respondo personalmente en menos de 24 horas hábiles ' +
          'para ver si esto es lo que necesitas; si no lo es, te lo digo con la misma claridad.'
      ) +
      ui.p('Mientras tanto puedes responder este correo si quieres agregar contexto.') +
      ui.firma(),
    nota: 'Tus datos se tratan únicamente para atender esta solicitud. No quedaste suscrito a ninguna lista de correo.',
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    // Filtro antibot: honeypot, tiempo de llenado y origen (ver lib/antibot.ts).
    // Un descarte responde 200 como si hubiera entrado: un 400 le enseña al bot
    // qué campo corregir, un 200 lo deja creyendo que funcionó.
    const veredicto = revisarAntibot(req, body)
    if (!veredicto.ok) {
      logDescarte('mario/solicitud', veredicto.motivo, body.email)
      return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
    }
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
