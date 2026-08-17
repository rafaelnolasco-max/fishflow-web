// app/api/content/schedule/[id]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Editar o cancelar una publicación YA programada en Blotato.
//
// PATCH  { clientId, date, time, caption?, hashtags?, media? } → la reescribe
// DELETE ?clientId=…                                          → la cancela
//
// El PATCH sirve para los dos casos: si solo vienen fecha y hora, se mueve de
// horario; si además viene contenido, se reemplaza el borrador completo. Es un
// solo endpoint porque para Blotato es la misma operación.
//
// ⚠️ El `id` viene del navegador, así que antes de tocar nada se comprueba que
// esa publicación sea de una cuenta de ESTE cliente. Blotato es un solo espacio
// de trabajo con las cuentas de todos los clientes de FishFlow: sin esta
// comprobación, adivinar un id sería suficiente para reescribirle la campaña a
// otro cliente.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import {
  blotatoConfigured,
  BlotatoError,
  deleteSchedule,
  importMedia,
  listSchedules,
  updateSchedule,
  type BlotatoSchedule,
} from "@/lib/blotato";
import {
  cdmxToUtcIso,
  composePostText,
  MAX_CAROUSEL,
  parseTargets,
} from "@/lib/socialTargets";

export const runtime = "nodejs";
// Editar puede implicar subir láminas nuevas a Blotato, una por una.
export const maxDuration = 120;

const MAX_TEXT = 2200;

/** Una lámina tal como la manda el navegador. */
type MediaInput = { url: string; path: string | null };

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function fallo(e: unknown) {
  if (e instanceof BlotatoError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[content/schedule/:id] error:", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

/** ¿Esta URL ya la hospeda Blotato? Entonces no hay que volver a subirla. */
function yaEnBlotato(url: string): boolean {
  return /^https:\/\/database\.blotato\.(io|com)\//.test(url);
}

type Guard =
  | { ok: true; email: string; schedule: BlotatoSchedule }
  | { ok: false; response: NextResponse };

/**
 * Sesión + acceso al cliente + la publicación pertenece a una cuenta suya.
 *
 * Se resuelve con `GET /schedules` completo y no con `GET /schedules/:id`
 * a propósito: la lista ya trae el accountId con la forma que conocemos, y
 * pedirla entera nos evita depender de un segundo formato de respuesta para la
 * comprobación de la que depende el aislamiento entre clientes.
 */
async function guard(scheduleId: string, clientId: string): Promise<Guard> {
  if (!clientId) {
    return { ok: false, response: NextResponse.json({ error: "Falta el cliente." }, { status: 400 }) };
  }

  const auth = await requireClientAccess(clientId);
  if (!auth.ok) return { ok: false, response: auth.response };

  if (!blotatoConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "La publicación automática todavía no está configurada." },
        { status: 503 },
      ),
    };
  }

  const { data } = await admin()
    .from("content_settings")
    .select("blotato_accounts")
    .eq("client_id", clientId)
    .maybeSingle();

  const cuentas = new Set(parseTargets(data?.blotato_accounts).map((t) => t.accountId));

  const schedule = (await listSchedules()).find((s) => s.id === scheduleId);
  // Mismo 404 para "no existe" y para "no es tuya": distinguirlos le confirmaría
  // a quien anda probando ids que acertó con uno de otro cliente.
  if (!schedule || !cuentas.has(schedule.draft?.accountId ?? "")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Esa publicación ya no existe." }, { status: 404 }),
    };
  }

  return { ok: true, email: auth.email, schedule };
}

/**
 * Normaliza y valida las láminas que manda el navegador, y devuelve las URLs
 * que Blotato va a publicar, EN ORDEN.
 *
 * Las que ya hospeda Blotato se reusan tal cual —no tiene sentido volver a
 * copiarlas— y las nuestras se importan. La comprobación de propiedad es la
 * parte que importa: una URL que no es de Blotato tiene que venir con su ruta
 * dentro de la carpeta de ESTE cliente, o se rechaza. Sin eso, un payload
 * armado a mano podría meter la imagen de otro cliente (o cualquier imagen de
 * internet) en la publicación.
 */
