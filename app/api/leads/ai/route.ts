import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'
import { SENDERS } from '@/lib/email'
import { revisarAntibot, logDescarte } from '@/lib/antibot'
import { sendTemplate } from '@/lib/whatsapp'
import { notifySlack, slackEscape } from '@/lib/slack'

// ─── Clientes ────────────────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Lazy: el SDK de Resend truena al construirse sin API key. A nivel de módulo
// eso rompe `next build` en cualquier máquina que no tenga el secreto.
function getResend() {
  return new Resend(process.env.RESEND_API_KEY!)
}

// ─── System prompt de FishFlow ───────────────────────────────────────────────

const FISHFLOW_SYSTEM_PROMPT = `Eres el asistente de FishFlow, empresa mexicana de automatización e IA para micro PyMES locales.

Cómo cotiza FishFlow (no hay paquetes ni planes):
- Implementación: un pago único para construir la solución, conectarla con las herramientas del negocio (WhatsApp, pagos, facturación), cargar sus datos y capacitar al equipo.
- Suscripción mensual: mantenerla funcionando y mejorándola (hospedaje, seguridad, la IA y servicios conectados, soporte).
- Los montos de ambas partes dependen de lo que se automatice; se cotizan después de revisar el caso.

Clientes actuales de FishFlow (ejemplos reales de lo que entregamos):
- Estética Belange CDMX: contabilidad de ventas por día, semana y mes, e inventario
- CANE Neurofeedback: sitio propio, reseñas de Google y redes publicándose solas
- Enlace Integral Seguros: captación de prospectos y operación comercial de su equipo de vendedoras
- Lukon Telemática: facturación que se timbra y se envía sola
- SPARC Group (administración de condominios): sitio con cuestionario de captación y resumen inteligente de la cartera de todos sus edificios, conectado a su sistema actual
- VIBRA MX: venta de boletos en línea con QR y ligas de referido

Stack tecnológico: Next.js, Supabase, Vercel, Meta Cloud API (WhatsApp).

Cuando el prospecto describa su problema, responde siguiendo EXACTAMENTE este orden:
1. Reconoce el reto del negocio en una oración (sin repetir textualmente lo que dijeron)
2. Explica de forma concreta cómo FishFlow lo resuelve — menciona qué funciona, no cómo se llama la tecnología
3. En una oración, di qué parte se resolvería primero y que se cotiza en dos partes: un pago único de implementación y una suscripción mensual, ambas según lo que automaticemos (nunca des montos ni rangos)
4. Cierra diciendo que alguien del equipo de FishFlow le va a escribir muy pronto para aterrizarlo (no le pidas que agende nada)

Reglas de tono:
- Habla de tú, nunca de usted
- Máximo 130 palabras en total
- Directo y cálido — como un socio tecnológico de confianza, no como una empresa corporativa
- Sin frases vacías como "soluciones integrales" o "empoderamos tu negocio"
- No menciones precios ni rangos — siempre se cotizan después de revisar su caso
- No menciones "Tipo A", "Tipo B", "SaaS" ni nombres de planes`

// ─── Email HTML ───────────────────────────────────────────────────────────────

function escHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** La IA a veces responde con **negritas** de Markdown: en el correo se ven como <b>. */
function iaToHtml(t: string): string {
  return escHtml(t.trim())
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#083B4C;">$1</b>')
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

// Identidad del rebranding "Siempre Adelante" (oct-2026): fondo claro, logo
// vertical, cyan #42C7E8 + naranja #FF8A2A, firma con el slogan.
function buildEmailHtml(name: string, aiResponse: string): string {
  const nombre = escHtml(name.split(/\s+/)[0] || name)
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#EEF9FC;font-family:Inter,Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#EEF9FC;padding:32px 12px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(8,59,76,.12);">
        <tr><td style="height:6px;background:linear-gradient(90deg,#42C7E8 0%,#42C7E8 50%,#FF8A2A 50%,#FF8A2A 100%);background-color:#42C7E8;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td align="center" style="padding:30px 32px 6px;">
            <img src="https://www.fishflow.mx/email/fishflow-logo.png" width="132" alt="FishFlow" style="display:block;width:132px;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:22px 36px 8px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#083B4C;">Hola ${nombre},</p>
            <p style="margin:0 0 22px;font-size:15px;color:#4F6672;line-height:1.6;">Gracias por contarnos tu caso. Esto es lo que vemos para tu negocio:</p>
            <div style="background:#EEF9FC;border-left:4px solid #42C7E8;border-radius:10px;padding:20px 22px;margin-bottom:24px;">
              <p style="margin:0;font-size:15px;color:#162632;line-height:1.7;">${iaToHtml(aiResponse)}</p>
            </div>
            <p style="margin:0 0 22px;font-size:15px;color:#162632;line-height:1.6;">Te estaremos contactando muy pronto para programar una reunión y aterrizarlo juntos.</p>
            <a href="https://wa.me/525610597851?text=Hola%20FishFlow%2C%20ya%20recib%C3%AD%20mi%20diagn%C3%B3stico"
               style="display:inline-block;background:#FF8A2A;color:#FFFFFF;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px;text-decoration:none;">
              Escríbenos por WhatsApp
            </a>
            <p style="margin:14px 0 0;font-size:13px;color:#4F6672;">
              O responde este correo: <a href="mailto:raf@fishflow.mx" style="color:#0A7EA3;font-weight:600;">raf@fishflow.mx</a>
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:30px 32px 26px;">
            <p style="margin:0;font-size:26px;font-weight:800;letter-spacing:-.5px;line-height:1.1;"><span style="color:#42C7E8;">Siempre</span> <span style="color:#FF8A2A;">Adelante</span></p>
            <p style="margin:10px 0 0;font-size:12px;color:#7B8E98;">FishFlow · Soluciones digitales y de IA para negocios locales · <a href="https://www.fishflow.mx" style="color:#7B8E98;">fishflow.mx</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { name, email, problem } = body
    // WhatsApp opcional: solo si trae entre 10 y 13 dígitos (MX con o sin 52/521)
    const phoneDigits = String(body.phone ?? '').replace(/\D/g, '')
    const phone = phoneDigits.length >= 10 && phoneDigits.length <= 13 ? phoneDigits : null

    // Filtro antibot (ver lib/antibot.ts). Va ANTES que nada porque este
    // endpoint es el más caro de abusar del portafolio: cada POST gasta una
    // llamada a Claude y manda un correo a la dirección que le escriban. Se
    // devuelve un texto genérico en vez de un error para no enseñarle al bot
    // qué campo corregir.
    const veredicto = revisarAntibot(req, body)
    if (!veredicto.ok) {
      logDescarte('leads/ai', veredicto.motivo, email)
      return NextResponse.json({
        response:
          'Gracias por escribir. Te mandamos el diagnóstico a tu correo en un momento.',
      })
    }

    // Validaciones básicas
    if (!name?.trim() || !email?.trim() || !problem?.trim()) {
      return NextResponse.json(
        { error: 'Nombre, email y descripción del problema son requeridos' },
        { status: 400 }
      )
    }

    // ── 1. Llamada a Claude Haiku ─────────────────────────────────────────────
    // Para cambiar a Sonnet: reemplaza 'claude-haiku-4-5-20251001' por 'claude-sonnet-4-6'
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: FISHFLOW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: problem.trim() }],
    })

    const aiResponse =
      message.content[0].type === 'text' ? message.content[0].text : ''

    // ── 2. Guardar lead en Supabase ───────────────────────────────────────────
    const { data: leadRow, error: dbError } = await supabaseAdmin.from('leads').insert({
      name:        name.trim(),
      email:       email.trim().toLowerCase(),
      phone,
      problem:     problem.trim(),
      ai_response: aiResponse,
    }).select('id').single()

    if (dbError) {
      console.error('[leads/ai] Supabase insert error:', dbError)
      // No bloqueamos al usuario si falla el guardado — la respuesta igual se muestra
    }

    // ── 3. Email de seguimiento con Resend ────────────────────────────────────
    const { error: emailError } = await getResend().emails.send({
      from:     SENDERS.fishflow,
      to:       [email.trim().toLowerCase()],
      replyTo:  'raf@fishflow.mx',
      subject:  `${name.trim()}, aquí está tu diagnóstico de FishFlow`,
      html:     buildEmailHtml(name.trim(), aiResponse),
    })

    if (emailError) {
      console.error('[leads/ai] Resend error:', emailError)
      // Igual devolvemos la respuesta aunque falle el email
    }

    // ── 4. WhatsApp inmediato (plantilla diagnostico_recibido_v2) ───────────────
    // No bloquea: si la plantilla no está aprobada o Meta falla, queda en logs
    // y en whatsapp_messages con status 'failed'.
    if (phone) {
      const wa = await sendTemplate({
        to: phone,
        // v2 (oct-2026): sin liga de agenda. "Te estaremos contactando para programar una reunión".
        name: 'diagnostico_recibido_v2',
        params: [name.trim().split(/\s+/)[0]],
        ref: leadRow?.id ?? null,
      })
      if (!wa.ok) console.error('[leads/ai] WhatsApp no salió:', wa.error)
    }

    // ── 5. Aviso al canal #leads de Slack (equipo FishFlow) ──────────────────
    await notifySlack('leads', {
      text: `Nuevo diagnóstico en la landing: ${name.trim()}`,
      body:
        `${slackEscape(email.trim().toLowerCase())}${phone ? ` · WhatsApp +${phone}` : ''}\n` +
        `>${slackEscape(problem.trim().slice(0, 1500)).replace(/\n/g, '\n>')}`,
      button: { label: 'Ver en /admin', url: 'https://www.fishflow.mx/admin' },
    })

    return NextResponse.json({ response: aiResponse })

  } catch (err: any) {
    console.error('[leads/ai] Error:', err?.message ?? err)
    return NextResponse.json(
      { error: 'Error al procesar tu solicitud. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
