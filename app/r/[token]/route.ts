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
    .select("review_link")
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

  return aGoogle(cfg.review_link);
}
