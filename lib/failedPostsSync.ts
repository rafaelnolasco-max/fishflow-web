// lib/failedPostsSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Detecta publicaciones de Blotato que fallaron, identifica cliente/cuenta,
// avisa por correo de inmediato y reintenta UNA vez a los RETRY_MINUTOS.
//
// SOLO SERVIDOR: mismo candado que lib/publishedSync.ts — usa el service role
// de Supabase y BLOTATO_API_KEY vía lib/blotato.
//
// EL PROBLEMA (mismo que resuelve publishedSync para lo publicado)
// GET /v2/posts?status=failed no trae accountId. La atribución se hace
// cruzando contra content_schedules y content_schedule_watch — las MISMAS vías
// 2 y 3 de publishedSync.ts. La vía 1 (URL de Facebook) no aplica: una
// publicación fallida nunca llegó a tener URL.
//
// CICLO DE UNA FALLA
//   1. Se detecta en la lista de fallidas (no estaba ya guardada, y no es el
//      resultado de un reintento nuestro — ver el filtro por retry_submission_id).
//   2. Se atribuye a cliente/cuenta. Alerta inmediata por correo a Rafa.
//   3. Si se identificó la cuenta: a los RETRY_MINUTOS se reintenta con el
//      MISMO texto/imágenes/cuenta.
//   4. El resultado del reintento se sigue por su propio postSubmissionId
//      (getPostStatus), no volviendo a barrer la lista de fallidas: así un
//      reintento que también falla no dispara un segundo reintento en cadena,
//      solo una segunda alerta.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  blotatoConfigured,
  createPost,
  getPostStatus,
  listFailedPosts,
  type BlotatoFailedPost,
} from "@/lib/blotato";
import { parseTargets, type SocialTarget } from "@/lib/socialTargets";
import { buscarEnCandidatos, compartenMedia, type Candidato } from "@/lib/publishedSync";
import { sendEmail } from "@/lib/email";

/** Cuánto pasado se revisa en cada corrida del cron (5 min). Ancho a propósito:
 * una corrida perdida no debe dejar una falla sin detectar. */
const VENTANA_MIN = 60;

/** Cuánto se espera antes de reintentar una publicación fallida. */
const RETRY_MINUTOS = 10;

const ADMIN_TO = ["raf@fishflow.mx"];

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Candidatos y atribución ────────────────────────────────────────────────

async function cargarCandidatos(
  db: SupabaseClient,
  since: string,
): Promise<{ programadas: Candidato[]; watch: Candidato[] }> {
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
  return {
    programadas: (filasProgramadas ?? []) as Candidato[],
    watch: (filasWatch ?? []) as Candidato[],
  };
}

async function cargarSettings(db: SupabaseClient): Promise<Map<string, SocialTarget[]>> {
  const { data } = await db.from("content_settings").select("client_id, blotato_accounts");
  const mapa = new Map<string, SocialTarget[]>();
  for (const fila of data ?? []) {
    mapa.set(fila.client_id as string, parseTargets(fila.blotato_accounts));
  }
  return mapa;
}

/**
 * Marca como 'failed' la fila de content_schedules que corresponde a esta
 * publicación, si la programó el tablero de FishFlow. Espejo de lo que
 * publishedSync.cerrarProgramadas hace con 'published' — sin esto, una
 * publicación programada desde el tablero que falla se queda en 'scheduled'
 * para siempre y el calendario miente.
 */
async function marcarProgramadaComoFallida(
  db: SupabaseClient,
  post: BlotatoFailedPost,
  clientId: string,
  errorMessage: string,
  since: string,
): Promise<void> {
  const { data: pendientes } = await db
    .from("content_schedules")
    .select("id, blotato_media_urls, platform")
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .gte("scheduled_at", since);

  const match = (pendientes ?? []).find(
    (r) => r.platform === post.platform && compartenMedia((r.blotato_media_urls ?? []) as string[], post.mediaUrls ?? []),
  );
  if (!match) return;

  const { error } = await db
    .from("content_schedules")
    .update({ status: "failed", error: errorMessage })
    .eq("id", match.id);
  if (error) console.error("[failedPostsSync] no se pudo marcar la programada como fallida:", error.message);
}

// ─── Correo ──────────────────────────────────────────────────────────────────

