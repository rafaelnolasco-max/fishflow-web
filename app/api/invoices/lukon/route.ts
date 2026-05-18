import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// ─── Constantes de Lukon ──────────────────────────────────────────────────────
const LUKON_CLIENT_ID = '1aa4a82b-e524-40f4-808e-c02e87e82427'
const ALLOWED_EMAILS  = ['rafaelnolasco@gmail.com', 'aalmarazmo@lukon.com.mx']

// Clave SAT para servicios de localización GPS/telemática
const SAT_PRODUCT_KEY = '81161500' // Servicios de rastreo satelital de vehículos
const SAT_UNIT_KEY    = 'E48'      // Unidad de servicio

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // ── 1. Verificar sesión ────────────────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !ALLOWED_EMAILS.includes(user.email ?? '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── 2. Verificar que Facturapi esté configurado ────────────────────────────
    const facturApiKey = process.env.FACTURAPI_SECRET_KEY
    if (!facturApiKey) {
      return NextResponse.json({
        error: 'Facturapi no está configurado aún. Agrega FACTURAPI_SECRET_KEY en Vercel para habilitar la facturación.',
        code:  'FACTURAPI_NOT_CONFIGURED',
      }, { status: 503 })
    }

    // ── 3. Parsear body ────────────────────────────────────────────────────────
    const {
      rfc,
      razon_social,
      email,
      cp,
      regimen_fiscal = '616',
      concepto,
      amount,
      transaction_id,
      payment_form = '03', // Transferencia electrónica de fondos
      cfdi_use     = 'G03', // Gastos en general
    } = await req.json()

    if (!rfc || !razon_social || !concepto || !amount || Number(amount) <= 0) {
      return NextResponse.json({
        error: 'Campos requeridos: rfc, razon_social, concepto, amount'
      }, { status: 400 })
    }

    // ── 4. Llamar a Facturapi ──────────────────────────────────────────────────
    const facturRes = await fetch('https://www.facturapi.io/v2/invoices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${facturApiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        customer: {
          legal_name: razon_social,
          tax_id:     rfc.toUpperCase(),
          tax_system: regimen_fiscal,
          email:      email || undefined,
          address: {
            zip: cp || '06600',
          },
        },
        items: [{
          quantity: 1,
          product: {
            description:  concepto,
            product_key:  SAT_PRODUCT_KEY,
            unit_key:     SAT_UNIT_KEY,
            price:        Number(amount),
            taxes: [{ type: 'IVA', rate: 0.16 }],
          },
        }],
        payment_form,
        use: cfdi_use,
      }),
    })

    const facturData = await facturRes.json()

    if (!facturRes.ok) {
      console.error('[lukon/invoice] facturapi error:', facturData)
      return NextResponse.json({
        error: facturData.message ?? 'Error al timbrar con Facturapi',
        details: facturData,
      }, { status: 502 })
    }

    // ── 5. Guardar en tabla invoices ───────────────────────────────────────────
    const { data: invoice, error: invError } = await supabaseAdmin
      .from('invoices')
      .insert({
        client_id:    LUKON_CLIENT_ID,
        transaction_id: transaction_id ?? null,
        facturapi_id: facturData.id,
        uuid_sat:     facturData.uuid,
        status:       'valid',
        cfdi_type:    'I',
        amount:       Number(amount),
        currency:     'MXN',
        pdf_url:      facturData.pdf_url  ?? null,
        xml_url:      facturData.xml_url  ?? null,
      })
      .select()
      .single()

    if (invError) {
      console.error('[lukon/invoice] insert:', invError)
      // No es fatal — el CFDI ya se timbró
    }

    return NextResponse.json({
      invoice_id:   invoice?.id,
      facturapi_id: facturData.id,
      uuid_sat:     facturData.uuid,
      pdf_url:      facturData.pdf_url,
      xml_url:      facturData.xml_url,
      status:       'valid',
    })

  } catch (err) {
    console.error('[lukon/invoice] error:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
