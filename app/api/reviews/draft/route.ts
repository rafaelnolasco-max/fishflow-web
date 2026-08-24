import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { requireClientAccess } from '@/lib/apiAuth'

// ─── Clientes ────────────────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full
}

// Persona genérica cuando el cliente no tiene ai_persona configurado.
function genericPersona(business: string) {
  return `Eres el dueño de ${business || 'un negocio local en México'}. Le escribes de tú a tú a un cliente, como el dueño que eres: cordial, directo y cercano. Nada de lenguaje corporativo ni de marketing.`
}

// ─── Handler ─────────────────────────────────────────────────────────────────
// Genera el borrador del mensaje 2 (pedir reseña) o 3 (mandar link) tomando en
// cuenta la respuesta que el cliente dio por WhatsApp (pegada a mano en el
// tablero). Solo redacta el texto; el envío sigue siendo manual por wa.me.

export async function POST(req: NextRequest) {
  try {
    const { clientId, stage, reply, contactName } = await req.json()

    // stage = etapa ACTUAL del request. 1 = saludo enviado → generar msg 2.
    // 2 = petición enviada → generar msg 3 (con link).
    const stg = Number(stage)
    if (!clientId || (stg !== 1 && stg !== 2)) {
      return NextResponse.json(
        { error: 'clientId y stage (1 o 2) son requeridos' },
        { status: 400 }
      )
    }
    if (!reply?.trim()) {
      return NextResponse.json(
        { error: 'Pega la respuesta del cliente para generar el mensaje' },
        { status: 400 }
      )
    }

    // Candado. La ruta gasta tokens de Anthropic y devuelve un mensaje escrito
    // con la voz (ai_persona) del negocio: sin sesión, cualquiera con un
    // client_id podía sacarla. Mismo patrón que /api/content/schedule.
    const auth = await requireClientAccess(String(clientId))
    if (!auth.ok) return auth.response

    // ── 1. Configuración del cliente (voz, negocio, plantilla base, link) ──────
    const { data: settings, error: sErr } = await supabaseAdmin
      .from('review_settings')
      .select('business_display_name, review_link, msg_template_2, msg_template_3, ai_persona, ai_sensitive')
      .eq('client_id', clientId)
      .maybeSingle()

    if (sErr) {
      console.error('[reviews/draft] settings error:', sErr)
      return NextResponse.json({ error: 'No se pudo leer la configuración' }, { status: 500 })
    }

    const business = settings?.business_display_name ?? ''
    const persona = settings?.ai_persona?.trim() || genericPersona(business)
    const reviewLink = settings?.review_link ?? ''
    const baseTpl = stg === 1 ? settings?.msg_template_2 : settings?.msg_template_3
    const name = firstName(contactName ?? 'el cliente')
    // Verticales sensibles (salud, terapia): el borrador NO puede reproducir
    // contenido clínico de la respuesta del paciente. Ver review_settings.ai_sensitive.
    const sensitive = settings?.ai_sensitive === true

    // ── 2. System prompt: persona + tarea ─────────────────────────────────────
    const system = `${persona}

Le escribes por WhatsApp a un cliente para conseguir una reseña en Google. Hablas TÚ, no una marca ni un asistente de IA.

Tono: español de México, natural. Tuteo. Breve (2 a 4 líneas). Sin signos de apertura recargados, sin frases corporativas, máximo 1 emoji.

${
  stg === 1
    ? `Objetivo de este mensaje: pedirle amablemente que te deje una reseña en Google. Todavía NO mandes el link (va en el siguiente mensaje).`
    : `Objetivo de este mensaje: mandarle el link para que deje la reseña. Incluye el link de forma natural: ${reviewLink || '{link}'}`
}

Plantilla base (úsala como referencia de estilo, adáptala a la respuesta):
"${baseTpl ?? ''}"

Reglas:
1. Redacta tomando en cuenta LO QUE EL CLIENTE ACABA DE RESPONDER. Reconócelo antes de pedir.
2. Si la respuesta menciona algo del servicio (una duda, una falla, soporte, algo técnico): atiéndelo primero como el dueño, ofrece resolverlo, y NO fuerces la reseña — sugiere pedirla después.
3. Si el cliente suena molesto o insatisfecho: nada de link de reseña; ofrece una llamada para resolverlo.
4. Devuelve SOLO el texto del mensaje listo para enviar, sin comillas ni explicaciones.${
      sensitive
        ? `

CONFIDENCIALIDAD (obligatorio, este es un servicio de salud):
5. NUNCA repitas, parafrasees ni aludas al contenido de salud que la persona haya mencionado: síntomas, diagnósticos, medicamentos, emociones, sueño, ansiedad, avances o retrocesos del tratamiento. Ese mensaje puede ser leído por alguien más en su teléfono.
6. Agradece en términos neutros y generales ("me da mucho gusto saber de ti", "gracias por contarme"). Sin adjetivos que revelen cómo va su proceso.
7. No menciones el tipo de tratamiento ni el motivo de consulta.
8. Si la persona expresa malestar emocional o algo delicado: NO pidas reseña ni mandes link. Responde con calidez y ofrécele agendar un espacio para platicarlo.`
        : ''
    }`

    const userMsg = `Cliente: ${name}
Respuesta del cliente por WhatsApp: "${reply.trim()}"`

    // ── 3. Haiku ──────────────────────────────────────────────────────────────
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userMsg }],
    })

    const draft = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!draft) {
      return NextResponse.json({ error: 'No se pudo generar el mensaje. Intenta de nuevo.' }, { status: 502 })
    }

    return NextResponse.json({ draft })
  } catch (err: any) {
    console.error('[reviews/draft] Error:', err?.message ?? err)
    return NextResponse.json(
      { error: 'Error al generar el mensaje. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
