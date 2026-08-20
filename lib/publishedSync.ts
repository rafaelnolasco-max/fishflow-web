// lib/publishedSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sincroniza el historial de publicaciones de Blotato hacia nuestras tablas y
// le pone dueño a cada una.
//
// SOLO SERVIDOR: importa lib/blotato (que lee BLOTATO_API_KEY) y usa el service
// role de Supabase. Nunca desde un componente con "use client".
//
// EL PROBLEMA QUE RESUELVE
// Blotato es un único espacio de trabajo con las cuentas de todos los clientes
// de FishFlow, y sus endpoints de publicadas no devuelven accountId. Si el
// tablero de Karlita llamara a Blotato y pintara lo que viene, le enseñaría las
// publicaciones de Enlace y las de FishFlow. La atribución tiene que hacerse
// aquí, con lo que sí sabemos.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  blotatoConfigured,
  getPostAnalytics,
  listPublishedPosts,
  type BlotatoPublishedPost,
  type BlotatoSchedule,
} from "@/lib/blotato";
import { parseTargets, type SocialTarget } from "@/lib/socialTargets";

/** Cuánto pasado se le pide a Blotato en una corrida normal. */
const VENTANA_DIAS = 60;

/** La primera corrida barre más atrás, para traer lo que ya existía. */
const BACKFILL_DIAS = 365;

/** Cada cuánto vale la pena volver a salir a Blotato por la lista de posts. */
const REFRESCO_LISTA_MIN = 20;

/**
 * A los 7 días Blotato toma su última medición del plan Starter. Diez días de
 * margen y después el número ya no cambia nunca: seguir preguntando es gastar
 * llamadas para recibir lo mismo.
 */
const DIAS_METRICAS_VIVAS = 10;

/** Cada cuánto se re-consultan las métricas de un post todavía "vivo". */
const REFRESCO_METRICAS_HORAS = 6;

/**
 * Tope de llamadas de analíticas por corrida. Blotato permite 60/min y la
 * función de Vercel tiene su propio reloj: más vale terminar la corrida y
 * seguir en la siguiente que morir a la mitad y no guardar nada.
 */
const MAX_ANALITICAS_POR_CORRIDA = 15;

const SCOPE = "blotato_published";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── Registro de lo programado (vía 3 de atribución) ─────────────────────────

/**
 * Deja constancia de lo que Blotato tiene programado AHORA, con su dueño.
 *
 * Se llama desde GET /api/content/schedule, que ya trae esa lista para pintar
 * el calendario: no cuesta una llamada extra a Blotato.
 *
 * Por qué existe: GET /v2/schedules es el ÚNICO endpoint de Blotato que
 * devuelve accountId, y solo devuelve el futuro. En cuanto la publicación sale
 * al aire, ese dato se pierde para siempre. Esta tabla lo conserva. Sin ella no
 * hay forma de saber que un Instagram publicado es de Karlita y no de FishFlow,
 * porque el URL de un post de Instagram no dice de quién es.
 *
 * Nunca lanza: si falla, el calendario del cliente debe pintarse igual.
 */
export async function recordSchedulesSeen(
  clientId: string,
  schedules: BlotatoSchedule[],
  targetsPorCuenta: Map<string, SocialTarget>,
): Promise<void> {
  if (schedules.length === 0) return;

  const filas = schedules.flatMap((s) => {
    const target = targetsPorCuenta.get(s.draft?.accountId ?? "");
    if (!target) return [];
    return [{
      blotato_schedule_id: s.id,
      client_id: clientId,
      target_key: target.key,
      target_label: target.label,
      platform: target.platform,
      blotato_account_id: target.accountId,
      blotato_media_urls: s.draft?.content?.mediaUrls ?? [],
      post_text: s.draft?.content?.text ?? "",
      scheduled_at: s.scheduledAt,
      last_seen_at: new Date().toISOString(),
    }];
  });

  if (filas.length === 0) return;

  const { error } = await admin()
    .from("content_schedule_watch")
    .upsert(filas, { onConflict: "blotato_schedule_id" });

  if (error) console.error("[publishedSync] watch no guardado:", error.message);
}

// ─── Atribución ───────────────────────────────────────────────────────────────

export type Dueno = {
  clientId: string;
  targetKey: string | null;
  targetLabel: string | null;
  attribution: "facebook_page" | "schedule_row" | "schedule_watch";
};

