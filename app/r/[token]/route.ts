// FishFlow — Módulo Reputación · el link que sí se puede medir
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ PRUEBA DE CONCEPTO. Todavía NO escribe nada: solo redirige. Es para que
// Rafa sienta la experiencia en el teléfono antes de construir el resto.
//
// El problema que resuelve: hoy el mensaje de WhatsApp lleva el link DIRECTO a
// `search.google.com/local/writereview`. La persona sale de WhatsApp a Google
// sin pasar por nosotros, así que ese clic es invisible y la única señal que
// queda es que el vendedor se acuerde de marcar "dejó review" en el panel
// después de haber cobrado y despedido al cliente. No pasa.
//
// El canal QR ya resuelve esto: ahí la persona aterriza en `/o/[slug]` y por eso
// existe `review_responses.google_cta_clicked`. Esta ruta le da a la cola de
// WhatsApp el mismo tratamiento, sin cambiarle la experiencia a nadie: es un
// 302 inmediato, no una página con un botón. Un tap de más cuesta conversión.
//
// Lo que falta para que quede completo (fase 2):
//   • columna `clicked_google_at` en `review_requests`
//   • token = el id del request; hoy solo responde a `demo`
//   • que `ReviewsTab` arme el mensaje con esta ruta en vez del link de Google

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO = "demo";
const ENLACE_CLIENT_ID = "e8094119-0414-4d46-8506-6ee1a52e852c";

function aGoogle(url: string) {
  const res = NextResponse.redirect(url, 302);
  // Sin caché: si un proxy guardara el 302, dejaríamos de ver los clics.
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Demo: el link real de Enlace, sin registrar nada.
  if (token === DEMO) {
    const { data } = await db
      .from("review_settings")
      .select("review_link")
      .eq("client_id", ENLACE_CLIENT_ID)
      .maybeSingle();
    if (data?.review_link) return aGoogle(data.review_link);
    return NextResponse.json({ error: "Sin link configurado" }, { status: 404 });
  }

  // Cualquier otro token todavía no existe. Se responde igual para todos los
  // casos: un token que no resuelve no debe decir si existió alguna vez.
  return NextResponse.json({ error: "Link no disponible" }, { status: 404 });
}
