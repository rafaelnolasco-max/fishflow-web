import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { descargarCfdi, rutasDescarga, nombreArchivoCfdi } from '@/lib/facturapi'
import { sendEmail, REPLY_TO, type Adjunto } from '@/lib/email'
import { plantillaCfdi, asuntoCfdi, MARCA_LUKON, type DatosCfdi } from '@/lib/cfdiEmail'

// ─── Constantes de Lukon ──────────────────────────────────────────────────────
const LUKON_CLIENT_ID = '1aa4a82b-e524-40f4-808e-c02e87e82427'
const ALLOWED_EMAILS  = ['rafaelnolasco@gmail.com', 'aalmarazmo@lukon.com.mx']

// Clave SAT para servicios de localización GPS/telemática
const SAT_PRODUCT_KEY = '81161500' // Servicios de rastreo satelital de vehículos
const SAT_UNIT_KEY    = 'E48'      // Unidad de servicio

// Timbrar + bajar PDF y XML + enviar correo con adjuntos no cabe en el default.
export const maxDuration = 60

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
      enviar_correo = true,
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
    // ⚠️ Facturapi NO devuelve pdf_url ni xml_url al crear la factura. Se
    // guardan las rutas del proxy interno, que sí saben bajar los archivos.
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
        receptor_rfc:     rfc.toUpperCase(),
        receptor_razon:   razon_social,
        receptor_regimen: regimen_fiscal,
        receptor_cp:      cp || null,
        receptor_email:   email || null,
        cfdi_use,
        payment_form,
      })
      .select()
      .single()

    if (invError) {
      console.error('[lukon/invoice] insert:', invError)
      // No es fatal — el CFDI ya se timbró ante el SAT.
    }

    const rutas = invoice?.id
      ? rutasDescarga(invoice.id)
      : { pdf_url: null, xml_url: null }

    if (invoice?.id) {
      await supabaseAdmin.from('invoices').update(rutas).eq('id', invoice.id)
    }

    // ── 6. Enviar el CFDI por correo (PDF + XML adjuntos) ──────────────────────
    // Nada de aquí para abajo puede tumbar la respuesta: la factura ya existe
    // ante el SAT aunque el correo falle. El resultado se reporta en `email`.
    let emailResultado: { enviado: boolean; motivo?: string } = {
      enviado: false,
      motivo:  'omitido',
    }

    if (enviar_correo && email) {
      const { pdf, xml } = await descargarCfdi(facturData.id, facturApiKey)

      if (!pdf && !xml) {
        emailResultado = { enviado: false, motivo: 'no_se_pudo_descargar_el_cfdi' }
      } else {
        const folio = facturData.folio_number?.toString() ?? null
        const adjuntos: Adjunto[] = []
        if (pdf) adjuntos.push({ filename: nombreArchivoCfdi(folio, facturData.uuid, 'pdf'), content: pdf })
        if (xml) adjuntos.push({ filename: nombreArchivoCfdi(folio, facturData.uuid, 'xml'), content: xml })

        // Remitente parametrizado en base de datos (clients.email_from), no
        // hardcodeado: cualquier cliente con dominio propio hereda este flujo.
        const { data: cliente } = await supabaseAdmin
          .from('clients')
          .select('email_from, email_reply_to')
          .eq('id', LUKON_CLIENT_ID)
          .single()

        const datos: DatosCfdi = {
          razonSocial: razon_social,
          rfc:         rfc.toUpperCase(),
          concepto,
          total:       Number(amount) * 1.16,
          uuid:        facturData.uuid ?? '',
          fecha:       new Date().toLocaleDateString('es-MX', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City',
          }),
          adjuntos:    adjuntos.map((a) => a.filename),
        }

        const envio = await sendEmail({
          from:        'lukonFacturacion',
          fromAddress: cliente?.email_from,
          to:          email,
          bcc:         REPLY_TO,
          replyTo:     cliente?.email_reply_to ?? REPLY_TO,
          subject:     asuntoCfdi(MARCA_LUKON, datos),
          html:        plantillaCfdi(MARCA_LUKON, datos),
          attachments: adjuntos,
          tag:         'lukon/cfdi',
        })

        emailResultado = envio.ok
          ? { enviado: true }
          : { enviado: false, motivo: 'resend_error' }

        if (envio.ok && invoice?.id) {
          await supabaseAdmin
            .from('invoices')
            .update({ email_sent_at: new Date().toISOString(), email_to: email })
            .eq('id', invoice.id)
        }
      }
    } else if (enviar_correo && !email) {
      emailResultado = { enviado: false, motivo: 'sin_correo_del_receptor' }
    }

    return NextResponse.json({
      invoice_id:   invoice?.id,
      facturapi_id: facturData.id,
      uuid_sat:     facturData.uuid,
      pdf_url:      rutas.pdf_url,
      xml_url:      rutas.xml_url,
      status:       'valid',
      email:        emailResultado,
    })

  } catch (err) {
    console.error('[lukon/invoice] error:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
