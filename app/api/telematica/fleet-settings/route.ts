// PATCH /api/telematica/fleet-settings
// Body: { client_id, fuel_price_mxn?, default_km_per_l?, speeding_kmh?, vehicles?: [{ id, alias?, plate?, fuel_km_per_l? }] }
// Ajustes que el dueño o Lukon editan desde el tablero de flotilla.

import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";

const numOrNull = (v: unknown, min: number, max: number) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;   // undefined = inválido
};
const txtOrNull = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) || null : v === null ? null : undefined);

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
  const auth = await requireFleetAccess(clientId);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();

  const patch: Record<string, unknown> = {};
  if ("fuel_price_mxn" in body) {
    const v = numOrNull(body.fuel_price_mxn, 1, 200);
    if (v === undefined) return NextResponse.json({ error: "Precio por litro inválido" }, { status: 400 });
    patch.fuel_price_mxn = v;
  }
  if ("default_km_per_l" in body) {
    const v = numOrNull(body.default_km_per_l, 0.5, 60);
    if (v === undefined || v === null) return NextResponse.json({ error: "Rendimiento por defecto inválido" }, { status: 400 });
    patch.default_km_per_l = v;
  }
  if ("speeding_kmh" in body) {
    const v = numOrNull(body.speeding_kmh, 30, 160);
    if (v === undefined || v === null) return NextResponse.json({ error: "Límite de velocidad inválido" }, { status: 400 });
    patch.speeding_kmh = v;
  }
  if (Object.keys(patch).length) {
    const { error } = await db.from("telematica_fleet_settings")
      .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const vehicles = Array.isArray(body.vehicles) ? body.vehicles as Record<string, unknown>[] : [];
  for (const v of vehicles.slice(0, 200)) {
    if (typeof v.id !== "string") continue;
    const vp: Record<string, unknown> = {};
    if ("alias" in v) { const a = txtOrNull(v.alias); if (a !== undefined) vp.alias = a; }
    if ("plate" in v) { const p = txtOrNull(v.plate); if (p !== undefined) vp.plate = p?.toUpperCase() ?? null; }
    if ("fuel_km_per_l" in v) {
      const k = numOrNull(v.fuel_km_per_l, 0.5, 60);
      if (k === undefined) return NextResponse.json({ error: "Rendimiento (km/l) inválido" }, { status: 400 });
      vp.fuel_km_per_l = k;
    }
    if (!Object.keys(vp).length) continue;
    const { error } = await db.from("telematica_vehicles").update(vp).eq("id", v.id).eq("client_id", clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
