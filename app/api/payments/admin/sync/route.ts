import { NextRequest, NextResponse } from 'next/server'
import { MercadoPagoConfig, Payment } from 'mercadopago'
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

    const mp = new MercadoPagoConfig({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })
    const mpPayment = new Payment(mp)

    let mpStatus: string | undefined
    let mpPaymentId: string | undefined

    // ── 3a. Si tenemos el payment_id directo, consultarlo directamente ─────────
    //       external_id puede ser el preference_id (pref.id) o el payment_id real.
    //       Después del pago, MP actualiza external_id con el payment id numérico.
    const numericId = txn.external_id && /^\d+$/.test(String(txn.external_id))
      ? txn.external_id
      : null

    if (numericId) {
      try {
        const paymentData = await mpPayment.get({ id: numericId })
        mpStatus    = paymentData.status ?? undefined
        mpPaymentId = String(paymentData.id)
      } catch (e) {
        console.warn('[sync] get by id failed, falling back to search:', e)
      }
    }

    // ── 3b. Si no, buscar por external_reference (= nuestro transaction_id UUID) ─
    if (!mpStatus) {
      try {
        const searchResult = await mpPayment.search({
          options: { external_reference: transaction_id, sort: 'date_created', criteria: 'desc', range: 'date_created' },
        })
        const payments = (searchResult as any)?.results ?? []
        if (payments.length > 0) {
          mpStatus    = payments[0].status
          mpPaymentId = String(payments[0].id)
        }
      } catch (e) {
        console.warn('[sync] search failed:', e)
      }
    }

    // ── 4. Si no encontramos nada en MP ──────────────────────────────────────
    if (!mpStatus) {
      return NextResponse.json({
        synced:  false,
        message: 'No se encontró el pago en MercadoPago todavía. Puede que aún esté procesando.',
        status:  txn.status,
      })
    }

    const newStatus = STATUS_MAP[mpStatus] ?? 'pending'

    // ── 5. Actualizar si cambió ───────────────────────────────────────────────
    if (newStatus !== txn.status) {
      await supabaseAdmin
        .from('pos_transactions')
        .update({
          status:      newStatus,
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
    console.error('[admin/sync] error:', err?.message ?? err)
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 })
  }
}
