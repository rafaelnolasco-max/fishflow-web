// app/api/content/schedule/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Ventana "Programar" — calendario y alta de publicaciones.
//
// GET  ?clientId=… → destinos del cliente + lo que ya tiene programado
// POST             → programa una publicación (un solo paso, sin aprobación)
//
// Toda la conversación con Blotato pasa por aquí: la API key es de servidor y
// nunca viaja al navegador. Y el filtro por cuentas del cliente vive aquí, no
// en la pantalla — Blotato es UN espacio de trabajo con las cuentas de TODOS
// los clientes de FishFlow, así que sin filtro de servidor Karlita vería (y
// podría tocar) las publicaciones de los demás.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import {
  blotatoConfigured,
  BlotatoError,
  createPost,
  importCarousel,
  listSchedules,
} from "@/lib/blotato";
import {
  cdmxToUtcIso,
  composePostText,
  MAX_CAROUSEL,
  parseTargets,
  type SocialTarget,
} from "@/lib/socialTargets";

export const runtime = "nodejs";
// Subir un carrusel de 10 láminas a Blotato son 10 llamadas en fila, más la de
// publicar. 120 s deja margen sin dejar la función colgada media hora.
export const maxDuration = 120;

/** Instagram corta el pie en 2200 caracteres. Vale más avisar que publicar mocho. */
const MAX_TEXT = 2200;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function loadTargets(clientId: string): Promise<SocialTarget[]> {
  const { data, error } = await admin()
    .from("content_settings")
    .select("blotato_accounts")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    console.error("[content/schedule] settings error:", error);
    return [];
  }
  return parseTargets(data?.blotato_accounts);
}

