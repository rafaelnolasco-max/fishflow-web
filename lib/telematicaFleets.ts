// FishFlow — Telemática: flotillas con sus unidades, puntos y rango de fechas.
// Lo usan /api/telematica/fleets (panel de Lukon) y /api/telematica/pin/fleet (vista por NIP).
import type { SupabaseClient } from "@supabase/supabase-js";

type FleetRow = { id: string; name: string; slug: string; active?: boolean | null };

export async function fleetsWithVehicles(db: SupabaseClient, fleets: FleetRow[]) {
  const ids = fleets.map(f => f.id);
  const { data: vehicles, error: vErr } = ids.length
    ? await db.from("telematica_vehicles")
        .select("id, client_id, device_id, plate, alias, photo_url, active").in("client_id", ids).order("alias")
    : { data: [], error: null };
  if (vErr) throw new Error(vErr.message);

  // Puntos por unidad: suma del resumen diario (contar 400 mil puntos crudos unidad por unidad tardaba ~8 s)
  const { data: daily, error: dErr } = ids.length
    ? await db.rpc("telematica_points_by_vehicle", { p_clients: ids })
    : { data: [], error: null };
  if (dErr) throw new Error(dErr.message);
  const pointsBy = new Map<string, number>();
  for (const d of (daily ?? []) as { vehicle_id: string; points: number }[]) pointsBy.set(d.vehicle_id, Number(d.points));

  const stats = await Promise.all((vehicles ?? []).map(async v => {
    const [first, last] = await Promise.all([
      db.from("telematica_points").select("ts").eq("vehicle_id", v.id).order("ts", { ascending: true }).limit(1),
      db.from("telematica_points").select("ts").eq("vehicle_id", v.id).order("ts", { ascending: false }).limit(1),
    ]);
    return { ...v, points: pointsBy.get(v.id) ?? 0, ts_min: first.data?.[0]?.ts ?? null, ts_max: last.data?.[0]?.ts ?? null };
  }));

  return fleets.map(f => ({ ...f, vehicles: stats.filter(v => v.client_id === f.id) }));
}
