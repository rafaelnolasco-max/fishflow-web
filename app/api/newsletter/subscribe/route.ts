import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'
import { SENDERS, REPLY_TO, getResend } from '@/lib/email'

export const runtime = 'nodejs'

// Alta al newsletter de Mario Citalán SIN completar ninguna evaluación.
//
// El sitio público vive en Hostinger (mariocitalan.net) y hace POST aquí, igual
// que /api/demo/mario-criterio. La persona cae en la misma tabla `leads` con
// client_id de Mario, así que aparece en su panel /app/mariocitalan sin ningún
// paso manual.
//
// DOS ALTAS, DOS CONSENTIMIENTOS DISTINTOS. `source` dice de dónde vino y el
// permiso que otorga vive en columnas separadas:
//
//   newsletter → bloque junto a los cuestionarios. Marca opt_in = true, y el
//                trigger `trg_leads_newsletter_from_optin` lo pasa a
//                newsletter = 'suscrito'. Autoriza el boletín recurrente.
//   libro      → lista de espera de "Ciencia en escena". Marca solo libro_at.
//                Autoriza UN aviso de lanzamiento, no el boletín.
//
// No mezclarlos: dar de alta en el boletín a quien solo pidió aviso del libro
// es mandarle correo que no pidió, y además infla el alcance real de los envíos.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const ORIGENES = new Set(['newsletter', 'libro'])

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Nombre a partir del correo cuando la persona no lo dio: `leads.name` es NOT NULL. */
function nombreDesdeEmail(email: string) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  if (!local) return 'Suscriptor'
  return local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60)
}

/**
 * Saludo del correo.
 *
 * Solo se usa el nombre que la persona ESCRIBIÓ. El derivado del correo sirve
 * para llenar `leads.name` (que es NOT NULL) y para que Mario reconozca a quién
 * tiene enfrente en el panel, pero como saludo queda ridículo: el formulario del
 * libro no pide nombre, así que salía "Hola Rafaelnolasco,". Sin nombre real,
 * "Hola," a secas se lee natural.
 */
function saludo(nombreDado: string) {
  const primer = nombreDado.trim().split(/\s+/)[0]
  return primer ? `Hola ${esc(primer)},` : 'Hola,'
}

