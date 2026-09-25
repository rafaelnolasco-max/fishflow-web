/**
 * Cerebro de la línea WhatsApp de FishFlow (+52 56 1059 7851).
 *
 * Lo llama /api/whatsapp/webhook con after() por cada mensaje entrante, ya
 * guardado en whatsapp_messages. Dos rutas:
 *
 *  1. RESEÑAS — si el número tiene una solicitud activa del Módulo de
 *     Reputación de FishFlow en etapa 1 o 2, la respuesta alimenta el borrador
 *     IA (lib/reviewDraft) y el siguiente mensaje sale solo por la API.
 *
 *  2. ASISTENTE — fuera de horario (lun–vie 9:00–18:00 CDMX) contesta Haiku
 *     con la información de FishFlow, sin precios. Si detecta intención de
 *     compra, avisa a Rafa con 🔥, pausa el bot 24 h con ese contacto y le dice
 *     al cliente que Rafa le escribe. En horario no contesta: solo el correo
 *     de aviso que ya manda el webhook.
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { sendText } from '@/lib/whatsapp'
import { generateReviewDraft } from '@/lib/reviewDraft'
import { sendEmail } from '@/lib/email'

// Mismo valor que FISHFLOW_CLIENT_ID de lib/supabase.ts (no se importa de ahí:
// ese módulo crea un cliente de navegador al cargarse).
const FISHFLOW_CLIENT_ID = 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42'
const TZ = 'America/Mexico_City'
const ADMIN_NOTIFY_TO = 'rafaelnolasco@gmail.com'
const PAUSE_MS = 24 * 60 * 60 * 1000

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const last10 = (s: string) => s.replace(/\D/g, '').slice(-10)

/** Lunes a viernes de 9:00 a 17:59, hora de CDMX. */
export function enHorario(d = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(d)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  return !['Sat', 'Sun'].includes(wd) && h >= 9 && h < 18
}

// ─── 1. Reseñas ───────────────────────────────────────────────────────────────

async function tryReviewFlow(waId: string, name: string | null, text: string): Promise<boolean> {
  const { data: reqs } = await db()
    .from('review_requests')
    .select('id, contact_name, contact_phone, stage, status')
    .eq('client_id', FISHFLOW_CLIENT_ID)
    .eq('status', 'active')
    .in('stage', [1, 2])
    .order('updated_at', { ascending: false })
    .limit(200)
  const r = (reqs ?? []).find((x) => last10(x.contact_phone ?? '') === last10(waId))
  if (!r) return false

  const stg = r.stage as 1 | 2
  const draft = await generateReviewDraft({
    clientId: FISHFLOW_CLIENT_ID,
    stg,
    reply: text,
    contactName: r.contact_name ?? name,
    linkOverride: stg === 2 ? `https://www.fishflow.mx/r/${r.id}/` : null,
  })
  if (!draft.ok) {
    console.error('[wa-bot] borrador de reseña falló', r.id, draft.error)
    return true // es conversación de reseña: no la mandes al asistente
  }

  const sent = await sendText({ to: waId, body: draft.draft, clientId: FISHFLOW_CLIENT_ID, sentBy: 'bot' })
  const now = new Date().toISOString()
  const next = stg + 1
  const patch: Record<string, unknown> = {
    [`reply_${stg}`]: text,
    [`draft_${next}`]: draft.draft,
    updated_at: now,
  }
  if (sent.ok) {
    patch.stage = next
    patch[`stage${next}_sent_at`] = now
  }
  const { error } = await db().from('review_requests').update(patch).eq('id', r.id)
  if (error) console.error('[wa-bot] update review_request', error)
  return true
}

// ─── 2. Asistente ─────────────────────────────────────────────────────────────

