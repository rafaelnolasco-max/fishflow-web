import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import Stripe from 'stripe'

const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Valores válidos en el CHECK constraint de pos_transactions.status
const MP_STATUS_MAP: Record<string, string> = {
  approved:   'paid',
  rejected:   'failed',
  cancelled:  'cancelled',
  pending:    'pending',
  in_process: 'pending',
  authorized: 'pending',
}

/** Llama directo a la REST API de MP — más confiable que el SDK para search */
async function mpFetch(path: string, token: string) {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`MP API ${res.status}: ${err}`)
  }
  return res.json()
}

async function updateDb(transaction_id: string, newStatus: string, externalId?: string) {
  const { error, data } = await supabaseAdmin
    .from('pos_transactions')
    .update({
      status: newStatus,
      ...(externalId ? { external_id: externalId } : {}),
    })
    .eq('id', transaction_id)
    .select('id, status')

  console.log('[sync] DB update result — error:', error, 'data:', data)
  return error
}

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

    const { transaction_id } = await req.json()
    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id requerido' }, { status: 400 })
    }

    // ── 2. Obtener la transacción de Supabase ─────────────────────────────────
    const { data: txn, error: txnError } = await supabaseAdmin
      .from('pos_transactions')
      .select('id, provider, external_id, metadata, status')
      .eq('id', transaction_id)
      .single()

    if (txnError || !txn) {
      return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 })
    }

    // ── 3. Branch por provider ────────────────────────────────────────────────
    if (txn.provider === 'stripe') {
      return await syncStripe(txn, transaction_id)
    } else {
      return await syncMercadoPago(txn, transaction_id)
    }

  } catch (err: any) {
    console.error('[admin/sync] unexpected:', err?.message ?? err)
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 })
  }
}

// ── Stripe sync ───────────────────────────────────────────────────────────────
async function syncStripe(txn: any, transaction_id: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY no configurado' }, { status: 500 })
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2026-04-22.dahlia' })

  // El external_id puede ser session_id (cs_...) o payment_intent (pi_...)
  const sessionId = txn.metadata?.session_id ?? txn.external_id
  if (!sessionId) {
    return NextResponse.json({
      synced:  false,
      message: 'No hay session_id de Stripe registrado para esta transacción.',
      status:  txn.status,
    })
  }

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (e: any) {
    console.error('[sync/stripe] retrieve session failed:', e.message)
    return NextResponse.json({ error: `Error consultando Stripe: ${e.message}` }, { status: 500 })
  }

  console.log(`[sync/stripe] session ${sessionId} status=${session.status} payment_status=${session.payment_status}`)

  // Mapear status de Stripe a DB
  let newStatus: string
  if (session.status === 'complete' && session.payment_status === 'paid') {
    newStatus = 'paid'
  } else if (session.status === 'expired') {
    newStatus = 'failed'
  } else {
    newStatus = 'pending'
  }

  if (newStatus !== txn.status) {
    const dbErr = await updateDb(transaction_id, newStatus, session.payment_intent as string ?? undefined)
    if (dbErr) {
      return NextResponse.json({
        synced:         false,
        old_status:     txn.status,
        new_status:     newStatus,
        stripe_status:  session.status,
        db_error:       dbErr.message,
        db_code:        (dbErr as any).code,
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    synced:        true,
    old_status:    txn.status,
    new_status:    newStatus,
    stripe_status: session.status,
    payment_status: session.payment_status,
    changed:       newStatus !== txn.status,
  })
}

// ── MercadoPago sync ──────────────────────────────────────────────────────────
async function syncMercadoPago(txn: any, transaction_id: string) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN!

  let mpStatus: string | undefined
  let mpPaymentId: string | undefined

  // 3a. Si external_id es numérico (payment ID real), consultar directo
  const isNumeric = txn.external_id && /^\d+$/.test(String(txn.external_id))
  if (isNumeric) {
    try {
      const data = await mpFetch(`/v1/payments/${txn.external_id}`, token)
      mpStatus    = data.status
      mpPaymentId = String(data.id)
      console.log(`[sync/mp] found by payment_id ${txn.external_id}: ${mpStatus}`)
    } catch (e: any) {
      console.warn('[sync/mp] direct payment GET failed:', e.message)
    }
  }

  // 3b. Buscar por external_reference (nuestro UUID)
  if (!mpStatus) {
    try {
      const data = await mpFetch(
        `/v1/payments/search?external_reference=${encodeURIComponent(transaction_id)}&sort=date_created&criteria=desc`,
        token
      )
      const results = data?.results ?? []
      console.log(`[sync/mp] search by external_reference found ${results.length} payments`)
      if (results.length > 0) {
        mpStatus    = results[0].status
        mpPaymentId = String(results[0].id)
      }
    } catch (e: any) {
      console.warn('[sync/mp] payment search failed:', e.message)
      return NextResponse.json({ error: `Error consultando MP: ${e.message}` }, { status: 500 })
    }
  }

  if (!mpStatus) {
    return NextResponse.json({
      synced:  false,
      message: 'Pago no encontrado en MercadoPago. Si el cliente ya pagó, espera unos minutos e intenta de nuevo.',
      status:  txn.status,
    })
  }

  const newStatus = MP_STATUS_MAP[mpStatus] ?? 'pending'

  if (newStatus !== txn.status) {
    const dbErr = await updateDb(transaction_id, newStatus, mpPaymentId)
    if (dbErr) {
      return NextResponse.json({
        synced:        false,
        old_status:    txn.status,
        new_status:    newStatus,
        mp_status:     mpStatus,
        mp_payment_id: mpPaymentId,
        db_error:      dbErr.message,
        db_code:       (dbErr as any).code,
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    synced:        true,
    old_status:    txn.status,
    new_status:    newStatus,
    mp_status:     mpStatus,
    mp_payment_id: mpPaymentId,
    changed:       newStatus !== txn.status,
  })
}
