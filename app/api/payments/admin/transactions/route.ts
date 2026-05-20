import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const ADMIN_EMAIL = 'rafaelnolasco@gmail.com'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  try {
    // ── Verificar sesión de Rafa ──────────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // ── Fetch con service role (bypasa RLS → join con clients funciona) ────────
    // Solo cobros generados desde el admin de FishFlow — excluye transacciones del POS de clientes
    const { data, error } = await supabaseAdmin
      .from('pos_transactions')
      .select('id, client_id, service, amount, currency, status, provider, metadata, created_at, clients(name)')
      .eq('metadata->>created_from', 'admin_panel')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[admin/transactions] error:', error)
      return NextResponse.json({ error: 'Error al obtener transacciones' }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err) {
    console.error('[admin/transactions] unexpected:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
