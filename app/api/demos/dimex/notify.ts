// Demo DIMEX: correo de confirmación al comprador y aviso a #demoenslack.
// Lo usan checkout (pedido recibido) y webhook de Mercado Pago (pago aprobado).
import { sendEmail, type Adjunto } from '@/lib/email'
import { notifySlack, slackEscape } from '@/lib/slack'
import { escHtml } from '@/lib/emailLayout'

export type DemoItem = { title: string; quantity: number; unit_price: number }
export type DemoFiscal = { rfc: string; razon?: string; cp?: string; regimen?: string; uso?: string }
export type DemoOrder = {
  ref: string
  canal: 'menudeo' | 'mayoreo'
  nombre?: string
  empresa?: string
  email?: string
  telefono?: string
  direccion?: string
  items: DemoItem[]
  total: number
  factura?: DemoFiscal | null
  pagoId?: string
  mapa?: string
}
export type DemoStage = 'recibido' | 'aprobado' | 'pendiente'

const STORE = 'https://www.fishflow.mx/demos/dimex/index.html'
const LOGO = 'https://www.fishflow.mx/demos/dimex/img/logo-dimex.png'
const BLUE = '#1d4f9c'
const money = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const COPY: Record<DemoStage, { subject: (r: string) => string; title: string; intro: string; badge: string; color: string }> = {
  recibido: {
    subject: (r) => `Recibimos tu pedido ${r} · DIMEX`,
    title: '¡Gracias por tu pedido!',
    intro: 'Recibimos tu pedido. En cuanto Mercado Pago confirme tu pago te enviamos la confirmación y lo preparamos para envío.',
    badge: 'Pendiente de pago',
    color: '#a66800',
  },
  pendiente: {
    subject: (r) => `Tu pago está en proceso · Pedido ${r}`,
    title: 'Tu pago está en proceso',
    intro: 'Mercado Pago está procesando tu pago (por ejemplo, un pago en OXXO o SPEI). Te avisamos en cuanto se acredite.',
    badge: 'Pago en proceso',
    color: '#a66800',
  },
  aprobado: {
    subject: (r) => `✅ Pago confirmado · Pedido ${r} · DIMEX`,
    title: '¡Tu pago fue aprobado!',
    intro: 'Ya estamos preparando tu pedido. Te escribiremos con la guía de envío en cuanto salga de nuestro almacén (1 a 2 días hábiles).',
    badge: 'Pago aprobado',
    color: '#1a7f45',
  },
}

