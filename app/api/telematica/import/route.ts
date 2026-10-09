// POST /api/telematica/import
// Recibe un bloque de puntos ya parseados en el navegador (lib/telematica.ts)
// y los guarda en telematica_points. Re-subir el mismo archivo no duplica:
// unique (vehicle_id, ts, event_code) + ignoreDuplicates.
//
// Body: { client_id, device_id, filename, points[], import_id?, done? }
//   - Primer bloque sin import_id: crea la unidad si no existe y la bitácora.
//   - Bloques siguientes: mandan el import_id que regresó el primero.
//   - done: true en el último bloque cierra la bitácora con totales y fechas.

import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";
import { IMPORT_CHUNK, type TelematicaPoint } from "@/lib/telematica";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: {
    client_id?: string; device_id?: string; filename?: string;
    points?: TelematicaPoint[]; import_id?: string; done?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const { client_id, device_id, filename, points = [], done } = body;
  if (!client_id || !device_id) return NextResponse.json({ error: "Faltan client_id o device_id" }, { status: 400 });
  if (!Array.isArray(points) || points.length > IMPORT_CHUNK) {
    return NextResponse.json({ error: `Máximo ${IMPORT_CHUNK} puntos por bloque` }, { status: 400 });
  }

  const auth = await requireFleetAccess(client_id);
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();

  // Unidad: se crea sola la primera vez que aparece un equipo
  let { data: vehicle, error: vErr } = await db
    .from("telematica_vehicles").select("id")
    .eq("client_id", client_id).eq("device_id", device_id).maybeSingle();
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!vehicle) {
    const ins = await db.from("telematica_vehicles")
      .insert({ client_id, device_id }).select("id").single();
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
    vehicle = ins.data;
  }

  // Bitácora
  let importId = body.import_id;
  if (!importId) {
    const imp = await db.from("telematica_imports")
      .insert({ client_id, vehicle_id: vehicle.id, filename: filename ?? null, created_by: auth.email })
      .select("id").single();
    if (imp.error) return NextResponse.json({ error: imp.error.message }, { status: 500 });
    importId = imp.data.id;
  }

  // Puntos
  let inserted = 0;
  if (points.length) {
    const rows = points.map(p => ({
      client_id, vehicle_id: vehicle!.id,
      ts: p.ts, lat: p.lat, lon: p.lon,
      speed_kmh: p.speed_kmh, heading: p.heading, event_code: p.event_code,
      ignition: p.ignition, odometer_m: p.odometer_m, sats: p.sats,
      gsm_signal: p.gsm_signal, batt_gps_pct: p.batt_gps_pct,
      batt_vehicle_v: p.batt_vehicle_v, address: p.address,
    }));
    const { data, error } = await db.from("telematica_points")
      .upsert(rows, { onConflict: "vehicle_id,ts,event_code", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    inserted = data?.length ?? 0;
  }

  // Totales acumulados en la bitácora
  const { data: cur, error: cErr } = await db.from("telematica_imports")
    .select("rows_read, rows_inserted").eq("id", importId).single();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const patch: Record<string, unknown> = {
    rows_read: (cur?.rows_read ?? 0) + points.length,
    rows_inserted: (cur?.rows_inserted ?? 0) + inserted,
  };
  if (done) {
    const { data: range } = await db.from("telematica_points")
      .select("ts").eq("vehicle_id", vehicle.id).order("ts", { ascending: true }).limit(1);
    const { data: rangeMax } = await db.from("telematica_points")
      .select("ts").eq("vehicle_id", vehicle.id).order("ts", { ascending: false }).limit(1);
    patch.ts_min = range?.[0]?.ts ?? null;
    patch.ts_max = rangeMax?.[0]?.ts ?? null;
  }
  const { error: uErr } = await db.from("telematica_imports").update(patch).eq("id", importId);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ import_id: importId, vehicle_id: vehicle.id, inserted, read: points.length });
}
