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


// ─── Test DERVIAC · "Descubre qué influye en tus decisiones" (sep-2026) ──────
// A diferencia de Actitud y Criterio, este test NO da un perfil ni una
// calificación: devuelve los dos "territorios" con mayor puntaje, cada uno con
// su texto y su pregunta de reflexión. Los textos viven aquí (no llegan del
// navegador) para que nadie pueda usar el endpoint para mandar contenido
// arbitrario a un tercero; el navegador solo manda las claves.
const TERRITORIOS: Record<string, { nombre: string; texto: string; pregunta: string }> = {
  interpretacion: {
    nombre: "Interpretación",
    texto: "A veces decidimos a partir de lo que creemos que ocurrió, sin haberlo comprobado. Tus respuestas invitan a observar cómo interpretas las acciones de otras personas y qué das por hecho cuando una situación te preocupa. Una primera pista puede estar en distinguir lo que sabes de lo que supones.",
    pregunta: "¿Hay alguna decisión que hayas tomado, o sigas tomando, sin haber comprobado su veracidad?",
  },
  aprendido: {
    nombre: "Lo aprendido",
    texto: "Lo que has vivido puede influir en lo que esperas de una situación y en lo que crees posible para ti. Algunas ideas que aprendiste hace tiempo quizá sigan participando en tus decisiones actuales.",
    pregunta: "¿Hay algo que hoy estás dejando de intentar por una idea que tienes sobre ti?",
  },
  automatico: {
    nombre: "Lo automático",
    texto: "Hay maneras de responder que, con el tiempo, se vuelven habituales. Pueden aparecer tan rápido que solo después de haber tomado la decisión nos detenemos a pensar qué hicimos. Observar cuándo se repiten puede abrir espacio para responder de otra forma.",
    pregunta: "¿Qué respuesta repites incluso cuando sabes que no suele ayudarte?",
  },
  presion: {
    nombre: "La presión",
    texto: "La presión puede cambiar la manera en que decides. Cuando hay poco tiempo, preocupación o expectativas de otras personas, quizá consideres menos posibilidades o busques terminar cuanto antes con la incomodidad.",
    pregunta: "¿Qué cosas consideras que tomarías en cuenta si pudieras decidir con menos presión?",
  },
  criterio: {
    nombre: "El criterio",
    texto: "Tener clara una opción no siempre significa haberla examinado totalmente. Tus respuestas invitan a observar qué alternativas consideras, qué consecuencias anticipas y en qué basas la idea de que algo te conviene.",
    pregunta: "¿Actualmente qué razones sostienen una decisión que consideras correcta?",
  },
  accion: {
    nombre: "La acción",
    texto: "Tomar una decisión y llevarla a la práctica son momentos distintos. A veces sabemos qué queremos hacer, pero lo postergamos o volvemos a una conducta conocida. Mirar esa distancia puede ayudar a comprender qué está ocurriendo.",
    pregunta: "¿Qué podrías hacer hoy para empezar a llevar a la práctica esa decisión que está postergada?",
  },
}

const PREGUNTA_GENERAL = '¿Qué podrías estar dejando de considerar cuando decides?'

