// FishFlow — Telemática: candado de acceso para las rutas del módulo Recorridos.
// Un cliente de Lukon es una fila en `clients` con parent_client_id = Lukon.
// Pasa quien tenga acceso al cliente o a su padre (mismo criterio que la
// función SQL user_has_access_to_client tras la migración 20261009180000).

import { createClient } from "@supabase/supabase-js";
import { requireClientAccess, type AuthResult } from "@/lib/apiAuth";

export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function requireFleetAccess(clientId: string): Promise<AuthResult & { parentId?: string | null }> {
  const direct = await requireClientAccess(clientId);
  if (direct.ok) return direct;
  if (direct.response.status === 401) return direct;

  const { data: c, error } = await supabaseAdmin()
    .from("clients").select("parent_client_id").eq("id", clientId).maybeSingle();
  if (error || !c?.parent_client_id) return direct;
  const viaParent = await requireClientAccess(c.parent_client_id);
  return viaParent.ok ? { ...viaParent, parentId: c.parent_client_id } : direct;
}
