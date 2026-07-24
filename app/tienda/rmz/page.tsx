// app/tienda/rmz/page.tsx
// Tienda pública de Cocinas y Closets RMZ — catálogo desde Supabase.
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { RMZ_CLIENT_ID } from '@/lib/storeRmz'
import StoreClient, { type StoreProduct } from './StoreClient'

export const metadata: Metadata = {
  title: 'RMZ — Muebles listos, cocinas y closets a la medida',
  description:
    'RMZ: muebles prefabricados de fábrica (alacenas, burós, zapateras, coffee stations) entregados armados a domicilio. También cocinas y closets a la medida.',
}

export const revalidate = 60 // catálogo se refresca cada minuto

export default async function TiendaRmzPage() {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: products, error } = await supabaseAdmin
    .from('store_products')
    .select('id, category, name, dimensions, price, colors, photo_url')
    .eq('client_id', RMZ_CLIENT_ID)
    .eq('active', true)
    .order('sort_order', { ascending: true })

  if (error) console.error('[tienda/rmz] products:', error)

  return <StoreClient products={(products ?? []) as StoreProduct[]} />
}
