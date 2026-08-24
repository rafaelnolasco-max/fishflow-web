// lib/reviewVendors.ts
// ─────────────────────────────────────────────────────────────────────────────
// Vendedora del Módulo Reputación identificada por su token.
//
// La página /resenas/[token] es PÚBLICA y sin login: el token es la credencial.
// Esta resolución vivía dentro de /api/reviews/vendor/[token]; se sacó aquí
// cuando /api/reviews/draft tuvo que aceptar la misma credencial, para que las
// dos rutas validen igual y no se separen con el tiempo.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

/** Lazy init: instanciar a nivel de módulo con envs faltantes tumba `next build`. */
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

export type ReviewVendor = { id: string; client_id: string; name: string };

/** La vendedora activa dueña del token, o null. Fail closed ante cualquier error. */
export async function vendorPorToken(token: string): Promise<ReviewVendor | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await admin()
    .from("review_vendors")
    .select("id, client_id, name")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("[reviewVendors] lookup:", error);
    return null;
  }
  return (data as ReviewVendor | null) ?? null;
}
