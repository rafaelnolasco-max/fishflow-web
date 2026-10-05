// app/api/invoices/route.ts
// Timbrado de CFDI — puerta única, dos modos. Toda la lógica vive en lib/cfdi.ts.
//
//   1. Autoservicio (sin login) — el recibo /receipt/[id] manda `transaction_id`
//      + datos fiscales. Monto, concepto y emisor salen de la transacción, NUNCA
//      del body: nadie puede timbrar otra cantidad ni a nombre de otro emisor.
//
//   2. Manual (con login) — el panel o /admin manda `emisor_client_id`,
//      receptor y conceptos. Exige acceso al emisor (Rafa siempre pasa).
//
// Antes de oct-2026 esta ruta timbraba sin sesión con monto libre y la llave
// global. Cerrado.

import { NextRequest, NextResponse } from 'next/server'
import { requireClientAccess } from '@/lib/apiAuth'
import { emitirCfdi, facturarTransaccion, type Concepto, type Receptor } from '@/lib/cfdi'

export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function receptorDe(body: any): Receptor {
  return {
    rfc: String(body.rfc ?? ''),
    razon_social: String(body.razon_social ?? ''),
    regimen_fiscal: String(body.regimen_fiscal ?? ''),
    cp: String(body.cp ?? ''),
    email: body.email ? String(body.email) : null,
    cfdi_use: body.cfdi_use ? String(body.cfdi_use) : null,
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // ── 1. Autoservicio desde el recibo ───────────────────────────────────────
  if (body.transaction_id) {
    if (!UUID_RE.test(String(body.transaction_id))) {
      return NextResponse.json({ error: 'transaction_id inválido' }, { status: 400 })
    }
    const r = await facturarTransaccion(String(body.transaction_id), 'autoservicio', receptorDe(body))
    return r.ok
      ? NextResponse.json({ success: true, ...r })
      : NextResponse.json(r, { status: r.status })
  }

  // ── 2. Manual desde un panel ──────────────────────────────────────────────
  const emisorClientId = String(body.emisor_client_id ?? '')
  if (!UUID_RE.test(emisorClientId)) {
    return NextResponse.json({ error: 'emisor_client_id requerido' }, { status: 400 })
  }
  const auth = await requireClientAccess(emisorClientId)
  if (!auth.ok) return auth.response

  // Acepta `conceptos: [...]` o el formato corto `concepto` + `amount`.
  const conceptos: Concepto[] = Array.isArray(body.conceptos)
    ? body.conceptos.map((c: any) => ({
        descripcion: String(c.descripcion ?? ''),
        importe: Number(c.importe),
        cantidad: c.cantidad ? Number(c.cantidad) : 1,
        iva_incluido: c.iva_incluido !== false,
        product_key: c.product_key || undefined,
      }))
    : [{ descripcion: String(body.concepto ?? ''), importe: Number(body.amount), iva_incluido: body.iva_incluido !== false }]

  const r = await emitirCfdi({
    emisorClientId,
    receptorClientId: body.receptor_client_id ?? null,
    receptor: receptorDe(body),
    conceptos,
    paymentForm: body.payment_form ?? null,
    origen: 'manual',
    enviarCorreo: body.enviar_correo !== false,
  })
  return r.ok ? NextResponse.json({ success: true, ...r }) : NextResponse.json(r, { status: r.status })
}
