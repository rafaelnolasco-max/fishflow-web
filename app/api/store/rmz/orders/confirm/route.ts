// app/api/store/rmz/orders/confirm/route.ts
// Confirmar depósito por transferencia (botón del panel /app/rmz).
// Requiere sesión con acceso al cliente rmz. Marca pagado y avisa al cliente.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import {
  RMZ_CLIENT_ID, emailCustomerPaid,
  type StoreOrder, type StoreOrderItem,
} from '@/lib/storeRmz'

export const runtime = 'nodejs'

const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Sesión con acceso a rmz ────────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    if (user.email !== ADMIN_EMAIL) {
      const { data: hasAccess, error: rpcErr } = await supabase.rpc(
        'user_has_access_to_slug', { p_slug: 'rmz' }
      )
      if (rpcErr || !hasAccess)
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // ── 2. Validar pedido ─────────────────────────────────────────────────────
    const { order_id } = await req.json()
    if (!order_id) return NextResponse.json({ error: 'order_id requerido' }, { status: 400 })

    const { data: order, error } = await supabaseAdmin
      .from('store_orders')
      .select('*')
      .eq('id', order_id)
      .eq('client_id', RMZ_CLIENT_ID)
      .maybeSingle()
    if (error) console.error('[rmz/confirm] select:', error)
    if (!order) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    if (order.payment_status === 'paid')
      return NextResponse.json({ ok: true, already: true })

    // ── 3. Marcar pagado + avisar al cliente ─────────────────────────────────
    const { error: upErr } = await supabaseAdmin
      .from('store_orders')
      .update({
        payment_status: 'paid',
        fulfillment_status: order.fulfillment_status === 'nuevo' ? 'produccion' : order.fulfillment_status,
      })
      .eq('id', order.id)
    if (upErr) {
      console.error('[rmz/confirm] update:', upErr)
      return NextResponse.json({ error: 'Error al confirmar' }, { status: 500 })
    }

    const { data: items } = await supabaseAdmin
      .from('store_order_items')
      .select('product_name, color_name, unit_price, qty, line_total')
      .eq('order_id', order.id)

    await emailCustomerPaid(
      { ...order, payment_status: 'paid' } as StoreOrder,
      (items ?? []) as StoreOrderItem[]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[rmz/confirm] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