/**
 * Saca el pageId de un URL de Facebook.
 *
 * Blotato devuelve el post publicado como facebook.com/{pageId}_{postId} — el
 * identificador de la página viene incrustado. Es la atribución más confiable
 * que tenemos porque no depende de que nosotros hayamos visto nada antes.
 *
 * Instagram no tiene equivalente: instagram.com/p/{shortcode} no dice de qué
 * cuenta es. De ahí la tabla content_schedule_watch.
 */
export function pageIdDeUrlFacebook(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /facebook\.com\/(?:[^/]+\/posts\/)?(\d{6,})_\d+/.exec(url);
  return m ? m[1] : null;
}

/** ¿Comparten al menos una imagen? Las URLs de Blotato son únicas por archivo. */
export function compartenMedia(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((url) => set.has(url));
}

export type Candidato = {
  client_id: string;
  target_key: string | null;
  target_label: string | null;
  blotato_media_urls: string[] | null;
  platform: string;
  post_text?: string | null;
  scheduled_at: string;
};

/** Normaliza texto para comparar: Blotato puede devolverlo con otros saltos de línea. */
function normaliza(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, 300);
}

export function buscarEnCandidatos(
  post: BlotatoPublishedPost,
  candidatos: Candidato[],
): Omit<Dueno, "attribution"> | null {
  // 1. Por imagen. Determinista: la URL de Blotato identifica el archivo.
  const porMedia = candidatos.find(
    (c) => c.platform === post.platform && compartenMedia(c.blotato_media_urls ?? [], post.mediaUrls),
  );
  if (porMedia) {
    return {
      clientId: porMedia.client_id,
      targetKey: porMedia.target_key,
      targetLabel: porMedia.target_label,
    };
  }

  // 2. Por texto + hora. Red de seguridad para cuando Blotato rehospeda la
  //    imagen al publicar y la URL deja de coincidir. Se exige que el texto
  //    coincida Y que la hora no se separe más de 20 minutos: cualquiera de las
  //    dos sola daría falsos positivos entre clientes que publican lo mismo.
  const cuando = new Date(post.postTime).getTime();
  const texto = normaliza(post.text);
  if (!texto) return null;

  const porTexto = candidatos.find((c) => {
    if (c.platform !== post.platform) return false;
    if (normaliza(c.post_text ?? "") !== texto) return false;
    return Math.abs(new Date(c.scheduled_at).getTime() - cuando) <= 20 * 60_000;
  });
  if (!porTexto) return null;

  return {
    clientId: porTexto.client_id,
    targetKey: porTexto.target_key,
    targetLabel: porTexto.target_label,
  };
}

// ─── Sincronización ───────────────────────────────────────────────────────────

export type SyncResult = {
  ok: boolean;
  revisados: number;
  nuevos: number;
  atribuidos: number;
  sinAtribuir: number;
  metricas: number;
  error?: string;
};

/** ¿Ya toca salir a Blotato, o lo que tenemos guardado sigue fresco? */
async function tocaCorrer(db: SupabaseClient, forzar: boolean): Promise<boolean> {
  if (forzar) return true;
  const { data } = await db
    .from("content_sync_state")
    .select("last_run_at")
    .eq("scope", SCOPE)
    .maybeSingle();
  if (!data?.last_run_at) return true;
  return Date.now() - new Date(data.last_run_at).getTime() > REFRESCO_LISTA_MIN * 60_000;
}

/**
 * Trae de Blotato lo publicado, le pone dueño y refresca las métricas que ya
 * caducaron.
 *
 * Es idempotente y no lanza: devuelve el resultado con `ok:false` si algo se
 * rompió. El historial que ya está guardado se sigue pudiendo mostrar aunque
 * Blotato esté caído, y eso es justo lo que se busca.
 */
