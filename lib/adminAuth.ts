// Candado de /admin para rutas de API y páginas de servidor.
// El middleware ya bloquea /admin/*, pero las rutas /api/admin/* no pasan por
// él: cada una debe llamar a isAdmin() antes de tocar datos con service role.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const ADMIN_EMAIL = "rafaelnolasco@gmail.com";

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && user.email === ADMIN_EMAIL;
}
