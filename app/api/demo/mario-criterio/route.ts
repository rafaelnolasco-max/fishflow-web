import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const runtime = 'nodejs'

// Notificación de demo: al completar la Evaluación de Arquitectura Mental y del
// Criterio se envían DOS correos:
//   1) Interno → Mario + Rafa (admin): aviso con los datos del prospecto.
//   2) Al prospecto → su resultado (perfil + ruta recomendada).
// NO guarda en Supabase (es demo).
const ADMIN_TO = ['mariocitalan@gmail.com', 'raf@fishflow.mx']

function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function adminHtml(d: {
  nombre: string; email: string; tel: string; perfil: string; ruta: string
}) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F1A24">
    <div style="background:#0F1A24;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67D4E8">Arquitectura Mental y del Criterio</div>
      <div style="font-family:Georgia,serif;font-size:22px;margin-top:6px">Alguien completó tu evaluación</div>
    </div>
    <div style="padding:24px 26px;border:1px solid #DCE4EC;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr><td style="padding:8px 0;color:#7B8794;width:120px">Nombre</td><td style="padding:8px 0"><strong>${esc(d.nombre)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#7B8794">Correo</td><td style="padding:8px 0">${esc(d.email)}</td></tr>
        <tr><td style="padding:8px 0;color:#7B8794">Teléfono</td><td style="padding:8px 0">${esc(d.tel) || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#7B8794">Perfil</td><td style="padding:8px 0"><strong style="color:#2A6AAE">${esc(d.perfil)}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#7B8794">Ruta sugerida</td><td style="padding:8px 0">${esc(d.ruta)}</td></tr>
      </table>
      <p style="font-size:12px;color:#7B8794;margin-top:20px">Aviso automático del demo · FishFlow</p>
    </div>
  </div>`
}

function leadHtml(d: {
  nombre: string; perfil: string; desc: string; ruta: string; ctaUrl: string; ctaLabel: string
  pdfUrl: string; pdfNombre: string
}) {
  const primer = d.nombre.split(' ')[0] || d.nombre
  const pdfBlock = d.pdfUrl ? `
      <div style="background:#0F1A24;border-radius:4px;padding:20px 22px;margin:0 0 24px;text-align:center">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#67D4E8;margin-bottom:10px">Tu material de regalo</div>
        <a href="${esc(d.pdfUrl)}" style="display:inline-block;background:#fff;color:#0F1A24;text-decoration:none;padding:13px 24px;font-size:13px;letter-spacing:.06em;text-transform:uppercase">Descargar PDF · ${esc(d.pdfNombre)}</a>
      </div>` : ''
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F1A24">
    <div style="background:#0F1A24;color:#fff;padding:26px">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#67D4E8">Tu resultado</div>
      <div style="font-family:Georgia,serif;font-size:26px;margin-top:8px">${esc(d.perfil)}</div>
    </div>
    <div style="padding:26px;border:1px solid #DCE4EC;border-top:none">
      <p style="font-size:16px;margin:0 0 16px">Hola ${esc(primer)},</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 18px">Gracias por completar tu evaluación. Este es tu perfil general:</p>
      <div style="border-left:3px solid #3E86CF;padding:4px 0 4px 18px;margin:0 0 22px">
        <div style="font-family:Georgia,serif;font-size:19px;color:#0F1A24">${esc(d.perfil)}</div>
        <div style="font-size:14.5px;color:#283845;line-height:1.6;margin-top:6px">${esc(d.desc)}</div>
      </div>
      ${pdfBlock}
      <div style="background:#F4F7FA;border:1px solid #DCE4EC;border-left:3px solid #3E86CF;padding:18px 20px;margin:0 0 24px">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#2A6AAE;margin-bottom:6px">Tu siguiente paso</div>
        <div style="font-size:15px;color:#0F1A24;line-height:1.5">${esc(d.ruta)}</div>
      </div>
      <a href="${esc(d.ctaUrl)}" style="display:inline-block;background:#0F1A24;color:#fff;text-decoration:none;padding:14px 26px;font-size:13px;letter-spacing:.08em;text-transform:uppercase">${esc(d.ctaLabel)}</a>
      <p style="font-size:14px;color:#283845;line-height:1.6;margin:26px 0 0">Te escribo personalmente en menos de 24 horas hábiles con la lectura completa de tu resultado.</p>
      <p style="font-size:14px;color:#283845;margin:18px 0 0">Un abrazo,<br><strong>Mario Citalán</strong></p>
      <p style="font-size:11px;color:#7B8794;line-height:1.5;margin-top:24px;border-top:1px solid #DCE4EC;padding-top:16px">Esta evaluación es una herramienta de desarrollo humano y autoconocimiento. No constituye una prueba psicológica, psiquiátrica ni diagnóstica, y sus resultados son orientativos.</p>
    </div>
  </div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const nombre = (body.nombre ?? '').toString().trim()
    const email = (body.email ?? '').toString().trim()
    const tel = (body.tel ?? '').toString().trim()
    const perfil = (body.perfil ?? '').toString().trim()
    const ruta = (body.ruta ?? '').toString().trim()
    const desc = (body.desc ?? '').toString().trim()
    const link = (body.link ?? '').toString().trim()
    const test = (body.test ?? 'criterio').toString().trim().toLowerCase()
    const ctaLabel = (body.ctaLabel ?? 'Ver mi ruta recomendada').toString().trim()
    const pdf = (body.pdf ?? '').toString().trim()
    const pdfNombre = (body.pdfNombre ?? 'Tu PDF').toString().trim()
    const testLabel = test === 'actitud' ? 'Actitud' : 'Criterio'

    if (!nombre || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 })
    }

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      console.error('[demo/mario-criterio] RESEND_API_KEY no configurada')
      return NextResponse.json({ ok: false, note: 'email no configurado' })
    }

    // URL absoluta del CTA hacia la ruta recomendada del demo
    let ctaUrl = 'https://www.fishflow.mx/demos/mariocitalan/index.html#soluciones'
    let pdfUrl = ''
    try {
      const origin = new URL(req.url).origin
      const base = `${origin}/demos/mariocitalan/`
      ctaUrl = new URL(link || 'index.html#soluciones', base).toString()
      if (pdf) pdfUrl = new URL(pdf, base).toString()
    } catch (_) {}

    const resend = new Resend(resendKey)

    // 1) Aviso interno → Mario + Rafa
    const { error: adminErr } = await resend.emails.send({
      from: 'FishFlow <recibos@fishflow.mx>',
      to: ADMIN_TO,
      replyTo: email,
      subject: `Nueva evaluación de ${testLabel} — ${nombre} (${perfil})`,
      html: adminHtml({ nombre, email, tel, perfil, ruta }),
    })
    if (adminErr) console.error('[demo/mario-criterio] admin email error:', adminErr)

    // 2) Resultado → prospecto
    const { error: leadErr } = await resend.emails.send({
      from: 'Mario Citalán <recibos@fishflow.mx>',
      to: [email],
      replyTo: 'raf@fishflow.mx',
      subject: `${nombre.split(' ')[0] || nombre}, tu resultado: ${perfil}`,
      html: leadHtml({ nombre, perfil, desc, ruta, ctaUrl, ctaLabel, pdfUrl, pdfNombre }),
    })
    if (leadErr) console.error('[demo/mario-criterio] lead email error:', leadErr)

    return NextResponse.json({ ok: !adminErr && !leadErr })
  } catch (err: any) {
    console.error('[demo/mario-criterio] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
