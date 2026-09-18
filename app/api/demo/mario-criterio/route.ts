import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { revisarAntibot, logDescarte } from '@/lib/antibot'

export const runtime = 'nodejs'

// client_id de "Mario Citalán — Arquitectura del Criterio" en la tabla `clients`.
// Panel propio en /app/mariocitalan, separado de TherapyOS (que es su consultorio).
const MARIO_CLIENT_ID = 'ea5266d5-cabb-44e2-a96a-0a0f40da07e7'

// CORS: el sitio público de Mario vive en su propio dominio (Hostinger) y hace
// POST a este endpoint. Sin credenciales, por eso '*' es aceptable.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// Al completar la Evaluación de Actitud o de Arquitectura Mental y del Criterio:
//   1) Se guarda el prospecto en Supabase (tabla `leads`) → panel /app/mariocitalan.
//   2) Aviso interno → Mario + Rafa con los datos del prospecto.
//   3) Al prospecto → su resultado (perfil + ruta recomendada).
const ADMIN_TO = ['mariocitalan@gmail.com', 'raf@fishflow.mx']

const DISCLAIMER =
  'Esta evaluación es una herramienta de desarrollo humano y autoconocimiento. ' +
  'No constituye una prueba psicológica, psiquiátrica ni diagnóstica, y sus resultados son orientativos.'

