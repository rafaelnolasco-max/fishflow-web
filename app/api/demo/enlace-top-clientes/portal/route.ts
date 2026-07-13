import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Portal continuo de vendedores — Enlace Integral Seguros.
// POST  = entrar: verifica el NIP (o lo crea la primera vez) y regresa los
//         clientes guardados de ESE vendedor. El servidor es la fuente de verdad.
// PATCH = actualizar un cliente ya guardado (completar campos para HubSpot).
// Todo con service role — la tabla tiene RLS y nunca se lee desde el browser.

const PAGE = 1000 // Supabase regresa máx 1000 filas por request — paginar siempre

function clean(v: unknown) {
  return String(v ?? '').trim()
}

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type VendorAuth =
  | { ok: true; created: boolean }
  | { ok: false; status: number; error: string }

// Verifica NIP del vendedor; si el vendedor no está registrado aún (legacy o
// nuevo), registra su NIP en este momento (allowCreate).
async function authVendor(
  supabase: SupabaseClient,
  vendorName: string,
  pin: string,
  allowCreate: boolean
): Promise<VendorAuth> {
  if (!vendorName) return { ok: false, status: 400, error: 'Falta el nombre del vendedor.' }
  if (!/^\d{4}$/.test(pin)) return { ok: false, status: 400, error: 'El NIP debe ser de 4 dígitos.' }

  const { data: vendor, error } = await supabase
    .from('insurance_vendors')
    .select('id, pin')
    .eq('client_id', ENLACE_CLIENT_ID)
    .eq('name', vendorName)
    .maybeSingle()
  if (error) {
    console.error('[enlace-top-clientes/portal] vendor fetch error:', error)
    return { ok: false, status: 500, error: 'Error al verificar. Intenta de nuevo.' }
  }

  if (!vendor) {
    if (!allowCreate) return { ok: false, status: 401, error: 'Vendedor no registrado. Entra de nuevo desde la página principal.' }
    const { error: insErr } = await supabase
      .from('insurance_vendors')
      .insert({ client_id: ENLACE_CLIENT_ID, name: vendorName, pin })
    if (insErr) {
      console.error('[enlace-top-clientes/portal] vendor insert error:', insErr)
      return { ok: false, status: 500, error: 'Error al registrar tu NIP. Intenta de nuevo.' }
    }
    return { ok: true, created: true }
  }

  if (vendor.pin !== pin) return { ok: false, status: 401, error: 'NIP incorrecto.' }
  return { ok: true, created: false }
}

// Mapea fila de BD → llaves que usa el formulario
function toUi(r: Record<string, unknown>) {
  return {
    id: r.id,
    nombre: r.client_name ?? '',
    telefono: r.phone ?? '',
    email: r.email ?? '',
    ciudad: r.city ?? '',
    estado: r.state ?? '',
    cp: r.postal_code ?? '',
    genero: r.gender ?? '',
    nacimiento: r.birth_date_or_age ?? '',
    color: r.color ?? '',
    ocupacion: r.occupation_type ?? '',
    profesion: r.profession ?? '',
    ingreso: r.income ?? '',
    dependientes: r.dependents ?? '',
    nota: r.relevant_note ?? '',
    productos: r.products ?? '',
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const vendorName = clean(body.vendedor)
    const pin = clean(body.pin)

    const supabase = sb()
    const auth = await authVendor(supabase, vendorName, pin, true)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Clientes guardados de este vendedor (paginado)
    const clients: Record<string, unknown>[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('insurance_vendor_top_clients')
        .select('*')
        .eq('client_id', ENLACE_CLIENT_ID)
        .eq('vendor_name', vendorName)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[enlace-top-clientes/portal] clients fetch error:', error)
        return NextResponse.json({ error: 'Error al cargar tus clientes.' }, { status: 500 })
      }
      clients.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }

    return NextResponse.json({ ok: true, pinCreated: auth.created, clientes: clients.map(toUi) })
  } catch (err: unknown) {
    console.error('[enlace-top-clientes/portal] POST error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const vendorName = clean(body.vendedor)
    const pin = clean(body.pin)
    const id = clean(body.id)
    const c = (body.cliente ?? {}) as Record<string, unknown>

    if (!id) return NextResponse.json({ error: 'Falta el cliente a actualizar.' }, { status: 400 })

    const supabase = sb()
    const auth = await authVendor(supabase, vendorName, pin, false)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const update = {
      client_name: clean(c.nombre),
      phone: clean(c.telefono),
      email: clean(c.email).toLowerCase(),
      city: clean(c.ciudad) || null,
      state: clean(c.estado) || null,
      postal_code: clean(c.cp) || null,
      gender: clean(c.genero) || null,
      birth_date_or_age: clean(c.nacimiento) || null,
      color: clean(c.color) || null,
      occupation_type: clean(c.ocupacion) || null,
      profession: clean(c.profesion) || null,
      income: clean(c.ingreso) || null,
      dependents: clean(c.dependientes) || null,
      relevant_note: clean(c.nota) || null,
      products: clean(c.productos) || null,
    }
    if (!update.client_name || !update.phone || !update.email) {
      return NextResponse.json(
        { error: 'Nombre, teléfono y email no pueden quedar vacíos.' },
        { status: 400 }
      )
    }

    // Solo puede tocar filas suyas (mismo client_id + vendor_name)
    const { data: updated, error } = await supabase
      .from('insurance_vendor_top_clients')
      .update(update)
      .eq('id', id)
      .eq('client_id', ENLACE_CLIENT_ID)
      .eq('vendor_name', vendorName)
      .select('id')
    if (error) {
      console.error('[enlace-top-clientes/portal] update error:', error)
      return NextResponse.json({ error: 'Error al guardar cambios.' }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Cliente no encontrado.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[enlace-top-clientes/portal] PATCH error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