/** Resultado del Test DERVIAC → prospecto. */
function decisionesLeadHtml(d: {
  nombre: string; territorios: string[]; alerta: boolean; programaUrl: string; boletinUrl: string
}) {
  const ui = emailUI('mario')
  const primer = d.nombre.trim().split(/\s+/)[0] || ''
  const mapa = d.territorios
    .map((k) => TERRITORIOS[k])
    .filter(Boolean)
    .map((t) =>
      ui.bloque(
        ui.rotulo(t.nombre) +
          ui.p(escHtml(t.texto)) +
          `<p style="margin:0;font-family:Georgia,serif;font-style:italic;font-size:17px;line-height:1.45;color:#2A6AAE">${escHtml(t.pregunta)}</p>`
      )
    )
    .join('')
  const alerta = d.alerta
    ? ui.bloque(
        ui.rotulo('Una recomendación importante') +
          ui.p('Por lo que nos compartes, te recomendamos buscar una valoración con un profesional de la salud mental (psicólogo o psiquiatra) que pueda acompañarte en lo que estás viviendo.') +
          ui.p('El Programa de Desarrollo Personal DERVIAC no es psicoterapia ni sustituye la atención psicológica o psiquiátrica cuando ésta se requiere.'),
        'aviso'
      )
    : ''
  return ui.layout({
    audiencia: 'externo',
    preheader: 'Tu Mapa DERVIAC: algunos aspectos que podrían estar influyendo en tus decisiones.',
    etiqueta: 'Tu Mapa DERVIAC',
    titulo: primer ? `${primer}, este es tu Mapa DERVIAC` : 'Este es tu Mapa DERVIAC',
    cuerpo:
      ui.p('Gracias por hacer el test <strong>Descubre qué influye en tus decisiones</strong>.') +
      mapa +
      (mapa
        ? ui.p('Estos son algunos aspectos que, según tus respuestas, podría valer la pena que identifiques. No son una calificación. No son los únicos que influyen en tus decisiones. Son un punto de partida para observar cómo decides y descubrir qué más podría estar influyendo en ti.')
        : '') +
      ui.p('A veces, una pregunta nos ayuda a mirar con más claridad una decisión. Ojalá este resultado te invite a observarte con curiosidad, sin juzgarte, y a descubrir algo que te ayude a seguir creciendo.') +
      ui.dato('Una pregunta para ti', PREGUNTA_GENERAL) +
      alerta +
      ui.p('Si quieres profundizar en esta pregunta, te invitamos a conocer el Programa de Desarrollo Personal DERVIAC: una experiencia para comprender mejor tu manera de decidir y desarrollar un criterio más claro para responder a las situaciones que se presentan en tu vida.') +
      ui.botones([{ texto: 'Conocer el programa DERVIAC', href: d.programaUrl }]) +
      ui.p('También recuerda que, si quieres saber más sobre decisiones, criterio, creencias, emociones, estructura mental y demás temas que tienen que ver con tu desarrollo personal y toma de decisiones, puedes suscribirte a nuestro boletín. Compartiremos reflexiones y contenidos DERVIAC para comprender mejor cómo decidimos.') +
      ui.botones([{ texto: 'Quiero recibir el boletín', href: d.boletinUrl, estilo: 'secundario' }]) +
      ui.firma(),
    nota:
      'El Test DERVIAC es una herramienta de desarrollo humano y autoconocimiento. No es una calificación ni constituye una prueba psicológica, psiquiátrica o diagnóstica.',
  })
}

