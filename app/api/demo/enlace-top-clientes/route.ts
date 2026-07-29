import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'

// Captura del Top 20 clientes por vendedor de Enlace Integral Seguros
// (/demos/enlaceintegral/top-clientes). Guarda cada cliente en
// insurance_vendor_top_clients con service role — nunca toca git, nunca es público.
// El aviso por correo NO va aquí: se manda agrupado en /api/cron/enlace-digest.
// Techo de seguridad por envío (no es una meta — un vendedor puede mandar más de 20
// en varios envíos). Solo evita que un bug o reintento infle miles de filas de golpe.
const MAX_CLIENTS_PER_REQUEST = 50

type ClienteInput = {
  nombre?: string
  telefono?: string
  email?: string
  ciudad?: string
  estado?: string
  cp?: string
  genero?: string
  nacimiento?: string
  // Campos Avatar CRM (HubSpot) — opcionales
  color?: string
  ocupacion?: string
  profesion?: string
  ingreso?: string
  dependientes?: string
  nota?: string
  productos?: string
}

function clean(v: unknown) {
  return String(v ?? '').trim()
}

// El nombre del vendedor llega tecleado por él en el portal, así que varía en
// capitalización y espacios ("edna cruz" vs "Edna Cruz"). Antes eso rompía el
// dedupe: cada variante contaba como una vendedora distinta y el mismo cliente
// entraba dos veces. Ahora se compara sin distinguir mayúsculas y se guarda
// siempre el nombre canónico de `insurance_vendors`.
function cleanName(v: unknown) {
  return clean(v).replace(/\s+/g, ' ')
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const vendorInput = cleanName(body.vendedor)
    let vendorName = vendorInput
    const pin = clean(body.pin)
    const clientesRaw: ClienteInput[] = Array.isArray(body.clientes) ? body.clientes : []

    if (!vendorName) {
      return NextResponse.json({ error: 'Falta el nombre del vendedor.' }, { status: 400 })
    }

    // Solo filas con los 3 campos obligatorios completos.
    // `vendor_name` se rellena más abajo con el nombre canónico del vendedor.
    let rows = clientesRaw
      .slice(0, MAX_CLIENTS_PER_REQUEST)
      .map((c) => ({
        client_id: ENLACE_CLIENT_ID,
        vendor_name: '',
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
        source: 'web_form' as const,
      }))
      .filter((r) => r.client_name && r.phone && r.email)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No hay clientes con nombre, teléfono y email completos.' },
        { status: 400 }
      )
    }

    // Dedupe dentro del mismo envío (mismo teléfono o email repetido en el lote)
    const seen = new Set<string>()
    rows = rows.filter((r) => {
      const key = `${r.phone}|${r.email}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verificación de NIP — el portal registra al vendedor al entrar, así que
    // aquí el registro ya debe existir y el NIP debe coincidir.
    // `ilike` sin comodines = igualdad sin distinguir mayúsculas.
    const { data: vendor, error: vendorErr } = await supabase
      .from('insurance_vendors')
      .select('name, pin')
      .eq('client_id', ENLACE_CLIENT_ID)
      .ilike('name', vendorInput)
      .maybeSingle()
    if (vendorErr) {
      console.error('[demo/enlace-top-clientes] vendor fetch error:', vendorErr)
      return NextResponse.json({ error: 'Error al verificar. Intenta de nuevo.' }, { status: 500 })
    }
    if (!vendor || vendor.pin !== pin) {
      return NextResponse.json(
        { error: 'NIP incorrecto. Entra de nuevo desde la página principal.' },
        { status: 401 }
      )
    }

    // Nombre canónico: así "edna cruz" y "Edna Cruz" quedan como una sola vendedora
    vendorName = cleanName(vendor.name) || vendorInput
    rows = rows.map((r) => ({ ...r, vendor_name: vendorName }))

    // Dedupe contra lo ya guardado de este vendedor (mismo teléfono o email ya registrado)
    const { data: existing, error: fetchErr } = await supabase
      .from('insurance_vendor_top_clients')
      .select('phone, email')
      .eq('client_id', ENLACE_CLIENT_ID)
      .ilike('vendor_name', vendorName)
    if (fetchErr) {
      console.error('[demo/enlace-top-clientes] Supabase fetch error:', fetchErr)
      return NextResponse.json({ error: 'Error al guardar. Intenta de nuevo.' }, { status: 500 })
    }
    const existingKeys = new Set(
      (existing ?? []).flatMap((e) => [e.phone, e.email].filter(Boolean))
    )
    const newRows = rows.filter((r) => !existingKeys.has(r.phone) && !existingKeys.has(r.email))
    const duplicates = rows.length - newRows.length

    if (newRows.length === 0) {
      return NextResponse.json(
        { error: 'Estos clientes ya estaban guardados para este vendedor.' },
        { status: 400 }
      )
    }

    const { error } = await supabase.from('insurance_vendor_top_clients').insert(newRows)
    if (error) {
      console.error('[demo/enlace-top-clientes] Supabase insert error:', error)
      return NextResponse.json({ error: 'Error al guardar. Intenta de nuevo.' }, { status: 500 })
    }

    // Sin aviso por captura: las vendedoras capturan cliente por cliente y eso
    // generaba cientos de correos al día (89 el 16-jul, 81 el 17-jul).
    // El resumen del día lo manda /api/cron/enlace-digest.

    return NextResponse.json({ ok: true, saved: newRows.length, duplicates })
  } catch (err: unknown) {
    console.error('[demo/enlace-top-clientes] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
