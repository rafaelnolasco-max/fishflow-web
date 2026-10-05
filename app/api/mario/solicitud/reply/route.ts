import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'
import { requireClientAccess } from '@/lib/apiAuth'
import { sendEmail } from '@/lib/email'
import { emailUI, escHtml } from '@/lib/emailLayout'

export const runtime = 'nodejs'

// Envía por correo la respuesta que Mario revisó en el panel.
//
// - Sale de "Mario Citalán <mariocitalan@fishflow.mx>" con su marca.
// - Reply-To a su Gmail: si la persona contesta, le llega directo a él.
// - Copia oculta a su Gmail, para que tenga el hilo en su bandeja.
// - Marca la solicitud como contactada y guarda el texto que se envió.

const MARIO_EMAIL = 'mariocitalan@gmail.com'

function html(asunto: string, cuerpo: string) {
  const ui = emailUI('mario')
  const parrafos = cuerpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ui.p(escHtml(p).replace(/\n/g, '<br>')))
    .join('')
  return ui.layout({
    audiencia: 'externo',
    preheader: cuerpo.replace(/\s+/g, ' ').slice(0, 110),
    titulo: asunto,
    cuerpo: parrafos + ui.firma(),
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const leadId = String(body.leadId ?? '').trim()
    const asunto = String(body.asunto ?? '').trim().slice(0, 120)
    const cuerpo = String(body.cuerpo ?? '').trim().slice(0, 6000)
    if (!leadId || !asunto || cuerpo.length < 10) {
      return NextResponse.json({ error: 'Falta el asunto o el texto.' }, { status: 400 })
    }

    const auth = await requireClientAccess(CRITERIO_CLIENT_ID)
    if (!auth.ok) return auth.response

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id,email,status,reply_draft')
      .eq('id', leadId)
      .eq('client_id', CRITERIO_CLIENT_ID)
      .maybeSingle()
    if (error || !lead) return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 })
    if (!/.+@.+\..+/.test(lead.email ?? '')) {
      return NextResponse.json({ error: 'La solicitud no tiene un correo válido.' }, { status: 400 })
    }

    const envio = await sendEmail({
      from: 'marioCitalan',
      to: lead.email,
      replyTo: MARIO_EMAIL,
      bcc: MARIO_EMAIL,
      subject: asunto,
      html: html(asunto, cuerpo),
      tag: 'mario/solicitud/reply',
    })
    if (!envio.ok) return NextResponse.json({ error: 'No se pudo enviar el correo.' }, { status: 502 })

    const ahora = new Date().toISOString()
    const update = {
      reply_sent_at: ahora,
      reply_sent_via: 'email',
      reply_draft: { ...(lead.reply_draft ?? {}), enviado: { via: 'email', asunto, texto: cuerpo, at: ahora } },
      // Solo avanza si seguía en "nuevo": no regresa a alguien que ya estaba agendado.
      ...((lead.status || 'nuevo') === 'nuevo' ? { status: 'contactado' } : {}),
    }
    const { error: upErr } = await supabase.from('leads').update(update).eq('id', leadId)
    if (upErr) console.error('[mario/solicitud/reply] update error:', upErr)

    return NextResponse.json({ ok: true, sent_at: ahora, status: update.status ?? lead.status })
  } catch (err: unknown) {
    console.error('[mario/solicitud/reply] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al enviar.' }, { status: 500 })
  }
}