function tarjeta(titulo: string, cuerpo: string, colorBarra: string): string {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b2733">
    <div style="background:#212934;color:#fff;padding:22px 26px;border-top:4px solid ${colorBarra}">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${colorBarra}">FishFlow · Blotato</div>
      <div style="font-size:20px;margin-top:6px;font-weight:800">${esc(titulo)}</div>
    </div>
    <div style="padding:22px 26px;border:1px solid #E2EAE5;border-top:none;font-size:14px;line-height:1.6">
      ${cuerpo}
      <p style="font-size:12px;color:#5d7080;margin-top:22px">Aviso automático · FishFlow</p>
    </div>
  </div>`;
}

async function alertaPrimeraFalla(opts: {
  clienteNombre: string | null;
  targetLabel: string | null;
  platform: string;
  postText: string;
  errorMessage: string;
  vaAReintentar: boolean;
}): Promise<void> {
  const destino = opts.clienteNombre
    ? `${esc(opts.clienteNombre)}${opts.targetLabel ? ` — ${esc(opts.targetLabel)}` : ""}`
    : "Sin identificar";

  const cuerpo = `
    <p style="margin:0 0 14px"><strong>Cliente/cuenta:</strong> ${destino}</p>
    <p style="margin:0 0 14px"><strong>Plataforma:</strong> ${esc(opts.platform)}</p>
    <p style="margin:0 0 14px"><strong>Error de Blotato:</strong> ${esc(opts.errorMessage) || "sin detalle"}</p>
    <p style="margin:0 0 14px"><strong>Texto de la publicación:</strong><br>${esc(opts.postText).slice(0, 300)}</p>
    <p style="margin:0 0 14px">
      ${opts.vaAReintentar
        ? `FishFlow va a reintentar la publicación en ${RETRY_MINUTOS} minutos, con el mismo texto e imágenes.`
        : "No se pudo identificar la cuenta de origen, así que no hay reintento automático. Hay que resolverlo a mano en Blotato."}
    </p>
    <a href="https://my.blotato.com/failed"
       style="display:inline-block;margin-top:6px;background:#F26B17;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:14px">
      Ver en Blotato
    </a>`;

  await sendEmail({
    from: "fishflowNoreply",
    to: ADMIN_TO,
    subject: `Blotato: publicación fallida — ${opts.clienteNombre ?? "sin identificar"}`,
    html: tarjeta("Una publicación falló", cuerpo, "#F26B17"),
    tag: "cron/blotato-failures",
  });
}

async function alertaReintentoFallido(opts: {
  clienteNombre: string | null;
  targetLabel: string | null;
  platform: string;
  errorMessage: string;
}): Promise<void> {
  const destino = opts.clienteNombre
    ? `${esc(opts.clienteNombre)}${opts.targetLabel ? ` — ${esc(opts.targetLabel)}` : ""}`
    : "Sin identificar";

  const cuerpo = `
    <p style="margin:0 0 14px"><strong>Cliente/cuenta:</strong> ${destino}</p>
    <p style="margin:0 0 14px"><strong>Plataforma:</strong> ${esc(opts.platform)}</p>
    <p style="margin:0 0 14px"><strong>Error del reintento:</strong> ${esc(opts.errorMessage) || "sin detalle"}</p>
    <p style="margin:0 0 14px">
      El reintento automático también falló. FishFlow no vuelve a reintentar solo — hay que
      revisarlo y publicarlo a mano.
    </p>
    <a href="https://my.blotato.com/failed"
       style="display:inline-block;margin-top:6px;background:#F26B17;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:14px">
      Ver en Blotato
    </a>`;

  await sendEmail({
    from: "fishflowNoreply",
    to: ADMIN_TO,
    subject: `Blotato: el reintento también falló — ${opts.clienteNombre ?? "sin identificar"}`,
    html: tarjeta("El reintento automático falló", cuerpo, "#c0392b"),
    tag: "cron/blotato-failures",
  });
}

// ─── Detección de fallas nuevas ─────────────────────────────────────────────

type FilaFallida = {
  id: string;
  blotato_post_id: string;
  client_id: string | null;
  target_key: string | null;
  target_label: string | null;
  platform: string;
  blotato_account_id: string | null;
  post_text: string;
  media_urls: string[];
  error_message: string;
  retry_submission_id: string | null;
};

async function detectarNuevasFallas(
  db: SupabaseClient,
  since: string,
): Promise<{ revisadas: number; nuevas: number; alertadas: number }> {
  const posts = await listFailedPosts({ since });

  const { data: yaGuardados } = await db
    .from("content_failed_posts")
    .select("blotato_post_id, retry_submission_id");

  const conocidos = new Set<string>();
  for (const fila of yaGuardados ?? []) {
    conocidos.add(fila.blotato_post_id as string);
    if (fila.retry_submission_id) conocidos.add(fila.retry_submission_id as string);
  }

  const { programadas, watch } = await cargarCandidatos(db, since);
  const settings = await cargarSettings(db);

  let nuevas = 0;
  let alertadas = 0;

  for (const post of posts) {
    if (post.state?.type !== "failed") continue;
    if (conocidos.has(post.id)) continue;
    nuevas++;

    let match = buscarEnCandidatos(post, programadas);
    let attribution: "schedule_row" | "schedule_watch" | "unattributed" = match ? "schedule_row" : "unattributed";
    if (!match) {
      match = buscarEnCandidatos(post, watch);
      if (match) attribution = "schedule_watch";
    }

    let accountId: string | null = null;
    if (match) {
      const target = settings.get(match.clientId)?.find((t) => t.key === match.targetKey);
      accountId = target?.accountId ?? null;
    }

    const errorMessage = post.state?.errorMessage ?? "";
    const vaAReintentar = Boolean(accountId);

    const { error: insertError } = await db.from("content_failed_posts").upsert(
      {
        blotato_post_id: post.id,
        client_id: match?.clientId ?? null,
        target_key: match?.targetKey ?? null,
        target_label: match?.targetLabel ?? null,
        platform: post.platform,
        blotato_account_id: accountId,
        post_text: post.text ?? "",
        media_urls: post.mediaUrls ?? [],
        error_message: errorMessage,
        attribution,
        failed_at: post.postTime,
        alert_sent_at: new Date().toISOString(),
        retry_at: vaAReintentar ? new Date(Date.now() + RETRY_MINUTOS * 60_000).toISOString() : null,
      },
      { onConflict: "blotato_post_id" },
    );
    if (insertError) {
      console.error("[failedPostsSync] no se pudo guardar la falla:", insertError.message);
      continue;
    }

    let clienteNombre: string | null = null;
    if (match?.clientId) {
      const { data: cliente } = await db.from("clients").select("name").eq("id", match.clientId).maybeSingle();
      clienteNombre = (cliente?.name as string) ?? null;
      await marcarProgramadaComoFallida(db, post, match.clientId, errorMessage, since);
    }

    try {
      await alertaPrimeraFalla({
        clienteNombre,
        targetLabel: match?.targetLabel ?? null,
        platform: post.platform,
        postText: post.text ?? "",
        errorMessage,
        vaAReintentar,
      });
      alertadas++;
    } catch (e) {
      console.error("[failedPostsSync] no se pudo mandar la alerta:", e);
    }
  }

  return { revisadas: posts.length, nuevas, alertadas };
}

// ─── Reintentos ──────────────────────────────────────────────────────────────

async function reintentar(db: SupabaseClient, fila: FilaFallida): Promise<void> {
  const ahora = new Date().toISOString();

  if (!fila.blotato_account_id) {
    // No debería llegar aquí (solo se agenda retry_at con cuenta identificada),
    // pero por si acaso: se cierra sin reintentar de verdad.
    await db.from("content_failed_posts").update({ retried_at: ahora, retry_result: "failed" }).eq("id", fila.id);
    return;
  }

  let pageId: string | null = null;
  if (fila.platform === "facebook" && fila.client_id) {
    const { data: settingsRow } = await db
      .from("content_settings")
      .select("blotato_accounts")
      .eq("client_id", fila.client_id)
      .maybeSingle();
    const targets = parseTargets(settingsRow?.blotato_accounts);
    pageId = targets.find((t) => t.key === fila.target_key)?.pageId ?? null;
  }

  try {
    const submissionId = await createPost({
      accountId: fila.blotato_account_id,
      platform: fila.platform as "instagram" | "facebook",
      pageId,
      text: fila.post_text,
      mediaUrls: fila.media_urls,
    });
    await db
      .from("content_failed_posts")
      .update({ retried_at: ahora, retry_submission_id: submissionId || null })
      .eq("id", fila.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido al reintentar";
    console.error("[failedPostsSync] reintento falló:", msg);
    await db.from("content_failed_posts").update({ retried_at: ahora, retry_result: "failed" }).eq("id", fila.id);

    let clienteNombre: string | null = null;
    if (fila.client_id) {
      const { data: cliente } = await db.from("clients").select("name").eq("id", fila.client_id).maybeSingle();
      clienteNombre = (cliente?.name as string) ?? null;
    }
    await alertaReintentoFallido({
      clienteNombre,
      targetLabel: fila.target_label,
      platform: fila.platform,
      errorMessage: msg,
    }).catch((err) => console.error("[failedPostsSync] no se pudo mandar la segunda alerta:", err));
  }
}

async function ejecutarReintentosPendientes(db: SupabaseClient): Promise<number> {
  const ahora = new Date().toISOString();
  const { data: pendientes } = await db
    .from("content_failed_posts")
    .select("*")
    .lte("retry_at", ahora)
    .is("retried_at", null);

  for (const fila of (pendientes ?? []) as FilaFallida[]) {
    await reintentar(db, fila);
  }
  return (pendientes ?? []).length;
}

async function revisarReintentosEnCurso(db: SupabaseClient): Promise<number> {
  const { data: enCurso } = await db
    .from("content_failed_posts")
    .select("*")
    .not("retried_at", "is", null)
    .is("retry_result", null)
    .not("retry_submission_id", "is", null);

  let resueltos = 0;
  for (const fila of (enCurso ?? []) as FilaFallida[]) {
    const estado = await getPostStatus(fila.retry_submission_id as string).catch(() => null);
    if (!estado) continue;

    if (estado.status === "published") {
      await db.from("content_failed_posts").update({ retry_result: "success" }).eq("id", fila.id);
      resueltos++;
    } else if (estado.status === "failed") {
      await db.from("content_failed_posts").update({ retry_result: "failed" }).eq("id", fila.id);
      resueltos++;

      let clienteNombre: string | null = null;
      if (fila.client_id) {
        const { data: cliente } = await db.from("clients").select("name").eq("id", fila.client_id).maybeSingle();
        clienteNombre = (cliente?.name as string) ?? null;
      }
      await alertaReintentoFallido({
        clienteNombre,
        targetLabel: fila.target_label,
        platform: fila.platform,
        errorMessage: estado.errorMessage ?? "Blotato no dio más detalle.",
      }).catch((err) => console.error("[failedPostsSync] no se pudo mandar la segunda alerta:", err));
    }
    // "in-progress": se vuelve a revisar en la siguiente corrida del cron.
  }
  return resueltos;
}

// ─── Punto de entrada ────────────────────────────────────────────────────────

export type FailedSyncResult = {
  ok: boolean;
  revisadas: number;
  nuevas: number;
  alertadas: number;
  reintentosDisparados: number;
  reintentosResueltos: number;
  error?: string;
};

/**
 * Corre el ciclo completo: detecta fallas nuevas y avisa, dispara los
 * reintentos que ya cumplieron su espera, y revisa el resultado de los que
 * están en curso. Pensada para llamarse cada 5 minutos desde el cron de
 * Vercel — ver app/api/cron/blotato-failures/route.ts.
 *
 * No lanza: un error a medio camino no debe tumbar el cron completo.
 */
export async function syncFailedPosts(): Promise<FailedSyncResult> {
  const vacio: FailedSyncResult = {
    ok: true, revisadas: 0, nuevas: 0, alertadas: 0, reintentosDisparados: 0, reintentosResueltos: 0,
  };
  if (!blotatoConfigured()) return { ...vacio, ok: false, error: "Blotato no configurado" };

  const db = admin();
  const since = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();

  try {
    const { revisadas, nuevas, alertadas } = await detectarNuevasFallas(db, since);
    const reintentosDisparados = await ejecutarReintentosPendientes(db);
    const reintentosResueltos = await revisarReintentosEnCurso(db);
    return { ok: true, revisadas, nuevas, alertadas, reintentosDisparados, reintentosResueltos };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error desconocido";
    console.error("[failedPostsSync] falló:", msg);
    return { ...vacio, ok: false, error: msg };
  }
}
