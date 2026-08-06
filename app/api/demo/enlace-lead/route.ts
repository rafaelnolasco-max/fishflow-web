import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { SENDERS, enlaceNotifyTo } from '@/lib/email'

export const runtime = 'nodejs'

// Captura de leads de la landing de Enlace Integral Seguros (/demos/enlaceintegral).
// 1) Guarda el lead en Supabase (tabla `leads`, visible en /admin → Leads).
// 2) Envía aviso inmediato por Resend a Rafa (y opcionalmente al asesor).
// Reutiliza la infraestructura existente; no requiere migración.

// client_id de Enlace Integral en la tabla `clients` (multi-tenant).
// Los leads de la landing quedan etiquetados a Enlace → Ivonne solo ve los suyos
// en /app/enlace, separados de los leads generales de FishFlow en /admin.
const ENLACE_CLIENT_ID = 'e8094119-0414-4d46-8506-6ee1a52e852c'

// Destinatarios del aviso (Rafa + Enlace). Centralizado en lib/email.ts —
// ver la nota ahí sobre por qué `contacto@...com.mx` no sirve.

const PLAN_LABEL: Record<string, string> = {
  ahorro: 'Ahorro para el retiro (OptiMaxx Plus)',
  vida: 'Protección de vida',
  gmm: 'Gastos médicos mayores',
  educacion: 'Ahorro educativo',
}

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function adminHtml(d: Record<string, string>) {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 0;color:#5d7080;width:150px">${k}</td><td style="padding:7px 0"><strong>${esc(v) || '—'}</strong></td></tr>`
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b2733">
    <div style="background:#212934;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#65BC7B">Enlace Integral Seguros · Nuevo lead</div>
      <div style="font-size:22px;margin-top:6px;font-weight:800">Llegó un prospecto desde tu página</div>
    </div>
    <div style="padding:22px 26px;border:1px solid #E2EAE5;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Nombre', d.nombre)}
        ${row('WhatsApp', d.whatsapp)}
        ${row('Correo', d.email)}
        ${row('Plan recomendado', d.plan)}
        ${row('Objetivo', d.objetivo)}
        ${row('Edad', d.edad)}
        ${row('Dependientes', d.dependientes)}
        ${row('Capacidad mensual', d.capacidad)}
        ${row('Ocupación', d.ocupacion)}
      </table>
      <a href="https://wa.me/52${esc(d.whatsapp).replace(/\D/g, '')}" style="display:inline-block;margin-top:18px;background:#25D366;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">Escribirle por WhatsApp</a>
      <p style="font-size:12px;color:#5d7080;margin-top:20px">Aviso automático de la landing · FishFlow</p>
    </div>
  </div>`
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}))
    const nombre = (b.nombre ?? '').toString().trim()
    const whatsapp = (b.whatsapp ?? '').toString().trim()
    const email = (b.email ?? '').toString().trim().toLowerCase()
    const segmento = (b.segmento ?? '').toString().trim()
    const plan = PLAN_LABEL[segmento] || (b.plan_recomendado ?? '').toString().trim() || '—'
    const objetivo = (b.objetivo ?? '').toString().trim()
    const edad = (b.edad ?? '').toString().trim()
    const dependientes = (b.dependientes ?? '').toString().trim()
    const capacidad = (b.capacidad ?? '').toString().trim()
    const ocupacion = (b.ocupacion ?? '').toString().trim()

    if (!nombre || !whatsapp) {
      return NextResponse.json({ error: 'Falta nombre o WhatsApp.' }, { status: 400 })
    }

    const resumen = [
      '[Landing Enlace Integral]',
      `Plan: ${plan}`,
      `WhatsApp: ${whatsapp}`,
      `Objetivo: ${objetivo}`,
      `Edad: ${edad}`,
      `Dependientes: ${dependientes}`,
      `Capacidad: ${capacidad}`,
      `Ocupación: ${ocupacion}`,
    ].join(' · ')

    // 1) Guardar en Supabase (best-effort; no bloquea al usuario si falla)
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      const { error } = await supabase.from('leads').insert({
        name: nombre,
        email: email || `wa-${whatsapp.replace(/\D/g, '')}@enlace.local`,
        problem: resumen,
        ai_response: `Plan recomendado: ${plan}`,
        source: 'enlace_landing',
        client_id: ENLACE_CLIENT_ID,
      })
      if (error) console.error('[demo/enlace-lead] Supabase insert error:', error)
    } catch (e) {
      console.error('[demo/enlace-lead] Supabase error:', e)
    }

    // 2) Aviso inmediato por correo
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const resend = new Resend(resendKey)
      const { error: mailErr } = await resend.emails.send({
        from: SENDERS.enlace,
        to: enlaceNotifyTo(),
        replyTo: email || undefined,
        subject: `Nuevo lead — ${nombre} · ${plan}`,
        html: adminHtml({ nombre, whatsapp, email, plan, objetivo, edad, dependientes, capacidad, ocupacion }),
      })
      if (mailErr) console.error('[demo/enlace-lead] email error:', mailErr)
    } else {
      console.error('[demo/enlace-lead] RESEND_API_KEY no configurada')
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[demo/enlace-lead] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
