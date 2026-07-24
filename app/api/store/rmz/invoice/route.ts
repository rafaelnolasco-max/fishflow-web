// app/api/store/rmz/invoice/route.ts
// Solicitud de factura desde la orden de compra pública (por token).
// Guarda los datos fiscales y avisa a Rafa + Antonio. La emisión del CFDI
// (Facturapi) se dispara desde el panel — es el servicio adicional a vender.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyOwnersInvoiceRequest, type StoreOrder } from '@/lib/storeRmz'

export const runtime = 'nodejs'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  try {
    const { token, rfc, razon_social, cp, cfdi_use, email } = await req.json()

    if (!token || !UUID_RE.test(token))
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    if (!rfc || !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(String(rfc).trim()))
      return NextResponse.json({ error: 'RFC inválido' }, { status: 400 })
    if (!razon_social?.trim())
      return NextResponse.json({ error: 'Razón social requerida' }, { status: 400 })

    const { data: order, error } = await supabaseAdmin
      .from('store_orders').select('*').eq('token', token).maybeSingle()
    if (error) console.error('[rmz/invoice] select:', error)
    if (!order)
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    if (order.payment_status !== 'paid')
      return NextResponse.json({ error: 'La factura se solicita después de confirmar el pago' }, { status: 400 })

    const invoice_data = {
      rfc: String(rfc).trim().toUpperCase().slice(0, 13),
      razon_social: String(razon_social).trim().slice(0, 200),
      cp: String(cp ?? '').trim().slice(0, 5),
      cfdi_use: ['G01', 'G03', 'P01'].includes(cfdi_use) ? cfdi_use : 'G03',
      email: String(email ?? '').trim().slice(0, 120) || order.customer_email,
    }

    const { error: upErr } = await supabaseAdmin
      .from('store_orders')
      .update({ invoice_requested: true, invoice_data })
      .eq('id', order.id)
    if (upErr) {
      console.error('[rmz/invoice] update:', upErr)
      return NextResponse.json({ error: 'Error al guardar la solicitud' }, { status: 500 })
    }

    await notifyOwnersInvoiceRequest({ ...order, invoice_requested: true, invoice_data } as StoreOrder)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[rmz/invoice] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