function fallo(e: unknown) {
  if (e instanceof BlotatoError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[content/schedule] error:", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

// ─── GET: el calendario ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) return NextResponse.json({ error: "Falta el cliente." }, { status: 400 });

  const auth = await requireClientAccess(clientId);
  if (!auth.ok) return auth.response;

  try {
    const targets = await loadTargets(clientId);

    if (!blotatoConfigured() || targets.length === 0) {
      return NextResponse.json({
        ok: true,
        configured: blotatoConfigured(),
        targets,
        schedules: [],
      });
    }

    // Índice cuenta → destino. Una cuenta de Blotato que no esté declarada en
    // content_settings simplemente no es de este cliente.
    const porCuenta = new Map(targets.map((t) => [t.accountId, t]));

    const schedules = (await listSchedules())
      .filter((s) => porCuenta.has(s.draft?.accountId ?? ""))
      .map((s) => {
        const target = porCuenta.get(s.draft.accountId)!;
        return {
          id: s.id,
          scheduledAt: s.scheduledAt,
          targetKey: target.key,
          targetLabel: target.label,
          platform: target.platform,
          text: s.draft?.content?.text ?? "",
          mediaUrls: s.draft?.content?.mediaUrls ?? [],
        };
      })
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    return NextResponse.json({ ok: true, configured: true, targets, schedules });
  } catch (e) {
    return fallo(e);
  }
}

// ─── POST: programar ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.clientId ?? "").trim();
    const targetKey = String(body.targetKey ?? "").trim();
    const caption = String(body.caption ?? "").trim();
    const hashtags = String(body.hashtags ?? "").trim();
    const date = String(body.date ?? "").trim();
    const time = String(body.time ?? "").trim();
    const mediaPaths: string[] = Array.isArray(body.mediaPaths) ? body.mediaPaths.map(String) : [];
    const mediaUrls: string[] = Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : [];

    if (!clientId) return NextResponse.json({ error: "Falta el cliente." }, { status: 400 });

    const auth = await requireClientAccess(clientId);
    if (!auth.ok) return auth.response;

    // ── Validación ────────────────────────────────────────────────────────────
    const targets = await loadTargets(clientId);
    const target = targets.find((t) => t.key === targetKey);
    if (!target) {
      return NextResponse.json({ error: "Ese destino no está configurado." }, { status: 400 });
    }

    if (mediaUrls.length === 0) {
      return NextResponse.json({ error: "Sube al menos una imagen." }, { status: 400 });
    }
    if (mediaUrls.length > MAX_CAROUSEL) {
      return NextResponse.json(
        { error: `Un carrusel admite hasta ${MAX_CAROUSEL} imágenes.` },
        { status: 400 },
      );
    }
    if (mediaPaths.length !== mediaUrls.length) {
      return NextResponse.json({ error: "Las imágenes llegaron incompletas." }, { status: 400 });
    }
    // Las imágenes tienen que ser de ESTE cliente: la ruta del bucket empieza con
    // su client_id. Sin esta comprobación, un payload armado a mano podría
    // publicar el arte de otro cliente.
    if (!mediaPaths.every((p) => p.startsWith(`${clientId}/`))) {
      return NextResponse.json({ error: "Las imágenes no son de este cliente." }, { status: 400 });
    }

    const text = composePostText(caption, hashtags);
    if (!text) {
      return NextResponse.json({ error: "Escribe el texto de la publicación." }, { status: 400 });
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: `El texto pasa de ${MAX_TEXT} caracteres y la red social lo cortaría.` },
        { status: 400 },
      );
    }

    const scheduledTime = cdmxToUtcIso(date, time);
    if (!scheduledTime) {
      return NextResponse.json({ error: "Revisa la fecha y la hora." }, { status: 400 });
    }
    // Dos minutos de colchón: programar "en 10 segundos" es publicar ya, y el
    // cliente creyó que estaba programando.
    if (new Date(scheduledTime).getTime() < Date.now() + 2 * 60_000) {
      return NextResponse.json(
        { error: "Esa hora ya pasó. Escoge una al menos unos minutos adelante." },
        { status: 400 },
      );
    }

    if (!blotatoConfigured()) {
      return NextResponse.json(
        { error: "La publicación automática todavía no está configurada. Avísale a FishFlow." },
        { status: 503 },
      );
    }

    // ── Blotato ───────────────────────────────────────────────────────────────
    // Primero las imágenes: Blotato publica desde su propia copia, no desde la
    // nuestra. El orden del arreglo ES el orden de las láminas del carrusel.
    const blotatoMediaUrls = await importCarousel(mediaUrls);

    const submissionId = await createPost({
      accountId: target.accountId,
      platform: target.platform,
      pageId: target.pageId,
      text,
      mediaUrls: blotatoMediaUrls,
      scheduledTime,
    });

    // ── Historial propio ──────────────────────────────────────────────────────
    // Se guarda DESPUÉS de que Blotato aceptó: una fila que diga "programada"
    // sin que nadie la vaya a publicar es peor que no tener fila.
    // Si esta escritura falla, la publicación SÍ quedó programada — se avisa
    // como advertencia, no como error, para que el cliente no la programe dos veces.
    const { error: insErr } = await admin().from("content_schedules").insert({
      client_id: clientId,
      target_key: target.key,
      target_label: target.label,
      platform: target.platform,
      blotato_account_id: target.accountId,
      blotato_page_id: target.pageId ?? null,
      caption,
      hashtags,
      media_paths: mediaPaths,
      media_urls: mediaUrls,
      blotato_media_urls: blotatoMediaUrls,
      scheduled_at: scheduledTime,
      blotato_submission_id: submissionId || null,
      status: "scheduled",
      created_by: auth.email,
    });

    if (insErr) console.error("[content/schedule] historial no guardado:", insErr);

    return NextResponse.json({
      ok: true,
      scheduledTime,
      submissionId,
      warning: insErr
        ? "Quedó programada, pero no se pudo guardar en tu historial. Avísale a FishFlow."
        : null,
    });
  } catch (e) {
    return fallo(e);
  }
}