/** Aviso interno → Mario + Rafa. Marca de Mario (lib/emailLayout.ts). */
function adminHtml(d: {
  nombre: string; email: string; tel: string; perfil: string; ruta: string; test: string
}) {
  const ui = emailUI('mario')
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.nombre} · ${d.perfil}`,
    etiqueta: `Evaluación de ${d.test}`,
    titulo: 'Alguien completó tu evaluación',
    cuerpo:
      ui.tabla([
        ['Nombre', d.nombre],
        ['Correo', d.email],
        ['Teléfono', d.tel],
        ['Perfil', d.perfil],
        ['Ruta sugerida', d.ruta],
      ]) +
      ui.p('Responde este correo y le escribes directo a quien hizo la evaluación.') +
      ui.botones([{ texto: 'Ver en el panel', href: 'https://www.fishflow.mx/app/mariocitalan' }]),
  })
}

/** Resultado → prospecto. */
function leadHtml(d: {
  nombre: string; perfil: string; desc: string; ruta: string; ctaUrl: string; ctaLabel: string
  pdfUrl: string; pdfNombre: string
}) {
  const ui = emailUI('mario')
  const primer = d.nombre.trim().split(/\s+/)[0] || ''
  const regalo = d.pdfUrl
    ? ui.bloque(
        ui.rotulo('Tu material de regalo') +
          ui.botones([{ texto: `Descargar PDF · ${d.pdfNombre}`, href: d.pdfUrl, estilo: 'secundario' }])
      )
    : ''
  return ui.layout({
    audiencia: 'externo',
    preheader: `Tu perfil: ${d.perfil}. Tu siguiente paso: ${d.ruta}`,
    etiqueta: 'Tu resultado',
    titulo: primer ? `${primer}, este es tu resultado` : 'Este es tu resultado',
    cuerpo:
      ui.p('Gracias por completar tu evaluación. Este es tu perfil general:') +
      ui.dato('Tu perfil', d.perfil) +
      (d.desc ? ui.p(escHtml(d.desc)) : '') +
      regalo +
      ui.dato('Tu siguiente paso', d.ruta) +
      ui.botones([{ texto: d.ctaLabel, href: d.ctaUrl }]) +
      ui.p('Te escribo personalmente en menos de 24 horas hábiles con la lectura completa de tu resultado.') +
      ui.firma(),
    nota: DISCLAIMER,
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
      logDescarte('demo/mario-criterio', veredicto.motivo, body.email)
      return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
    }
    const nombre = (body.nombre ?? '').toString().trim()
    const email = (body.email ?? '').toString().trim()
    const tel = (body.tel ?? '').toString().trim()
    const perfil = (body.perfil ?? '').toString().trim()
    const ruta = (body.ruta ?? '').toString().trim()
    const desc = (body.desc ?? '').toString().trim()
    const link = (body.link ?? '').toString().trim()
    const test = (body.test ?? 'criterio').toString().trim().toLowerCase()
    const ctaLabel = (body.ctaLabel ?? 'Ver mi ruta recomendada').toString().trim()
    const pdf = (body.pdf ?? '').toString().trim()
    const pdfNombre = (body.pdfNombre ?? 'Tu PDF').toString().trim()
    const testLabel = test === 'actitud' ? 'Actitud' : 'Criterio'
    // Suscripción voluntaria al newsletter (casilla en el cuestionario)
    const optIn = body.optIn === true || body.optIn === 'true' || body.optIn === 1
    // Respuestas completas del cuestionario (para segmentar comunicaciones)
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : null

    if (!nombre || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: CORS_HEADERS })
    }

    /* Atribucion. Hasta el 2-sep-2026 estas evaluaciones se guardaban sin
       ninguna: 118 registros y cero idea de que canal los trajo. Mario invierte
       en radio, TV y conferencias, asi que sin esto no hay forma de saber que
       vale la pena repetir. Mismo patron que /api/demo/enlace-lead. Se recorta
       para que un query string inflado no ensucie la tabla. */
    const utm = (k: string) => {
      const v = (body[k] ?? '').toString().trim()
      return v ? v.slice(0, 200) : null
    }
    const landingUrl = (body.landing_url ?? '').toString().trim().slice(0, 500) || null
    const referrer = (body.referrer ?? '').toString().trim().slice(0, 500) || null

    // 1) Guardar el prospecto (best-effort: si falla, el usuario igual recibe su resultado)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey)
        const { error: dbErr } = await supabase.from('leads').insert({
          name: nombre,
          email: email.toLowerCase(),
          phone: tel || null,
          problem: `[Evaluación de ${testLabel}] Perfil: ${perfil || '—'}`,
          ai_response: desc || null,
          profile: perfil || null,
          route: ruta || null,
          answers,
          opt_in: optIn,
          source: test === 'actitud' ? 'actitud' : 'criterio',
          client_id: MARIO_CLIENT_ID,
          utm_source: utm('utm_source'),
          utm_medium: utm('utm_medium'),
          utm_campaign: utm('utm_campaign'),
          utm_content: utm('utm_content'),
          utm_term: utm('utm_term'),
          landing_url: landingUrl,
          referrer: referrer,
        })
        if (dbErr) console.error('[demo/mario-criterio] Supabase insert error:', dbErr)
      } else {
        console.error('[demo/mario-criterio] Falta SUPABASE_URL o SERVICE_ROLE_KEY')
      }
    } catch (e) {
      console.error('[demo/mario-criterio] Supabase error:', e)
    }

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      console.error('[demo/mario-criterio] RESEND_API_KEY no configurada')
      return NextResponse.json({ ok: false, note: 'email no configurado' }, { headers: CORS_HEADERS })
    }

    // URL absoluta del CTA hacia la ruta recomendada del demo
    let ctaUrl = 'https://www.fishflow.mx/demos/mariocitalan/index.html#soluciones'
    let pdfUrl = ''
    try {
      const reqOrigin = req.headers.get('origin') || new URL(req.url).origin
      const base = reqOrigin.includes('fishflow.mx')
        ? `${reqOrigin}/demos/mariocitalan/`
        : `${reqOrigin}/`
      ctaUrl = new URL(link || 'index.html#soluciones', base).toString()
      if (pdf) pdfUrl = new URL(pdf, base).toString()
    } catch (_) {}

    const resend = new Resend(resendKey)

    // 2) Aviso interno → Mario + Rafa
    const { error: adminErr } = await resend.emails.send({
      from: SENDERS.fishflow,
      to: ADMIN_TO,
      replyTo: email,
      subject: `Nueva evaluación de ${testLabel} — ${nombre} (${perfil})`,
      html: adminHtml({ nombre, email, tel, perfil, ruta, test: testLabel }),
    })
    if (adminErr) console.error('[demo/mario-criterio] admin email error:', adminErr)

    // 3) Resultado → prospecto
    const { error: leadErr } = await resend.emails.send({
      from: SENDERS.marioCitalan,
      to: [email],
      replyTo: 'raf@fishflow.mx',
      subject: `${nombre.split(' ')[0] || nombre}, tu resultado: ${perfil}`,
      html: leadHtml({ nombre, perfil, desc, ruta, ctaUrl, ctaLabel, pdfUrl, pdfNombre }),
    })
    if (leadErr) console.error('[demo/mario-criterio] lead email error:', leadErr)

    return NextResponse.json({ ok: !adminErr && !leadErr }, { headers: CORS_HEADERS })
  } catch (err: any) {
    console.error('[demo/mario-criterio] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: CORS_HEADERS })
  }
}
