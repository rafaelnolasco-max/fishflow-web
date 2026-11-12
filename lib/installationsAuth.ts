// FishFlow — Lukon · Instalaciones: quién está llamando a las rutas de una orden.
// - Admin (Alex / Rafa) con su sesión del panel → todo.
// - Instalador con la liga privada de la orden (header x-instalador = installer_token) → solo esa
//   orden, solo mientras está programada o en sitio, y solo empezar / fotos / terminar.
// Sin cuentas para instaladores (decisión de Rafa, 12-nov-2026).
import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID } from "@/lib/installations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InstAuth =
  | { ok: true; by: string; installer: boolean }
  | { ok: false; response: NextResponse };

export async function authInstallation(req: NextRequest, id: string): Promise<InstAuth> {
  const token = req.headers.get("x-instalador");
  if (!token) {
    const a = await requireClientAccess(LUKON_ID);
    return a.ok ? { ok: true, by: a.email ?? "panel", installer: false } : { ok: false, response: a.response };
  }
  const deny = (msg: string, status = 403) => ({ ok: false as const, response: NextResponse.json({ error: msg }, { status }) });
  if (!UUID_RE.test(token) || !UUID_RE.test(id)) return deny("Liga inválida", 404);
  const { data } = await supabaseAdmin().from("telematica_installations")
    .select("installer_no").eq("id", id).eq("client_id", LUKON_ID).eq("installer_token", token).maybeSingle();
  if (!data) return deny("Esta liga ya no es válida. Pide a LUKON una nueva.", 404);
  return { ok: true, by: data.installer_no ? `Instalador ${data.installer_no}` : "Instalador", installer: true };
}

/** Lo que el instalador NO debe ver de la orden. */
export function forInstaller<T extends Record<string, unknown>>(inst: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { report_token, installer_token, customer_email, accept_ip, ...rest } = inst;
  return rest;
}

/** Campos que el instalador puede capturar al terminar. */
export const INSTALLER_FIELDS = ["device_imei", "sim_iccid", "dashcam_serial", "hidden_location", "tech_notes"] as const;
