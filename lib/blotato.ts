/**
 * Cliente REST de Blotato (SOLO servidor).
 *
 * ⚠️ Este archivo nunca debe importarse desde un componente con "use client":
 * lee BLOTATO_API_KEY, y esa llave publica en las redes sociales de los clientes.
 * Si llega al bundle del navegador, cualquiera que abra las herramientas de
 * desarrollo puede publicar en la cuenta de Karlita.
 *
 * Base:   https://backend.blotato.com/v2
 * Auth:   header `blotato-api-key`
 * Límites: POST /media 30/min · POST /posts 30/min · GET /posts 60/min
 *
 * La llave puede terminar en "=" (relleno base64). Se manda tal cual: recortarla
 * o codificarla la invalida.
 */

const BASE = "https://backend.blotato.com/v2";

/** Tope de espera por llamada. Sin esto una función de Vercel se cuelga hasta su maxDuration. */
const TIMEOUT_MS = 25_000;

export class BlotatoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BlotatoError";
    this.status = status;
  }
}

/** ¿Está configurada la integración? Se consulta antes de prometerle nada al cliente. */
export function blotatoConfigured(): boolean {
  return Boolean(process.env.BLOTATO_API_KEY);
}

function apiKey(): string {
  const key = process.env.BLOTATO_API_KEY;
  if (!key) {
    throw new BlotatoError(
      "La publicación automática todavía no está configurada. Avísale a FishFlow.",
      503,
    );
  }
  return key;
}

/**
 * Traduce un error de Blotato a algo que el cliente pueda leer.
 * El cuerpo crudo se manda a los logs, no a la pantalla: suele traer el eco del
 * request completo y no le dice nada a quien está programando una publicación.
 */
function mensajeDeError(status: number, cuerpo: string): string {
  if (status === 401 || status === 403) {
    return "Blotato rechazó nuestras credenciales. Avísale a FishFlow.";
  }
  if (status === 429) {
    return "Blotato nos pidió esperar un momento. Intenta de nuevo en un minuto.";
  }
  if (status === 404) return "Esa publicación ya no existe en Blotato.";
  if (status >= 500) return "Blotato no está respondiendo. Intenta de nuevo en unos minutos.";

  // 4xx de validación: el mensaje de Blotato sí suele ser útil (falta pageId,
  // formato de imagen no soportado…). Se recorta para no volcar un JSON entero.
  const limpio = cuerpo.replace(/\s+/g, " ").trim().slice(0, 200);
  return limpio ? `Blotato rechazó la publicación: ${limpio}` : "Blotato rechazó la publicación.";
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "blotato-api-key": apiKey(),
        ...(init.headers ?? {}),
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e: unknown) {
    const abortada = e instanceof DOMException && e.name === "AbortError";
    throw new BlotatoError(
      abortada
        ? "Blotato se tardó demasiado en responder. Intenta de nuevo."
        : "No se pudo contactar a Blotato.",
      504,
    );
  } finally {
    clearTimeout(corte);
  }

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    console.error(`[blotato] ${init.method ?? "GET"} ${path} → ${res.status}`, cuerpo.slice(0, 500));
    throw new BlotatoError(mensajeDeError(res.status, cuerpo), res.status);
  }

  // DELETE y PATCH devuelven 204 sin cuerpo.
  if (res.status === 204) return undefined as T;
  const texto = await res.text();
  if (!texto) return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new BlotatoError("Blotato respondió algo que no pudimos leer.", 502);
  }
}

// ─── Media ────────────────────────────────────────────────────────────────────

/**
 * Le entrega a Blotato una imagen que ya vive en una URL pública (nuestro bucket
 * de Supabase) y devuelve la copia que Blotato hospeda.
 *
 * Por qué el import por URL y no la subida con presigned URL: las imágenes ya
 * están en Supabase Storage —las necesitamos ahí de todos modos, para la
 * miniatura del calendario y el historial— así que mandar los bytes otra vez a
 * través de la función de Vercel sería pagar dos veces el mismo transporte.
 * Blotato las jala directo.
 */
export async function importMedia(publicUrl: string): Promise<string> {
  const out = await call<{ url?: string }>("/media", {
    method: "POST",
    body: JSON.stringify({ url: publicUrl }),
  });
  if (!out?.url) throw new BlotatoError("Blotato no devolvió la imagen subida.", 502);
  return out.url;
}

/**
 * Sube el carrusel completo, EN ORDEN, y devuelve las URLs de Blotato en ese
 * mismo orden. Secuencial y no en paralelo a propósito: son 30 llamadas por
 * minuto y un carrusel de 10 láminas disparadas de golpe se come un tercio del
 * cupo del minuto de todos los clientes.
 */
export async function importCarousel(publicUrls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of publicUrls) {
    out.push(await importMedia(url));
  }
  return out;
}

// ─── Publicación ──────────────────────────────────────────────────────────────

