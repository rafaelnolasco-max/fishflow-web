import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// ─── Módulo Karaoke B-Wing ────────────────────────────────────────────────────
// Todas las escrituras de la ruta pública de mesa (/k/bwing/[codigo]) pasan por
// aquí con service role. Las tablas karaoke_* NO tienen policies de escritura
// anon: este endpoint es la única puerta, y valida todas las reglas de negocio.
//
// Reglas:
// - La mesa se identifica por CÓDIGO aleatorio (karaoke_tables), no por número:
//   nadie puede adivinar la URL de otra mesa. GET ?code= resuelve código→mesa
//   (karaoke_tables no tiene ningún grant anon; solo service role la lee).
// - Solo se escribe sobre la sesión 'open' del cliente bwing.
// - Editar / cancelar / reordenar: solo requests en status 'pending' y solo
//   con el edit_token correcto (se genera al crear y vive en localStorage).
// - Cancelar = soft delete (status 'cancelled'), nunca DELETE — Jesús quiere
//   estadísticas de la noche completa.
// - position global la controla solo el admin; la mesa solo permuta SUS
//   canciones entre SUS propios lugares (reorder_own).
// - Límite de pendientes por mesa para que nadie acapare la fila.
//   12 = mesas grandes (10+ personas) piden de una sola vez sin toparse.

const BWING_SLUG = 'bwing'
const MAX_PENDING_PER_TABLE = 12

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getOpenSession(supabase: ReturnType<typeof svc>) {
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', BWING_SLUG)
    .single()
  if (cErr || !client) return { session: null, clientId: null }

  const { data: session } = await supabase
    .from('karaoke_sessions')
    .select('id, client_id')
    .eq('client_id', client.id)
    .eq('status', 'open')
    .maybeSingle()
  return { session, clientId: client.id }
}

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code })
}

// Resuelve código de mesa → número. Solo códigos activos del cliente bwing.
async function resolveTable(
  supabase: ReturnType<typeof svc>,
  code: string,
  clientId: string
) {
  if (!/^[a-z0-9]{4,12}$/i.test(code)) return null
  const { data } = await supabase
    .from('karaoke_tables')
    .select('table_number')
    .eq('client_id', clientId)
    .eq('code', code.toLowerCase())
    .eq('active', true)
    .maybeSingle()
  return data?.table_number ?? null
}

// ─── GET ?code=xxx: resolver código → mesa (lo usa la página de mesa) ────────
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code') ?? ''
  const supabase = svc()
  const { session, clientId } = await getOpenSession(supabase)
  if (!clientId) return bad('Cliente no encontrado', 500)

  const table_number = await resolveTable(supabase, code, clientId)
  if (!table_number) return bad('Mesa no válida', 404)

  return NextResponse.json({
    table_number,
    open: !!session,
    max_pending: MAX_PENDING_PER_TABLE,
  })
}

// ─── POST: crear petición de canción ─────────────────────────────────────────
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return bad('JSON inválido')
  }

  const code = String(body.code ?? '')
  const song = String(body.song ?? '').trim().slice(0, 120)
  const artist = String(body.artist ?? '').trim().slice(0, 120) || null
  const singer_name = String(body.singer_name ?? '').trim().slice(0, 60)

  if (!song) return bad('Falta la canción')
  if (!singer_name) return bad('Falta el nombre de quien canta')

  const supabase = svc()
  const { session, clientId } = await getOpenSession(supabase)
  if (!clientId) return bad('Cliente no encontrado', 500)
  const table_number = await resolveTable(supabase, code, clientId)
  if (!table_number) return bad('Mesa no válida', 403)
  if (!session) return bad('El karaoke no está abierto en este momento', 409)

  // Límite de pendientes por mesa
  const { count } = await supabase
    .from('karaoke_requests')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('table_number', table_number)
    .eq('status', 'pending')
  if ((count ?? 0) >= MAX_PENDING_PER_TABLE)
    return bad(`Tu mesa ya tiene ${MAX_PENDING_PER_TABLE} canciones en la fila. Espera a que pase una.`, 409)

  // position = max + 1 dentro de la sesión (orden de llegada)
  const { data: last } = await supabase
    .from('karaoke_requests')
    .select('position')
    .eq('session_id', session.id)
    .not('position', 'is', null)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const position = (last?.position ?? 0) + 1

  const { data, error } = await supabase
    .from('karaoke_requests')
    .insert({
      session_id: session.id,
      client_id: session.client_id,
      table_number,
      song,
      artist,
      singer_name,
      position,
    })
    .select('id, edit_token')
    .single()

  if (error || !data) {
    console.error('[bwing/requests POST]', error)
    return bad('No se pudo registrar la canción, intenta de nuevo', 500)
  }

  return NextResponse.json({ id: data.id, edit_token: data.edit_token })
}