function bienvenidaHtml(nombreDado: string, esLibro: boolean) {
  const cuerpo = esLibro
    ? 'Quedaste en la lista de espera de <strong>Ciencia en escena</strong>. Te aviso en cuanto el libro esté disponible.'
    : 'Quedaste suscrito a mis publicaciones. De vez en cuando te escribo con algo que valga tu tiempo: cómo se construye un criterio, cómo se sostiene una decisión, y qué hacer cuando la estructura se tambalea.'

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F1A24">
    <div style="background:#0F1A24;color:#fff;padding:26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67D4E8">Arquitectura del Criterio</div>
      <div style="font-family:Georgia,serif;font-size:24px;margin-top:8px">${esLibro ? 'Estás en la lista' : 'Listo, estás dentro'}</div>
    </div>
    <div style="padding:26px;border:1px solid #DCE4EC;border-top:none">
      <p style="font-size:16px;margin:0 0 16px">${saludo(nombreDado)}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 22px">${cuerpo}</p>

      <div style="background:#F4F7FA;border:1px solid #DCE4EC;border-left:3px solid #3E86CF;padding:18px 20px;margin:0 0 24px">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#2A6AAE;margin-bottom:8px">Si algún día quieres ir más a fondo</div>
        <div style="font-size:14.5px;color:#283845;line-height:1.6">
          Las evaluaciones te dan un perfil y una ruta concreta. No hay prisa: están ahí cuando quieras.
        </div>
        <div style="margin-top:14px">
          <a href="https://mariocitalan.net/actitud.html" style="color:#2A6AAE;font-size:14px">Evalúa tu actitud (15 preguntas)</a>
          <span style="color:#7B8794"> · </span>
          <a href="https://mariocitalan.net/cuestionario.html" style="color:#2A6AAE;font-size:14px">Evaluación de Criterio</a>
        </div>
      </div>

      <p style="font-size:14px;color:#283845;margin:0">Un abrazo,<br><strong>Mario Citalán</strong></p>
      <p style="font-size:11px;color:#7B8794;line-height:1.5;margin-top:24px;border-top:1px solid #DCE4EC;padding-top:16px">
        Recibes este correo porque te suscribiste en mariocitalan.net. Si no fuiste tú o ya no quieres recibirlo, responde "baja" a este mensaje y te saco de la lista.
      </p>
    </div>
  </div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const email = (body.email ?? '').toString().trim().toLowerCase()
    const nombreDado = (body.nombre ?? '').toString().trim().slice(0, 120)
    const tel = (body.tel ?? '').toString().trim().slice(0, 40)
    const origenRaw = (body.origen ?? 'newsletter').toString().trim().toLowerCase()
    const origen = ORIGENES.has(origenRaw) ? origenRaw : 'newsletter'
    const esLibro = origen === 'libro'

    // El consentimiento se marca en la página; sin él no hay alta.
    //
    // Ojo: `consent` autoriza SOLO aquello para lo que la persona llenó el
    // formulario. Apuntarse a que te avisen de un libro no es aceptar un boletín
    // quincenal, así que el alta del libro NO toca opt_in ni newsletter.
    const consent = body.consent === true || body.consent === 'true' || body.consent === 1

    if (!/.+@.+\..+/.test(email) || email.length > 200) {
      return NextResponse.json(
        { error: 'Escribe un correo válido.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }
    if (!consent) {
      return NextResponse.json(
        { error: 'Falta aceptar recibir los correos.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      console.error('[newsletter/subscribe] Falta SUPABASE_URL o SERVICE_ROLE_KEY')
      return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 500, headers: CORS_HEADERS })
    }
    const supabase = createClient(supabaseUrl, serviceKey)

    const nombre = nombreDado || nombreDesdeEmail(email)

    const ahora = new Date().toISOString()

    // Qué autoriza cada formulario. Son dos permisos distintos y una misma
    // persona puede acumular los dos en la misma fila.
    //   newsletter → opt_in = true  (el trigger lo pasa a newsletter='suscrito')
    //   libro      → libro_at = now (NO toca opt_in ni newsletter)
    const permiso = esLibro
      ? { libro_at: ahora }
      : { opt_in: true, newsletter: 'suscrito', newsletter_at: ahora }

    // ¿Ya lo conocemos? Puede haber hecho una evaluación antes. En ese caso NO
    // se crea otra fila (ensuciaría el conteo de evaluaciones del panel): se
    // agrega el permiso al registro que ya existe.
    const { data: previos, error: findErr } = await supabase
      .from('leads')
      .select('id, newsletter, phone, libro_at')
      .eq('client_id', CRITERIO_CLIENT_ID)
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)

    if (findErr) console.error('[newsletter/subscribe] lookup error:', findErr)

    const previo = previos?.[0]
    let yaEstaba = false

    if (previo) {
      // "Ya estaba" se mide contra el permiso que se está pidiendo ahora, no
      // contra el otro: quien está suscrito al boletín pero no en la lista del
      // libro sí es un alta nueva para el libro.
      yaEstaba = esLibro ? previo.libro_at != null : previo.newsletter === 'suscrito'

      const { error: updErr } = await supabase
        .from('leads')
        .update({
          ...permiso,
          // No pisar un teléfono ya capturado con un campo vacío.
          ...(tel && !previo.phone ? { phone: tel } : {}),
        })
        .eq('id', previo.id)
      if (updErr) {
        console.error('[newsletter/subscribe] update error:', updErr)
        return NextResponse.json({ error: 'No se pudo completar el alta.' }, { status: 500, headers: CORS_HEADERS })
      }
    } else {
      const { error: insErr } = await supabase.from('leads').insert({
        name: nombre,
        email,
        phone: tel || null,
        problem: esLibro
          ? '[Lista de espera] Libro "Ciencia en escena"'
          : '[Newsletter] Suscripción directa, sin evaluación',
        source: origen,
        client_id: CRITERIO_CLIENT_ID,
        ...permiso,
      })
      if (insErr) {
        console.error('[newsletter/subscribe] insert error:', insErr)
        return NextResponse.json({ error: 'No se pudo completar el alta.' }, { status: 500, headers: CORS_HEADERS })
      }
    }

    // Correo de bienvenida. Solo la primera vez: si vuelve a mandar el formulario
    // no tiene por qué recibirlo otra vez.
    if (!yaEstaba) {
      const resend = getResend()
      if (resend) {
        const { error: mailErr } = await resend.emails.send({
          from: SENDERS.marioCitalan,
          to: [email],
          replyTo: REPLY_TO,
          subject: esLibro
            ? 'Estás en la lista de "Ciencia en escena"'
            : 'Listo, estás suscrito',
          headers: {
            // Gmail y Apple Mail pintan un botón nativo de "Cancelar suscripción"
            // cuando existe esta cabecera, y ambos lo toman como señal de correo
            // legítimo. Sin ella, un remitente nuevo como mariocitalan@fishflow.mx
            // tiene muchas más probabilidades de caer en Promociones o en spam.
            'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=Baja%20de%20la%20lista>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          html: bienvenidaHtml(nombreDado, esLibro),
        })
        if (mailErr) console.error('[newsletter/subscribe] email error:', mailErr)
      } else {
        console.error('[newsletter/subscribe] RESEND_API_KEY no configurada')
      }
    }

    // `yaEstaba` deja que la página diga "ya estabas en la lista" en vez de
    // fingir un alta nueva.
    return NextResponse.json({ ok: true, yaEstaba }, { headers: CORS_HEADERS })
  } catch (err: unknown) {
    console.error('[newsletter/subscribe] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: CORS_HEADERS })
  }
}
