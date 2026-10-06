import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { notifySlack, slackEscape } from '@/lib/slack'

export const runtime = 'nodejs'

/**
 * Webhook de Resend → Slack #alertas.
 *
 * Avisa cuando un correo que mandamos (FishFlow o a nombre de un cliente)
 * rebota, lo marcan como spam o falla el envío. Registrado en Resend →
 * Webhooks apuntando a https://www.fishflow.mx/api/resend/webhook/ (con la
 * diagonal final: trailingSlash: true).
 *
 * Resend firma con Svix: headers svix-id, svix-timestamp y svix-signature.
 * El secreto (whsec_...) va en RESEND_WEBHOOK_SECRET.
 */

const EVENTOS: Record<string, string> = {
  'email.bounced': ':mailbox_with_no_mail: Correo rebotado',
  'email.complained': ':no_entry: Correo marcado como spam',
  'email.failed': ':x: Correo no se pudo enviar',
}

function firmaValida(raw: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const id = headers.get('svix-id')
  const ts = headers.get('svix-timestamp')
  const sigs = headers.get('svix-signature')
  if (!secret || !id || !ts || !sigs) return false

  // Rechaza eventos de más de 5 min (repetición).
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const esperado = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest()
  return sigs.split(' ').some((s) => {
    const [, b64] = s.split(',')
    if (!b64) return false
    const dada = Buffer.from(b64, 'base64')
    return dada.length === esperado.length && timingSafeEqual(dada, esperado)
  })
}

interface ResendEvent {
  type: string
  data?: {
    email_id?: string
    from?: string
    to?: string[] | string
    subject?: string
    bounce?: { message?: string; type?: string; subType?: string }
    failed?: { reason?: string }
  }
}

export async function POST(req: Request) {
  const raw = await req.text()
  if (!firmaValida(raw, req.headers)) {
    console.warn('[resend/webhook] firma inválida o RESEND_WEBHOOK_SECRET ausente')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let ev: ResendEvent
  try {
    ev = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true })
  }

  const titulo = EVENTOS[ev.type]
  if (!titulo) return NextResponse.json({ ok: true, skipped: ev.type })

  const d = ev.data ?? {}
  const para = Array.isArray(d.to) ? d.to.join(', ') : d.to ?? '¿?'
  const motivo = d.bounce?.message ?? d.failed?.reason ?? ''
  const lineas = [
    `*Para:* ${slackEscape(para)}`,
    `*De:* ${slackEscape(d.from ?? '¿?')}`,
    `*Asunto:* ${slackEscape(d.subject ?? '(sin asunto)')}`,
    d.bounce?.type ? `*Tipo:* ${slackEscape([d.bounce.type, d.bounce.subType].filter(Boolean).join(' / '))}` : null,
    motivo ? `>${slackEscape(motivo.slice(0, 500))}` : null,
  ].filter(Boolean)

  await notifySlack('alertas', {
    text: `${titulo}: ${para}`,
    body: lineas.join('\n'),
    button: d.email_id ? { label: 'Ver en Resend', url: `https://resend.com/emails/${d.email_id}` } : undefined,
  })

  return NextResponse.json({ ok: true })
}
