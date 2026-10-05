// app/api/invoices/[id]/cancel/route.ts
// Cancelación de un CFDI ante el SAT (vía Facturapi). Exige acceso al emisor.
// Body: { motivo: '01'|'02'|'03'|'04', sustitucion_uuid?: string }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireClientAccess } from '@/lib/apiAuth'
import { cancelarCfdi, type MotivoCancelacion } from '@/lib/cfdi'

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: inv } = await sb
    .from('invoices')
    .select('id, invoice_orgs:emisor_org_id(client_id)')
    .eq('id', id)
    .maybeSingle()
  const emisorClientId = (inv?.invoice_orgs as { client_id?: string } | null)?.client_id
  if (!emisorClientId) return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })

  const auth = await requireClientAccess(emisorClientId)
  if (!auth.ok) return auth.response

  const { motivo, sustitucion_uuid } = await req.json().catch(() => ({}))
  const r = await cancelarCfdi(id, motivo as MotivoCancelacion, sustitucion_uuid ?? null)
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status })
}
