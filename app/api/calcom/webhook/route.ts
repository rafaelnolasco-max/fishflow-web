/**
 * Webhook de Cal.com — agendador de diagnósticos de fishflow.mx
 * (cal.com/rafa-fish-likxep/diagnostico-fishflow).
 *
 * En BOOKING_CREATED y BOOKING_RESCHEDULED le manda al prospecto la plantilla
 * de WhatsApp `confirmacion_diagnostico` (es_MX):
 *   "Hola {{1}}, tu diagnóstico con FishFlow quedó agendado para el {{2}} a las {{3}}…"
 *
 * Requisitos en Cal.com:
 *  - El tipo de evento pide teléfono (campo "Número de teléfono" del
 *    formulario de reserva → responses.attendeePhoneNumber).
 *  - Settings → Developer → Webhooks → URL
 *    https://www.fishflow.mx/api/calcom/webhook/ con secreto = CALCOM_WEBHOOK_SECRET.
 *
 * Cal.com firma el cuerpo con HMAC-SHA256 en X-Cal-Signature-256 (hex).
 * Siempre responde 200 tras validar la firma para que Cal.com no reintente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { sendTemplate, templateAlreadySent, normalizeWaNumber } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

const TEMPLATE = 'confirmacion_diagnostico'
const TZ = 'America/Mexico_City'

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.CALCOM_WEBHOOK_SECRET
  if (!secret || !header) return false
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const given = header.replace(/^sha256=/, '')
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
}

type Resp = { value?: unknown } | undefined

interface CalPayload {
  triggerEvent?: string
  payload?: {
    uid?: string
    startTime?: string
    rescheduleUid?: string
    attendees?: { name?: string; phoneNumber?: string | null }[]
    responses?: Record<string, Resp>
    smsReminderNumber?: string | null
  }
}

/** Busca el teléfono del invitado en los lugares donde Cal.com lo deja. */
function findPhone(p: NonNullable<CalPayload['payload']>): string | null {
  const r = p.responses ?? {}
  const candidates: unknown[] = [
    r.attendeePhoneNumber?.value,
    r.phone?.value,
    r.telefono?.value,
    r.whatsapp?.value,
    p.attendees?.[0]?.phoneNumber,
    p.smsReminderNumber,
  ]
  // Cualquier otra respuesta que parezca teléfono (+52…)
  for (const v of Object.values(r)) candidates.push(v?.value)
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const digits = c.replace(/\D/g, '')
    if (digits.length >= 10 && digits.length <= 15 && /^[+\d\s()-]+$/.test(c.trim())) {
      return normalizeWaNumber(c)
    }
  }
  return null
}

function firstName(full?: string): string {
  const n = (full ?? '').trim().split(/\s+/)[0]
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'hola'
}

function fechaHora(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso)
  const fecha = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
  }).format(d) // "martes, 30 de septiembre"
  const hora = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d) // "11:00 a.m."
  return { fecha: fecha.replace(',', ''), hora }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!validSignature(raw, req.headers.get('x-cal-signature-256'))) {
    console.error('[calcom-webhook] firma inválida o CALCOM_WEBHOOK_SECRET ausente')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let body: CalPayload
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  const trigger = body.triggerEvent
  const p = body.payload
  if (!p || (trigger !== 'BOOKING_CREATED' && trigger !== 'BOOKING_RESCHEDULED')) {
    return NextResponse.json({ ok: true, skipped: trigger ?? 'sin evento' })
  }
  if (!p.uid || !p.startTime) return NextResponse.json({ ok: true, skipped: 'sin uid/hora' })

  const phone = findPhone(p)
  if (!phone) {
    console.warn('[calcom-webhook] reserva sin teléfono, no se manda WhatsApp', p.uid)
    return NextResponse.json({ ok: true, skipped: 'sin teléfono' })
  }

  // La reprogramación genera un uid nuevo, así que también sale su aviso.
  if (await templateAlreadySent(TEMPLATE, p.uid)) {
    return NextResponse.json({ ok: true, skipped: 'ya enviado' })
  }

  const { fecha, hora } = fechaHora(p.startTime)
  const res = await sendTemplate({
    to: phone,
    name: TEMPLATE,
    params: [firstName(p.attendees?.[0]?.name), fecha, hora],
    ref: p.uid,
  })
  if (!res.ok) console.error('[calcom-webhook] no salió la confirmación', p.uid, res.error)

  return NextResponse.json({ ok: true, sent: res.ok })
}