export async function syncPublished(
  opts: { forzar?: boolean } = {},
): Promise<SyncResult> {
  const vacio: SyncResult = {
    ok: true, revisados: 0, nuevos: 0, atribuidos: 0, sinAtribuir: 0, metricas: 0,
  };
  if (!blotatoConfigured()) return { ...vacio, ok: false, error: "Blotato no configurado" };

  const db = admin();
  if (!(await tocaCorrer(db, Boolean(opts.forzar)))) return vacio;

  // El reloj se marca ANTES de trabajar: si esta corrida se cae a la mitad, la
  // siguiente petición no debe reintentar de inmediato y arrastrar el mismo
  // error en cada carga de pantalla.
  await db.from("content_sync_state").upsert(
    { scope: SCOPE, last_run_at: new Date().toISOString(), last_error: null },
    { onConflict: "scope" },
  );

  try {
    const res = await correr(db);
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    console.error("[publishedSync] falló:", msg);
    await db.from("content_sync_state").upsert(
      { scope: SCOPE, last_run_at: new Date().toISOString(), last_error: msg },
      { onConflict: "scope" },
    );
    return { ...vacio, ok: false, error: msg };
  }
}

async function correr(db: SupabaseClient): Promise<SyncResult> {
  // ── Mapa pageId → cliente, desde la configuración de todos los clientes ────
  const { data: settings } = await db
    .from("content_settings")
    .select("client_id, blotato_accounts");

  const porPageId = new Map<string, Dueno>();
  for (const fila of settings ?? []) {
    for (const t of parseTargets(fila.blotato_accounts)) {
      if (t.platform === "facebook" && t.pageId) {
        porPageId.set(t.pageId, {
          clientId: fila.client_id as string,
          targetKey: t.key,
          targetLabel: t.label,
          attribution: "facebook_page",
        });
      }
    }
  }

  // ── ¿Primera corrida? Entonces se barre más atrás ─────────────────────────
  const { count } = await db
    .from("content_published_posts")
    .select("blotato_post_id", { count: "exact", head: true });
  const dias = (count ?? 0) === 0 ? BACKFILL_DIAS : VENTANA_DIAS;
  const since = new Date(Date.now() - dias * 24 * 60 * 60_000).toISOString();

  const posts = await listPublishedPosts({ since });

  // ── Candidatos para las vías 2 y 3 ────────────────────────────────────────
  const [{ data: filasProgramadas }, { data: filasWatch }] = await Promise.all([
    db
      .from("content_schedules")
      .select("client_id, target_key, target_label, blotato_media_urls, platform, scheduled_at")
      .gte("scheduled_at", since),
    db
      .from("content_schedule_watch")
      .select("client_id, target_key, target_label, blotato_media_urls, platform, post_text, scheduled_at")
      .gte("scheduled_at", since),
  ]);

  const candidatosProgramadas = (filasProgramadas ?? []) as Candidato[];
  const candidatosWatch = (filasWatch ?? []) as Candidato[];

  // Lo que ya tenemos guardado, para no re-atribuir lo que ya tiene dueño.
  const { data: yaGuardados } = await db
    .from("content_published_posts")
    .select("blotato_post_id, client_id, metrics_synced_at, published_at");

  const guardados = new Map(
    (yaGuardados ?? []).map((r) => [r.blotato_post_id as string, r]),
  );

  // ── Atribuir y guardar ────────────────────────────────────────────────────
  const filas: Record<string, unknown>[] = [];
  let atribuidos = 0;
  let sinAtribuir = 0;
  let nuevos = 0;

  for (const post of posts) {
    if (post.state?.type !== "published") continue;

    const previo = guardados.get(post.id);
    if (!previo) nuevos++;
    // Un post que ya tiene dueño no se vuelve a atribuir: si Rafa lo asignó a
    // mano (attribution = 'manual'), recalcular lo borraría.
    if (previo?.client_id) continue;

    const url = post.state.postUrl ?? null;

    let dueno: Dueno | null = null;

    const pageId = pageIdDeUrlFacebook(url);
    if (pageId) dueno = porPageId.get(pageId) ?? null;

    if (!dueno) {
      const m = buscarEnCandidatos(post, candidatosProgramadas);
      if (m) dueno = { ...m, attribution: "schedule_row" };
    }
    if (!dueno) {
      const m = buscarEnCandidatos(post, candidatosWatch);
      if (m) dueno = { ...m, attribution: "schedule_watch" };
    }

    if (dueno) atribuidos++;
    else sinAtribuir++;

    filas.push({
      blotato_post_id: post.id,
      client_id: dueno?.clientId ?? null,
      target_key: dueno?.targetKey ?? null,
      target_label: dueno?.targetLabel ?? null,
      attribution: dueno?.attribution ?? "unattributed",
      platform: post.platform,
      post_url: url,
      post_text: post.text ?? "",
      media_urls: post.mediaUrls ?? [],
      published_at: post.postTime,
    });
  }

  if (filas.length > 0) {
    const { error } = await db
      .from("content_published_posts")
      .upsert(filas, { onConflict: "blotato_post_id" });
    if (error) throw new Error(`no se pudo guardar el historial: ${error.message}`);
  }

  // ── Cerrar las filas de content_schedules que ya salieron al aire ─────────
  await cerrarProgramadas(db, since);

  // ── Métricas ──────────────────────────────────────────────────────────────
  const metricas = await refrescarMetricas(db);

  return {
    ok: true,
    revisados: posts.length,
    nuevos,
    atribuidos,
    sinAtribuir,
    metricas,
  };
}

