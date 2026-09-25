/**
 * WhatsApp Cloud API (Meta) — envío de mensajes y bitácora.
 *
 * Línea corporativa FishFlow: +52 56 1059 7851 (Phone Number ID en
 * WHATSAPP_PHONE_NUMBER_ID). Todo lo que sale por aquí queda registrado en
 * public.whatsapp_messages; los entrantes y los estados los escribe
 * /api/whatsapp/webhook.
 *
 * Reglas de Meta que conviene recordar:
 *  - Texto libre (sendText) solo dentro de las 24 h posteriores al último
 *    mensaje del contacto. Fuera de esa ventana → plantilla aprobada.
 *  - Las plantillas se crean y aprueban en WhatsApp Manager (WABA en
 *    WHATSAPP_WABA_ID). Ejemplo: confirmacion_diagnostico (es_MX, 3 variables).
 *
 * Variables de entorno (Vercel): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_WABA_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.
 * Se leen dentro de cada función (nunca a nivel de módulo) para no romper
 * `next build` en máquinas sin los secretos.
 */
import { createClient } from '@supabase/supabase-js'

export const WA_GRAPH_VERSION = 'v25.0'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Normaliza a solo dígitos con lada país (MX por defecto si vienen 10). */
export function normalizeWaNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `52${digits}`
  return digits
}

type SendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; error: unknown }

async function postMessage(
  payload: Record<string, unknown>,
  log: { to: string; msgType: string; body?: string; templateName?: string; clientId?: string | null }
): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) {
    console.error('[whatsapp] faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID')
    return { ok: false, error: 'missing_env' }
  }

  const res = await fetch(
    `https://graph.facebook.com/${WA_GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(15_000),
    }
  )
  const data = await res.json().catch(() => null)
  const waMessageId: string | undefined = data?.messages?.[0]?.id

  const { error: dbError } = await supabaseAdmin().from('whatsapp_messages').insert({
    client_id: log.clientId ?? null,
    phone_number_id: phoneNumberId,
    wa_message_id: waMessageId ?? null,
    direction: 'outbound',
    contact_wa_id: log.to,
    msg_type: log.msgType,
    body: log.body ?? null,
    template_name: log.templateName ?? null,
    status: res.ok ? 'accepted' : 'failed',
    status_at: new Date().toISOString(),
    error: res.ok ? null : data,
  })
  if (dbError) console.error('[whatsapp] no se pudo registrar el envío:', dbError)

  if (!res.ok || !waMessageId) {
    console.error('[whatsapp] Meta rechazó el envío:', data)
    return { ok: false, error: data }
  }
  return { ok: true, waMessageId }
}

/** Texto libre. Solo funciona dentro de la ventana de 24 h. */
export function sendText(args: { to: string; body: string; clientId?: string | null }) {
  const to = normalizeWaNumber(args.to)
  return postMessage(
    { to, type: 'text', text: { body: args.body, preview_url: true } },
    { to, msgType: 'text', body: args.body, clientId: args.clientId }
  )
}

/**
 * Plantilla aprobada con variables de cuerpo posicionales ({{1}}, {{2}}…).
 * Ej.: sendTemplate({ to: '5514831644', name: 'confirmacion_diagnostico',
 *        params: ['Laura', 'martes 30 de septiembre', '11:00 am'] })
 */
export function sendTemplate(args: {
  to: string
  name: string
  params?: string[]
  lang?: string
  clientId?: string | null
}) {
  const to = normalizeWaNumber(args.to)
  const params = args.params ?? []
  return postMessage(
    {
      to,
      type: 'template',
      template: {
        name: args.name,
        language: { code: args.lang ?? 'es_MX' },
        ...(params.length
          ? {
              components: [
                {
                  type: 'body',
                  parameters: params.map((text) => ({ type: 'text', text })),
                },
              ],
            }
          : {}),
      },
    },
    { to, msgType: 'template', templateName: args.name, body: params.join(' | ') || undefined, clientId: args.clientId }
  )
}
