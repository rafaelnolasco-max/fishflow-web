// app/api/invoices/admin/route.ts
// Datos de la pestaña Facturación del /admin: emisores, facturas recientes y
// clientes (con sus datos fiscales para prellenar). Solo Rafa.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const [orgs, invoices, clients] = await Promise.all([
    sb
      .from('invoice_orgs')
      .select(
        'id, client_id, active, modo, emisor_rfc, emisor_razon, serie, auto_al_pagar, sat_product_key, test_key_secret_id, live_key_secret_id, clients:client_id(name, slug)'
      ),
    sb
      .from('invoices')
      .select(
        'id, created_at, status, modo, origen, invoice_layer, emisor_org_id, client_id, receptor_rfc, receptor_razon, receptor_email, concepto, amount, total, serie, folio, uuid_sat, email_sent_at, email_to, error_message, cancel_status'
      )
      .order('created_at', { ascending: false })
      .limit(100),
    sb
      .from('clients')
      .select('id, name, slug, rfc, razon_social, regimen_fiscal, cp, email_factura, factura_auto')
      .eq('active', true)
      .order('name'),
  ])

  const err = orgs.error ?? invoices.error ?? clients.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({
    // Nunca se mandan las llaves: solo si existen.
    orgs: (orgs.data ?? []).map(({ test_key_secret_id, live_key_secret_id, ...o }) => ({
      ...o,
      tiene_llave_test: !!test_key_secret_id,
      tiene_llave_live: !!live_key_secret_id,
    })),
    invoices: invoices.data ?? [],
    clients: clients.data ?? [],
  })
}