/**
 * Marca como 'published' lo que se programó desde el tablero y ya salió.
 *
 * Antes de esto, una fila de content_schedules se quedaba en 'scheduled' para
 * siempre — el estado decía una cosa y la realidad otra.
 */
async function cerrarProgramadas(db: SupabaseClient, since: string): Promise<void> {
  const { data: publicados } = await db
    .from("content_published_posts")
    .select("blotato_post_id, client_id, media_urls, platform, published_at")
    .not("client_id", "is", null)
    .gte("published_at", since);

  const { data: pendientes } = await db
    .from("content_schedules")
    .select("id, client_id, platform, blotato_media_urls, scheduled_at")
    .eq("status", "scheduled")
    .gte("scheduled_at", since);

  for (const fila of pendientes ?? []) {
    const match = (publicados ?? []).find(
      (p) =>
        p.client_id === fila.client_id &&
        p.platform === fila.platform &&
        compartenMedia(
          (fila.blotato_media_urls ?? []) as string[],
          (p.media_urls ?? []) as string[],
        ),
    );
    if (!match) continue;

    const { error } = await db
      .from("content_schedules")
      .update({
        status: "published",
        blotato_post_id: match.blotato_post_id,
        published_at: match.published_at,
      })
      .eq("id", fila.id);
    if (error) console.error("[publishedSync] no se pudo cerrar la programada:", error.message);
  }
}

/**
 * Pide a Blotato las métricas de los posts que las tienen caducadas.
 *
 * Solo de posts CON dueño: preguntar por los que no pudimos atribuir sería
 * gastar cupo en algo que nadie va a ver. Y solo de los que siguen "vivos": a
 * los diez días el plan Starter ya tomó su última foto y el número no vuelve a
 * moverse.
 */
async function refrescarMetricas(db: SupabaseClient): Promise<number> {
  const vivos = new Date(Date.now() - DIAS_METRICAS_VIVAS * 24 * 60 * 60_000).toISOString();
  const caducas = new Date(Date.now() - REFRESCO_METRICAS_HORAS * 60 * 60_000).toISOString();

  const { data: pendientes } = await db
    .from("content_published_posts")
    .select("id, blotato_post_id, metrics_synced_at")
    .not("client_id", "is", null)
    .gte("published_at", vivos)
    .or(`metrics_synced_at.is.null,metrics_synced_at.lt.${caducas}`)
    .order("published_at", { ascending: false })
    .limit(MAX_ANALITICAS_POR_CORRIDA);

  let hechas = 0;

  for (const fila of pendientes ?? []) {
    const ahora = new Date().toISOString();
    try {
      const a = await getPostAnalytics(fila.blotato_post_id as string);
      await db
        .from("content_published_posts")
        .update({
          metrics: a?.metrics ?? null,
          metrics_fetched_at: a?.lastFetchedAt ?? null,
          metrics_error: a?.lastError ?? null,
          metrics_synced_at: ahora,
        })
        .eq("id", fila.id);
      hechas++;
    } catch (e: unknown) {
      // Se marca el intento igual: sin esto, un post que Blotato no puede medir
      // se reintentaría en cada corrida y se comería el cupo de los demás.
      await db
        .from("content_published_posts")
        .update({
          metrics_synced_at: ahora,
          metrics_error: e instanceof Error ? e.message : "no se pudieron leer las métricas",
        })
        .eq("id", fila.id);
    }
  }

  return hechas;
}
