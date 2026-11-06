// GET /api/telematica/monthly-report?client_id=<uuid>
// Reporte mensual de la flotilla (primera vista del jefe de flotilla): un
// renglón por mes con totales y detalle por unidad. Sale de
// telematica_monthly_report(), que suma telematica_daily_stats.

import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
  const auth = await requireFleetAccess(clientId);
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const [{ data, error }, { data: settings, error: sErr }] = await Promise.all([
    db.rpc("telematica_monthly_report", { p_client: clientId }),
    db.from("telematica_fleet_settings")
      .select("fuel_price_mxn, default_km_per_l, work_start_hour, work_end_hour, work_days, sat_end_hour, speeding_kmh")
      .eq("client_id", clientId).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  return NextResponse.json({
    months: data ?? [],
    settings: settings ?? { fuel_price_mxn: null, default_km_per_l: 8, work_start_hour: 7, work_end_hour: 19, work_days: [1, 2, 3, 4, 5, 6], sat_end_hour: null, speeding_kmh: 80 },
  });
}
