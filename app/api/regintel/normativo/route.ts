import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Monitor normativo de /app/regintel: "Revisar ahora" y carga manual de una
// página guardada (fuentes de gob.mx bloqueadas por el desafío anti-bot).
// La función regintel-normativo pide el token del Vault; aquí se lee con
// service role y nunca llega al navegador.

export const maxDuration = 60

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAdmin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const MAX_HTML = 3_000_000

async function usuarioConAcceso(req: NextRequest): Promise<boolean> {
  // Sesión por cookie (patrón del resto de la app) o, si no hay, Bearer del cliente.
  const cookieStore = await cookies()
  let sb: SupabaseClient = createServerClient(URL_SB, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  }) as unknown as SupabaseClient
  let { data: { user } } = await sb.auth.getUser()
  if (!user) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return false
    sb = createClient(URL_SB, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    ;({ data: { user } } = await sb.auth.getUser(token))
    if (!user) return false
  }
  // Mismo criterio que middleware.ts: Rafa siempre pasa; el resto según user_client_access.
  if (user.email === (process.env.ADMIN_EMAIL ?? 'rafaelnolasco@gmail.com')) return true
  const { data, error } = await sb.rpc('user_has_access_to_slug', { p_slug: 'regintel' })
  return !error && data === true
}

export async function POST(req: NextRequest) {
  try {
    if (!(await usuarioConAcceso(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const fase = body.fase === 'subir' ? 'subir' : 'inicio'
    if (fase === 'subir') {
      if (typeof body.clave !== 'string' || typeof body.html !== 'string') {
        return NextResponse.json({ error: 'Falta la fuente o la página' }, { status: 400 })
      }
      if (body.html.length > MAX_HTML) return NextResponse.json({ error: 'La página pesa demasiado (máx. 3 MB)' }, { status: 413 })
    }

    const { data: token, error: te } = await supabaseAdmin.rpc('regintel_scan_token')
    if (te || !token) return NextResponse.json({ error: 'No se pudo autorizar la corrida' }, { status: 500 })

    const r = await fetch(`${URL_SB}/functions/v1/regintel-normativo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-regintel-token': token as string },
      body: JSON.stringify(fase === 'subir'
        ? { fase, clave: body.clave, html: body.html }
        : { fase, disparo: 'manual' }),
    })
    const j = await r.json().catch(() => ({}))
    return NextResponse.json(j, { status: r.ok ? 200 : 502 })
  } catch (e) {
    console.error('[api/regintel/normativo]', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
