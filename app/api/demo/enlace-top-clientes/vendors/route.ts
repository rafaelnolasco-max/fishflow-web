import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lista de vendedores para la pantalla de entrada del portal Top Clientes.
// Une los vendedores registrados (insurance_vendors, con NIP) con los nombres
// que ya guardaron clientes antes de existir el registro (legacy, sin NIP).
// Solo expone nombres — nunca PII de clientes ni NIPs.

const PAGE = 1000 // Supabase regresa máx 1000 filas por request — paginar siempre

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: registered, error: vErr } = await supabase
      .from('insurance_vendors')
      .select('name')
      .eq('client_id', ENLACE_CLIENT_ID)
    if (vErr) {
      console.error('[enlace-top-clientes/vendors] vendors error:', vErr)
      return NextResponse.json({ error: 'Error al cargar vendedores.' }, { status: 500 })
    }

    // Nombres legacy desde los clientes ya guardados (paginado)
    const legacyNames = new Set<string>()
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('insurance_vendor_top_clients')
        .select('vendor_name')
        .eq('client_id', ENLACE_CLIENT_ID)
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[enlace-top-clientes/vendors] legacy error:', error)
        return NextResponse.json({ error: 'Error al cargar vendedores.' }, { status: 500 })
      }
      for (const r of data ?? []) {
        if (r.vendor_name) legacyNames.add(r.vendor_name.trim())
      }
      if (!data || data.length < PAGE) break
    }

    const withPin = new Set((registered ?? []).map((v) => v.name))
    const all = new Set<string>([...withPin, ...legacyNames])
    const vendors = [...all]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((name) => ({ name, hasPin: withPin.has(name) }))

    return NextResponse.json({ vendors })
  } catch (err: unknown) {
    console.error('[enlace-top-clientes/vendors] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
