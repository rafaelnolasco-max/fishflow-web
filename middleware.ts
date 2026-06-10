import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ─── Email del administrador (solo Rafa puede entrar a /admin) ────────────────
const ADMIN_EMAIL = "rafaelnolasco@gmail.com";

// ─── Acceso por cliente: tabla user_client_access en Supabase ─────────────────
// El acceso a /app/[slug] se valida con la función user_has_access_to_slug()
// (SECURITY DEFINER, consulta user_client_access + clients.slug).
// Onboarding de cliente nuevo = 2 inserts en Supabase, sin tocar este archivo.

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refrescar sesión — IMPORTANTE: no remover esta línea
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── /admin → solo rafaelnolasco@gmail.com ───────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (user.email !== ADMIN_EMAIL) {
      // Usuario autenticado pero no es Rafa → a la landing
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // ── /app/* → usuario autenticado + restricción por ruta ─────────────────────
  if (pathname.startsWith("/app/")) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // Verificar acceso por cliente via user_client_access (Rafa siempre pasa)
    if (user.email !== ADMIN_EMAIL) {
      const slug = pathname.split("/")[2] ?? "";
      const { data: hasAccess, error } = await supabase.rpc(
        "user_has_access_to_slug",
        { p_slug: slug }
      );
      if (error || !hasAccess) {
        // Sin acceso (o error en la verificación → fail closed) → landing
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/app/:path*",
  ],
};
