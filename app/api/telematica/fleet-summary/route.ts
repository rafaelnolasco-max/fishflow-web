// GET /api/telematica/fleet-summary?client_id=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Resumen de toda la flotilla (vista del dueño). El cálculo pesado vive en la
// función SQL telematica_fleet_summary (migración 20261009230000). Sin rango:
// los últimos 30 días hasta el último reporte de la flotilla.

import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
  const auth = await requireFleetAccess(clientId);
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const isDay = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = sp.get("from"), to = sp.get("to");
  if (!isDay(from) || !isDay(to)) {
    const { data: last, error } = await db.from("telematica_points").select("ts")
      .eq("client_id", clientId).order("ts", { ascending: false }).limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!last?.length) return NextResponse.json({ from: null, to: null, vehicles: [], daily: [], settings: null });
    const end = new Date(new Date(last[0].ts).getTime() - 6 * 3600e3);   // día CDMX
    to = end.toISOString().slice(0, 10);
    from = new Date(end.getTime() - 29 * 86400e3).toISOString().slice(0, 10);
  }

  const [{ data, error }, { data: settings, error: sErr }] = await Promise.all([
    db.rpc("telematica_fleet_summary", {
      p_client: clientId, p_from: `${from}T00:00:00-06:00`, p_to: `${to}T23:59:59.999-06:00`,
    }),
    db.from("telematica_fleet_settings").select("fuel_price_mxn, default_km_per_l, work_start_hour, work_end_hour, work_days, speeding_kmh")
      .eq("client_id", clientId).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  return NextResponse.json({
    from, to, ...(data as object),
    settings: settings ?? { fuel_price_mxn: null, default_km_per_l: 8, work_start_hour: 7, work_end_hour: 19, work_days: [1, 2, 3, 4, 5, 6], speeding_kmh: 80 },
  });
}
