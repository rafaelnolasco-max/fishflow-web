// GET /api/telematica/fleets?parent=<client_id>
// Flotillas (clientes hijos) de un padre —hoy Lukon— con sus unidades,
// cuántos puntos tiene cada una y su rango de fechas.

import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";

export async function GET(req: NextRequest) {
  const parent = req.nextUrl.searchParams.get("parent");
  if (!parent) return NextResponse.json({ error: "Falta parent" }, { status: 400 });
  const auth = await requireClientAccess(parent);
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data: fleets, error } = await db.from("clients")
    .select("id, name, slug, active").eq("parent_client_id", parent).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (fleets ?? []).map(f => f.id);
  const { data: vehicles, error: vErr } = ids.length
    ? await db.from("telematica_vehicles")
        .select("id, client_id, device_id, plate, alias, active").in("client_id", ids).order("alias")
    : { data: [], error: null };
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const stats = await Promise.all((vehicles ?? []).map(async v => {
    const [{ count }, first, last] = await Promise.all([
      db.from("telematica_points").select("id", { count: "exact", head: true }).eq("vehicle_id", v.id),
      db.from("telematica_points").select("ts").eq("vehicle_id", v.id).order("ts", { ascending: true }).limit(1),
      db.from("telematica_points").select("ts").eq("vehicle_id", v.id).order("ts", { ascending: false }).limit(1),
    ]);
    return { ...v, points: count ?? 0, ts_min: first.data?.[0]?.ts ?? null, ts_max: last.data?.[0]?.ts ?? null };
  }));

  return NextResponse.json({
    fleets: (fleets ?? []).map(f => ({ ...f, vehicles: stats.filter(v => v.client_id === f.id) })),
  });
}
