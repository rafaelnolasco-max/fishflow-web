/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 *  GET  → verificación de Meta (hub.challenge) con WHATSAPP_VERIFY_TOKEN.
 *  POST → mensajes entrantes y estados de entrega. Se valida la firma
 *         X-Hub-Signature-256 con WHATSAPP_APP_SECRET, se guarda todo en
 *         public.whatsapp_messages y se avisa por correo a Rafa cuando
 *         alguien escribe.
 *
 * Meta reintenta si no recibe 200, así que el POST siempre responde 200 una
 * vez validada la firma, aunque falle algo interno (queda en logs).
 * Registrado en: developers.facebook.com → app FishFlow Mensajeria →
 * WhatsApp → Configuración → Webhooks, campo `messages`.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { handleInbound } from '@/lib/whatsappBot'

export const runtime = 'nodejs'
export const maxDuration = 60

// Buzón de FishFlow (no el personal). Se puede cambiar con WHATSAPP_NOTIFY_TO.
const ADMIN_NOTIFY_TO = process.env.WHATSAPP_NOTIFY_TO || 'raf@fishflow.mx'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── GET: verificación ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (
    expected &&
    p.get('hub.mode') === 'subscribe' &&
    p.get('hub.verify_token') === expected
  ) {
    return new NextResponse(p.get('hub.challenge') ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ─── Tipos mínimos del payload ────────────────────────────────────────────────

interface WaMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  button?: { text: string }
  interactive?: {
    button_reply?: { title: string }
    list_reply?: { title: string }
  }
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
  location?: { latitude: number; longitude: number; name?: string }
  reaction?: { emoji?: string }
}

interface WaStatus {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: unknown[]
}

interface WaValue {
  metadata?: { phone_number_id?: string }
  contacts?: { wa_id: string; profile?: { name?: string } }[]
  messages?: WaMessage[]
  statuses?: WaStatus[]
}

function messageText(m: WaMessage): string | null {
  switch (m.type) {
    case 'text': return m.text?.body ?? null
    case 'button': return m.button?.text ?? null
    case 'interactive':
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null
    case 'image': return m.image?.caption ?? '[imagen]'
    case 'video': return m.video?.caption ?? '[video]'
    case 'document': return m.document?.caption ?? m.document?.filename ?? '[documento]'
    case 'audio': return '[audio]'
    case 'sticker': return '[sticker]'
    case 'reaction': return m.reaction?.emoji ?? '[reacción]'
    case 'location':
      return m.location
        ? `[ubicación] ${m.location.name ?? ''} ${m.location.latitude},${m.location.longitude}`.trim()
        : '[ubicación]'
    default: return `[${m.type}]`
  }
}

const STATUS_RANK: Record<string, number> = {
  accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5,
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const given = header.slice('sha256='.length)
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'))
}

// ─── POST: eventos ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const raw = await req.text()

  if (!validSignature(raw, req.headers.get('x-hub-signature-256'))) {
    console.error('[wa-webhook] firma inválida o WHATSAPP_APP_SECRET ausente')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let payload: { entry?: { changes?: { field?: string; value?: WaValue }[] }[] }
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true })
  }

  const db = supabaseAdmin()

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue
      const value = change.value
      const phoneNumberId = value.metadata?.phone_number_id ?? 'desconocido'

      // Mensajes entrantes
      for (const m of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === m.from)
        const body = messageText(m)
        const { data: inserted, error } = await db.from('whatsapp_messages').upsert(
          {
            phone_number_id: phoneNumberId,
            wa_message_id: m.id,
            direction: 'inbound',
            contact_wa_id: m.from,
            contact_name: contact?.profile?.name ?? null,
            msg_type: m.type,
            body,
            status: 'received',
            status_at: new Date(Number(m.timestamp) * 1000).toISOString(),
            raw: m,
          },
          { onConflict: 'wa_message_id', ignoreDuplicates: true }
        ).select('id')
        if (error) {
          console.error('[wa-webhook] insert entrante:', error)
          continue
        }
        // Reintento de Meta (ya lo teníamos): ni correo ni bot otra vez.
        if (!inserted?.length) continue

        // Reseñas / asistente IA, después de responderle 200 a Meta.
        after(() =>
          handleInbound({
            waId: m.from,
            name: contact?.profile?.name ?? null,
            text: body,
            msgType: m.type,
          })
        )

        const quien = contact?.profile?.name
          ? `${contact.profile.name} (+${m.from})`
          : `+${m.from}`
        await sendEmail({
          from: 'fishflowNoreply',
          to: ADMIN_NOTIFY_TO,
          subject: `WhatsApp FishFlow — mensaje de ${quien}`,
          html: `<p><strong>${escapeHtml(quien)}</strong> escribió a la línea FishFlow:</p>
<blockquote style="border-left:3px solid #FF8C35;padding-left:12px;margin:12px 0">${escapeHtml(body ?? '')}</blockquote>
<p style="color:#666;font-size:13px">Tienes 24 h para contestar con texto libre. Después solo con plantilla aprobada.</p>`,
          tag: 'wa-webhook',
        })
      }

      // Estados de mensajes salientes (sent / delivered / read / failed)
      for (const s of value.statuses ?? []) {
        // Meta no garantiza el orden: un 'sent' tardío no debe pisar un 'read'.
        const { data: actual } = await db
          .from('whatsapp_messages')
          .select('status, template_name, ref')
          .eq('wa_message_id', s.id)
          .maybeSingle()
        if (actual && (STATUS_RANK[actual.status ?? ''] ?? 0) > (STATUS_RANK[s.status] ?? 0)) continue

        const { error } = await db
          .from('whatsapp_messages')
          .update({
            status: s.status,
            status_at: new Date(Number(s.timestamp) * 1000).toISOString(),
            ...(s.errors?.length ? { error: s.errors } : {}),
          })
          .eq('wa_message_id', s.id)
        if (error) console.error('[wa-webhook] update estado:', error)

        // Si el saludo de reseña no llegó, la solicitud regresa a "sin contactar"
        // para que no parezca enviada (p. ej. Meta 130472: el número está en el
        // experimento de mensajes de marketing y no recibe plantillas de ese tipo).
        if (s.status === 'failed' && actual?.template_name === 'opinion_fishflow' && actual.ref) {
          const motivo = (s.errors as { code?: number; title?: string }[] | undefined)?.[0]
          const nota = `${new Date().toISOString().slice(0, 10)}: el saludo por WhatsApp no llegó` +
            (motivo ? ` (Meta ${motivo.code ?? ''}: ${motivo.title ?? ''})` : '') + '.'
          const { data: rr } = await db.from('review_requests').select('notes').eq('id', actual.ref).maybeSingle()
          const { error: rErr } = await db.from('review_requests').update({
            stage: 0,
            stage1_sent_at: null,
            notes: rr?.notes ? `${rr.notes}\n${nota}` : nota,
            updated_at: new Date().toISOString(),
          }).eq('id', actual.ref).eq('stage', 1)
          if (rErr) console.error('[wa-webhook] revertir reseña', rErr)
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
