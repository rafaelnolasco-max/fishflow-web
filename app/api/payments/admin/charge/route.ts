import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// ─── Solo Rafa puede usar este endpoint ──────────────────────────────────────
const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

// Admin client — bypasa RLS
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

    if (!client_id) {
      return NextResponse.json({ error: 'client_id es requerido' }, { status: 400 })
    }
    if (!description?.trim()) {
      return NextResponse.json({ error: 'description es requerido' }, { status: 400 })
    }
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'amount debe ser mayor a 0' }, { status: 400 })
    }

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
        provider:  'mercadopago',
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
      console.error('[admin/charge] insert txn:', txnError)
      return NextResponse.json({ error: 'Error al crear transacción' }, { status: 500 })
    }

    // ── 5. Crear Preference en MercadoPago ────────────────────────────────────
    const mp = new MercadoPagoConfig({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    const preference = new Preference(mp)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'

    const pref = await preference.create({
      body: {
        items: [{
          id:          txn.id,
          title:       description.trim(),
          quantity:    1,
          unit_price:  Number(amount),
          currency_id: 'MXN',
        }],
        payer:              payer_email ? { email: payer_email } : undefined,
        external_reference: txn.id,
        notification_url:   `${appUrl}/api/payments/mercadopago/webhook`,
        back_urls: {
          success: `${appUrl}/pay/success`,
          failure: `${appUrl}/pay/error`,
          pending: `${appUrl}/pay/pendiente`,
        },
        auto_return: 'approved',
      },
    })

    // ── 6. Actualizar transacción con el link de pago ─────────────────────────
    await supabaseAdmin
      .from('pos_transactions')
      .update({
        external_id: pref.id,
        metadata: {
          description:    description.trim(),
          payer_email:    payer_email ?? null,
          preference_id:  pref.id,
          payment_url:    pref.init_point,      // ← guardamos para /pay/[slug]
          created_by:     user.email,
          created_from:   'admin_panel',
        },
      })
      .eq('id', txn.id)

    return NextResponse.json({
      transaction_id: txn.id,
      payment_url:    pref.init_point,         // producción
      sandbox_url:    pref.sandbox_init_point, // pruebas
      preference_id:  pref.id,
      client_name:    client.name,
    })

  } catch (err) {
    console.error('[admin/charge] error:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
