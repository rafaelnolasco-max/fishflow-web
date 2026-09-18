import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS, enlaceNotifyTo, ENLACE_DEFAULT_TO } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'
import { corsHeaders, preflight } from '@/lib/cors'
import { revisarAntibot, logDescarte } from '@/lib/antibot'

export const runtime = 'nodejs'

// La landing productiva vive en enlaceintegralseguros.com (otro proyecto de
// Vercel), así que esta ruta se llama cross-origin. Ver lib/cors.ts.
export async function OPTIONS(req: Request) {
  return preflight(req)
}

// Captura de leads de la landing de Enlace Integral Seguros (/demos/enlaceintegral).
// 1) Guarda el lead en Supabase (tabla `leads`, visible en /admin → Leads).
// 2) Envía aviso inmediato por Resend a Rafa (y opcionalmente al asesor).
// Reutiliza la infraestructura existente; no requiere migración.

// client_id de Enlace Integral en la tabla `clients` (multi-tenant).
// Los leads de la landing quedan etiquetados a Enlace → Ivonne solo ve los suyos
// en /app/enlace, separados de los leads generales de FishFlow en /admin.
const ENLACE_CLIENT_ID = 'e8094119-0414-4d46-8506-6ee1a52e852c'

// Destinatarios del aviso (Rafa + Enlace). Centralizado en lib/email.ts —
// ver la nota ahí sobre por qué `contacto@...com.mx` no sirve.

const PLAN_LABEL: Record<string, string> = {
  ahorro: 'Ahorro para el retiro (OptiMaxx Plus)',
  vida: 'Protección de vida',
  gmm: 'Gastos médicos mayores',
  educacion: 'Ahorro educativo',
}

/**
 * Horario de atención de Enlace, en CDMX (UTC-6 fijo, sin horario de verano —
 * ver lib/socialTargets.ts). Confirmado por Edna Cruz el 2026-08-27:
 * **lunes a viernes de 9:00 a 17:00. No se atiende sábado ni domingo.**
 * Devuelve la frase que se le promete al prospecto en el acuse de recibo.
 * Sin esto, quien llena el cuestionario un viernes a las 22:00 se queda en
 * silencio hasta el lunes y para entonces ya cotizó en otro lado.
 */
const CDMX_OFFSET_MS = -6 * 60 * 60 * 1000
const ABRE = 9
const CIERRA = 17
function siguienteContacto(nowUtc: Date = new Date()): string {
  const cdmx = new Date(nowUtc.getTime() + CDMX_OFFSET_MS)
  const dia = cdmx.getUTCDay()          // 0 = domingo, 6 = sábado
  const hora = cdmx.getUTCHours()

  if (dia === 0) return 'mañana lunes a partir de las 9:00 de la mañana'
  if (dia === 6) return 'el lunes a partir de las 9:00 de la mañana'
  if (hora < ABRE) return 'hoy mismo, a partir de las 9:00 de la mañana'
  if (hora < CIERRA) return 'dentro de la próxima hora'
  // Ya cerró, entre semana
  if (dia === 5) return 'el lunes a partir de las 9:00 de la mañana'
  return 'mañana a partir de las 9:00 de la mañana'
}

/** Acuse de recibo para el PROSPECTO. Confirma, fija expectativa y deja salida por WhatsApp. */
function prospectoHtml(d: { nombre: string; plan: string; cuando: string; wa: string }) {
  const ui = emailUI('enlace')
  const primerNombre = d.nombre.trim().split(/\s+/)[0] || ''
  return ui.layout({
    audiencia: 'externo',
    preheader: `Tu plan recomendado: ${d.plan}. Un asesor te contacta ${d.cuando}.`,
    titulo: `Recibimos tus datos${primerNombre ? ', ' + primerNombre : ''}`,
    cuerpo:
      ui.p(
        'Gracias por tomarte el minuto para responder el cuestionario. Según tus respuestas, ' +
          'el plan que mejor se ajusta a lo que buscas es:'
      ) +
      ui.dato('Tu plan recomendado', d.plan) +
      ui.p(
        `<strong>Un asesor te contacta ${escHtml(d.cuando)}</strong> para explicarte las opciones ` +
          'sin compromiso y resolver tus dudas.'
      ) +
      ui.p('¿Prefieres adelantarlo? Escríbenos directo:') +
      ui.botones([{ texto: 'Hablar por WhatsApp', href: d.wa }]),
    nota:
      'Tus datos se usan únicamente para contactarte sobre tu solicitud. ' +
      'Si no deseas que te contactemos, responde este correo y lo damos de baja.',
  })
}

