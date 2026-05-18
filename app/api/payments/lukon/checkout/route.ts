import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// ─── Constantes de Lukon ──────────────────────────────────────────────────────
const LUKON_CLIENT_ID  = '1aa4a82b-e524-40f4-808e-c02e87e82427'
const ALLOWED_EMAILS   = ['rafaelnolasco@gmail.com', 'aalmarazmo@lukon.com.mx']

// Admin client — bypasses RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Verificar sesión ────────────────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !ALLOWED_EMAILS.includes(user.email ?? '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── 2. Parsear body ────────────────────────────────────────────────────────
    const { description, amount, payer_email } = await req.json()
    if (!description || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'description y amount son requeridos' },
        { status: 400 }
      )
    }

    // ── 3. Insertar transacción pendiente ──────────────────────────────────────
    const { data: txn, error: txnError } = await supabaseAdmin
      .from('pos_transactions')
      .insert({
        client_id:  LUKON_CLIENT_ID,
        provider:   'mercadopago',
        amount:     Number(amount),
        currency:   'MXN',
        status:     'pending',
        service:    description,
        vertical:   'telematica_gps',
        metadata:   { description, payer_email: payer_email ?? null, created_by: user.email },
      })
      .select()
      .single()

    if (txnError || !txn) {
      console.error('[lukon/checkout] insert:', txnError)
      return NextResponse.json({ error: 'Error al crear transacción' }, { status: 500 })
    }

    // ── 4. Crear Preference de MercadoPago ────────────────────────────────────
    const mp = new MercadoPagoConfig({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    const preference = new Preference(mp)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'

    const pref = await preference.create({
      body: {
        items: [{
          id:          txn.id,
          title:       description,
          quantity:    1,
          unit_price:  Number(amount),
          currency_id: 'MXN',
        }],
        payer:              payer_email ? { email: payer_email } : undefined,
        external_reference: txn.id,
        notification_url:   `${appUrl}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${appUrl}/app/lukon?pago=ok`,
          failure: `${appUrl}/app/lukon?pago=error`,
          pending: `${appUrl}/app/lukon?pago=pendiente`,
        },
        auto_return: 'approved',
      },
    })

    // ── 5. Actualizar transacción con ID de MP ─────────────────────────────────
    await supabaseAdmin
      .from('pos_transactions')
      .update({
        external_id: pref.id,
        metadata: {
          description,
          payer_email:   payer_email ?? null,
          preference_id: pref.id,
          created_by:    user.email,
        },
      })
      .eq('id', txn.id)

    return NextResponse.json({
      transaction_id: txn.id,
      payment_url:    pref.init_point,         // producción
      sandbox_url:    pref.sandbox_init_point, // pruebas / test
      preference_id:  pref.id,
    })

  } catch (err) {
    console.error('[lukon/checkout] error:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
