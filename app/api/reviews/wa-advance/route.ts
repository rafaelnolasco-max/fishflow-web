/**
 * Envía el siguiente mensaje de una solicitud de reseña por la Cloud API de
 * WhatsApp (en vez de abrir wa.me) y avanza la etapa. Hoy solo para FishFlow,
 * que es el único cliente con su número en la API; solo Rafa.
 *
 * body: { requestId, message?, noAdvance? }
 *  - etapa 0 → plantilla aprobada `opinion_fishflow` (inicia la conversación)
 *  - etapa 1/2 → texto libre (`message`, o la plantilla base con el link)
 *    Solo funciona dentro de la ventana de 24 h; si no, Meta lo rechaza y se
 *    devuelve el error.
 *  - noAdvance → manda `message` sin mover la etapa (feedback negativo).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { sendTemplate, sendText } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

const FISHFLOW_CLIENT_ID = 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42'
const TEMPLATE_1 = 'opinion_fishflow'

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const b = (await req.json().catch(() => null)) as
    | { requestId?: string; message?: string; noAdvance?: boolean }
    | null
  if (!b?.requestId) return NextResponse.json({ error: 'Falta requestId' }, { status: 400 })

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: r, error } = await db
    .from('review_requests')
    .select('id, client_id, contact_name, contact_phone, stage')
    .eq('id', b.requestId)
    .maybeSingle()
  if (error || !r) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (r.client_id !== FISHFLOW_CLIENT_ID) {
    return NextResponse.json({ error: 'Este cliente no tiene WhatsApp por API' }, { status: 400 })
  }

  let res
  if (b.noAdvance) {
    if (!b.message?.trim()) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
    res = await sendText({ to: r.contact_phone, body: b.message.trim(), clientId: FISHFLOW_CLIENT_ID, sentBy: 'admin' })
  } else if (r.stage === 0) {
    res = await sendTemplate({
      to: r.contact_phone,
      name: TEMPLATE_1,
      params: [firstName(r.contact_name ?? '')],
      clientId: FISHFLOW_CLIENT_ID,
      ref: r.id,
    })
  } else if (r.stage === 1 || r.stage === 2) {
    let text = b.message?.trim()
    if (!text) {
      const { data: s } = await db
        .from('review_settings')
        .select('msg_template_2, msg_template_3')
        .eq('client_id', FISHFLOW_CLIENT_ID)
        .maybeSingle()
      const tpl = (r.stage === 1 ? s?.msg_template_2 : s?.msg_template_3) ?? ''
      text = tpl
        .replaceAll('{nombre}', firstName(r.contact_name ?? ''))
        .replaceAll('{link}', `https://www.fishflow.mx/r/${r.id}/`)
        .trim()
    }
    if (!text) return NextResponse.json({ error: 'Configura las plantillas primero' }, { status: 400 })
    res = await sendText({ to: r.contact_phone, body: text, clientId: FISHFLOW_CLIENT_ID, sentBy: 'admin' })
  } else {
    return NextResponse.json({ error: 'Esta solicitud ya terminó su secuencia' }, { status: 400 })
  }

  if (!res.ok) {
    const e = res.error as { error?: { message?: string; code?: number } } | string
    const msg = typeof e === 'string' ? e : e?.error?.message ?? 'Meta rechazó el envío'
    const code = typeof e === 'string' ? null : e?.error?.code
    // 131047 = fuera de la ventana de 24 h
    return NextResponse.json(
      { error: code === 131047 ? 'Pasaron más de 24 h desde su última respuesta: solo se puede con plantilla.' : msg },
      { status: 502 }
    )
  }
  if (b.noAdvance) return NextResponse.json({ ok: true, patch: {} })

  const now = new Date().toISOString()
  const next = r.stage + 1
  const patch: Record<string, unknown> = { stage: next, updated_at: now, [`stage${next}_sent_at`]: now }
  if (b.message?.trim() && r.stage > 0) patch[`draft_${next}`] = b.message.trim()
  const { error: upErr } = await db.from('review_requests').update(patch).eq('id', r.id)
  if (upErr) console.error('[reviews/wa-advance] update', upErr)
  return NextResponse.json({ ok: true, patch })
}
