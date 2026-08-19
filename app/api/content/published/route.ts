// app/api/content/published/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Historial: lo que YA se publicó, con sus números.
//
// La pantalla nunca habla con Blotato: lee de content_published_posts, que es
// donde lib/publishedSync dejó cada publicación ya atribuida a su cliente. Eso
// hace dos cosas a la vez — el historial se pinta aunque Blotato esté caído, y
// el filtro por cliente no depende de un dato que la API de Blotato no da.
//
// GET ?clientId=…[&sync=1] → publicaciones del cliente, de la más nueva a la
// más vieja, con la última medición que Blotato haya tomado.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import { blotatoConfigured } from "@/lib/blotato";
import { syncPublished } from "@/lib/publishedSync";

export const runtime = "nodejs";
// La primera corrida barre un año de historial y pide analíticas de una en una.
export const maxDuration = 120;

/**
 * Las métricas que sí le decimos algo a la clienta.
 *
 * Blotato devuelve más de 60 campos y cada red llena unos cuantos. Pintar 60
 * cajas —la mayoría vacías o en cero— no es un tablero, es un volcado. Aquí se
 * escogen las que un dueño de negocio entiende sin explicación, y la pantalla
 * solo dibuja las que realmente vinieron con dato.
 */
const METRICAS = [
  { key: "viewsCount",    label: "Vistas" },
  { key: "reachCount",    label: "Alcance" },
  { key: "likesCount",    label: "Me gusta" },
  { key: "commentsCount", label: "Comentarios" },
  { key: "sharesCount",   label: "Compartidos" },
  { key: "savesCount",    label: "Guardados" },
] as const;

/**
 * Blotato manda los contadores como STRING (pueden pasarse de la precisión de
 * un número de JavaScript). Se convierten aquí, y lo que no sea un número
 * limpio se descarta en lugar de pintarse como NaN.
 */
function leerMetricas(raw: unknown): { key: string; label: string; value: number }[] {
  if (!raw || typeof raw !== "object") return [];
  const m = raw as Record<string, unknown>;
  return METRICAS.flatMap(({ key, label }) => {
    const bruto = m[key];
    if (bruto === null || bruto === undefined) return [];
    const n = Number(bruto);
    if (!Number.isFinite(n)) return [];
    return [{ key, label, value: n }];
  });
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) return NextResponse.json({ error: "Falta el cliente." }, { status: 400 });

  const auth = await requireClientAccess(clientId);
  if (!auth.ok) return auth.response;

  // El sincronizador se auto-limita (una corrida cada 20 min): llamarlo en cada
  // carga no significa salir a Blotato en cada carga. `sync=1` lo fuerza, para
  // el botón de "Actualizar" de la pantalla.
  const forzar = req.nextUrl.searchParams.get("sync") === "1";
  const sync = await syncPublished({ forzar });

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await db
    .from("content_published_posts")
    .select(
      "blotato_post_id, platform, target_label, post_url, post_text, media_urls, published_at, metrics, metrics_fetched_at",
    )
    .eq("client_id", clientId)
    .order("published_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[content/published] lectura:", error);
    return NextResponse.json(
      { error: "No se pudo leer tu historial de publicaciones." },
      { status: 500 },
    );
  }

  const posts = (data ?? []).map((r) => ({
    id: r.blotato_post_id as string,
    platform: r.platform as string,
    targetLabel: (r.target_label as string | null) ?? null,
    postUrl: (r.post_url as string | null) ?? null,
    text: (r.post_text as string) ?? "",
    mediaUrls: (r.media_urls as string[] | null) ?? [],
    publishedAt: r.published_at as string,
    metrics: leerMetricas(r.metrics),
    // Sin esta fecha el número miente: no es "ahora", es la última foto que
    // Blotato tomó, y en el plan Starter la última es la del día 7.
    metricsFetchedAt: (r.metrics_fetched_at as string | null) ?? null,
  }));

  return NextResponse.json({
    ok: true,
    configured: blotatoConfigured(),
    posts,
    // Solo informativo: si la sincronización falló, el historial guardado se
    // sigue mostrando. No se convierte en un error de pantalla.
    syncError: sync.ok ? null : sync.error ?? null,
  });
}
