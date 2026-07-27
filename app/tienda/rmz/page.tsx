// app/tienda/rmz/page.tsx
// Tienda pública de Cocinas y Closets RMZ — catálogo desde Supabase.
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { RMZ_CLIENT_ID } from '@/lib/storeRmz'
import StoreClient, { type StoreProduct } from './StoreClient'

export const metadata: Metadata = {
  title: 'Vallejo Tableros & Herrajes — Muebles listos, entregados armados',
  description:
    'Línea Cocinas y Closets RMZ de Vallejo Tableros & Herrajes: alacenas, burós, zapateras y coffee stations entregados armados a domicilio. También cocinas y closets a la medida.',
  // Favicon de la marca del cliente, no el de FishFlow (estándar de landings)
  icons: {
    icon: [{ url: '/rmz/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/rmz/apple-touch-icon.png' }],
  },
  openGraph: {
    title: 'Vallejo Tableros & Herrajes — Muebles listos, entregados armados',
    description: 'Línea Cocinas y Closets RMZ. Elige modelo y color, paga en línea y te lo llevamos montado.',
    images: ['/rmz/logo.png'],
  },
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
