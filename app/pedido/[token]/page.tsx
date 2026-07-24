// app/pedido/[token]/page.tsx
// Orden de compra pública de la tienda RMZ (acceso por token, sin login).
// Muestra estado, instrucciones SPEI si aplica y solicitud de factura.

import type React from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  RMZ_CLABE, RMZ_BANCO, RMZ_BENEFICIARIO, RMZ_BRAND,
  money, orderRef, type StoreOrder, type StoreOrderItem,
} from '@/lib/storeRmz'
import InvoiceForm from './InvoiceForm'

export const metadata = { title: 'Tu pedido — Cocinas y Closets RMZ' }
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STEPS = [
  ['pendiente', 'Pago pendiente'],
  ['produccion', 'En fabricación'],
  ['enviado', 'En camino'],
  ['entregado', 'Entregado'],
] as const

function stepIndex(o: StoreOrder) {
  if (o.payment_status !== 'paid') return 0
  switch (o.fulfillment_status) {
    case 'enviado': return 2
    case 'entregado': return 3
    default: return 1
  }
}

export default async function PedidoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const S = {
    page: { fontFamily: 'Inter,system-ui,sans-serif', background: '#FAF7F2', minHeight: '100vh', color: '#241C16', padding: '28px 16px 60px' } as React.CSSProperties,
    card: { maxWidth: 640, margin: '0 auto', background: '#fff', border: '1px solid #EAE0D5', borderRadius: 18, overflow: 'hidden' } as React.CSSProperties,
    head: { background: '#241C16', color: '#fff', padding: '20px 24px' } as React.CSSProperties,
    body: { padding: '20px 24px' } as React.CSSProperties,
    muted: { color: '#6E645C' } as React.CSSProperties,
  }

  if (!UUID_RE.test(token)) {
    return (
      <div style={S.page}><div style={S.card}><div style={S.body}>Pedido no encontrado.</div></div></div>
    )
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: order, error } = await supabaseAdmin
    .from('store_orders').select('*').eq('token', token).maybeSingle()

  if (error) console.error('[pedido] order:', error)
  if (!order) {
    return (
      <div style={S.page}><div style={S.card}><div style={S.body}>Pedido no encontrado. Revisa el enlace de tu correo.</div></div></div>
    )
  }

  const { data: itemsData, error: itemsErr } = await supabaseAdmin
    .from('store_order_items')
    .select('product_name, color_name, color_hex, unit_price, qty, line_total')
    .eq('order_id', order.id)
  if (itemsErr) console.error('[pedido] items:', itemsErr)

  const o = order as StoreOrder
  const items = (itemsData ?? []) as (StoreOrderItem & { color_hex: string | null })[]
  const idx = stepIndex(o)
  const paid = o.payment_status === 'paid'
  const isTransfer = o.payment_method === 'transferencia'

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.head}>
          <div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: RMZ_BRAND.accent }}>
            {RMZ_BRAND.name}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>Orden de compra {orderRef(o)}</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
            {new Date(o.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>

        <div style={S.body}>
          {/* Timeline de estado */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {STEPS.map(([key, label], i) => (
              <div key={key} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: 6, borderRadius: 99,
                  background: i <= idx ? RMZ_BRAND.accent : '#EAE0D5',
                }} />
                <div style={{ fontSize: 11, marginTop: 6, color: i <= idx ? '#241C16' : '#9A8B7C', fontWeight: i === idx ? 700 : 500 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Aviso de pago */}
          {!paid && isTransfer && (
            <div style={{ background: '#FFF7E8', border: '1px solid #EFD9A8', borderRadius: 12, padding: '14px 16px', marginBottom: 18, fontSize: 14 }}>
              <b>Tu pedido queda confirmado al recibir tu transferencia.</b>
              <table style={{ borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}><tbody>
                <tr><td style={{ ...S.muted, padding: '3px 14px 3px 0' }}>Banco</td><td><b>{RMZ_BANCO}</b></td></tr>
                <tr><td style={{ ...S.muted, padding: '3px 14px 3px 0' }}>Beneficiario</td><td><b>{RMZ_BENEFICIARIO}</b></td></tr>
                <tr><td style={{ ...S.muted, padding: '3px 14px 3px 0' }}>CLABE</td><td><b style={{ fontSize: 15 }}>{RMZ_CLABE}</b></td></tr>
                <tr><td style={{ ...S.muted, padding: '3px 14px 3px 0' }}>Monto</td><td><b>{money(o.total)}</b></td></tr>
                <tr><td style={{ ...S.muted, padding: '3px 14px 3px 0' }}>Referencia</td><td><b>{orderRef(o)}</b></td></tr>
              </tbody></table>
            </div>
          )}
          {!paid && !isTransfer && (
            <div style={{ background: '#FFF7E8', border: '1px solid #EFD9A8', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 14 }}>
              Tu pago está en proceso. Esta página se actualiza en cuanto se confirme.
            </div>
          )}
          {paid && (
            <div style={{ background: '#EAF6F0', border: '1px solid #BFE6D4', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 14, color: '#1E5E44' }}>
              ✅ Pago confirmado. Entrega estimada: {RMZ_BRAND.deliveryDays}. Te contactamos al {o.customer_phone} para coordinar.
            </div>
          )}

          {/* Artículos */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ ...S.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left' }}>
                <th style={{ paddingBottom: 8, fontWeight: 600 }}>Producto</th>
                <th style={{ paddingBottom: 8, fontWeight: 600, textAlign: 'center' }}>Cant.</th>
                <th style={{ paddingBottom: 8, fontWeight: 600, textAlign: 'right' }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td style={{ padding: '9px 0', borderTop: '1px solid #EAE0D5' }}>
                    {it.product_name}
                    {it.color_name && (
                      <span style={{ ...S.muted, fontSize: 13 }}>
                        {' '}· {it.color_hex && (
                          <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: it.color_hex, verticalAlign: 'middle', marginRight: 4, boxShadow: '0 0 0 1px #EAE0D5' }} />
                        )}{it.color_name}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '9px 0', borderTop: '1px solid #EAE0D5', textAlign: 'center' }}>{it.qty}</td>
                  <td style={{ padding: '9px 0', borderTop: '1px solid #EAE0D5', textAlign: 'right', fontWeight: 600 }}>{money(it.line_total)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{ padding: '12px 0 2px', textAlign: 'right', ...S.muted }}>Subtotal</td>
                <td style={{ padding: '12px 0 2px', textAlign: 'right' }}>{money(o.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '2px 0', textAlign: 'right', ...S.muted }}>Envío</td>
                <td style={{ padding: '2px 0', textAlign: 'right' }}>{Number(o.shipping_cost) > 0 ? money(o.shipping_cost) : 'Se cotiza al confirmar'}</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: '6px 0', textAlign: 'right', fontWeight: 800, fontSize: 17 }}>Total</td>
                <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 800, fontSize: 17 }}>{money(o.total)}</td>
              </tr>
            </tbody>
          </table>

          {/* Datos de entrega */}
          <div style={{ marginTop: 16, background: '#FAF7F2', border: '1px solid #EAE0D5', borderRadius: 12, padding: '12px 16px', fontSize: 14 }}>
            <b>Entrega a:</b> {o.customer_name} · {o.customer_phone}<br />
            <span style={S.muted}>{o.shipping_address}</span>
          </div>

          {/* Facturación */}
          <div style={{ marginTop: 22 }}>
            <InvoiceForm token={token} requested={o.invoice_requested} paid={paid} />
          </div>

          <p style={{ ...S.muted, fontSize: 12, marginTop: 24, textAlign: 'center' }}>
            ¿Dudas con tu pedido? Escríbenos por WhatsApp al {RMZ_BRAND.tel} · Hecho con FishFlow
          </p>
        </div>
      </div>
    </div>
  )
}
