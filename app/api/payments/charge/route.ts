import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { createClient } from '@supabase/supabase-js'
import { extractApiKey, getClientByApiKey } from '@/lib/getClient'

// Admin client — server-side only, bypasses RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Authenticate API key ──────────────────────────────────────
    const apiKey = extractApiKey(req.headers.get('authorization'))
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401 })
    }

    const client = await getClientByApiKey(apiKey)
    if (!client) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 403 })
    }

    // ── 2. Parse & validate body ─────────────────────────────────────
    const body = await req.json()
    const {
      amount,
      currency = 'MXN',
      service,
      description,
      payer_email,
    } = body

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'amount is required and must be > 0' },
        { status: 400 }
      )
    }

    // ── 3. Insert pending transaction ────────────────────────────────
    const { data: txn, error: txnError } = await supabaseAdmin
      .from('pos_transactions')
      .insert({
        client_id: client.id,
        provider: client.gateway_primary,
        amount: Number(amount),
        currency,
        status: 'pending',
        service: service ?? null,
        vertical: client.vertical ?? null,
        metadata: { description: description ?? null, payer_email: payer_email ?? null },
      })
      .select()
      .single()

    if (txnError || !txn) {
      console.error('[charge] Insert transaction failed:', txnError)
      return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 })
    }

    // ── 4. Route to gateway ──────────────────────────────────────────
    if (client.gateway_primary === 'mercadopago') {
      const mp = new MercadoPagoConfig({
        accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
      })
      const preference = new Preference(mp)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'

      const pref = await preference.create({
        body: {
          items: [
            {
              id: txn.id,
              title: description ?? service ?? 'Servicio FishFlow',
              quantity: 1,
              unit_price: Number(amount),
              currency_id: currency,
            },
          ],
          payer: payer_email ? { email: payer_email } : undefined,
          external_reference: txn.id, // used to match webhook → transaction
          notification_url: `${appUrl}/api/payments/mercadopago/webhook`,
          back_urls: {
            success: `${appUrl}/payment/success`,
            failure: `${appUrl}/payment/failure`,
            pending: `${appUrl}/payment/pending`,
          },
          auto_return: 'approved',
        },
      })

      // Store MP preference id in transaction
      await supabaseAdmin
        .from('pos_transactions')
        .update({
          external_id: pref.id,
          metadata: {
            description: description ?? null,
            payer_email: payer_email ?? null,
            preference_id: pref.id,
          },
        })
        .eq('id', txn.id)

      return NextResponse.json({
        transaction_id: txn.id,
        payment_url: pref.init_point,          // producción
        sandbox_url: pref.sandbox_init_point,  // pruebas
        preference_id: pref.id,
      })
    }

    // Future gateways go here (Conekta, Clip…)
    return NextResponse.json(
      { error: `Gateway '${client.gateway_primary}' not implemented yet` },
      { status: 501 }
    )
  } catch (err) {
    console.error('[charge] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
