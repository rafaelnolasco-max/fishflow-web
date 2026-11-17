import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'
import { requireClientAccess } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email'
import { emailUI } from '@/lib/emailLayout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Asigna (o desasigna) un prospecto de Enlace a un agente del directorio
 * `insurance_agents` y le avisa por correo, con copia a Edna e Ivonne
 * (decisión de Rafa, 17-nov-2026).
 *
 * El correo solo sale cuando el agente CAMBIA: re-elegir al mismo, o mover el
 * estatus, no vuelve a avisar.
 */

// Quienes reparten los prospectos: van en copia de cada asignación.
const CC_ASIGNACION = [
  'edna.cruz@enlaceintegralseguros.com.mx',
  'ivonne.guadarrama@enlaceintegralseguros.com.mx',
]

/** Lee "Clave: valor" del resumen que guarda la landing en `leads.problem`. */
function campo(problem: string, clave: string): string {
  const m = problem.match(new RegExp(`${clave}:\\s*([^·]*)`))
  return (m?.[1] ?? '').trim()
}

const ETIQUETAS: Record<string, string> = {
  retiro: 'Retiro', educacion: 'Educación de los hijos', medicos: 'Gastos médicos', salud: 'Salud',
  proteccion: 'Protección familiar', ahorro: 'Ahorro', integral: 'Protección integral', empresa: 'Empresa',
  nadie: 'Nadie', hijos_pequenos: 'Hijos pequeños', hijos_padres: 'Hijos y padres', pareja: 'Pareja',
  '<2500': 'Menos de $2,500', '2500-4000': '$2,500 a $4,000', '4000-6000': '$4,000 a $6,000',
}
const bonito = (v: string) => ETIQUETAS[v] ?? v.replace(/_/g, ' ')

export async function POST(req: Request) {
  const auth = await requireClientAccess(ENLACE_CLIENT_ID)
  if (!auth.ok) return auth.response

  let body: { leadId?: string; agent?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const leadId = String(body.leadId ?? '')
  const agentName = (body.agent ?? '').trim()
  if (!leadId) return NextResponse.json({ error: 'Falta leadId' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: lead, error: errLead } = await supabase
    .from('leads')
    .select('id, name, email, phone, problem, ai_response, created_at, assigned_to, status, utm_content')
    .eq('id', leadId)
    .eq('client_id', ENLACE_CLIENT_ID)
    .maybeSingle()
  if (errLead) {
    console.error('[enlace/asignar-lead] lead error:', errLead)
    return NextResponse.json({ error: 'No se pudo leer el prospecto' }, { status: 500 })
  }
  if (!lead) return NextResponse.json({ error: 'Prospecto no encontrado' }, { status: 404 })

  let agent: { name: string; email: string | null } | null = null
  if (agentName) {
    const { data, error } = await supabase
      .from('insurance_agents')
      .select('name, email')
      .eq('client_id', ENLACE_CLIENT_ID)
      .eq('name', agentName)
      .maybeSingle()
    if (error) console.error('[enlace/asignar-lead] agente error:', error)
    agent = data ?? null
  }

  // Si el prospecto ya iba más adelante en el embudo, no regresarlo a "asignado".
  const avanzado = lead.status === 'contactado' || lead.status === 'cerrado'
  const patch = {
    assigned_to: agentName || null,
    assigned_at: agentName ? new Date().toISOString() : null,
    status: agentName ? (avanzado ? lead.status : 'asignado') : 'nuevo',
  }
  const { error: errUp } = await supabase.from('leads').update(patch).eq('id', leadId)
  if (errUp) {
    console.error('[enlace/asignar-lead] update error:', errUp)
    return NextResponse.json({ error: 'No se pudo asignar' }, { status: 500 })
  }

  // ── Aviso por correo ────────────────────────────────────────────────────────
  let aviso: 'enviado' | 'sin_cambio' | 'sin_correo' | 'error' | 'desasignado' = 'sin_cambio'
  const cambio = (lead.assigned_to ?? '') !== agentName
  if (!agentName) aviso = 'desasignado'
  else if (cambio && !agent?.email) aviso = 'sin_correo'
  else if (cambio && agent?.email) {
    const problem = lead.problem ?? ''
    const plan = campo(problem, 'Plan') || (lead.ai_response ?? '').replace(/^Plan recomendado:\s*/, '')
    const whatsapp = lead.phone || campo(problem, 'WhatsApp')
    const tel = whatsapp.replace(/\D/g, '').slice(-10)
    const correo = lead.email && !lead.email.endsWith('@enlace.local') ? lead.email : ''
    const nombreCorto = agent.name.split(' ')[0]
    const entro = new Date(lead.created_at).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    const msgWa = `Hola ${lead.name.split(' ')[0]}, soy ${nombreCorto} de Enlace Integral Seguros. ` +
      `Vi que llenaste nuestro cuestionario sobre ${plan || 'tu plan'}. ¿Te puedo llamar para platicarte las opciones?`

    const ui = emailUI('enlace')
    const html = ui.layout({
      audiencia: 'interno',
      preheader: `${lead.name} · ${plan} — contáctalo hoy`,
      etiqueta: 'Prospecto asignado',
      titulo: `${nombreCorto}, tienes un prospecto nuevo`,
      subtitulo: 'Contáctalo en menos de una hora en horario hábil.',
      cuerpo:
        ui.dato('Prospecto', lead.name) +
        ui.tabla([
          ['WhatsApp', whatsapp],
          ['Correo', correo],
          ['Plan recomendado', plan],
          ['Objetivo', bonito(campo(problem, 'Objetivo'))],
          ['Edad', campo(problem, 'Edad')],
          ['Dependientes', bonito(campo(problem, 'Dependientes'))],
          ['Capacidad mensual', bonito(campo(problem, 'Capacidad'))],
          ['Entró', entro],
          ['Asignado por', auth.email],
        ]) +
        ui.botones([
          { texto: 'Escribirle por WhatsApp', href: tel.length === 10 ? `https://wa.me/52${tel}?text=${encodeURIComponent(msgWa)}` : '' },
          ...(correo ? [{ texto: 'Mandarle correo', href: `mailto:${correo}`, estilo: 'secundario' as const }] : []),
        ]),
      nota: 'Cuando lo contactes, avísale a Edna o a Ivonne para que lo marquen en el panel.',
    })

    const cc = CC_ASIGNACION.filter((c) => c.toLowerCase() !== agent!.email!.toLowerCase())
    const r = await sendEmail({
      from: 'enlace',
      to: agent.email,
      cc,
      replyTo: 'edna.cruz@enlaceintegralseguros.com.mx',
      subject: `Prospecto asignado — ${lead.name} · ${plan || 'Enlace'}`,
      html,
      tag: 'enlace/asignar-lead',
    })
    aviso = r.ok ? 'enviado' : 'error'
  }

  return NextResponse.json({ ok: true, ...patch, aviso })
}
