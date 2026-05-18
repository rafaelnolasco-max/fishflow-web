import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ─── Mapa slug → client_id ────────────────────────────────────────────────────
// TODO: migrar a columna `slug` en la tabla `clients`
const SLUG_MAP: Record<string, string> = {
  'belange': '33933663-79d2-4caa-86fe-7ea046082b7f',
  'lukon':   '1aa4a82b-e524-40f4-808e-c02e87e82427',
  // TBA: agregar cuando Rafa registre el client_id en Supabase
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')

  if (!slug) {
    return NextResponse.json({ error: 'slug es requerido' }, { status: 400 })
  }

  const clientId = SLUG_MAP[slug.toLowerCase()]
  if (!clientId) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
  }

  // ── Traer info del cliente ────────────────────────────────────────────────
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
  }

  // ── Traer transacciones pendientes del cliente ────────────────────────────
  const { data: transactions } = await supabaseAdmin
    .from('pos_transactions')
    .select('id, service, amount, currency, status, provider, metadata, created_at')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return NextResponse.json({
    client: { id: client.id, name: client.name, slug },
    transactions: (transactions ?? []).map(tx => ({
      id:          tx.id,
      service:     tx.service ?? tx.metadata?.description ?? 'Pago FishFlow',
      amount:      tx.amount,
      currency:    tx.currency ?? 'MXN',
      payment_url: tx.metadata?.payment_url ?? null,
      created_at:  tx.created_at,
    })),
  })
}
