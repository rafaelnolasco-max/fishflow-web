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

/**
 * Consulta el estado de una transacción directamente en MercadoPago
 * y actualiza pos_transactions en Supabase.
 * Body: { transaction_id: string }
 */
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

    // ── 3. Buscar el pago en MercadoPago por external_reference ──────────────
    const mp = new MercadoPagoConfig({
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    })

    const mpPayment = new Payment(mp)

    // MP guarda external_reference = transaction_id, buscamos por ahí
    const searchResult = await mpPayment.search({
      options: {
        criteria:      'desc',
        external_reference: transaction_id,
      },
    })

    const payments = searchResult?.results ?? []

    if (payments.length === 0) {
      return NextResponse.json({
        message: 'Sin pagos encontrados en MercadoPago aún',
        status:  txn.status,
        synced:  false,
      })
    }

    // Tomar el pago más reciente
    const latestPayment = payments[0]
    const mpStatus = latestPayment.status

    const statusMap: Record<string, string> = {
      approved: 'approved',
      rejected: 'rejected',
      cancelled: 'cancelled',
      pending:  'pending',
      in_process: 'pending',
    }
    const newStatus = statusMap[mpStatus ?? ''] ?? 'pending'

    // ── 4. Actualizar si cambió ───────────────────────────────────────────────
    if (newStatus !== txn.status) {
      await supabaseAdmin
        .from('pos_transactions')
        .update({
          status:         newStatus,
          external_id:    String(latestPayment.id),
          payment_method: latestPayment.payment_method_id ?? null,
        })
        .eq('id', transaction_id)
    }

    return NextResponse.json({
      synced:      true,
      old_status:  txn.status,
      new_status:  newStatus,
      mp_payment_id: latestPayment.id,
      changed:     newStatus !== txn.status,
    })

  } catch (err: any) {
    console.error('[admin/sync] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 })
  }
}