function emailHtml(o: DemoOrder, stage: DemoStage) {
  const c = COPY[stage]
  const rows = o.items
    .map(
      (i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #ece7dc;font-size:14px">${escHtml(i.title)}<br><span style="color:#566074;font-size:12px">${i.quantity} × ${money(i.unit_price)}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #ece7dc;font-size:14px;text-align:right;white-space:nowrap">${money(i.quantity * i.unit_price)}</td></tr>`
    )
    .join('')
  const fact = o.factura
    ? `<div style="background:#eef3fb;border-radius:12px;padding:14px;margin-top:16px;font-size:14px">
        <b>🧾 Factura CFDI 4.0</b><br>${escHtml(o.factura.razon || '')} · RFC ${escHtml(o.factura.rfc)}<br>
        ${stage === 'aprobado' ? 'Adjuntamos el XML de tu factura. <i>(Demo: sin validez fiscal.)</i>' : 'Se genera y te llega en automático al confirmarse el pago.'}
      </div>`
    : `<p style="font-size:13px;color:#566074;margin-top:16px">¿Necesitas factura? Puedes generarla desde <a href="${STORE}" style="color:${BLUE}">la tienda</a> con tu número de pedido.</p>`
  return `<!doctype html><html><body style="margin:0;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;color:#1b2333">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ed;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
    <tr><td style="background:#1b2333;color:#fff;font-size:12px;text-align:center;padding:6px">Correo de una tienda DEMO · no se cobró dinero real</td></tr>
    <tr><td style="padding:22px 24px 8px"><img src="${LOGO}" alt="DIMEX Didácticos México" height="44" style="display:block"></td></tr>
    <tr><td style="padding:8px 24px 24px">
      <span style="display:inline-block;background:${c.color}1a;color:${c.color};font-weight:bold;font-size:12px;border-radius:8px;padding:4px 8px">${c.badge}${o.canal === 'mayoreo' ? ' · Mayoreo' : ''}</span>
      <h1 style="font-size:24px;margin:12px 0 6px">${c.title}</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Hola ${escHtml(o.nombre || '')}${o.empresa ? ` (${escHtml(o.empresa)})` : ''}, ${c.intro}</p>
      <p style="font-size:14px;color:#566074;margin:0 0 14px">Pedido <b style="color:#1b2333">${escHtml(o.ref)}</b></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
        <tr><td style="padding:10px 0;font-size:16px"><b>Total</b></td><td style="padding:10px 0;font-size:16px;text-align:right"><b>${money(o.total)}</b></td></tr></table>
      ${o.direccion ? `<p style="font-size:13px;color:#566074;margin:6px 0 0">📦 Envío a: ${escHtml(o.direccion)}${o.mapa ? ` · <a href="${escHtml(o.mapa)}" style="color:${BLUE}">ver en mapa</a>` : ''}</p>` : ''}
      ${fact}
      <p style="margin:22px 0 0"><a href="${STORE}" style="background:${BLUE};color:#fff;text-decoration:none;font-weight:bold;border-radius:12px;padding:12px 18px;display:inline-block">Volver a la tienda</a></p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#fffdf8;border-top:1px solid #ece7dc;font-size:12px;color:#8a877f">DIMEX Didácticos México · Fabricantes mexicanos<br>
      <a href="https://fishflow.mx/?utm_source=demo-dimex&utm_medium=credito-email&utm_campaign=sitios-clientes" style="color:#8a877f">Hecho con FishFlow</a></td></tr>
  </table></td></tr></table></body></html>`
}

function facturaXml(o: DemoOrder, uuid: string) {
  const f = o.factura!
  const x = (s: unknown) => escHtml(String(s ?? ''))
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DEMO · SIN VALIDEZ FISCAL -->
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="${x(o.ref.replace('DMX-', ''))}" Fecha="${new Date().toISOString().slice(0, 19)}" FormaPago="04" MetodoPago="PUE" Moneda="MXN" TipoDeComprobante="I" Exportacion="01" LugarExpedicion="06600" Total="${o.total.toFixed(2)}">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="DIMEX DIDACTICOS MEXICO" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${x(f.rfc)}" Nombre="${x(f.razon)}" DomicilioFiscalReceptor="${x(f.cp)}" RegimenFiscalReceptor="${x(f.regimen)}" UsoCFDI="${x(f.uso)}"/>
  <cfdi:Conceptos>
${o.items.map((i) => `    <cfdi:Concepto Cantidad="${i.quantity}" ClaveUnidad="H87" Descripcion="${x(i.title)}" ValorUnitario="${(i.unit_price / 1.16).toFixed(2)}" Importe="${((i.unit_price * i.quantity) / 1.16).toFixed(2)}" ObjetoImp="02"/>`).join('\n')}
  </cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}" SelloCFD="DEMO"/></cfdi:Complemento>
</cfdi:Comprobante>`
}

export async function notifyDemoOrder(o: DemoOrder, stage: DemoStage) {
  const tasks: Promise<unknown>[] = []

  if (o.email && EMAIL_RE.test(o.email)) {
    const attachments: Adjunto[] = []
    if (stage === 'aprobado' && o.factura?.rfc) {
      const uuid = crypto.randomUUID().toUpperCase()
      attachments.push({ filename: `factura-${o.ref}.xml`, content: Buffer.from(facturaXml(o, uuid), 'utf8') })
    }
    tasks.push(
      sendEmail({
        from: 'dimex',
        to: o.email,
        subject: COPY[stage].subject(o.ref),
        html: emailHtml(o, stage),
        replyTo: 'raf@fishflow.mx',
        attachments,
        tag: `demos/dimex/${stage}`,
      })
    )
  }

  const icon = stage === 'aprobado' ? '✅' : stage === 'pendiente' ? '⏳' : '🛒'
  const head =
    stage === 'aprobado' ? 'Pago aprobado' : stage === 'pendiente' ? 'Pago en proceso' : 'Pedido nuevo (pendiente de pago)'
  const lines = o.items.map((i) => `• ${i.quantity} × ${slackEscape(i.title)} — ${money(i.unit_price * i.quantity)}`).join('\n')
  tasks.push(
    notifySlack('demos', {
      text: `${icon} DIMEX demo · ${head} · ${o.ref} · ${money(o.total)}`,
      body: [
        `*Canal:* ${o.canal === 'mayoreo' ? '🏫 Mayoreo' : '🛍️ Menudeo'}`,
        `*Cliente:* ${slackEscape(o.nombre || '—')}${o.empresa ? ` · ${slackEscape(o.empresa)}` : ''}${o.email ? ` · ${slackEscape(o.email)}` : ''}`,
        o.direccion ? `*Envío:* ${slackEscape(o.direccion)}${o.mapa ? ` · <${o.mapa}|📍 ver en mapa>` : ''}` : '',
        `*Factura:* ${o.factura?.rfc ? `Sí · ${slackEscape(o.factura.rfc)}${stage === 'aprobado' ? ' (XML enviado)' : ''}` : 'No'}`,
        lines,
        o.pagoId ? `_Pago Mercado Pago ${slackEscape(o.pagoId)}_` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      button: { label: 'Ver panel de la demo', url: 'https://www.fishflow.mx/demos/dimex/admin.html' },
    })
  )

  await Promise.allSettled(tasks)
}
