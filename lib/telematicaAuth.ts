// FishFlow — Telemática: candado de acceso para las rutas del módulo Recorridos.
// Un cliente de Lukon es una fila en `clients` con parent_client_id = Lukon.
// Pasa quien tenga acceso al cliente o a su padre (mismo criterio que la
// función SQL user_has_access_to_client tras la migración 20261009180000).
// Con { allowPin: true } (solo rutas de LECTURA) también pasa la vista por NIP
// de /flotilla/<slug> de esa misma flotilla — ver lib/pinAccess.ts.

import { createClient } from "@supabase/supabase-js";
import { requireClientAccess, type AuthResult } from "@/lib/apiAuth";
import { pinSessionForClient } from "@/lib/pinAccess";

export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function requireFleetAccess(
  clientId: string,
  opts: { allowPin?: boolean } = {},
): Promise<AuthResult & { parentId?: string | null }> {
  const viaSession = await sessionAccess(clientId);
  if (viaSession.ok || !opts.allowPin) return viaSession;

  const pin = await pinSessionForClient(clientId);
  return pin ? { ok: true, email: `nip:${pin.slug}`, isAdmin: false } : viaSession;
}

async function sessionAccess(clientId: string): Promise<AuthResult & { parentId?: string | null }> {
  const direct = await requireClientAccess(clientId);
  if (direct.ok) return direct;
  if (direct.response.status === 401) return direct;

  const { data: c, error } = await supabaseAdmin()
    .from("clients").select("parent_client_id").eq("id", clientId).maybeSingle();
  if (error || !c?.parent_client_id) return direct;
  const viaParent = await requireClientAccess(c.parent_client_id);
  return viaParent.ok ? { ...viaParent, parentId: c.parent_client_id } : direct;
}
