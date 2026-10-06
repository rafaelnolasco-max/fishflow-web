/**
 * Avisos al Slack interno de FishFlow vía Incoming Webhooks.
 *
 * Cada canal tiene su propia URL de webhook en una variable de entorno
 * (app de Slack "FishFlow Avisos", api.slack.com/apps):
 *   leads   → SLACK_WEBHOOK_LEADS   (#leads: WhatsApp nuevo + diagnóstico de la landing)
 *   alertas → SLACK_WEBHOOK_ALERTAS (#alertas: crons y webhooks de pago que truenan)
 *
 * #pagos no pasa por aquí: lo avisan triggers de Postgres (pos_transactions e
 * invoices) con pg_net, para cubrir todos los caminos de cobro y facturación.
 * Ver supabase/migrations/20261006150000_slack_pagos.sql.
 *
 * Nunca truena: si falta la variable o Slack falla, solo queda en logs.
 * Es solo para el equipo (Rafa, Alex, Al): nada de esto llega a clientes.
 */

const WEBHOOKS = {
  leads: 'SLACK_WEBHOOK_LEADS',
  alertas: 'SLACK_WEBHOOK_ALERTAS',
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

/**
 * Envuelve un handler de ruta (cron o webhook) y avisa a #alertas si lanza una
 * excepción o responde 5xx. Los 4xx (firma inválida, etc.) no avisan.
 *
 *   export const GET = withSlackAlert('cron/whatsapp-digest', handler)
 */
export function withSlackAlert<A extends unknown[]>(
  name: string,
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      const res = await handler(...args)
      if (res.status >= 500) {
        let detalle = ''
        try { detalle = (await res.clone().text()).slice(0, 500) } catch {}
        await notifySlack('alertas', {
          text: `${name} respondió ${res.status}`,
          body: detalle ? `\`\`\`${slackEscape(detalle)}\`\`\`` : undefined,
          button: { label: 'Logs en Vercel', url: 'https://vercel.com/rafaelnolasco-maxs-projects/fishflow-web/logs' },
        })
      }
      return res
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      await notifySlack('alertas', {
        text: `${name} tronó`,
        body: `\`\`\`${slackEscape(msg.slice(0, 1500))}\`\`\``,
        button: { label: 'Logs en Vercel', url: 'https://vercel.com/rafaelnolasco-maxs-projects/fishflow-web/logs' },
      })
      throw err
    }
  }
}
