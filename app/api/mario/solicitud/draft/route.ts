import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CRITERIO_CLIENT_ID } from '@/lib/supabase'
import { requireClientAccess } from '@/lib/apiAuth'
import { sugerirRespuesta } from '@/lib/marioRespuesta'

export const runtime = 'nodejs'

// Botón "Sugerir respuesta" del panel /app/mariocitalan, pestaña Solicitudes.
// Genera (o regenera) el borrador y lo guarda en leads.reply_draft.
// No envía nada.

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const leadId = String(body.leadId ?? '').trim()
    if (!leadId) return NextResponse.json({ error: 'Falta la solicitud.' }, { status: 400 })

    // Cliente fijo: esta ruta escribe con la voz de Mario y nada más.
    const auth = await requireClientAccess(CRITERIO_CLIENT_ID)
    if (!auth.ok) return auth.response

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: lead, error } = await supabase
      .from('leads')
      .select('id,name,source,answers,created_at')
      .eq('id', leadId)
      .eq('client_id', CRITERIO_CLIENT_ID)
      .maybeSingle()
    if (error || !lead) return NextResponse.json({ error: 'Solicitud no encontrada.' }, { status: 404 })

    const draft = await sugerirRespuesta(lead)

    const { error: upErr } = await supabase.from('leads').update({ reply_draft: draft }).eq('id', leadId)
    if (upErr) {
      console.error('[mario/solicitud/draft] update error:', upErr)
      return NextResponse.json({ error: 'No se pudo guardar el borrador.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, draft })
  } catch (err: unknown) {
    console.error('[mario/solicitud/draft] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'No se pudo generar la respuesta.' }, { status: 500 })
  }
}
