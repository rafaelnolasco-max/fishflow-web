import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function markTransaction(txnId: string, status: string, session: Stripe.Checkout.Session) {
  const { error } = await supabaseAdmin
    .from('pos_transactions')
    .update({
      status,
      payment_method: session.payment_method_types?.[0] ?? 'card',
      external_id:    (session.payment_intent as string) ?? session.id,
    })
    .eq('id', txnId)

  if (error) {
    console.error(`[stripe/webhook] DB update failed for txn ${txnId}:`, error)
  } else {
    console.log(`[stripe/webhook] txn ${txnId} → ${status}`)
  }
  return error
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe/webhook] Missing signature or webhook secret')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    })
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const txnId   = session.metadata?.transaction_id

  if (!txnId) {
    console.warn('[stripe/webhook] No transaction_id in session metadata — skipping')
    return NextResponse.json({ received: true, skipped: 'no transaction_id' })
  }

  switch (event.type) {

    // ── Pago con tarjeta completado (o inicio de voucher OXXO) ───────────────
    case 'checkout.session.completed': {
      // Con tarjeta: payment_status = 'paid'  → marcar pagado
      // Con OXXO:   payment_status = 'unpaid' → voucher generado, esperar pago en tienda
      if (session.payment_status === 'paid') {
        await markTransaction(txnId, 'paid', session)
        console.log(`[stripe/webhook] card payment complete → txn ${txnId} paid`)
      } else {
        // OXXO: voucher listo, el pago llegará via async_payment_succeeded
        console.log(`[stripe/webhook] OXXO voucher generated for txn ${txnId} — awaiting cash payment`)
      }
      break
    }

    // ── Cliente pagó en OXXO ──────────────────────────────────────────────────
    case 'checkout.session.async_payment_succeeded': {
      await markTransaction(txnId, 'paid', session)
      console.log(`[stripe/webhook] OXXO cash payment received → txn ${txnId} paid`)
      break
    }

    // ── Voucher OXXO expiró sin pagar ─────────────────────────────────────────
    case 'checkout.session.async_payment_failed': {
      await markTransaction(txnId, 'failed', session)
      console.log(`[stripe/webhook] OXXO voucher expired → txn ${txnId} failed`)
      break
    }

    default:
      console.log(`[stripe/webhook] unhandled event type: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}
