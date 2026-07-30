import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'

// Envío del newsletter de Mario Citalán.
//
// MODO PRUEBA (el actual): pase lo que pase, el correo solo sale a los dos
// buzones de abajo. La lista blanca vive en el servidor, no en el navegador, así
// que aunque alguien manipule la petición no puede alcanzar a los suscriptores.
//
// Para abrirlo a la lista real hacen falta dos cosas:
//   1. Verificar mail.mariocitalan.net en Resend (hoy saldría desde fishflow.mx,
//      que es el dominio transaccional y no debe cargar envíos masivos).
//   2. Cambiar TEST_MODE a false y resolver el enlace de baja por destinatario.
const TEST_MODE = true
const TEST_RECIPIENTS = ['raf@fishflow.mx', 'mariocitalan@gmail.com']

const FROM = 'Mario Citalán <recibos@fishflow.mx>'

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Convierte el texto plano del borrador en párrafos con la tipografía del sitio. */
function renderBody(body: string) {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="font-size:16px;line-height:1.75;color:#283845;margin:0 0 18px">${esc(p).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

function emailHtml(subject: string, body: string, aviso: string) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F1A24;background:#FFFFFF">
    <div style="background:#0F1A24;color:#fff;padding:26px 30px">
      <div style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#67D4E8">Arquitectura del Criterio</div>
      <div style="font-family:Georgia,serif;font-size:25px;margin-top:9px;line-height:1.25">${esc(subject)}</div>
    </div>
    <div style="padding:30px;border:1px solid #DCE4EC;border-top:none">
      ${renderBody(body)}
      <div style="border-top:1px solid #DCE4EC;margin-top:26px;padding-top:18px">
        <p style="font-size:14px;color:#283845;margin:0 0 6px"><strong>Mario Citalán</strong></p>
        <p style="font-size:13px;color:#7B8794;margin:0">
          Arquitectura Mental y del Criterio ·
          <a href="https://mariocitalan.net" style="color:#2A6AAE">mariocitalan.net</a>
        </p>
        <p style="font-size:11.5px;color:#7B8794;line-height:1.6;margin-top:16px">${aviso}</p>
      </div>
    </div>
  </div>`
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const subject = String(body.subject ?? '').trim()
    const texto = String(body.body ?? '').trim()
    const audience = String(body.audience ?? 'todos')

    if (!subject || !texto) {
      return NextResponse.json({ error: 'Falta el asunto o el cuerpo del correo.' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendKey = process.env.RESEND_API_KEY
    if (!supabaseUrl || !serviceKey || !resendKey) {
      console.error('[newsletter/send] Faltan credenciales')
      return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    // Cuántos suscriptores reales alcanzaría este envío (solo informativo en prueba)
    const { count: suscritos } = await supabase
      .from('leads')
      .select('email', { count: 'exact', head: true })
      .eq('client_id', CRITERIO_CLIENT_ID)
      .eq('newsletter', 'suscrito')

    const destinatarios = TEST_MODE ? TEST_RECIPIENTS : []
    if (destinatarios.length === 0) {
      return NextResponse.json({ error: 'El envío a la lista real todavía no está habilitado.' }, { status: 400 })
    }

    const aviso = TEST_MODE
      ? 'ENVÍO DE PRUEBA · Este correo solo llegó a Mario y a FishFlow. Los suscriptores no lo recibieron.'
      : 'Recibes este correo porque aceptaste las publicaciones de Mario Citalán. Puedes darte de baja respondiendo "baja".'

    const resend = new Resend(resendKey)
    const { error: mailErr } = await resend.emails.send({
      from: FROM,
      to: destinatarios,
      replyTo: 'mariocitalan@gmail.com',
      subject: TEST_MODE ? `[PRUEBA] ${subject}` : subject,
      html: emailHtml(subject, texto, aviso),
    })
    if (mailErr) {
      console.error('[newsletter/send] email error:', mailErr)
      return NextResponse.json({ error: 'No se pudo enviar.' }, { status: 500 })
    }

    // Historial: queda registro de cada envío, también de las pruebas
    const { error: dbErr } = await supabase.from('newsletter_campaigns').insert({
      client_id: CRITERIO_CLIENT_ID,
      subject,
      body: texto,
      audience,
      recipients: destinatarios.length,
      test_mode: TEST_MODE,
      sent_to: destinatarios,
      created_by: String(body.by ?? 'panel'),
    })
    if (dbErr) console.error('[newsletter/send] Supabase insert error:', dbErr)

    return NextResponse.json({
      ok: true,
      testMode: TEST_MODE,
      sentTo: destinatarios,
      wouldReach: suscritos ?? 0,
    })
  } catch (err: unknown) {
    console.error('[newsletter/send] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al enviar.' }, { status: 500 })
  }
}
