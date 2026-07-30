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

// ─── Identidad visual de mariocitalan.net ─────────────────────────────────────
// Mismas variables de color y el mismo trío tipográfico del sitio. En correo,
// Fraunces solo carga en algunos clientes (Apple Mail sí, Gmail no), por eso la
// pila termina en Georgia: el sitio también usa serif, así que degrada bien.
const INK = '#0F1A24'
const INK2 = '#283845'
const PAPER = '#F4F7FA'
const ACCENT_DEEP = '#2A6AAE'
const CYAN = '#67D4E8'
const RULE = '#DCE4EC'
const MUTED = '#7B8794'

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, 'Segoe UI', Arial, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'Courier New', monospace"

// El logo se sirve desde fishflow.mx (no desde Hostinger) para que el correo no
// dependa del sitio del cliente. Todo el encabezado se lee aunque el cliente de
// correo bloquee imágenes, porque el fondo oscuro y el texto son HTML.
const LOGO = 'https://www.fishflow.mx/mariocitalan/dr-mente-logo.png'
const SITIO = 'https://mariocitalan.net'

/** Párrafos del cuerpo con el interlineado del sitio. */
function renderBody(body: string) {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 20px;font-family:${SANS};font-size:16px;line-height:1.75;color:${INK2}">${esc(
          p
        ).replace(/\n/g, '<br>')}</p>`
    )
    .join('')
}

function emailHtml(subject: string, body: string, aviso: string) {
  // Preheader: lo que se ve en la bandeja junto al asunto, antes de abrir.
  const preheader = body.replace(/\s+/g, ' ').trim().slice(0, 110)

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}">
    <tr><td align="center" style="padding:28px 14px">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${RULE}">

        <!-- Cabecera: navy del hero del sitio -->
        <tr>
          <td style="background:${INK};padding:28px 32px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="42" style="vertical-align:middle;padding-right:13px">
                  <img src="${LOGO}" width="42" height="42" alt=""
                       style="display:block;width:42px;height:42px;border:0">
                </td>
                <td style="vertical-align:middle">
                  <div style="font-family:${SERIF};font-size:19px;font-weight:500;color:#FFFFFF;line-height:1.2">Mario Citalán</div>
                  <div style="font-family:${MONO};font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:${CYAN};padding-top:4px">Arquitectura del Criterio</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Título del envío -->
        <tr>
          <td style="padding:34px 32px 0">
            <!-- ornamento línea + diamante, igual que en el sitio -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
              <tr>
                <td style="width:46px;height:1px;background:${ACCENT_DEEP};font-size:0;line-height:0">&nbsp;</td>
                <td style="padding-left:11px">
                  <div style="width:6px;height:6px;background:${ACCENT_DEEP};transform:rotate(45deg)"></div>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 26px;font-family:${SERIF};font-size:27px;font-weight:500;line-height:1.22;letter-spacing:-.01em;color:${INK}">${esc(
    subject
  )}</h1>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:0 32px">
            ${renderBody(body)}
          </td>
        </tr>

        <!-- Firma -->
        <tr>
          <td style="padding:8px 32px 30px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${RULE};padding-top:20px">
                <div style="font-family:${SERIF};font-size:18px;color:${INK}">Mario Citalán</div>
                <div style="font-family:${SANS};font-size:13.5px;color:${MUTED};padding-top:4px">
                  Médico y psicoterapeuta · Ciudad de México
                </div>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Pie oscuro con enlaces del sitio -->
        <tr>
          <td style="background:${INK};padding:24px 32px">
            <div style="font-family:${MONO};font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:${CYAN};padding-bottom:12px">Tu ecosistema</div>
            <div style="font-family:${SANS};font-size:13.5px;line-height:2;color:rgba(255,255,255,.82)">
              <a href="${SITIO}/actitud.html" style="color:rgba(255,255,255,.82);text-decoration:none">Evalúa tu actitud</a>
              &nbsp;·&nbsp;
              <a href="${SITIO}/cuestionario.html" style="color:rgba(255,255,255,.82);text-decoration:none">Evaluación de Criterio</a>
              &nbsp;·&nbsp;
              <a href="${SITIO}/recursos.html" style="color:rgba(255,255,255,.82);text-decoration:none">Recursos</a>
            </div>
            <div style="font-family:${SANS};font-size:12.5px;color:rgba(255,255,255,.5);padding-top:16px">
              <a href="${SITIO}" style="color:${CYAN};text-decoration:none">mariocitalan.net</a>
            </div>
          </td>
        </tr>

      </table>

      <!-- Aviso legal / baja -->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
        <tr><td style="padding:16px 8px 0;font-family:${SANS};font-size:11.5px;line-height:1.65;color:${MUTED};text-align:center">
          ${aviso}
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`
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
