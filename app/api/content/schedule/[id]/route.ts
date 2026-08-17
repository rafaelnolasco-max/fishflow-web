// app/api/content/schedule/[id]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Mover o cancelar una publicación YA programada en Blotato.
//
// PATCH  { clientId, date, time } → la cambia de hora
// DELETE ?clientId=…              → la cancela
//
// ⚠️ El `id` viene del navegador, así que antes de tocar nada se comprueba que
// esa publicación sea de una cuenta de ESTE cliente. Blotato es un solo espacio
// de trabajo con las cuentas de todos los clientes de FishFlow: sin esta
// comprobación, adivinar un id sería suficiente para cancelarle la campaña a
// otro cliente.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import {
  blotatoConfigured,
  BlotatoError,
  deleteSchedule,
  listSchedules,
  rescheduleSchedule,
  type BlotatoSchedule,
} from "@/lib/blotato";
import { cdmxToUtcIso, parseTargets } from "@/lib/socialTargets";

export const runtime = "nodejs";
export const maxDuration = 60;

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

// ─── PATCH: cambiar de hora ───────────────────────────────────────────────────
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

    await rescheduleSchedule(id, scheduledTime);

    // El historial se empareja por cuenta + hora anterior: es la única llave que
    // compartimos con Blotato, porque POST /posts nos dio un submissionId y no
    // el id del calendario. De paso se sella el schedule_id, y a partir de aquí
    // esa fila ya se puede ubicar directo.
    const { error: upErr } = await admin()
      .from("content_schedules")
      .update({ scheduled_at: scheduledTime, blotato_schedule_id: id })
      .eq("client_id", clientId)
      .eq("blotato_account_id", g.schedule.draft.accountId)
      .eq("scheduled_at", g.schedule.scheduledAt);
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
