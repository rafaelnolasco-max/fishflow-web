import { createClient } from '@supabase/supabase-js'

// Admin client — bypasses RLS, server-side only
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type ClientRecord = {
  id: string
  name: string
  gateway_primary: 'mercadopago' | 'conekta' | 'clip' | 'stripe'
  gateway_fallback: 'mercadopago' | 'conekta' | 'clip' | 'stripe' | null
  vertical: string | null
  connection_type: 'widget' | 'api'
  rfc: string | null
  razon_social: string | null
  regimen_fiscal: string | null
  email_factura: string | null
  cp: string | null
  factura_auto: boolean
  active: boolean
}

/**
 * Validates an API key and returns the client record if active.
 * Returns null if the key is invalid or the client is inactive.
 */
export async function getClientByApiKey(apiKey: string): Promise<ClientRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('api_key', apiKey)
    .eq('active', true)
    .single()

  if (error || !data) return null
  return data as ClientRecord
}

/**
 * Extracts the Bearer token from an Authorization header.
 * Returns null if the header is missing or malformed.
 */
export function extractApiKey(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}
