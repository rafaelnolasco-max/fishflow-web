// app/api/invoices/route.ts
// Genera CFDI via Facturapi — multi-tenant, dos capas:
//   layer = 'fishflow' → FishFlow factura al cliente que pagó (Capa 1)
//   layer = 'client'   → El cliente de FishFlow factura a su cliente final (Capa 2)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callFacturapi(apiKey: string, body: object) {
  const res = await fetch('https://www.facturapi.io/v2/invoices', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { ok: res.ok, data }
}

// ─── POST /api/invoices ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      // Capa (requerido)
      layer = 'fishflow',       // 'fishflow' | 'client'

      // Datos del receptor (quien recibe la factura)
      rfc,
      razon_social,
      regimen_fiscal = '616',   // Personas físicas sin actividad empresarial
      cp             = '06600',
      email,
      cfdi_use       = 'G03',   // Gastos en general
      payment_form   = '03',    // Transferencia

      // Concepto
      concepto,
      amount,

      // Referencia a la transacción (opcional)
      transaction_id,

      // Solo para Capa 2: client_id del cliente de FishFlow que emite
      client_id,
    } = body

    if (!rfc || !razon_social || !concepto || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: 'Campos requeridos: rfc, razon_social, concepto, amount' },
        { status: 400 }
      )
    }

    // ── Determinar API key según la capa ─────────────────────────────────────
    let facturApiKey: string | undefined
    let sat_product_key = '81161500'
    let sat_unit_key    = 'E48'
    let invoiceClientId = client_id ?? null

    if (layer === 'fishflow') {
      // Capa 1: FishFlow es el emisor — usamos la key maestra
      facturApiKey = process.env.FACTURAPI_SECRET_KEY
      if (!facturApiKey) {
        return NextResponse.json(
          { error: 'FACTURAPI_SECRET_KEY no configurada', code: 'FACTURAPI_NOT_CONFIGURED' },
          { status: 503 }
        )
      }

      // Si viene transaction_id, deducir client_id del pago
      if (transaction_id && !invoiceClientId) {
        const { data: txn } = await supabaseAdmin
          .from('pos_transactions')
          .select('client_id')
          .eq('id', transaction_id)
          .single()
        invoiceClientId = txn?.client_id ?? null
      }

    } else {
      // Capa 2: el cliente de FishFlow es el emisor — buscamos su org
      if (!client_id) {
        return NextResponse.json(
          { error: 'client_id requerido para layer=client' },
          { status: 400 }
        )
      }

      const { data: org } = await supabaseAdmin
        .from('invoice_orgs')
        .select('*')
        .eq('client_id', client_id)
        .eq('active', true)
        .single()

      if (!org) {
        return NextResponse.json(
          { error: 'Módulo de facturación no habilitado para este cliente', code: 'ORG_NOT_FOUND' },
          { status: 404 }
        )
      }

      facturApiKey    = org.facturapi_test_key ?? org.facturapi_live_key
      sat_product_key = org.sat_product_key
      sat_unit_key    = org.sat_unit_key

      if (!facturApiKey) {
        return NextResponse.json(
          { error: 'API key de Facturapi no configurada para este cliente', code: 'ORG_KEY_MISSING' },
          { status: 503 }
        )
      }
    }

    // ── Llamar a Facturapi ────────────────────────────────────────────────────
    const { ok, data: facturData } = await callFacturapi(facturApiKey, {
      customer: {
        legal_name: razon_social,
        tax_id:     rfc.toUpperCase().trim(),
        tax_system: regimen_fiscal,
        email:      email || undefined,
        address: { zip: cp },
      },
      items: [{
        quantity: 1,
        product: {
          description: concepto,
          product_key: sat_product_key,
          unit_key:    sat_unit_key,
          price:       Number(amount),
          taxes: [{ type: 'IVA', rate: 0.16 }],
        },
      }],
      payment_form,
      use: cfdi_use,
    })

    if (!ok) {
      console.error('[invoices] facturapi error:', facturData)
      return NextResponse.json(
        { error: facturData.message ?? 'Error al timbrar con Facturapi', details: facturData },
        { status: 502 }
      )
    }

    // ── Guardar en tabla invoices ─────────────────────────────────────────────
    const { data: invoice, error: invError } = await supabaseAdmin
      .from('invoices')
      .insert({
        client_id:        invoiceClientId,
        transaction_id:   transaction_id ?? null,
        invoice_layer:    layer,
        facturapi_id:     facturData.id,
        uuid_sat:         facturData.uuid,
        status:           'valid',
        cfdi_type:        'I',
        amount:           Number(amount),
        currency:         'MXN',
        pdf_url:          facturData.pdf_url  ?? null,
        xml_url:          facturData.xml_url  ?? null,
        receptor_rfc:     rfc.toUpperCase().trim(),
        receptor_razon:   razon_social,
        receptor_regimen: regimen_fiscal,
        receptor_cp:      cp,
        receptor_email:   email ?? null,
        cfdi_use,
        payment_form,
      })
      .select()
      .single()

    if (invError) {
      console.error('[invoices] insert error:', invError)
      // No es fatal — el CFDI ya se timbró en el SAT
    }

    return NextResponse.json({
      success:      true,
      invoice_id:   invoice?.id,
      facturapi_id: facturData.id,
      uuid_sat:     facturData.uuid,
      pdf_url:      facturData.pdf_url,
      xml_url:      facturData.xml_url,
      status:       'valid',
    })

  } catch (err) {
    console.error('[invoices] error inesperado:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
