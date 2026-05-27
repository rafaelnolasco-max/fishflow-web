import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'

// ─── Clientes ────────────────────────────────────────────────────────────────

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const resend = new Resend(process.env.RESEND_API_KEY!)

// ─── System prompt de FishFlow ───────────────────────────────────────────────

const FISHFLOW_SYSTEM_PROMPT = `Eres el asistente de FishFlow, empresa mexicana de automatización e IA para micro PyMES locales.

FishFlow ofrece dos modelos de servicio:
- Tipo A (SaaS): plataforma en nube con cobro mensual — ideal para negocios que necesitan un sistema propio: agenda de citas, seguimiento de pedidos, notificaciones automáticas por WhatsApp, contabilidad de ventas por día/semana/mes.
- Tipo B (Servicio administrado): automatización personalizada recurrente — ideal cuando el dueño no tiene tiempo para operar un sistema y prefiere que FishFlow lo maneje todo.

Clientes actuales de FishFlow (ejemplos reales de lo que entregamos):
- Estética en CDMX: sistema de contabilidad de productos vendidos por día, semana y mes
- Empresa de telecomunicaciones: CRM propio para gestión de clientes
- Clínica de neurofeedback: landing page profesional y presencia digital

Stack tecnológico: Next.js, Supabase, Vercel, Meta Cloud API (WhatsApp).

Cuando el prospecto describa su problema, responde siguiendo EXACTAMENTE este orden:
1. Reconoce el reto del negocio en una oración (sin repetir textualmente lo que dijeron)
2. Explica de forma concreta cómo FishFlow lo resuelve — menciona qué funciona, no cómo se llama la tecnología
3. Indica si sería Tipo A (SaaS) o Tipo B (Servicio administrado) y por qué
4. Cierra con una invitación breve a agendar un diagnóstico gratuito sin costo

Reglas de tono:
- Habla de tú, nunca de usted
- Máximo 130 palabras en total
- Directo y cálido — como un socio tecnológico de confianza, no como una empresa corporativa
- Sin frases vacías como "soluciones integrales" o "empoderamos tu negocio"
- No menciones precios — siempre son "a la medida después del diagnóstico"`

// ─── Email HTML ───────────────────────────────────────────────────────────────

function buildEmailHtml(name: string, aiResponse: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Inter,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0D1B2A;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <span style="font-size:22px;font-weight:800;color:#FF8C35;letter-spacing:-0.5px;">FishFlow</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#e2e8f0;">Hola ${name},</p>
            <p style="margin:0 0 24px;font-size:14px;color:#94a3b8;line-height:1.6;">
              Aquí está tu diagnóstico personalizado de FishFlow:
            </p>
            <div style="background:rgba(103,212,232,0.08);border-left:3px solid #67D4E8;border-radius:4px;padding:20px 24px;margin-bottom:28px;">
              <p style="margin:0;font-size:15px;color:#e2e8f0;line-height:1.7;">${aiResponse}</p>
            </div>
            <a href="mailto:rafaelnolasco@gmail.com?subject=Diagnóstico%20gratuito%20FishFlow"
               style="display:inline-block;background:#FF8C35;color:#fff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">
              Agendar diagnóstico gratuito
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0;font-size:12px;color:#475569;">
              FishFlow — Automatización inteligente para tu negocio · fishflow.mx
            </p>
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
    const { name, email, problem } = await req.json()

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
    const { error: dbError } = await supabaseAdmin.from('leads').insert({
      name:        name.trim(),
      email:       email.trim().toLowerCase(),
      problem:     problem.trim(),
      ai_response: aiResponse,
    })

    if (dbError) {
      console.error('[leads/ai] Supabase insert error:', dbError)
      // No bloqueamos al usuario si falla el guardado — la respuesta igual se muestra
    }

    // ── 3. Email de seguimiento con Resend ────────────────────────────────────
    const { error: emailError } = await resend.emails.send({
      from:     'FishFlow <recibos@fishflow.mx>',
      to:       [email.trim().toLowerCase()],
      replyTo:  'rafaelnolasco@gmail.com',
      subject:  `${name.trim()}, aquí está tu diagnóstico de FishFlow`,
      html:     buildEmailHtml(name.trim(), aiResponse),
    })

    if (emailError) {
      console.error('[leads/ai] Resend error:', emailError)
      // Igual devolvemos la respuesta aunque falle el email
    }

    return NextResponse.json({ response: aiResponse })

  } catch (err: any) {
    console.error('[leads/ai] Error:', err?.message ?? err)
    return NextResponse.json(
      { error: 'Error al procesar tu solicitud. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
