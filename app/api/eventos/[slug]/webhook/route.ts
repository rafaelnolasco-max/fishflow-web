// POST /api/eventos/[slug]/webhook/ — aviso de Mercado Pago (cuenta del organizador).
// Firma: x-signature con MP_<mp_env>_WEBHOOK_SECRET (si está configurado).
// Todo lo que cambia la orden sale de consultar el pago al API de MP.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getEvent, mpWebhookSecret, processPayment } from '@/lib/eventos'
import { withSlackAlert } from '@/lib/slack'

export const runtime = 'nodejs'

function signatureOk(req: NextRequest, dataId: string, secret: string | null): boolean {
  if (!secret) {
    console.warn('[eventos/webhook] sin secreto de webhook — se omite la verificación de firma')
    return true
  }
  const xs = req.headers.get('x-signature')
  const rid = req.headers.get('x-request-id') ?? ''
  if (!xs) return false
  const parts: Record<string, string> = {}
  xs.split(',').forEach((p) => { const [k, v] = p.split('='); if (k && v) parts[k.trim()] = v.trim() })
  if (!parts.ts || !parts.v1) return false
  const manifest = `id:${dataId};request-id:${rid};ts:${parts.ts};`
  return createHmac('sha256', secret).update(manifest).digest('hex') === parts.v1
}

async function handler(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const ev = await getEvent(slug)
  if (!ev) return NextResponse.json({ error: 'evento' }, { status: 404 })

  const url = new URL(req.url)
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const type = (body.type as string) ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
  const dataId = String(
    url.searchParams.get('data.id') ?? (body.data as { id?: string } | undefined)?.id ?? url.searchParams.get('id') ?? ''
  )

  if (type !== 'payment' || !dataId) return NextResponse.json({ received: true, skipped: true })

  if (!signatureOk(req, url.searchParams.get('data.id') ?? dataId, mpWebhookSecret(ev)))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  const r = await processPayment(ev, dataId)
  console.log(`[eventos/webhook] ${slug} pago ${dataId} →`, r)
  // Pagos que no son de este evento (otra integración de la misma cuenta): 200 para que MP no reintente
  if (!r.ok && r.reason !== 'db' && r.reason !== 'emitir') return NextResponse.json({ received: true, ...r })
  if (!r.ok) return NextResponse.json(r, { status: 500 })
  return NextResponse.json({ received: true, ...r })
}

export const POST = withSlackAlert('webhook eventos (Mercado Pago)', handler)
