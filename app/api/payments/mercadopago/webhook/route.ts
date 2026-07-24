import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'
import { markStoreOrderPaidByTxn } from '@/lib/storeRmz'

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
  // Secrets aceptados: producción + endpoint de pruebas RMZ (modo test)
  const secrets = [
    process.env.MERCADOPAGO_WEBHOOK_SECRET,
    process.env.RMZ_MP_WEBHOOK_SECRET,
  ].filter(Boolean) as string[]
  if (!secrets.length) {
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
  return secrets.some(
    (secret) => createHmac('sha256', secret).update(manifest).digest('hex') === v1
  )
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
    // Intentar con el token de producción; si falla y hay token de pruebas
    // RMZ (modo test), reintentar con ese.
    let paymentData
    try {
      const mp = new MercadoPagoConfig({
        accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
      })
      paymentData = await new Payment(mp).get({ id: paymentId })
    } catch (primaryErr) {
      if (!process.env.RMZ_MP_ACCESS_TOKEN) throw primaryErr
      const mpTest = new MercadoPagoConfig({
        accessToken: process.env.RMZ_MP_ACCESS_TOKEN,
      })
      paymentData = await new Payment(mpTest).get({ id: paymentId })
    }

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

    // Pedidos de tienda B2C (RMZ): confirmar pedido + correo al cliente
    if (status === 'paid') {
      await markStoreOrderPaidByTxn(externalRef)
    }

    console.log(`[webhook] payment ${paymentId} → txn ${externalRef} → ${status}`)
    return NextResponse.json({ received: true, transaction_id: externalRef, status })
  } catch (err) {
    console.error('[webhook] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
