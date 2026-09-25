/**
 * Borrador IA de los mensajes 2 (pedir reseña) y 3 (mandar link) del Módulo
 * de Reputación, a partir de lo que respondió el cliente.
 *
 * Lo usan /api/reviews/draft (tablero, envío manual por wa.me) y el bot de
 * WhatsApp (lib/whatsappBot.ts, envío automático por la Cloud API).
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full
}

// Persona genérica cuando el cliente no tiene ai_persona configurado.
function genericPersona(business: string) {
  return `Eres el dueño de ${business || 'un negocio local en México'}. Le escribes de tú a tú a un cliente, como el dueño que eres: cordial, directo y cercano. Nada de lenguaje corporativo ni de marketing.`
}

export type DraftResult = { ok: true; draft: string } | { ok: false; status: number; error: string }

/**
 * @param stg     etapa ACTUAL del request: 1 → genera msg 2; 2 → genera msg 3 (con link)
 * @param linkOverride link a usar en el msg 3 (p. ej. el rastreado /r/<id>/)
 */
export async function generateReviewDraft(args: {
  clientId: string
  stg: 1 | 2
  reply: string
  contactName?: string | null
  linkOverride?: string | null
}): Promise<DraftResult> {
  const { stg, reply, contactName } = args
  const clienteAutorizado = args.clientId
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: 25_000 })

  // ── 1. Configuración del cliente (voz, negocio, plantilla base, link) ──────
  const { data: settings, error: sErr } = await supabaseAdmin
    .from('review_settings')
    .select('business_display_name, review_link, msg_template_2, msg_template_3, ai_persona, ai_sensitive')
    .eq('client_id', clienteAutorizado)
    .maybeSingle()

  if (sErr) {
    console.error('[reviews/draft] settings error:', sErr)
    return { ok: false, status: 500, error: 'No se pudo leer la configuración' }
  }

  const business = settings?.business_display_name ?? ''
  const persona = settings?.ai_persona?.trim() || genericPersona(business)
  const reviewLink = args.linkOverride || settings?.review_link || ''
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
  if (!draft) return { ok: false, status: 502, error: 'No se pudo generar el mensaje. Intenta de nuevo.' }
  return { ok: true, draft }
}
