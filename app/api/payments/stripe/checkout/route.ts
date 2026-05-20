import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// ─── Solo Rafa puede usar este endpoint ──────────────────────────────────────
const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Verificar sesión de Rafa ───────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── 2. Parsear y validar body ─────────────────────────────────────────────
    const { client_id, description, amount, payer_email } = await req.json()

    if (!client_id)              return NextResponse.json({ error: 'client_id es requerido' }, { status: 400 })
    if (!description?.trim())    return NextResponse.json({ error: 'description es requerido' }, { status: 400 })
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: 'amount debe ser mayor a 0' }, { status: 400 })

    // ── 3. Verificar que el cliente existe ────────────────────────────────────
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .eq('id', client_id)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    }

    // ── 4. Insertar transacción pendiente ─────────────────────────────────────
    const { data: txn, error: txnError } = await supabaseAdmin
      .from('pos_transactions')
      .insert({
        client_id,
        provider:  'stripe',
        amount:    Number(amount),
        currency:  'MXN',
        status:    'pending',
        service:   description.trim(),
        metadata: {
          description:  description.trim(),
          payer_email:  payer_email ?? null,
          created_by:   user.email,
          created_from: 'admin_panel',
        },
      })
      .select()
      .single()

    if (txnError || !txn) {
      console.error('[stripe/checkout] insert txn:', txnError)
      return NextResponse.json({ error: 'Error al crear transacción' }, { status: 500 })
    }

    // ── 5. Crear Stripe Checkout Session ──────────────────────────────────────
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia',
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'mxn',
            product_data: {
              name: description.trim(),
              metadata: { client: client.name },
            },
            unit_amount: Math.round(Number(amount) * 100), // Stripe usa centavos
          },
          quantity: 1,
        },
      ],
      ...(payer_email ? { customer_email: payer_email } : {}),
      metadata: {
        transaction_id: txn.id,
        client_id,
        client_name:    client.name,
        created_by:     user.email,
      },
      success_url: `${appUrl}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/pay/error`,
    })

    // ── 6. Actualizar transacción con el session id ───────────────────────────
    await supabaseAdmin
      .from('pos_transactions')
      .update({
        external_id: session.id,
        metadata: {
          description:  description.trim(),
          payer_email:  payer_email ?? null,
          session_id:   session.id,
          payment_url:  session.url,
          created_by:   user.email,
          created_from: 'admin_panel',
        },
      })
      .eq('id', txn.id)

    return NextResponse.json({
      transaction_id: txn.id,
      payment_url:    session.url,
      session_id:     session.id,
      client_name:    client.name,
    })

  } catch (err: any) {
    console.error('[stripe/checkout] error:', err)
    // Exponer mensaje de Stripe en desarrollo para diagnóstico
    const msg = err?.message ?? 'Error interno del servidor'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
