// app/api/invoices/[id]/pdf/route.ts
// Proxy de descarga de PDF via Facturapi (no expone la API key al cliente)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('facturapi_id, invoice_layer, client_id')
    .eq('id', id)
    .single()

  if (!invoice?.facturapi_id) {
    return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
  }

  // Determinar API key según la capa
  let apiKey = process.env.FACTURAPI_SECRET_KEY
  if (invoice.invoice_layer === 'client' && invoice.client_id) {
    const { data: org } = await supabaseAdmin
      .from('invoice_orgs')
      .select('facturapi_test_key, facturapi_live_key')
      .eq('client_id', invoice.client_id)
      .single()
    apiKey = org?.facturapi_test_key ?? org?.facturapi_live_key ?? apiKey
  }

  const facturRes = await fetch(
    `https://www.facturapi.io/v2/invoices/${invoice.facturapi_id}/pdf`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  )

  if (!facturRes.ok) {
    return NextResponse.json({ error: 'Error al descargar PDF' }, { status: 502 })
  }

  const buffer = await facturRes.arrayBuffer()
  return new NextResponse(buffer, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="factura-${id}.pdf"`,
    },
  })
}
