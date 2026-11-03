// Demo DIMEX: correo de confirmación al comprador y aviso a #demoenslack.
// Lo usan checkout (pedido recibido) y webhook de Mercado Pago (pago aprobado).
import { sendEmail, type Adjunto } from '@/lib/email'
import { notifySlack, slackEscape } from '@/lib/slack'
import { emailUI, escHtml } from '@/lib/emailLayout'

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
const money = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const COPY: Record<DemoStage, { subject: (r: string) => string; title: string; intro: string; badge: string; color: string }> = {
  recibido: {
    subject: (r) => `Recibimos tu pedido ${r} · DIMEX`,
    title: '¡Gracias por tu pedido!',
    intro: 'recibimos tu pedido. En cuanto se confirme tu pago te enviamos la confirmación y lo preparamos para envío.',
    badge: 'Pendiente de pago',
    color: '#a66800',
  },
  pendiente: {
    subject: (r) => `Tu pago está en proceso · Pedido ${r}`,
    title: 'Tu pago está en proceso',
    intro: 'tu pago se está procesando (por ejemplo, un pago en OXXO o SPEI). Te avisamos en cuanto se acredite.',
    badge: 'Pago en proceso',
    color: '#a66800',
  },
  aprobado: {
    subject: (r) => `✅ Pago confirmado · Pedido ${r} · DIMEX`,
    title: '¡Tu pago fue aprobado!',
    intro: 'ya estamos preparando tu pedido. Te escribiremos con la guía de envío en cuanto salga de nuestro almacén (1 a 2 días hábiles).',
    badge: 'Pago aprobado',
    color: '#1a7f45',
  },
}

// Correo al comprador = audiencia 'externo': lleva la marca DIMEX y NO menciona
// a FishFlow (CLAUDE.md § 4.2). La plantilla vive en lib/emailLayout.ts.
function emailHtml(o: DemoOrder, stage: DemoStage) {
  const c = COPY[stage]
  const ui = emailUI('dimex')
  const saludo = `Hola ${escHtml(o.nombre || '')}${o.empresa ? ` (${escHtml(o.empresa)})` : ''}, ${c.intro}`
  const productos = ui.tabla(o.items.map((i) => [`${i.quantity} × ${i.title}`, money(i.quantity * i.unit_price)]))
  const envio = o.direccion
    ? ui.p(`<strong>Envío a:</strong> ${escHtml(o.direccion)}${o.mapa ? ` · ${ui.link('ver en mapa', o.mapa)}` : ''}`)
    : ''
  const fact = o.factura
    ? ui.bloque(
        ui.rotulo('Factura CFDI 4.0') +
          ui.p(
            `${escHtml(o.factura.razon || '')} · RFC ${escHtml(o.factura.rfc)}<br>` +
              (stage === 'aprobado'
                ? 'Adjuntamos el XML de tu factura. <em>(Demo: sin validez fiscal.)</em>'
                : 'Se genera y te llega en automático al confirmarse el pago.')
          )
      )
    : ui.p(`¿Necesitas factura? Puedes generarla desde ${ui.link('la tienda', STORE)} con tu número de pedido.`)
  return ui.layout({
    audiencia: 'externo',
    preheader: `${c.title} Pedido ${o.ref} · ${money(o.total)}`,
    etiqueta: `${c.badge}${o.canal === 'mayoreo' ? ' · Mayoreo' : ''}`,
    titulo: c.title,
    subtitulo: `Pedido ${o.ref}`,
    cuerpo:
      ui.bloque(ui.p('<strong>Tienda de demostración:</strong> los pagos están en modo de prueba, no se cobró dinero real.'), 'aviso') +
      ui.p(saludo) +
      ui.rotulo('Tu pedido') +
      productos +
      ui.dato('Total', money(o.total)) +
      envio +
      fact +
      ui.botones([{ texto: 'Volver a la tienda', href: STORE }]),
  })
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