/** Aviso interno del Test DERVIAC → Mario + Rafa. */
function decisionesAdminHtml(d: {
  nombre: string; email: string; tel: string; mapa: string; alerta: boolean
  modalidad: string; grupal: string; busca: string; afectacion: string; atencion: string
}) {
  const ui = emailUI('mario')
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.nombre} · ${d.mapa}${d.alerta ? ' · requiere atención' : ''}`,
    etiqueta: 'Test DERVIAC',
    titulo: 'Alguien completó el Test DERVIAC',
    cuerpo:
      (d.alerta
        ? ui.bloque(
            ui.rotulo('Atención') +
              ui.p('Esta persona indicó una afectación importante o una posible necesidad de atención psicológica o psiquiátrica. Su resultado incluyó la recomendación de buscar valoración profesional.'),
            'aviso'
          )
        : '') +
      ui.tabla([
        ['Nombre', d.nombre],
        ['Correo', d.email],
        ['Teléfono', d.tel],
        ['Territorios', d.mapa],
        ['Modalidad preferida', d.modalidad],
        ['Experiencia grupal', d.grupal],
        ['Qué busca', d.busca],
        ['Afectación', d.afectacion],
        ['Atención psicológica', d.atencion],
      ]) +
      ui.p('Responde este correo y le escribes directo a quien hizo el test.') +
      ui.botones([{ texto: 'Ver en el panel', href: 'https://www.fishflow.mx/app/mariocitalan' }]),
  })
}

type DatosComunes = {
  nombre: string; email: string; tel: string; optIn: boolean; answers: unknown
  utm: (k: string) => string | null; landingUrl: string | null; referrer: string | null
}

async function manejarDecisiones(req: Request, body: Record<string, unknown>, d: DatosComunes) {
  const txt = (k: string) => (body[k] ?? '').toString().trim().slice(0, 300)
  const territorios = (Array.isArray(body.territorios) ? body.territorios : [])
    .map((k) => String(k))
    .filter((k) => k in TERRITORIOS)
    .slice(0, 2)
  const alerta = body.alerta === true
  const mapa = territorios.length ? territorios.map((k) => TERRITORIOS[k].nombre).join(' · ') : 'Sin territorios destacados'
  const modalidad = txt('modalidad'), grupal = txt('grupal'), busca = txt('busca')
  const afectacion = txt('afectacion'), atencion = txt('atencion')

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey)
      const { error: dbErr } = await supabase.from('leads').insert({
        name: d.nombre,
        email: d.email.toLowerCase(),
        phone: d.tel || null,
        problem: `[Test DERVIAC] ${mapa}${alerta ? ' · ⚠ recomendar valoración profesional' : ''}`,
        profile: mapa,
        route: modalidad || null,
        answers: d.answers && typeof d.answers === 'object' ? d.answers : null,
        opt_in: d.optIn,
        source: 'decisiones',
        client_id: MARIO_CLIENT_ID,
        utm_source: d.utm('utm_source'),
        utm_medium: d.utm('utm_medium'),
        utm_campaign: d.utm('utm_campaign'),
        utm_content: d.utm('utm_content'),
        utm_term: d.utm('utm_term'),
        landing_url: d.landingUrl,
        referrer: d.referrer,
      })
      if (dbErr) console.error('[demo/mario-criterio] decisiones insert error:', dbErr)
    }
  } catch (e) {
    console.error('[demo/mario-criterio] decisiones Supabase error:', e)
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return NextResponse.json({ ok: false, note: 'email no configurado' }, { headers: CORS_HEADERS })

  let base = 'https://www.fishflow.mx/demos/mariocitalan/'
  try {
    const reqOrigin = req.headers.get('origin') || new URL(req.url).origin
    base = reqOrigin.includes('fishflow.mx') ? `${reqOrigin}/demos/mariocitalan/` : `${reqOrigin}/`
  } catch (_) {}
  const programaUrl = new URL('programa-personal.html', base).toString()
  const boletinUrl = new URL('index.html#newsletter', base).toString()

  const resend = new Resend(resendKey)
  const { error: adminErr } = await resend.emails.send({
    from: SENDERS.fishflow,
    to: ADMIN_TO,
    replyTo: d.email,
    subject: `${alerta ? '⚠ ' : ''}Nuevo Test DERVIAC — ${d.nombre} (${mapa})`,
    html: decisionesAdminHtml({ nombre: d.nombre, email: d.email, tel: d.tel, mapa, alerta, modalidad, grupal, busca, afectacion, atencion }),
  })
  if (adminErr) console.error('[demo/mario-criterio] decisiones admin email error:', adminErr)

  const { error: leadErr } = await resend.emails.send({
    from: SENDERS.marioCitalan,
    to: [d.email],
    replyTo: 'mariocitalan@gmail.com',
    subject: `${d.nombre.split(' ')[0] || d.nombre}, tu Mapa DERVIAC`,
    html: decisionesLeadHtml({ nombre: d.nombre, territorios, alerta, programaUrl, boletinUrl }),
  })
  if (leadErr) console.error('[demo/mario-criterio] decisiones lead email error:', leadErr)

  return NextResponse.json({ ok: !adminErr && !leadErr }, { headers: CORS_HEADERS })
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

    // Test DERVIAC: sin perfil ni calificación, con su propio correo (ver arriba).
    if (test === 'decisiones') {
      return await manejarDecisiones(req, body, { nombre, email, tel, optIn, answers, utm, landingUrl, referrer })
    }

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
