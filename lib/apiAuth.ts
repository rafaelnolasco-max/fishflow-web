// FishFlow — apiAuth
// ─────────────────────────────────────────────────────────────────────────────
// Candado compartido para rutas de API que manejan datos de un cliente.
// Patrón: sesión por cookie (el mismo login del panel) + acceso al cliente via
// `user_client_access`. Rafa (ADMIN_EMAIL) siempre pasa.
//
// Uso en una ruta:
//   const auth = await requireClientAccess(patient.client_id);
//   if (!auth.ok) return auth.response;
//
// Server-to-server: si una ruta llama a otra con fetch, hay que reenviar el
// header `cookie` de la petición original (ver forwardCookies).

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "rafaelnolasco@gmail.com";

export type AuthOk = { ok: true; email: string; isAdmin: boolean };
export type AuthFail = { ok: false; response: NextResponse };
export type AuthResult = AuthOk | AuthFail;

function deny(status: number, error: string): AuthFail {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Exige sesión válida y acceso al cliente indicado. Fail closed: cualquier
 * error de verificación niega el paso.
 */
export async function requireClientAccess(clientId: string): Promise<AuthResult> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return deny(401, "No autorizado");
  if (user.email === ADMIN_EMAIL) return { ok: true, email: user.email, isAdmin: true };

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: access, error } = await supabaseAdmin
    .from("user_client_access")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !access) return deny(403, "Sin acceso a este cliente");

  return { ok: true, email: user.email ?? "", isAdmin: false };
}

/** Header `cookie` de la petición entrante, para reenviar la sesión a otra ruta. */
export function forwardCookies(req: NextRequest): Record<string, string> {
  const cookie = req.headers.get("cookie");
  return cookie ? { cookie } : {};
}
