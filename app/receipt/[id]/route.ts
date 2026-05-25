// app/receipt/[id]/route.ts
// Recibo público de pago — sin autenticación requerida.
// Devuelve HTML autónomo con estilos y logo incrustados (imprimible desde el browser).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMXN(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount)
}

const MESES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre',
]

function formatFecha(iso: string): string {
  const TZ = 'America/Mexico_City'
  const d = new Date(iso)
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ,
    day:    'numeric',
    month:  'numeric',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => partes.find(p => p.type === type)?.value ?? ''
  const dia = get('day')
  const mes = MESES[parseInt(get('month'), 10) - 1]
  const año = get('year')
  const hora = `${get('hour')}:${get('minute')}`
  return `${dia} de ${mes} de ${año} · ${hora}`
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

function truncRef(ref: string | null | undefined): string {
  if (!ref) return '—'
  if (ref.length <= 12) return ref.toUpperCase()
  // pi_3QxX... → PI·XXXX...XXXX
  const clean = ref.replace(/^(pi_|cs_|[0-9]+)/i, '')
  return `···${ref.slice(-8).toUpperCase()}`
}

// ─── SVG del logo (incrustado) ────────────────────────────────────────────────

const LOGO_SVG = `<svg viewBox="0 0 1391 293.2" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FishFlow" style="height:26px;width:auto;display:block;">
  <defs>
    <linearGradient id="ff-tide" x1="14%" y1="50%" x2="86%" y2="50%">
      <stop offset="0%" stop-color="#1FA9D6"/>
      <stop offset="40%" stop-color="#3DB3CE"/>
      <stop offset="50%" stop-color="#C7AE82" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="#F0A14A"/>
      <stop offset="100%" stop-color="#F26B17"/>
    </linearGradient>
  </defs>
  <g transform="translate(16 16) scale(0.4354)">
    <path d="M 600 300 C 760 100,1000 90,1000 300 C 1000 510,760 500,600 300 C 440 100,200 90,200 300 C 200 510,440 500,600 300 Z" fill="none" stroke="url(#ff-tide)" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="880" cy="278" r="9" fill="#0C3445" opacity="0.55"/>
  </g>
  <path d="M13.6 0V-141.2H45V0ZM37.6-55.4V-82.4H108.2V-55.4ZM37.6-114.2V-141.2H111.4V-114.2Z" fill="#1FA9D6" transform="translate(570.44 217.21)"/>
  <path d="M126.8 0V-97.2H157.4V0ZM142.2-110.6Q135-110.6 130.3-115.5Q125.6-120.4 125.6-127.4Q125.6-134.6 130.3-139.4Q135-144.2 142.2-144.2Q149.4-144.2 154-139.4Q158.6-134.6 158.6-127.4Q158.6-120.4 154-115.5Q149.4-110.6 142.2-110.6Z" fill="#1FA9D6" transform="translate(570.44 217.21)"/>
  <path d="M212.4 2.4Q203.8 2.4 195.5.2Q187.2-2 180.1-6.1Q173-10.2 168-15.6L185.4-33.2Q190.2-28 196.8-25.1Q203.4-22.2 211.2-22.2Q216.6-22.2 219.5-23.8Q222.4-25.4 222.4-28.2Q222.4-31.8 218.9-33.7Q215.4-35.6 210-37.1Q204.6-38.6 198.6-40.4Q192.6-42.2 187.2-45.4Q181.8-48.6 178.4-54.3Q175-60 175-68.8Q175-78.2 179.8-85.1Q184.6-92 193.4-96Q202.2-100 214-100Q226.4-100 236.9-95.7Q247.4-91.4 254-83L236.6-65.4Q232-70.8 226.3-73Q220.6-75.2 215.2-75.2Q210-75.2 207.4-73.7Q204.8-72.2 204.8-69.4Q204.8-66.4 208.2-64.6Q211.6-62.8 217-61.4Q222.4-60 228.4-58Q234.4-56 239.8-52.6Q245.2-49.2 248.6-43.5Q252-37.8 252-28.6Q252-14.4 241.3-6Q230.6 2.4 212.4 2.4Z" fill="#1FA9D6" transform="translate(570.44 217.21)"/>
  <path d="M330.8 0V-55.4Q330.8-63 326.1-67.7Q321.4-72.4 314.2-72.4Q309.2-72.4 305.4-70.3Q301.6-68.2 299.4-64.3Q297.2-60.4 297.2-55.4L285.4-61.2Q285.4-72.6 290.2-81.2Q295-89.8 303.6-94.5Q312.2-99.2 323.4-99.2Q334.8-99.2 343.4-94.5Q352-89.8 356.7-81.5Q361.4-73.2 361.4-62.2V0ZM266.6 0V-145.2H297.2V0Z" fill="#1FA9D6" transform="translate(570.44 217.21)"/>
  <path d="M381.8 0V-141.2H413.2V0ZM405.8-55.4V-82.4H476.4V-55.4ZM405.8-114.2V-141.2H479.6V-114.2Z" fill="#F26B17" transform="translate(570.44 217.21)"/>
  <path d="M495 0V-145.2H525.6V0Z" fill="#F26B17" transform="translate(570.44 217.21)"/>
  <path d="M592 2.2Q577 2.2 564.9-4.5Q552.8-11.2 545.8-22.8Q538.8-34.4 538.8-48.8Q538.8-63.2 545.8-74.6Q552.8-86 564.8-92.7Q576.8-99.4 592-99.4Q607.2-99.4 619.2-92.8Q631.2-86.2 638.2-74.7Q645.2-63.2 645.2-48.8Q645.2-34.4 638.2-22.8Q631.2-11.2 619.2-4.5Q607.2 2.2 592 2.2ZM592-25.6Q598.6-25.6 603.6-28.5Q608.6-31.4 611.3-36.7Q614-42 614-48.8Q614-55.6 611.2-60.7Q608.4-65.8 603.5-68.7Q598.6-71.6 592-71.6Q585.6-71.6 580.6-68.7Q575.6-65.8 572.8-60.6Q570-55.4 570-48.6Q570-42 572.8-36.7Q575.6-31.4 580.6-28.5Q585.6-25.6 592-25.6Z" fill="#F26B17" transform="translate(570.44 217.21)"/>
  <path d="M682.2 0 648.6-97.2H678.6L699.4-26.6 690.6-26.4 713.6-97.2H738.4L761.6-26.4 752.6-26.6 773.6-97.2H803.6L770 0H745L722.4-67.2H730L707 0Z" fill="#F26B17" transform="translate(570.44 217.21)"/>
</svg>`

// ─── HTML del recibo ──────────────────────────────────────────────────────────

function buildHtml(data: {
  folio: string
  fecha: string
  clienteNombre: string
  concepto: string
  monto: string
  amount: number
  metodo: string
  referencia: string
  payerEmail: string | null
  txnId: string
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fishflow.mx'

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recibo FishFlow · ${data.folio}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');

    :root {
      --tide-cyan:   #1FA9D6;
      --tide-orange: #F26B17;
      --ink:         #0E2A36;
      --ink-soft:    #0C3445;
      --rule-strong: #C9C4B5;
      --muted:       #6B7B82;
      --font-display:'Outfit', system-ui, sans-serif;
      --font-body:   'Inter', system-ui, sans-serif;
      --font-mono:   'JetBrains Mono', ui-monospace, monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #1a1a1a;
      min-height: 100vh;
      padding: 48px 16px 80px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      font-family: var(--font-body);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }

    .receipt {
      width: 380px;
      background: white;
      padding: 36px 32px 32px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.45);
      font-family: var(--font-mono);
      position: relative;
    }

    /* zig-zag bottom edge */
    .receipt::after {
      content: "";
      position: absolute;
      left: 0; right: 0; bottom: -16px;
      height: 16px;
      background-color: white;
      -webkit-mask:
        linear-gradient(135deg, transparent 50%, #000 50%) 0 0 / 16px 16px,
        linear-gradient(  45deg, transparent 50%, #000 50%) 0 0 / 16px 16px;
      mask:
        linear-gradient(135deg, transparent 50%, #000 50%) 0 0 / 16px 16px,
        linear-gradient(  45deg, transparent 50%, #000 50%) 0 0 / 16px 16px;
    }

    /* ── Secciones ─────────────────────────────────── */
    .r-logo {
      display: flex;
      justify-content: center;
      margin-bottom: 14px;
    }

    .r-tag {
      text-align: center;
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--tide-orange);
      margin-bottom: 22px;
    }

    .r-thanks {
      text-align: center;
      font-family: var(--font-display);
      font-size: 26px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 8px 0 4px;
      color: var(--ink);
    }

    .r-sub {
      text-align: center;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 22px;
      font-family: var(--font-mono);
    }

    .r-divider {
      border: none;
      border-top: 1px dashed var(--rule-strong);
      margin: 0;
    }

    .r-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      padding: 14px 0;
      font-size: 11px;
    }
    .r-meta .k { color: var(--muted); }
    .r-meta .v { text-align: right; font-weight: 500; }

    .r-concepto {
      padding: 14px 0;
      font-size: 11px;
    }
    .r-concepto .label { color: var(--muted); margin-bottom: 4px; }
    .r-concepto .value { font-weight: 500; color: var(--ink); line-height: 1.4; }

    .r-total-wrap {
      padding: 16px 0 12px;
    }
    .r-total-label {
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .r-total-amount {
      font-family: var(--font-display);
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--tide-orange);
    }
    .r-total-currency {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--muted);
      margin-left: 4px;
    }

    .r-pay {
      padding: 12px 0;
      font-size: 11px;
      color: var(--ink-soft);
      text-align: center;
    }
    .r-pay .metodo { font-weight: 500; }
    .r-pay .ref {
      color: var(--muted);
      margin-top: 4px;
      font-size: 10px;
      letter-spacing: 0.12em;
    }

    .r-stamp {
      text-align: center;
      margin: 16px 0 4px;
      font-size: 10px;
      letter-spacing: 0.22em;
      color: var(--tide-cyan);
    }

    .r-foot {
      margin-top: 16px;
      text-align: center;
      font-size: 9px;
      line-height: 1.6;
      color: var(--muted);
    }
    .r-foot .url {
      display: block;
      margin-top: 6px;
      color: var(--tide-orange);
      font-weight: 500;
    }

    /* ── Factura ── */
    .r-factura-btn {
      display: block;
      width: 100%;
      margin: 20px 0 0;
      padding: 11px 0;
      background: transparent;
      border: 1.5px solid var(--tide-cyan);
      border-radius: 4px;
      color: var(--tide-cyan);
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.06em;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .r-factura-btn:hover { background: var(--tide-cyan); color: white; }

    .r-factura-form {
      display: none;
      margin-top: 16px;
      padding: 16px;
      background: #f9f8f5;
      border-radius: 4px;
      border: 1px solid var(--rule-strong);
    }
    .r-factura-form.open { display: block; }
    .r-factura-form h4 {
      margin: 0 0 12px;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .r-factura-form label {
      display: block;
      font-size: 10px;
      color: var(--muted);
      margin: 10px 0 3px;
    }
    .r-factura-form input,
    .r-factura-form select {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--rule-strong);
      border-radius: 3px;
      font-family: var(--font-body);
      font-size: 12px;
      color: var(--ink);
      background: white;
    }
    .r-factura-submit {
      display: block;
      width: 100%;
      margin-top: 14px;
      padding: 10px 0;
      background: var(--tide-orange);
      color: white;
      border: none;
      border-radius: 4px;
      font-family: var(--font-body);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .r-factura-submit:disabled { opacity: 0.6; cursor: default; }
    .r-factura-msg {
      margin-top: 10px;
      font-size: 11px;
      text-align: center;
      min-height: 16px;
    }
    .r-factura-msg.ok  { color: #2a9d3e; }
    .r-factura-msg.err { color: #c0392b; }

    @media print {
      body { background: white; padding: 0; }
      .receipt { box-shadow: none; }
      .receipt::after { display: none; }
      .r-factura-btn, .r-factura-form { display: none !important; }
    }
  </style>
</head>
<body>

<div class="receipt">

  <div class="r-logo">${LOGO_SVG}</div>
  <div class="r-tag">— Pago Confirmado —</div>

  <div class="r-thanks">Gracias${data.clienteNombre ? ', ' + data.clienteNombre.split(' ')[0] + '.' : '.'}</div>
  <div class="r-sub">${data.concepto}</div>

  <hr class="r-divider">
  <div class="r-meta">
    <div class="k">Recibo №</div>   <div class="v">${data.folio}</div>
    <div class="k">Fecha</div>      <div class="v">${data.fecha}</div>
    <div class="k">Método</div>     <div class="v">${data.metodo}</div>
    ${data.payerEmail ? `<div class="k">Email</div><div class="v" style="font-size:9.5px;word-break:break-all;">${data.payerEmail}</div>` : ''}
  </div>
  <hr class="r-divider">

  <div class="r-total-wrap">
    <div class="r-total-label">Total Pagado</div>
    <div class="r-total-amount">
      ${data.monto}<span class="r-total-currency">MXN</span>
    </div>
  </div>

  <hr class="r-divider">

  <div class="r-pay">
    <div class="metodo">${data.metodo}</div>
    <div class="ref">Ref. autorización · ${data.referencia}</div>
  </div>

  <div class="r-stamp">— · — · — pagado · — · — · —</div>

  <!-- Sección de factura -->
  <button class="r-factura-btn" onclick="document.getElementById('facturaForm').classList.toggle('open')">
    ¿Necesitas factura? Solicítala aquí
  </button>

  <div class="r-factura-form" id="facturaForm">
    <h4>Datos de facturación</h4>

    <label>RFC *</label>
    <input id="f-rfc" type="text" placeholder="XAXX010101000" maxlength="13" style="text-transform:uppercase">

    <label>Razón social *</label>
    <input id="f-razon" type="text" placeholder="Como aparece en el SAT">

    <label>Régimen fiscal *</label>
    <select id="f-regimen">
      <option value="616">616 — Sin actividad empresarial (persona física)</option>
      <option value="601">601 — General de Ley (persona moral)</option>
      <option value="612">612 — Personas Físicas con Actividad Empresarial</option>
      <option value="621">621 — Incorporación Fiscal</option>
      <option value="626">626 — Simplificado de Confianza</option>
    </select>

    <label>Código postal *</label>
    <input id="f-cp" type="text" placeholder="06600" maxlength="5">

    <label>Email (para recibir el CFDI)</label>
    <input id="f-email" type="email" placeholder="correo@empresa.com">

    <label>Uso del CFDI</label>
    <select id="f-uso">
      <option value="G03">G03 — Gastos en general</option>
      <option value="G01">G01 — Adquisición de mercancias</option>
      <option value="G02">G02 — Devoluciones, descuentos o bonificaciones</option>
      <option value="I01">I01 — Construcciones</option>
      <option value="S01">S01 — Sin efectos fiscales</option>
    </select>

    <button class="r-factura-submit" id="f-submit" onclick="solicitarFactura()">
      Generar factura
    </button>
    <div class="r-factura-msg" id="f-msg"></div>
  </div>

  <div class="r-foot">
    FishFlow · CDMX, México<br>
    rafaelnolasco@gmail.com
    <span class="url">${appUrl}/receipt/${data.txnId}</span>
  </div>

</div>

<script>
async function solicitarFactura() {
  const rfc    = document.getElementById('f-rfc').value.trim().toUpperCase()
  const razon  = document.getElementById('f-razon').value.trim()
  const regimen= document.getElementById('f-regimen').value
  const cp     = document.getElementById('f-cp').value.trim()
  const email  = document.getElementById('f-email').value.trim()
  const uso    = document.getElementById('f-uso').value
  const msg    = document.getElementById('f-msg')
  const btn    = document.getElementById('f-submit')

  if (!rfc || !razon || !cp) {
    msg.className = 'r-factura-msg err'
    msg.textContent = 'RFC, razón social y código postal son requeridos.'
    return
  }

  btn.disabled = true
  btn.textContent = 'Generando...'
  msg.className = 'r-factura-msg'
  msg.textContent = ''

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layer:          'fishflow',
        transaction_id: '${data.txnId}',
        rfc,
        razon_social:   razon,
        regimen_fiscal: regimen,
        cp,
        email:          email || undefined,
        cfdi_use:       uso,
        concepto:       '${data.concepto.replace(/'/g, "\\'")}',
        amount:         ${data.amount},
      }),
    })

    const json = await res.json()

    if (!res.ok) {
      throw new Error(json.error ?? 'Error al generar la factura')
    }

    msg.className = 'r-factura-msg ok'
    msg.innerHTML = '✓ Factura generada. ' +
      (json.pdf_url ? '<a href="' + json.pdf_url + '" target="_blank">Descargar PDF</a> · ' : '') +
      (json.xml_url ? '<a href="' + json.xml_url + '" target="_blank">Descargar XML</a>' : '')
    btn.textContent = 'Factura generada ✓'

  } catch (err) {
    msg.className = 'r-factura-msg err'
    msg.textContent = err.message ?? 'Error inesperado. Intenta de nuevo.'
    btn.disabled = false
    btn.textContent = 'Generar factura'
  }
}
</script>
</body>
</html>`
}

// ─── Handler GET ──────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // ── 1. Fetch transacción ────────────────────────────────────────────────────
  const { data: txn, error: txnErr } = await supabaseAdmin
    .from('pos_transactions')
    .select('id, client_id, amount, currency, service, provider, payment_method, status, metadata, external_id, created_at')
    .eq('id', id)
    .single()

  if (txnErr || !txn) {
    return new NextResponse(notFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // ── 2. Fetch nombre del cliente ─────────────────────────────────────────────
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', txn.client_id)
    .single()

  // ── 3. Ensamblar datos del recibo ───────────────────────────────────────────
  const folio       = `FF-${txn.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
  const fecha       = formatFecha(txn.created_at)
  const concepto    = txn.service ?? txn.metadata?.description ?? 'Servicio FishFlow'
  const monto       = formatMXN(Number(txn.amount)).replace('MX$', '$')
  const metodo      = labelMetodo(txn.provider, txn.payment_method)
  const referencia  = truncRef(txn.external_id ?? txn.metadata?.session_id)
  const payerEmail  = txn.metadata?.payer_email ?? null
  const clienteNombre = client?.name ?? ''

  // ── 4. Renderizar ───────────────────────────────────────────────────────────
  const html = buildHtml({
    folio,
    fecha,
    clienteNombre,
    concepto,
    monto,
    amount: Number(txn.amount),
    metodo,
    referencia,
    payerEmail,
    txnId: txn.id,
  })

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}

// ─── 404 ─────────────────────────────────────────────────────────────────────

function notFoundHtml(): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Recibo no encontrado</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;color:#fff;margin:0}
.box{text-align:center;padding:40px}.logo{font-size:22px;font-weight:700;color:#F26B17;margin-bottom:16px}
p{color:#888;font-size:14px}</style></head>
<body><div class="box"><div class="logo">FishFlow</div><h2>Recibo no encontrado</h2>
<p>El folio solicitado no existe o fue eliminado.</p></div></body></html>`
}
