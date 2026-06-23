import { NextResponse } from 'next/server'
import { Resend } from 'resend'

export const runtime = 'nodejs'

// Notificación de demo: avisa a Mario + Rafa cuando alguien completa la
// Evaluación de Arquitectura Mental y del Criterio en el demo.
// NO guarda en Supabase (es demo). Solo envía el correo de aviso.
const NOTIFY_TO = ['mariocitalan@gmail.com', 'raf@fishflow.mx']

function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildHtml(d: {
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const nombre = (body.nombre ?? '').toString().trim()
    const email = (body.email ?? '').toString().trim()
    const tel = (body.tel ?? '').toString().trim()
    const perfil = (body.perfil ?? '').toString().trim()
    const ruta = (body.ruta ?? '').toString().trim()

    if (!nombre || !/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 })
    }

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      console.error('[demo/mario-criterio] RESEND_API_KEY no configurada')
      return NextResponse.json({ ok: false, note: 'email no configurado' })
    }

    const resend = new Resend(resendKey)
    const { error } = await resend.emails.send({
      from: 'FishFlow <recibos@fishflow.mx>',
      to: NOTIFY_TO,
      replyTo: email,
      subject: `Nueva evaluación de Criterio — ${nombre} (${perfil})`,
      html: buildHtml({ nombre, email, tel, perfil, ruta }),
    })

    if (error) {
      console.error('[demo/mario-criterio] Resend error:', error)
      return NextResponse.json({ ok: false }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[demo/mario-criterio] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
