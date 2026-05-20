import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const STATUS_MAP: Record<string, string> = {
  approved:   'approved',
  rejected:   'rejected',
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

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN!

    let mpStatus: string | undefined
    let mpPaymentId: string | undefined

    // ── 3a. Si external_id es numérico (payment ID real), consultar directo ───
    const isNumeric = txn.external_id && /^\d+$/.test(String(txn.external_id))
    if (isNumeric) {
      try {
        const data = await mpFetch(`/v1/payments/${txn.external_id}`, token)
        mpStatus    = data.status
        mpPaymentId = String(data.id)
        console.log(`[sync] found by payment_id ${txn.external_id}: ${mpStatus}`)
      } catch (e: any) {
        console.warn('[sync] direct payment GET failed:', e.message)
      }
    }

    // ── 3b. Buscar por external_reference (nuestro UUID) via REST ─────────────
    if (!mpStatus) {
      try {
        const data = await mpFetch(
          `/v1/payments/search?external_reference=${encodeURIComponent(transaction_id)}&sort=date_created&criteria=desc`,
          token
        )
        const results = data?.results ?? []
        console.log(`[sync] search by external_reference found ${results.length} payments`)
        if (results.length > 0) {
          mpStatus    = results[0].status
          mpPaymentId = String(results[0].id)
        }
      } catch (e: any) {
        console.warn('[sync] payment search failed:', e.message)
        return NextResponse.json({ error: `Error consultando MP: ${e.message}` }, { status: 500 })
      }
    }

    // ── 4. No encontrado aún ──────────────────────────────────────────────────
    if (!mpStatus) {
      return NextResponse.json({
        synced:  false,
        message: 'Pago no encontrado en MercadoPago. Si el cliente ya pagó, espera unos minutos e intenta de nuevo.',
        status:  txn.status,
      })
    }

    const newStatus = STATUS_MAP[mpStatus] ?? 'pending'

    // ── 5. Actualizar Supabase si cambió ──────────────────────────────────────
    if (newStatus !== txn.status) {
      await supabaseAdmin
        .from('pos_transactions')
        .update({
          status:    newStatus,
          ...(mpPaymentId ? { external_id: mpPaymentId } : {}),
        })
        .eq('id', transaction_id)
    }

    return NextResponse.json({
      synced:        true,
      old_status:    txn.status,
      new_status:    newStatus,
      mp_status:     mpStatus,
      mp_payment_id: mpPaymentId,
      changed:       newStatus !== txn.status,
    })

  } catch (err: any) {
    console.error('[admin/sync] unexpected:', err?.message ?? err)
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 })
  }
}
