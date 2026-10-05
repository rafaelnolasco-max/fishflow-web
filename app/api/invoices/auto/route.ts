// app/api/invoices/auto/route.ts
// Facturación automática al confirmarse un pago.
//
// La llama la Edge Function `auto-invoice` (disparada por el trigger
// notify_auto_invoice cuando pos_transactions pasa a 'paid'). Autenticación
// server-to-server con la service role key, que ya existe en Vercel y en
// Supabase: no hace falta un secreto nuevo.
//
// Responde 200 aunque no timbre (sin datos fiscales, auto desactivado): para
// la Edge Function eso no es un error, es "solo va el recibo".

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { facturarTransaccion } from '@/lib/cfdi'

export const maxDuration = 60

function autorizado(req: NextRequest): boolean {
  const esperado = process.env.SUPABASE_SERVICE_ROLE_KEY
  const header = req.headers.get('authorization') ?? ''
  const dado = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!esperado || !dado) return false
  const a = Buffer.from(esperado)
  const b = Buffer.from(dado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { transaction_id } = await req.json().catch(() => ({}))
  if (!transaction_id) return NextResponse.json({ error: 'transaction_id requerido' }, { status: 400 })

  const r = await facturarTransaccion(String(transaction_id), 'auto')
  if (!r.ok) console.log(`[invoices/auto] ${transaction_id}: ${r.code} — ${r.error}`)
  return NextResponse.json(r, { status: r.ok ? 200 : r.status })
}
