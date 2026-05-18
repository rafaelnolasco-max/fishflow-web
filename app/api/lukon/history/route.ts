import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const LUKON_CLIENT_ID = '1aa4a82b-e524-40f4-808e-c02e87e82427'
const ALLOWED_EMAILS  = ['rafaelnolasco@gmail.com', 'aalmarazmo@lukon.com.mx']

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    // ── Verificar sesión ───────────────────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !ALLOWED_EMAILS.includes(user.email ?? '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── Obtener transacciones recientes ────────────────────────────────────────
    const { data: transactions } = await supabaseAdmin
      .from('pos_transactions')
      .select('id, amount, currency, status, service, provider, external_id, metadata, created_at')
      .eq('client_id', LUKON_CLIENT_ID)
      .order('created_at', { ascending: false })
      .limit(50)

    // ── Obtener facturas recientes ─────────────────────────────────────────────
    const { data: invoices } = await supabaseAdmin
      .from('invoices')
      .select('id, facturapi_id, uuid_sat, status, amount, currency, pdf_url, xml_url, created_at')
      .eq('client_id', LUKON_CLIENT_ID)
      .order('created_at', { ascending: false })
      .limit(50)

    return NextResponse.json({
      transactions: transactions ?? [],
      invoices:     invoices     ?? [],
    })

  } catch (err) {
    console.error('[lukon/history] error:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
