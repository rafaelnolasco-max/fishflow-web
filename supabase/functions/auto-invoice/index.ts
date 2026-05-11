// Supabase Edge Function — auto-invoice
// Triggered by DB trigger notify_auto_invoice() via pg_net when
// pos_transactions.status changes to 'paid'.
//
// Payload: { record: { id, client_id, amount, currency, service, provider, payment_method } }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FACTURAPI_URL = 'https://www.facturapi.io/v2'

// SAT product key for "Servicios de apoyo empresarial" — fits most B2B services
const DEFAULT_PRODUCT_KEY = '85121800'
// SAT unit key for "Servicio" (unidad de servicio)
const DEFAULT_UNIT_KEY = 'E48'

serve(async (req: Request) => {
  try {
    const { record } = await req.json() as {
      record: {
        id: string
        client_id: string
        amount: number
        currency: string
        service: string | null
        provider: string
        payment_method: string | null
      }
    }

    if (!record?.id || !record?.client_id) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload — missing record.id or record.client_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── 1. Get client fiscal data ──────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('rfc, razon_social, regimen_fiscal, email_factura, cp, factura_auto')
      .eq('id', record.client_id)
      .single()

    if (clientErr || !client) {
      console.error('[auto-invoice] Client not found:', clientErr)
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 2. Check factura_auto flag ─────────────────────────────────────
    if (!client.factura_auto) {
      console.log('[auto-invoice] factura_auto disabled for client', record.client_id)
      return new Response(
        JSON.stringify({ skipped: 'factura_auto is disabled for this client' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 3. Check fiscal data is complete ──────────────────────────────
    if (!client.rfc || !client.razon_social || !client.cp) {
      const msg = 'Incomplete fiscal data — missing rfc, razon_social, or cp'
      console.error('[auto-invoice]', msg, 'client_id:', record.client_id)

      // Create invoice record in error state so Rafa can see it in the dashboard
      await supabase.from('invoices').insert({
        transaction_id: record.id,
        client_id: record.client_id,
        amount: record.amount,
        currency: record.currency,
        status: 'error',
        error_message: msg,
      })

      return new Response(
        JSON.stringify({ error: msg }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 4. Create invoice record as pending ────────────────────────────
    const { data: invoice, error: invoiceErr } = await supabase
      .from('invoices')
      .insert({
        transaction_id: record.id,
        client_id: record.client_id,
        amount: record.amount,
        currency: record.currency,
        status: 'pending',
        cfdi_type: 'I',
      })
      .select()
      .single()

    if (invoiceErr || !invoice) {
      console.error('[auto-invoice] Failed to create invoice record:', invoiceErr)
      return new Response(
        JSON.stringify({ error: 'Failed to create invoice record' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 5. Emit CFDI via Facturapi ─────────────────────────────────────
    const facturapiKey = Deno.env.get('FACTURAPI_SECRET_KEY')!

    // Map payment method to SAT form code
    // MP payment methods: 'account_money', 'credit_card', 'debit_card', 'cash', etc.
    const pm = record.payment_method ?? ''
    let formaPA = '03'  // 03 = Transferencia electrónica (default)
    if (pm === 'cash' || pm === 'efectivo') formaPA = '01'      // 01 = Efectivo
    else if (pm.includes('credit_card')) formaPA = '04'          // 04 = Tarjeta de crédito
    else if (pm.includes('debit_card')) formaPA = '28'           // 28 = Tarjeta de débito

    const facturapiBody = {
      customer: {
        legal_name: client.razon_social,
        tax_id: client.rfc,
        tax_system: client.regimen_fiscal ?? '626', // 626 = RESICO (más común en PyMES)
        email: client.email_factura ?? undefined,
        address: { zip: client.cp },
      },
      items: [
        {
          product: {
            description: record.service ?? 'Servicio',
            product_key: DEFAULT_PRODUCT_KEY,
            unit_key: DEFAULT_UNIT_KEY,
            price: Number(record.amount),
          },
          quantity: 1,
        },
      ],
      use: 'G03',           // G03 = Gastos en general
      payment_form: formaPA,
      payment_method: 'PUE', // PUE = Pago en una sola exhibición
      currency: record.currency ?? 'MXN',
    }

    const facturapiResp = await fetch(`${FACTURAPI_URL}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facturapiKey}`,
      },
      body: JSON.stringify(facturapiBody),
    })

    // ── 6. Handle Facturapi response ───────────────────────────────────
    if (!facturapiResp.ok) {
      const errText = await facturapiResp.text()
      console.error('[auto-invoice] Facturapi error:', errText)

      await supabase
        .from('invoices')
        .update({ status: 'error', error_message: errText })
        .eq('id', invoice.id)

      return new Response(
        JSON.stringify({ error: 'Facturapi rejected the invoice', detail: errText }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const cfdi = await facturapiResp.json()

    // ── 7. Persist CFDI data ───────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('invoices')
      .update({
        facturapi_id: cfdi.id,
        uuid_sat: cfdi.uuid,
        status: 'valid',
        pdf_url: cfdi.pdf_url ?? cfdi.pdf ?? null,
        xml_url: cfdi.xml_url ?? cfdi.xml ?? null,
      })
      .eq('id', invoice.id)

    if (updateErr) {
      console.error('[auto-invoice] Failed to update invoice with CFDI data:', updateErr)
    }

    console.log('[auto-invoice] CFDI emitido:', cfdi.uuid, '— invoice_id:', invoice.id)

    return new Response(
      JSON.stringify({
        success: true,
        invoice_id: invoice.id,
        uuid_sat: cfdi.uuid,
        facturapi_id: cfdi.id,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[auto-invoice] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
