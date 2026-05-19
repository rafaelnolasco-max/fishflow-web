import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
      apiVersion: '2025-04-30.basil',
    })
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ── Solo nos interesan pagos completados ──────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const txnId   = session.metadata?.transaction_id

    if (!txnId) {
      console.warn('[stripe/webhook] No transaction_id in session metadata')
      return NextResponse.json({ received: true, skipped: 'no transaction_id' })
    }

    const { error } = await supabaseAdmin
      .from('pos_transactions')
      .update({
        status:         'approved',
        payment_method: session.payment_method_types?.[0] ?? 'card',
        external_id:    session.payment_intent as string ?? session.id,
      })
      .eq('id', txnId)

    if (error) {
      console.error('[stripe/webhook] Failed to update transaction:', error)
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
    }

    console.log(`[stripe/webhook] session ${session.id} → txn ${txnId} → approved`)
  }

  return NextResponse.json({ received: true })
}

// Stripe requiere el body sin parsear para verificar la firma
export const config = {
  api: { bodyParser: false },
}
