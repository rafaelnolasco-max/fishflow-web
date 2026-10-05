// app/api/invoices/lukon/route.ts
// Timbrado desde el panel de Lukon. Lukon factura con SU RFC y SU CSD (su fila
// en invoice_orgs), ya no con la llave global de FishFlow. Toda la lógica vive
// en lib/cfdi.ts; esta ruta solo conserva el contrato que usa el panel.

import { NextRequest, NextResponse } from 'next/server'
import { requireClientAccess } from '@/lib/apiAuth'
import { emitirCfdi } from '@/lib/cfdi'

const LUKON_CLIENT_ID = '1aa4a82b-e524-40f4-808e-c02e87e82427'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireClientAccess(LUKON_CLIENT_ID)
  if (!auth.ok) return auth.response

  const {
    rfc,
    razon_social,
    email,
    cp,
    regimen_fiscal = '616',
    concepto,
    amount,
    transaction_id,
    payment_form = '03',
    cfdi_use = 'G03',
    enviar_correo = true,
  } = await req.json()

  const r = await emitirCfdi({
    emisorClientId: LUKON_CLIENT_ID,
    receptor: { rfc, razon_social, regimen_fiscal, cp, email, cfdi_use },
    // El panel captura "Monto sin IVA". La ruta anterior lo mandaba como si
    // trajera IVA (default de Facturapi) y timbraba $1,000 en vez de $1,160.
    conceptos: [{ descripcion: concepto, importe: Number(amount), iva_incluido: false }],
    paymentForm: payment_form,
    transactionId: transaction_id ?? null,
    origen: 'manual',
    enviarCorreo: enviar_correo,
  })

  if (!r.ok) {
    // El panel muestra un aviso específico con este código.
    const sinConfigurar = r.code === 'ORG_NOT_FOUND' || r.code === 'ORG_INACTIVE' || r.code === 'ORG_KEY_MISSING'
    return NextResponse.json(
      { ...r, code: sinConfigurar ? 'FACTURAPI_NOT_CONFIGURED' : r.code },
      { status: r.status }
    )
  }

  return NextResponse.json({ ...r, status: 'valid' })
}
