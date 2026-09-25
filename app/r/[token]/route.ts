// FishFlow — Módulo Reputación · el link que sí se puede medir
// ─────────────────────────────────────────────────────────────────────────────
// El mensaje de WhatsApp llevaba el link DIRECTO a
// `search.google.com/local/writereview`: la persona salía de WhatsApp a Google
// sin pasar por nosotros, así que el clic era invisible y la única señal era
// que el vendedor se acordara de marcar "dejó review" en el panel — después de
// haber cobrado y despedido al cliente. No pasaba.
//
// El canal QR ya lo resolvía (`review_responses.google_cta_clicked`, porque ahí
// la persona aterriza en `/o/[slug]`). Esto le da lo mismo a la cola de
// WhatsApp: un 302 inmediato, sin página intermedia ni botón. La experiencia
// del cliente es idéntica — toca el link y aparece Google.
//
// Excepción iPhone/iPad (25-sep-2026): iOS solo abre la app de Google Maps
// cuando la persona TOCA un enlace de Google; un redirect automático se queda
// en Safari, donde casi nadie tiene la sesión de Google iniciada y la reseña
// se atora (Irazú y Martha le dieron 2 y 3 clics). En iOS se sirve una página
// mínima con la marca del cliente y un botón que va directo al link de Google.
// El clic se registra igual al cargar la página.
//
// ⚠️ Un clic NO es una reseña. Marca `clicked_google_at`, que significa "llegó
//    al formulario". El estado `completed` lo sigue poniendo una persona: si el
//    clic lo marcara solo, el tablero contaría como reseñas a quienes abrieron
//    Google y se arrepintieron, y ese número dejaría de servir para nada.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEMO = "demo";
const ENLACE_CLIENT_ID = "e8094119-0414-4d46-8506-6ee1a52e852c";

function aGoogle(url: string) {
  const res = NextResponse.redirect(url, 302);
  // Sin caché: un 302 guardado por un proxy nos dejaría ciegos otra vez, y peor,
  // creyendo que medimos.
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/** Un token que no resuelve responde igual en todos los casos: no confirma nada. */
function noDisponible() {
  return NextResponse.json({ error: "Link no disponible" }, { status: 404 });
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function esIOS(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  return /iPhone|iPad|iPod/i.test(ua);
}

/** Página de un botón para iOS: el toque del usuario es lo que abre la app de Maps. */
function paginaBoton(url: string, negocio: string, color: string, logo: string | null) {
  const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#1a73e8";
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deja tu opinión · ${esc(negocio)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,system-ui,sans-serif;background:#f6f7f9;color:#1f2933}
  .card{max-width:360px;width:calc(100% - 32px);background:#fff;border-radius:18px;
        padding:32px 24px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
  img{max-width:120px;max-height:72px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:15px;line-height:1.45;color:#52606d;margin:0 0 24px}
  a.btn{display:block;background:${c};color:#fff;text-decoration:none;font-weight:600;
        font-size:17px;padding:16px;border-radius:12px}
  small{display:block;margin-top:16px;font-size:12.5px;color:#7b8794;line-height:1.4}
</style></head><body><div class="card">
  ${logo ? `<img src="${esc(logo)}" alt="${esc(negocio)}">` : ""}
  <h1>Gracias por tu tiempo</h1>
  <p>Tu opinión de ${esc(negocio)} en Google nos ayuda muchísimo. Te toma un minuto.</p>
  <a class="btn" href="${esc(url)}">Abrir Google Maps y dejar mi opinión</a>
  <small>Si se abre en el navegador, inicia sesión con tu cuenta de Google para poder publicarla.</small>
</div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(
  req0: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Demo para enseñar la experiencia. No registra nada.
  if (token === DEMO) {
    const { data } = await db.from("review_settings")
      .select("review_link").eq("client_id", ENLACE_CLIENT_ID).maybeSingle();
    return data?.review_link ? aGoogle(data.review_link) : noDisponible();
  }

  if (!UUID.test(token)) return noDisponible();

  const { data: req, error } = await db
    .from("review_requests")
    .select("id, client_id, clicked_google_at, click_count")
    .eq("id", token)
    .maybeSingle();

  if (error || !req) return noDisponible();

  const { data: cfg } = await db
    .from("review_settings")
    .select("review_link, business_display_name, brand_color, logo_url")
    .eq("client_id", req.client_id)
    .maybeSingle();

  if (!cfg?.review_link) return noDisponible();

  // El registro no debe poder tumbar el redirect: si esto falla, la persona
  // igual llega a Google. Perder un dato es barato; perder una reseña no.
  try {
    await db.from("review_requests").update({
      clicked_google_at: req.clicked_google_at ?? new Date().toISOString(),
      click_count: (req.click_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq("id", req.id);
  } catch (e) {
    console.error("[r/token] no se pudo registrar el clic:", e);
  }

  if (esIOS(req0)) {
    return paginaBoton(
      cfg.review_link,
      cfg.business_display_name ?? "nuestro negocio",
      cfg.brand_color ?? "",
      cfg.logo_url ?? null,
    );
  }
  return aGoogle(cfg.review_link);
}