async function resolverMedia(media: MediaInput[], clientId: string): Promise<string[] | { error: string }> {
  if (media.length === 0) return { error: "Deja al menos una imagen." };
  if (media.length > MAX_CAROUSEL) {
    return { error: `Un carrusel admite hasta ${MAX_CAROUSEL} imágenes.` };
  }

  const out: string[] = [];
  for (const item of media) {
    const url = String(item?.url ?? "");
    if (!url) return { error: "Una de las imágenes llegó incompleta." };

    if (yaEnBlotato(url)) {
      out.push(url);
      continue;
    }

    const path = item?.path ? String(item.path) : "";
    if (!path || !path.startsWith(`${clientId}/`) || !url.includes(path)) {
      return { error: "Una de las imágenes no es de este cliente." };
    }
    out.push(await importMedia(url));
  }
  return out;
}

// ─── PATCH: mover de hora y/o reescribir ──────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.clientId ?? "").trim();
    const date = String(body.date ?? "").trim();
    const time = String(body.time ?? "").trim();

    const g = await guard(id, clientId);
    if (!g.ok) return g.response;

    const scheduledTime = cdmxToUtcIso(date, time);
    if (!scheduledTime) {
      return NextResponse.json({ error: "Revisa la fecha y la hora." }, { status: 400 });
    }
    if (new Date(scheduledTime).getTime() < Date.now() + 2 * 60_000) {
      return NextResponse.json(
        { error: "Esa hora ya pasó. Escoge una al menos unos minutos adelante." },
        { status: 400 },
      );
    }

    // ── ¿Solo cambio de horario, o también de contenido? ──────────────────────
    const editaContenido = Array.isArray(body.media);

    if (!editaContenido) {
      await updateSchedule(id, { scheduledTime });

      const { error: upErr } = await admin()
        .from("content_schedules")
        .update({ scheduled_at: scheduledTime, blotato_schedule_id: id })
        .eq("client_id", clientId)
        .eq("blotato_account_id", g.schedule.draft.accountId)
        .eq("scheduled_at", g.schedule.scheduledAt);
      if (upErr) console.error("[content/schedule/:id] historial no actualizado:", upErr);

      return NextResponse.json({ ok: true, scheduledTime });
    }

    const caption = String(body.caption ?? "").trim();
    const hashtags = String(body.hashtags ?? "").trim();
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

    const media = await resolverMedia(body.media as MediaInput[], clientId);
    if (!Array.isArray(media)) {
      return NextResponse.json({ error: media.error }, { status: 400 });
    }

    // El destino NO se toca: se reusa el de la publicación tal como está en
    // Blotato. Mover un post de una cuenta a otra cambia los campos obligatorios
    // (Facebook exige pageId, Instagram no) y no es un caso que nadie haya pedido;
    // para eso está cancelar y volver a crearla.
    const draft = {
      accountId: g.schedule.draft.accountId,
      content: {
        text,
        mediaUrls: media,
        platform: g.schedule.draft.content.platform,
      },
      target: g.schedule.draft.target,
    };

    await updateSchedule(id, { scheduledTime, draft });

    const propias = (body.media as MediaInput[])
      .map((m) => (m?.path ? String(m.path) : ""))
      .filter((p) => p.startsWith(`${clientId}/`));

    const { error: upErr } = await admin()
      .from("content_schedules")
      .update({
        caption,
        hashtags,
        media_urls: media,
        media_paths: propias,
        blotato_media_urls: media,
        scheduled_at: scheduledTime,
        blotato_schedule_id: id,
      })
      .eq("client_id", clientId)
      .eq("blotato_account_id", g.schedule.draft.accountId)
      .eq("scheduled_at", g.schedule.scheduledAt);
    // Puede no haber fila: las publicaciones creadas directo en Blotato, antes
    // de que existiera el tablero, no tienen historial nuestro. No es un error.
    if (upErr) console.error("[content/schedule/:id] historial no actualizado:", upErr);

    return NextResponse.json({ ok: true, scheduledTime });
  } catch (e) {
    return fallo(e);
  }
}

// ─── DELETE: cancelar ─────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const clientId = req.nextUrl.searchParams.get("clientId")?.trim() ?? "";

    const g = await guard(id, clientId);
    if (!g.ok) return g.response;

    await deleteSchedule(id);

    const { error: upErr } = await admin()
      .from("content_schedules")
      .update({ status: "canceled", blotato_schedule_id: id })
      .eq("client_id", clientId)
      .eq("blotato_account_id", g.schedule.draft.accountId)
      .eq("scheduled_at", g.schedule.scheduledAt);
    if (upErr) console.error("[content/schedule/:id] historial no actualizado:", upErr);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fallo(e);
  }
}
