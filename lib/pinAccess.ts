// FishFlow — Telemática · acceso temporal por NIP a /flotilla/<slug> (solo lectura).
// Para clientes de Lukon que aún no tienen usuario y contraseña (Grupo SELOME, nov-2026).
//
// - El NIP vive con bcrypt en `telematica_pin_access` (nunca en el repo: es público).
//   Se revisa con la función SQL telematica_pin_check (5 errores = 15 min de bloqueo).
// - Al acertar queda una cookie httpOnly firmada (HMAC) `ff_pin_<slug>` por 30 días o
//   hasta que venza el acceso, lo que pase primero.
// - Cambiar el NIP (telematica_pin_set) sube session_version y cierra todas las sesiones.
// - Solo sirve para LEER: requireFleetAccess(clientId, { allowPin: true }) en rutas GET.

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const PIN_COOKIE_PREFIX = "ff_pin_";
export const PIN_SESSION_DAYS = 30;

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const key = () => `${process.env.SUPABASE_SERVICE_ROLE_KEY}:telematica-pin-session`;
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export const pinCookieName = (slug: string) => `${PIN_COOKIE_PREFIX}${slug.replace(/[^a-z0-9-]/gi, "")}`;

/** Token de sesión: <access_id>.<session_version>.<exp_epoch_s>.<firma> */
export function makePinToken(accessId: string, version: number, expEpoch: number) {
  const payload = `${accessId}.${version}.${expEpoch}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, ver, exp, sig] = parts;
  const expected = Buffer.from(sign(`${id}.${ver}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || Number(exp) * 1000 < Date.now()) return null;
  return { accessId: id, version: Number(ver) };
}

export type PinSession = { accessId: string; slug: string; clientId: string; expiresAt: string };

/** Sesiones por NIP válidas en las cookies de esta petición (opcionalmente de un slug). */
export async function pinSessions(slug?: string): Promise<PinSession[]> {
  const store = await cookies();
  const tokens = store.getAll()
    .filter(c => c.name.startsWith(PIN_COOKIE_PREFIX) && (!slug || c.name === pinCookieName(slug)))
    .map(c => parseToken(c.value))
    .filter((t): t is { accessId: string; version: number } => !!t);
  if (!tokens.length) return [];

  const { data } = await db().from("telematica_pin_access")
    .select("id, slug, client_id, session_version, expires_at").in("id", tokens.map(t => t.accessId));
  const now = Date.now();
  return (data ?? [])
    .filter(r => new Date(r.expires_at).getTime() > now && tokens.some(t => t.accessId === r.id && t.version === r.session_version))
    .map(r => ({ accessId: r.id, slug: r.slug, clientId: r.client_id, expiresAt: r.expires_at }));
}

/** ¿Hay una sesión por NIP válida para esta flotilla? */
export async function pinSessionForClient(clientId: string): Promise<PinSession | null> {
  return (await pinSessions()).find(s => s.clientId === clientId) ?? null;
}
