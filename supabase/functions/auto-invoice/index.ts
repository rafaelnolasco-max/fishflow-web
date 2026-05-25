// Supabase Edge Function — auto-invoice
// Triggered by DB trigger notify_auto_invoice() via pg_net when
// pos_transactions.status changes to 'paid'.
//
// Payload: { record: { id, client_id, amount, currency, service, provider, payment_method, metadata } }
//
// MODO ACTUAL (Opción A):
//   Envía un email con el link al recibo usando Resend.
//   Destinatarios: payer_email (del metadata) + rafaelnolasco@gmail.com
//
// FUTURO (Opción B):
//   Agregar emisión de CFDI via Facturapi cuando factura_auto esté activo.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Constantes ───────────────────────────────────────────────────────────────

const RAFA_EMAIL   = 'rafaelnolasco@gmail.com'
const APP_URL      = Deno.env.get('APP_URL') ?? 'https://fishflow.mx'
const RESEND_URL   = 'https://api.resend.com/emails'
const FROM_ADDRESS = 'FishFlow <recibos@fishflow.mx>'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount).replace('MX$', '$')
}

function labelMetodo(provider: string, method: string | null): string {
  if (provider === 'stripe') {
    return method === 'oxxo' ? 'OXXO Pay' : 'Tarjeta'
  }
  if (!method) return 'Transferencia'
  if (method.includes('credit_card'))  return 'Tarjeta de crédito'
  if (method.includes('debit_card'))   return 'Tarjeta de débito'
  if (method === 'account_money')       return 'Cuenta MercadoPago'
  return method
}

// ─── Email HTML ───────────────────────────────────────────────────────────────

function buildEmailHtml(params: {
  clienteNombre: string
  concepto: string
  monto: string
  metodo: string
  receiptUrl: string
  folio: string
}): string {
  const { clienteNombre, concepto, monto, metodo, receiptUrl, folio } = params

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo de pago · FishFlow</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:system-ui,-apple-system,sans-serif;color:#0E2A36;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:white;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

          <!-- Header naranja -->
          <tr>
            <td style="background:#F26B17;padding:28px 32px 24px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:white;letter-spacing:-0.3px;">FishFlow</p>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:0.12em;text-transform:uppercase;">Recibo de Pago Confirmado</p>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding:32px 32px 24px;">
              <p style="margin:0 0 8px;font-size:15px;color:#6B7B82;">Estimado/a ${clienteNombre ? `<strong style="color:#0E2A36;">${clienteNombre}</strong>` : 'cliente'},</p>
              <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#444;">
                Hemos recibido tu pago correctamente. A continuación encontrarás el resumen de tu transacción.
              </p>

              <!-- Tabla de datos -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E1D6;border-radius:4px;overflow:hidden;font-size:13px;">
                <tr style="background:#FAFAF7;">
                  <td style="padding:10px 16px;color:#6B7B82;border-bottom:1px solid #E5E1D6;">Folio</td>
                  <td style="padding:10px 16px;font-weight:600;text-align:right;border-bottom:1px solid #E5E1D6;font-family:monospace;">${folio}</td>
                </tr>
                <tr>
                  <td style="padding:10px 16px;color:#6B7B82;border-bottom:1px solid #E5E1D6;">Concepto</td>
                  <td style="padding:10px 16px;font-weight:500;text-align:right;border-bottom:1px solid #E5E1D6;">${concepto}</td>
                </tr>
                <tr style="background:#FAFAF7;">
                  <td style="padding:10px 16px;color:#6B7B82;border-bottom:1px solid #E5E1D6;">Método</td>
                  <td style="padding:10px 16px;text-align:right;border-bottom:1px solid #E5E1D6;">${metodo}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-size:15px;font-weight:700;">Total Pagado</td>
                  <td style="padding:14px 16px;font-size:20px;font-weight:700;color:#F26B17;text-align:right;">${monto}</td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="margin-top:28px;text-align:center;">
                <a href="${receiptUrl}"
                   style="display:inline-block;background:#F26B17;color:white;text-decoration:none;padding:14px 32px;border-radius:4px;font-weight:600;font-size:14px;letter-spacing:0.02em;">
                  Ver Recibo Completo
                </a>
                <p style="margin:12px 0 0;font-size:11px;color:#6B7B82;">
                  O copia este link: <a href="${receiptUrl}" style="color:#1FA9D6;">${receiptUrl}</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #E5E1D6;background:#FAFAF7;">
              <p style="margin:0;font-size:11px;color:#6B7B82;line-height:1.6;">
                FishFlow · CDMX, México · rafaelnolasco@gmail.com<br>
                Este es un recibo automático generado al confirmar tu pago.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Enviar email via Resend ──────────────────────────────────────────────────

async function sendReceiptEmail(params: {
  to: string[]
  subject: string
  html: string
}): Promise<{ ok: boolean; error?: string }> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.warn('[auto-invoice] RESEND_API_KEY no configurado — saltando email')
    return { ok: false, error: 'RESEND_API_KEY not set' }
  }

  const resp = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from:     FROM_ADDRESS,
      reply_to: RAFA_EMAIL,
      to:       params.to,
      subject:  params.subject,
      html:     params.html,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    console.error('[auto-invoice] Resend error:', text)
    return { ok: false, error: text }
  }

  const result = await resp.json()
  console.log('[auto-invoice] Email enviado via Resend:', result.id)
  return { ok: true }
}

// ─── Serve ────────────────────────────────────────────────────────────────────

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
        metadata?: {
          payer_email?: string | null
          description?: string | null
        }
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

    // ── 1. Obtener nombre del cliente ────────────────────────────────────────
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', record.client_id)
      .single()

    const clienteNombre = client?.name ?? ''

    // ── 2. Construir datos del recibo ────────────────────────────────────────
    const folio      = `FF-${record.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
    const concepto   = record.service ?? record.metadata?.description ?? 'Servicio FishFlow'
    const monto      = formatMXN(Number(record.amount))
    const metodo     = labelMetodo(record.provider, record.payment_method)
    const receiptUrl = `${APP_URL}/receipt/${record.id}`

    // ── 3. Construir lista de destinatarios ──────────────────────────────────
    const payerEmail = record.metadata?.payer_email
    const recipients: string[] = [RAFA_EMAIL]
    if (payerEmail && payerEmail !== RAFA_EMAIL) {
      recipients.push(payerEmail)
    }

    console.log('[auto-invoice] Enviando recibo a:', recipients.join(', '))

    // ── 4. Armar y enviar email ──────────────────────────────────────────────
    const emailHtml = buildEmailHtml({ clienteNombre, concepto, monto, metodo, receiptUrl, folio })

    const nombreCliente = clienteNombre ? ` — ${clienteNombre}` : ''
    const { ok, error: emailError } = await sendReceiptEmail({
      to:      recipients,
      subject: `Recibo de pago ${folio}${nombreCliente} · ${monto}`,
      html:    emailHtml,
    })

    if (!ok) {
      // No es error fatal — el pago ya se registró en DB
      return new Response(
        JSON.stringify({ partial: true, warning: 'Email no enviado', detail: emailError, folio, receiptUrl }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, folio, receiptUrl, recipients }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[auto-invoice] Error inesperado:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
