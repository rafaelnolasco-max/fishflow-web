// GET /api/telematica/track?vehicle_id=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Puntos de una unidad en un rango de días (hora CDMX, ambos días incluidos),
// en orden, listos para el mapa con reproducción. Sin `from`/`to`: últimos 7
// días con datos de esa unidad.

import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";

const PAGE = 1000;          // tope de filas por consulta de PostgREST
const MAX_POINTS = 60000;   // ~1 año de una unidad; corta antes de reventar el navegador

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const vehicleId = sp.get("vehicle_id");
  if (!vehicleId) return NextResponse.json({ error: "Falta vehicle_id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: v, error: vErr } = await db.from("telematica_vehicles")
    .select("id, client_id, device_id, plate, alias").eq("id", vehicleId).maybeSingle();
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!v) return NextResponse.json({ error: "Unidad no encontrada" }, { status: 404 });

  const auth = await requireFleetAccess(v.client_id);
  if (!auth.ok) return auth.response;

  const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = sp.get("from"), to = sp.get("to");
  if (!isDay(from) || !isDay(to)) {
    const { data: last } = await db.from("telematica_points").select("ts")
      .eq("vehicle_id", v.id).order("ts", { ascending: false }).limit(1);
    if (!last?.length) return NextResponse.json({ vehicle: v, from: null, to: null, points: [] });
    // Día local CDMX (UTC-6) del último punto
    const end = new Date(new Date(last[0].ts).getTime() - 6 * 3600e3);
    const start = new Date(end.getTime() - 6 * 86400e3);
    to = end.toISOString().slice(0, 10);
    from = start.toISOString().slice(0, 10);
  }
  const fromTs = `${from}T00:00:00-06:00`;
  const toTs = `${to}T23:59:59.999-06:00`;

  const points: unknown[] = [];
  for (let off = 0; off < MAX_POINTS; off += PAGE) {
    const { data, error } = await db.from("telematica_points")
      .select("ts, lat, lon, speed_kmh, heading, ignition, event_code, address")
      .eq("vehicle_id", v.id).gte("ts", fromTs).lte("ts", toTs)
      .order("ts", { ascending: true }).range(off, off + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    points.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return NextResponse.json({ vehicle: v, from, to, points, truncated: points.length >= MAX_POINTS });
}
