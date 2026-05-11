import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'

// Admin client — server-side only
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Verifies Mercado Pago webhook signature.
 * Docs: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks
 *
 * MP sends: x-signature: ts=<ts>,v1=<hash>
 * Manifest: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 */
function verifyMpSignature(req: NextRequest, dataId: string): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret) {
    // Allow requests in dev/test when secret is not configured
    console.warn('[webhook] MERCADOPAGO_WEBHOOK_SECRET not set — skipping signature check')
    return true
  }

  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id') ?? ''

  if (!xSignature) return false

  // Parse "ts=...,v1=..." header
  const parts: Record<string, string> = {}
  xSignature.split(',').forEach((part) => {
    const [k, v] = part.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  })

  const { ts, v1 } = parts
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')

  return expected === v1
}

/** Maps MP payment status to our internal status */
function mapMpStatus(mpStatus: string | undefined): 'paid' | 'failed' | 'pending' | 'cancelled' {
  switch (mpStatus) {
    case 'approved': return 'paid'
    case 'rejected': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return 'pending'
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const url = new URL(req.url)
    const dataId = url.searchParams.get('data.id') ?? ''

    // ── 1. Verify signature ──────────────────────────────────────────
    if (!verifyMpSignature(req, dataId)) {
      console.warn('[webhook] Invalid MP signature — rejected')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)
    const { type, data } = payload

    // ── 2. Only handle payment events ────────────────────────────────
    if (type !== 'payment') {
      return NextResponse.json({ received: true, skipped: true })
    }

    const paymentId = data?.id
    if (!paymentId) {
      return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
    }

    // ── 3. Fetch payment details from MP ─────────────────────────────
    const mp = new MercadoPagoConfig({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    const mpPayment = new Payment(mp)
    const paymentData = await mpPayment.get({ id: paymentId })

    const externalRef = paymentData.external_reference // = our transaction_id (uuid)
    const mpStatus = paymentData.status
    const paymentMethod = paymentData.payment_method_id ?? null

    if (!externalRef) {
      // Not a transaction we issued — ignore
      return NextResponse.json({ received: true, skipped: 'no external_reference' })
    }

    const status = mapMpStatus(mpStatus)

    // ── 4. Update pos_transactions ───────────────────────────────────
    // When status becomes 'paid', the DB trigger notify_auto_invoice() fires
    // and calls the auto-invoice Edge Function via pg_net.
    const { error: updateError } = await supabaseAdmin
      .from('pos_transactions')
      .update({
        status,
        external_id: String(paymentId),
        payment_method: paymentMethod,
      })
      .eq('id', externalRef)

    if (updateError) {
      console.error('[webhook] Failed to update transaction:', updateError)
      return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
    }

    console.log(`[webhook] payment ${paymentId} → txn ${externalRef} → ${status}`)
    return NextResponse.json({ received: true, transaction_id: externalRef, status })
  } catch (err) {
    console.error('[webhook] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
