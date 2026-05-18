import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ─── Email del administrador (solo Rafa puede entrar a /admin) ────────────────
const ADMIN_EMAIL = "rafaelnolasco@gmail.com";

// ─── Acceso por ruta de cliente — vacío = cualquier autenticado ───────────────
const CLIENT_EMAILS: Record<string, string[]> = {
  "/app/tba":     ["andres@telecomba.com", "rafaelnolasco@gmail.com", "carlosnolascocas@gmail.com"],
  "/app/belange": [], // cualquier usuario autenticado
  "/app/lukon":   ["rafaelnolasco@gmail.com", "aalmarazmo@lukon.com.mx"],
};

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

    // Verificar restricción de email por ruta de cliente
    const matchedRoute = Object.keys(CLIENT_EMAILS).find(route =>
      pathname.startsWith(route)
    );
    if (matchedRoute) {
      const allowed = CLIENT_EMAILS[matchedRoute];
      if (allowed.length > 0 && !allowed.includes(user.email ?? "")) {
        // Usuario autenticado pero no tiene acceso a este cliente → landing
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