// ─── PATCH: editar / cancelar / reordenar propias ────────────────────────────
// { action: 'edit',        id, edit_token, song?, artist?, singer_name? }
// { action: 'cancel',      id, edit_token }
// { action: 'reorder_own', items: [{ id, edit_token }, ...] }  ← nuevo orden deseado
export async function PATCH(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return bad('JSON inválido')
  }

  const action = String(body.action ?? '')
  const supabase = svc()
  const { session } = await getOpenSession(supabase)
  if (!session) return bad('El karaoke no está abierto en este momento', 409)

  if (action === 'edit' || action === 'cancel') {
    const id = String(body.id ?? '')
    const edit_token = String(body.edit_token ?? '')
    if (!id || !edit_token) return bad('Faltan datos')

    // Solo pending + token correcto + sesión abierta
    const { data: reqRow } = await supabase
      .from('karaoke_requests')
      .select('id, status')
      .eq('id', id)
      .eq('edit_token', edit_token)
      .eq('session_id', session.id)
      .maybeSingle()
    if (!reqRow) return bad('Canción no encontrada', 404)
    if (reqRow.status !== 'pending')
      return bad('Esta canción ya no se puede modificar', 409)

    const patch: Record<string, unknown> =
      action === 'cancel'
        ? { status: 'cancelled' }
        : {
            ...(body.song != null && String(body.song).trim()
              ? { song: String(body.song).trim().slice(0, 120) }
              : {}),
            ...(body.artist !== undefined
              ? { artist: String(body.artist ?? '').trim().slice(0, 120) || null }
              : {}),
            ...(body.singer_name != null && String(body.singer_name).trim()
              ? { singer_name: String(body.singer_name).trim().slice(0, 60) }
              : {}),
          }
    if (Object.keys(patch).length === 0) return bad('Nada que actualizar')

    const { error } = await supabase
      .from('karaoke_requests')
      .update(patch)
      .eq('id', id)
      .eq('edit_token', edit_token)
      .eq('status', 'pending')
    if (error) {
      console.error('[bwing/requests PATCH]', error)
      return bad('No se pudo actualizar', 500)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'reorder_own') {
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length < 2) return bad('Se necesitan al menos 2 canciones')
    if (items.length > MAX_PENDING_PER_TABLE) return bad('Demasiados elementos')

    const ids = items.map((i: Record<string, unknown>) => String(i.id ?? ''))
    const tokens = new Map(
      items.map((i: Record<string, unknown>) => [String(i.id ?? ''), String(i.edit_token ?? '')])
    )
    if (ids.some((id) => !id)) return bad('Faltan datos')

    // Traer las requests: deben ser todas pending, de la misma mesa, con token válido
    const { data: rows } = await supabase
      .from('karaoke_requests')
      .select('id, edit_token, table_number, status, position')
      .in('id', ids)
      .eq('session_id', session.id)
    if (!rows || rows.length !== ids.length) return bad('Canción no encontrada', 404)

    const mesa = rows[0].table_number
    for (const r of rows) {
      if (r.edit_token !== tokens.get(r.id)) return bad('Token inválido', 403)
      if (r.status !== 'pending') return bad('Solo se pueden reordenar canciones en espera', 409)
      if (r.table_number !== mesa) return bad('Las canciones no son de la misma mesa', 403)
    }

    // Permutar: los lugares (positions) actuales se conservan ordenados;
    // el nuevo orden de items decide qué canción ocupa cada lugar.
    const slots = rows
      .map((r) => r.position)
      .sort((a, b) => (a ?? 0) - (b ?? 0))

    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase
        .from('karaoke_requests')
        .update({ position: slots[i] })
        .eq('id', ids[i])
        .eq('status', 'pending')
      if (error) {
        console.error('[bwing/requests reorder_own]', error)
        return bad('No se pudo reordenar', 500)
      }
    }
    return NextResponse.json({ ok: true })
  }

  return bad('Acción desconocida')
}