const ASSISTANT_PROMPT = `Eres el asistente de WhatsApp de FishFlow y contestas fuera de horario, mientras Rafa Fish (el fundador) no está disponible.

Sobre FishFlow:
- Empresa mexicana (CDMX) de automatización e inteligencia artificial para micro y pequeños negocios: estéticas, consultorios, talleres, restaurantes, cafeterías, despachos.
- Hace sistemas a la medida: agenda y confirmación de citas, recordatorios y avisos por WhatsApp, cobros y recibos, reseñas en Google, seguimiento de clientes, contenido para redes, tableros de ventas.
- Dos formas de trabajar: plataforma con renta mensual, o servicio administrado donde FishFlow opera todo.
- Primer paso: un diagnóstico gratuito de 30 minutos. Se agenda en https://www.fishflow.mx/#agenda
- Correo: raf@fishflow.mx. Horario de atención humana: lunes a viernes de 9 a 18 h.

Reglas:
1. Español de México, de tú, cálido y breve (2 a 4 líneas). Máximo 1 emoji. Nada de "soluciones integrales" ni frases de marketing.
2. NUNCA des precios ni rangos: toda propuesta es a la medida después del diagnóstico. Si preguntan precio, dilo así e invita a agendar.
3. No inventes clientes, cifras ni funciones que no estén arriba. Si no sabes algo, di que Rafa le responde en horario.
4. Cierra casi siempre invitando a agendar el diagnóstico.
5. Hay INTENCIÓN DE COMPRA si la persona pregunta precio o costo, dice que le interesa contratar, pide propuesta o cotización, quiere empezar, o pide hablar con alguien. En ese caso marca handoff=true y en tu respuesta dile que Rafa le escribe personalmente en cuanto esté disponible (y aun así deja el enlace para agendar).
6. Si es spam, un proveedor ofreciendo algo o algo sin relación, responde con una línea cortés y handoff=false.

Responde SOLO con JSON válido, sin texto extra: {"reply": "<mensaje>", "handoff": true|false}`

async function assistant(waId: string, name: string | null, text: string) {
  if (enHorario()) return

  const sb = db()
  const { data: contact } = await sb
    .from('whatsapp_contacts').select('bot_paused_until').eq('wa_id', waId).maybeSingle()
  if (contact?.bot_paused_until && new Date(contact.bot_paused_until).getTime() > Date.now()) return

  const { data: hist } = await sb
    .from('whatsapp_messages')
    .select('direction, body, created_at')
    .eq('contact_wa_id', waId)
    .order('created_at', { ascending: false })
    .limit(12)
  const turns = (hist ?? []).reverse()
    .filter((m) => m.body)
    .map((m) => ({ role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const, content: m.body as string }))
  // La API exige alternancia y que empiece con user: fusionar consecutivos.
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  for (const t of turns) {
    const prev = messages[messages.length - 1]
    if (prev && prev.role === t.role) prev.content += `\n${t.content}`
    else messages.push({ ...t })
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: text })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: 20_000 })
  let reply = ''
  let handoff = false
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `${ASSISTANT_PROMPT}\n\nNombre del contacto en WhatsApp: ${name ?? 'desconocido'}.`,
      messages,
    })
    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    reply = String(json.reply ?? '').trim()
    handoff = json.handoff === true
  } catch (e) {
    console.error('[wa-bot] asistente falló', e)
    return
  }
  if (!reply) return

  await sendText({ to: waId, body: reply, clientId: FISHFLOW_CLIENT_ID, sentBy: 'bot' })

  const now = new Date()
  await sb.from('whatsapp_contacts').upsert({
    wa_id: waId,
    name,
    updated_at: now.toISOString(),
    ...(handoff
      ? { bot_paused_until: new Date(now.getTime() + PAUSE_MS).toISOString(), last_intent_at: now.toISOString() }
      : {}),
  })

  if (handoff) {
    const quien = name ? `${name} (+${waId})` : `+${waId}`
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    await sendEmail({
      from: 'fishflowNoreply',
      to: ADMIN_NOTIFY_TO,
      subject: `🔥 WhatsApp FishFlow — ${quien} quiere hablar contigo`,
      html: `<p><strong>${esc(quien)}</strong> mostró intención de compra en WhatsApp.</p>
<p><strong>Escribió:</strong></p><blockquote style="border-left:3px solid #FF8C35;padding-left:12px">${esc(text)}</blockquote>
<p><strong>El bot contestó:</strong></p><blockquote style="border-left:3px solid #1FA9D6;padding-left:12px">${esc(reply)}</blockquote>
<p>El bot queda en pausa 24 h con este contacto. Contesta desde <a href="https://www.fishflow.mx/admin">/admin → WhatsApp</a>.</p>`,
      tag: 'wa-bot',
    })
  }
}

// ─── Entrada ──────────────────────────────────────────────────────────────────

export async function handleInbound(args: {
  waId: string
  name: string | null
  text: string | null
  msgType: string
}) {
  const { waId, name, text, msgType } = args
  if (!text || msgType === 'reaction' || msgType === 'sticker') return
  try {
    if (await tryReviewFlow(waId, name, text)) return
    await assistant(waId, name, text)
  } catch (e) {
    console.error('[wa-bot] handleInbound', e)
  }
}