/** Aviso al equipo de Enlace (y Rafa). */
function adminHtml(d: Record<string, string>) {
  const ui = emailUI('enlace')
  const tel = String(d.whatsapp ?? '').replace(/\D/g, '')
  return ui.layout({
    audiencia: 'interno',
    preheader: `${d.nombre} · ${d.plan}`,
    etiqueta: 'Nuevo prospecto',
    titulo: 'Llegó un prospecto desde tu página',
    cuerpo:
      ui.tabla([
        ['Nombre', d.nombre],
        ['WhatsApp', d.whatsapp],
        ['Correo', d.email],
        ['Plan recomendado', d.plan],
        ['Objetivo', d.objetivo],
        ['Edad', d.edad],
        ['Dependientes', d.dependientes],
        ['Capacidad mensual', d.capacidad],
        ['Ocupación', d.ocupacion],
        ['Origen', d.origen],
      ]) +
      ui.botones([
        { texto: 'Escribirle por WhatsApp', href: tel ? `https://wa.me/52${tel}` : '' },
        { texto: 'Ver en el panel', href: 'https://www.fishflow.mx/app/enlace', estilo: 'secundario' },
      ]),
    nota: 'Llegó desde el cuestionario de enlaceintegralseguros.com.',
  })
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'))
  try {
    const b = await req.json().catch(() => ({}))

    // Filtro antibot (ver lib/antibot.ts). Mismo tratamiento que en los
    // formularios de Mario: se responde como un alta buena y no se guarda ni
    // se manda nada. El CORS de arriba solo frena al navegador; un POST con
    // curl lo ignora y llegaba hasta el insert.
    const veredicto = revisarAntibot(req, b)
    if (!veredicto.ok) {
      logDescarte('demo/enlace-lead', veredicto.motivo, b.email)
      return NextResponse.json({ ok: true, cuando: siguienteContacto() }, { headers: cors })
    }
    const nombre = (b.nombre ?? '').toString().trim()
    const whatsapp = (b.whatsapp ?? '').toString().trim()
    const email = (b.email ?? '').toString().trim().toLowerCase()
    const segmento = (b.segmento ?? '').toString().trim()
    const plan = PLAN_LABEL[segmento] || (b.plan_recomendado ?? '').toString().trim() || '—'
    const objetivo = (b.objetivo ?? '').toString().trim()
    const edad = (b.edad ?? '').toString().trim()
    const dependientes = (b.dependientes ?? '').toString().trim()
    const capacidad = (b.capacidad ?? '').toString().trim()
    const ocupacion = (b.ocupacion ?? '').toString().trim()

    /* Atribucion. Los anuncios de la pauta mandan
         ?utm_source=facebook&utm_medium=paid&utm_campaign=lal1_sep2026&utm_content=<ppr|sat|tanda|universidad>
       y la landing los reenvia aqui. Sin esto no hay forma de separar un lead
       pagado de uno organico, y el costo por prospecto que se le reporta al
       cliente seria una adivinanza. Se recorta a 200 para que un query string
       inflado no ensucie la tabla. */
    const utm = (k: string) => {
      const v = (b[k] ?? '').toString().trim()
      return v ? v.slice(0, 200) : null
    }
    const utmSource = utm('utm_source')
    const utmMedium = utm('utm_medium')
    const utmCampaign = utm('utm_campaign')
    const utmContent = utm('utm_content')
    const utmTerm = utm('utm_term')
    const landingUrl = (b.landing_url ?? '').toString().trim().slice(0, 500) || null
    const referrer = (b.referrer ?? '').toString().trim().slice(0, 500) || null
    const origen = utmCampaign
      ? `${utmSource || 'desconocido'} / ${utmCampaign}${utmContent ? ' / ' + utmContent : ''}`
      : 'Organico (sin UTM)'

    if (!nombre || !whatsapp) {
      return NextResponse.json({ error: 'Falta nombre o WhatsApp.' }, { status: 400, headers: cors })
    }

    /* Se calcula UNA sola vez y se usa en dos lugares: el acuse por correo y
       la respuesta al navegador (la pantalla de gracias). Antes la landing
       decia "muy pronto" y el correo daba una hora concreta: si el prospecto
       entraba un viernes 22:00 leia dos promesas distintas. Una sola fuente. */
    const cuando = siguienteContacto()

    const resumen = [
      '[Landing Enlace Integral]',
      `Plan: ${plan}`,
      `WhatsApp: ${whatsapp}`,
      `Objetivo: ${objetivo}`,
      `Edad: ${edad}`,
      `Dependientes: ${dependientes}`,
      `Capacidad: ${capacidad}`,
      `Ocupación: ${ocupacion}`,
    ].join(' · ')

    // 1) Guardar en Supabase (best-effort; no bloquea al usuario si falla)
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { error } = await supabase.from('leads').insert({
        name: nombre,
        email: email || `wa-${whatsapp.replace(/\D/g, '')}@enlace.local`,
        // El WhatsApp tambien va en su propia columna. Antes solo vivia dentro
        // del texto de `problem`, asi que toda vista o export que leyera
        // `leads.phone` mostraba el prospecto sin telefono.
        phone: whatsapp || null,
        problem: resumen,
        ai_response: `Plan recomendado: ${plan}`,
        source: 'enlace_landing',
        client_id: ENLACE_CLIENT_ID,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
        landing_url: landingUrl,
        referrer: referrer,
      })
      if (error) console.error('[demo/enlace-lead] Supabase insert error:', error)
    } catch (e) {
      console.error('[demo/enlace-lead] Supabase error:', e)
    }

    // 2) Aviso inmediato por correo
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)
      const { error: mailErr } = await resend.emails.send({
        from: SENDERS.enlace,
        to: enlaceNotifyTo(),
        replyTo: email || undefined,
        subject: `Nuevo lead — ${nombre} · ${plan}`,
        html: adminHtml({ nombre, whatsapp, email, plan, objetivo, edad, dependientes, capacidad, ocupacion, origen }),
      })
      if (mailErr) console.error('[demo/enlace-lead] email error:', mailErr)

      // 3) Acuse de recibo al PROSPECTO. Solo si dejó correo — en el formulario
      //    es opcional, así que esto NO cubre a todos. Falla en silencio: si el
      //    acuse rebota, el lead ya quedó guardado y Enlace ya fue avisada.
      if (email) {
        const wa = `https://wa.me/5215516859769?text=${encodeURIComponent(
          `Hola, soy ${nombre}. Acabo de llenar el cuestionario y me interesa el ${plan}.`
        )}`
        const { error: ackErr } = await resend.emails.send({
          from: SENDERS.enlace,
          to: email,
          replyTo: ENLACE_DEFAULT_TO,
          subject: 'Recibimos tus datos — Enlace Integral Seguros',
          html: prospectoHtml({ nombre, plan, cuando, wa }),
        })
        if (ackErr) console.error('[demo/enlace-lead] acuse al prospecto error:', ackErr)
      }
    } else {
      console.error('[demo/enlace-lead] RESEND_API_KEY no configurada')
    }

    return NextResponse.json({ ok: true, cuando }, { headers: cors })
  } catch (err: any) {
    console.error('[demo/enlace-lead] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500, headers: cors })
  }
}