export type CreatePostInput = {
  accountId: string;
  platform: "instagram" | "facebook";
  /** Obligatorio en Facebook. */
  pageId?: string | null;
  text: string;
  mediaUrls: string[];
  /** ISO 8601 en UTC. Sin esto, se publica de inmediato. */
  scheduledTime?: string;
};

/**
 * Crea la publicación (programada si viene scheduledTime).
 *
 * ⚠️ `scheduledTime` va en la RAÍZ del cuerpo, hermano de `post`, no adentro.
 * Metido dentro de `post` la API lo ignora en silencio y la publicación sale
 * en ese momento: es el error que convierte "programar para el jueves" en
 * "publicar ahora mismo".
 */
export async function createPost(input: CreatePostInput): Promise<string> {
  const body = {
    post: {
      accountId: input.accountId,
      content: {
        text: input.text,
        mediaUrls: input.mediaUrls,
        platform: input.platform,
      },
      target: {
        targetType: input.platform,
        ...(input.platform === "facebook" && input.pageId ? { pageId: input.pageId } : {}),
      },
    },
    ...(input.scheduledTime ? { scheduledTime: input.scheduledTime } : {}),
  };

  const out = await call<{ postSubmissionId?: string }>("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return out?.postSubmissionId ?? "";
}

// ─── Programadas ──────────────────────────────────────────────────────────────

export type BlotatoSchedule = {
  id: string;
  scheduledAt: string;
  draft: {
    accountId: string;
    content: { text: string; mediaUrls: string[]; platform: string };
    target: { targetType: string; pageId?: string };
  };
  account?: {
    id: string;
    name?: string;
    username?: string;
    subaccountName?: string | null;
    profileImageUrl?: string | null;
  };
};

/**
 * Trae TODAS las publicaciones programadas a futuro, paginando hasta agotar.
 *
 * ⚠️ No cambiar esto por `GET /posts`: ese endpoint devuelve la lista mezclada
 * de publicadas, programadas y fallidas y la trunca —en la práctica salían tres
 * elementos aunque hubiera treinta—, así que el calendario del cliente se veía
 * casi vacío. `/schedules` es el que devuelve lo programado completo.
 *
 * El tope de páginas es un seguro contra un cursor que no avanza: preferimos un
 * calendario incompleto a una función que gira hasta que Vercel la mata.
 */
export async function listSchedules(maxPages = 10): Promise<BlotatoSchedule[]> {
  const todas: BlotatoSchedule[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (cursor) qs.set("cursor", cursor);
    const out = await call<{ items?: BlotatoSchedule[]; cursor?: string }>(`/schedules?${qs}`);
    const items = out?.items ?? [];
    todas.push(...items);
    if (!out?.cursor || items.length === 0 || out.cursor === cursor) break;
    cursor = out.cursor;
  }

  return todas;
}

/** Borrador de una publicación programada, tal como lo espera Blotato. */
export type ScheduleDraft = {
  accountId: string;
  content: { text: string; mediaUrls: string[]; platform: string };
  target: { targetType: string; pageId?: string };
};

/**
 * Reescribe una publicación programada: la hora, el borrador, o los dos.
 *
 * `draft` es un REEMPLAZO completo, no un merge: hay que mandar el texto, las
 * imágenes y el destino aunque solo cambie una palabra. Mandar medio borrador
 * es publicar medio post.
 */
export async function updateSchedule(
  id: string,
  patch: { scheduledTime?: string; draft?: ScheduleDraft },
): Promise<void> {
  await call<void>(`/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ patch }),
  });
}

/** Cancela una publicación programada. Blotato borra también su trabajo de publicación. */
export async function deleteSchedule(id: string): Promise<void> {
  await call<void>(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Publicadas ───────────────────────────────────────────────────────────────

/**
 * Una publicación ya publicada, tal como la devuelve GET /v2/posts.
 *
 * ⚠️ NO trae accountId. Ninguno de los endpoints de publicadas lo trae, y por
 * eso la atribución por cliente se hace de nuestro lado (ver lib/publishedSync).
 */
export type BlotatoPublishedPost = {
  id: string;
  platform: string;
  text: string;
  mediaUrls: string[];
  postTime: string;
  state?: { type: string; postUrl?: string; errorMessage?: string };
};

/**
 * Publicaciones ya publicadas dentro de una ventana de tiempo.
 *
 * Aquí sí se usa GET /posts —y no /schedules— porque lo que se busca es el
 * pasado, que es justo lo que /schedules no devuelve. La advertencia de
 * `listSchedules` sobre este endpoint sigue siendo cierta pero no aplica: se
 * truncaba por no mandar `limit` ni paginar con `cursor`. Con las dos cosas
 * puestas devuelve la lista completa.
 */
export async function listPublishedPosts(opts: {
  since: string;
  until?: string;
  maxPages?: number;
}): Promise<BlotatoPublishedPost[]> {
  const todas: BlotatoPublishedPost[] = [];
  let cursor: string | undefined;
  const maxPages = opts.maxPages ?? 10;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: "100", status: "published", since: opts.since });
    if (opts.until) qs.set("until", opts.until);
    if (cursor) qs.set("cursor", cursor);

    const out = await call<{ items?: BlotatoPublishedPost[]; cursor?: string }>(`/posts?${qs}`);
    const items = out?.items ?? [];
    todas.push(...items);
    // Mismo seguro que en listSchedules: un cursor que no avanza es un ciclo
    // infinito dentro de una función de Vercel.
    if (!out?.cursor || items.length === 0 || out.cursor === cursor) break;
    cursor = out.cursor;
  }

  return todas;
}

// ─── Fallidas ─────────────────────────────────────────────────────────────────

/**
 * Una publicación fallida, tal como la devuelve GET /v2/posts?status=failed.
 *
 * ⚠️ Mismo hueco que BlotatoPublishedPost: NO trae accountId ni pageId. Una
 * publicación fallida además nunca tuvo URL (no llegó a salir), así que la vía
 * de atribución por URL de Facebook tampoco aplica aquí — ver lib/failedPostsSync.
 */
export type BlotatoFailedPost = {
  id: string;
  platform: string;
  text: string;
  mediaUrls: string[];
  postTime: string;
  state?: { type: string; errorMessage?: string };
};

/**
 * Publicaciones fallidas dentro de una ventana de tiempo.
 *
 * Mismo patrón de paginación que listPublishedPosts: `limit` + `cursor`
 * explícitos, con el mismo seguro contra un cursor que no avanza.
 */
export async function listFailedPosts(opts: {
  since: string;
  until?: string;
  maxPages?: number;
}): Promise<BlotatoFailedPost[]> {
  const todas: BlotatoFailedPost[] = [];
  let cursor: string | undefined;
  const maxPages = opts.maxPages ?? 10;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: "100", status: "failed", since: opts.since });
    if (opts.until) qs.set("until", opts.until);
    if (cursor) qs.set("cursor", cursor);

    const out = await call<{ items?: BlotatoFailedPost[]; cursor?: string }>(`/posts?${qs}`);
    const items = out?.items ?? [];
    todas.push(...items);
    if (!out?.cursor || items.length === 0 || out.cursor === cursor) break;
    cursor = out.cursor;
  }

  return todas;
}

/**
 * Estado de una publicación ya enviada a Blotato (creada o reenviada), tal como
 * lo devuelve GET /v2/posts/{postSubmissionId}.
 *
 * Se usa para dar seguimiento a los reintentos automáticos SIN volver a barrer
 * la lista de fallidas: así un reintento que también falla no se confunde con
 * una publicación nueva y no dispara un segundo reintento en cadena.
 */
export type PostStatus = {
  postSubmissionId: string;
  status: "in-progress" | "scheduled" | "published" | "failed";
  scheduledTime?: string;
  publicUrl?: string;
  errorMessage?: string;
};

export async function getPostStatus(postSubmissionId: string): Promise<PostStatus> {
  return call<PostStatus>(`/posts/${encodeURIComponent(postSubmissionId)}`);
}

// ─── Analíticas ───────────────────────────────────────────────────────────────

/**
 * Última foto de las métricas de una publicación.
 *
 * ⚠️ NO dispara una consulta a la red social: devuelve el último snapshot que
 * Blotato ya había recolectado. Blotato mide en checkpoints fijos contados
 * desde que el post sale, y en el plan Starter esos checkpoints son solo dos —
 * al día 1 y al día 7. Después de la segunda medición el número queda congelado
 * para siempre. Por eso `fetchedAt` se guarda y se pinta: sin la fecha, un "32
 * vistas" de hace tres semanas se lee como si fuera de hoy.
 *
 * `metrics` viene en null mientras no haya habido ningún checkpoint (las
 * primeras 24 h de vida del post). Eso NO es un error.
 *
 * Los valores llegan como STRING, a propósito: los contadores de las redes
 * pueden pasarse de la precisión de un número de JavaScript.
 */
export type BlotatoMetrics = Record<string, string>;

export type BlotatoPostAnalytics = {
  publishedPostId: string;
  platform: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  metrics: BlotatoMetrics | null;
  history?: { fetchedAt: string; metrics: BlotatoMetrics }[];
};

export async function getPostAnalytics(id: string): Promise<BlotatoPostAnalytics | null> {
  try {
    return await call<BlotatoPostAnalytics>(`/posts/${encodeURIComponent(id)}/analytics`);
  } catch (e) {
    // Un post sin analíticas no puede tumbar el historial completo: se devuelve
    // null y la pantalla enseña la publicación sin números.
    if (e instanceof BlotatoError && e.status === 404) return null;
    throw e;
  }
}
