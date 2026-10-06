/**
 * Avisos al Slack interno de FishFlow vía Incoming Webhooks.
 *
 * Cada canal tiene su propia URL de webhook en una variable de entorno
 * (app de Slack "FishFlow Avisos", api.slack.com/apps):
 *   leads → SLACK_WEBHOOK_LEADS  (#leads: WhatsApp nuevo + diagnóstico de la landing)
 *
 * Nunca truena: si falta la variable o Slack falla, solo queda en logs.
 * Es solo para el equipo (Rafa, Alex, Al): nada de esto llega a clientes.
 */

const WEBHOOKS = {
  leads: 'SLACK_WEBHOOK_LEADS',
} as const

export type SlackChannel = keyof typeof WEBHOOKS

/** Escapa los caracteres que Slack interpreta en mrkdwn. */
export function slackEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface SlackNotice {
  /** Texto corto: es lo que sale en la notificación del celular. */
  text: string
  /** Cuerpo en mrkdwn (opcional). */
  body?: string
  /** Botón opcional al final. */
  button?: { label: string; url: string }
}

export async function notifySlack(channel: SlackChannel, n: SlackNotice): Promise<boolean> {
  const url = process.env[WEBHOOKS[channel]]
  if (!url) {
    console.warn(`[slack] ${WEBHOOKS[channel]} no está configurada; aviso omitido`)
    return false
  }

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: n.body ? `*${n.text}*\n${n.body}` : `*${n.text}*` } },
  ]
  if (n.button) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: n.button.label }, url: n.button.url }],
    })
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: n.text, blocks }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.error(`[slack] ${channel} respondió ${res.status}: ${await res.text()}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[slack] ${channel} falló:`, err)
    return false
  }
}
