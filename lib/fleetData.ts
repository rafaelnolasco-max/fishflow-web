// FishFlow — Telemática: consultas fijas sobre una flotilla, ya sumadas por unidad.
// Las usan el bot de preguntas (lib/fleetBot.ts) y el resumen semanal por correo
// (lib/fleetWeekly.ts). La fuente es telematica_daily_stats (unidad × día, hora CDMX),
// así que todo cuadra con el Reporte mensual y la vista Flotilla.

import type { SupabaseClient } from "@supabase/supabase-js";

export const TZ = "America/Mexico_City";

export interface FleetVehicle {
  id: string; alias: string | null; plate: string | null; device_id: string;
  vehicle_desc: string | null; vehicle_class: string | null; fuel_km_per_l: number | null;
}
export interface FleetSettings {
  fuel_price_mxn: number | null; default_km_per_l: number; speeding_kmh: number;
  work_start_hour: number; work_end_hour: number; sat_end_hour: number | null; work_days: number[] | null;
}
export interface FleetContext { id: string; name: string; slug: string; vehicles: FleetVehicle[]; settings: FleetSettings }

export interface DailyRow {
  vehicle_id: string; day: string; km: number; moving_min: number; idle_min: number; km_after_hours: number;
  speeding: number; vmax: number | null; first_move: string | null; last_move: string | null;
  harsh_accel: number; harsh_accel_low: number; harsh_brake: number; starts: number;
  km_night: number; night_min: number; max_drive_min: number; long_drives: number;
  batt_v_rest: number | null; batt_v_min: number | null; power_cut: number;
}

export const vehName = (v: Pick<FleetVehicle, "alias" | "plate" | "device_id">) =>
  `${v.alias ?? v.device_id}${v.plate ? ` (${v.plate})` : ""}`;

/** Fecha YYYY-MM-DD de hoy en CDMX (o desplazada n días). */
export function todayCdmx(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export async function loadFleet(db: SupabaseClient, clientId: string): Promise<FleetContext | null> {
  const [c, v, s] = await Promise.all([
    db.from("clients").select("id, name, slug").eq("id", clientId).maybeSingle(),
    db.from("telematica_vehicles")
      .select("id, alias, plate, device_id, vehicle_desc, vehicle_class, fuel_km_per_l, active")
      .eq("client_id", clientId).order("alias"),
    db.from("telematica_fleet_settings").select("*").eq("client_id", clientId).maybeSingle(),
  ]);
  if (!c.data) return null;
  const st = s.data ?? {};
  return {
    ...c.data,
    vehicles: (v.data ?? []).filter(x => x.active !== false).map(x => ({ ...x, fuel_km_per_l: x.fuel_km_per_l != null ? Number(x.fuel_km_per_l) : null })),
    settings: {
      fuel_price_mxn: st.fuel_price_mxn != null ? Number(st.fuel_price_mxn) : null,
      default_km_per_l: Number(st.default_km_per_l ?? 8),
      speeding_kmh: Number(st.speeding_kmh ?? 80),
      work_start_hour: Number(st.work_start_hour ?? 7),
      work_end_hour: Number(st.work_end_hour ?? 19),
      sat_end_hour: st.sat_end_hour != null ? Number(st.sat_end_hour) : null,
      work_days: st.work_days ?? null,
    },
  };
}

/** Filas diarias de la flotilla en [desde, hasta] (fechas CDMX, inclusive). Pagina de 1000 en 1000. */
export async function dailyStats(db: SupabaseClient, clientId: string, desde: string, hasta: string, vehicleId?: string) {
  const out: DailyRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("telematica_daily_stats")
      .select("vehicle_id, day, km, moving_min, idle_min, km_after_hours, speeding, vmax, first_move, last_move, harsh_accel, harsh_accel_low, harsh_brake, starts, km_night, night_min, max_drive_min, long_drives, batt_v_rest, batt_v_min, power_cut")
      .eq("client_id", clientId).gte("day", desde).lte("day", hasta).order("day").order("vehicle_id")
      .range(from, from + 999);
    if (vehicleId) q = q.eq("vehicle_id", vehicleId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as DailyRow[]).map(r => ({
      ...r,
      km: Number(r.km) || 0, moving_min: Number(r.moving_min) || 0, idle_min: Number(r.idle_min) || 0,
      km_after_hours: Number(r.km_after_hours) || 0, km_night: Number(r.km_night) || 0,
      night_min: Number(r.night_min) || 0, max_drive_min: Number(r.max_drive_min) || 0,
      batt_v_rest: r.batt_v_rest != null ? Number(r.batt_v_rest) : null,
      batt_v_min: r.batt_v_min != null ? Number(r.batt_v_min) : null,
    })));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const h = (min: number) => r1(min / 60);

export interface VehicleSummary {
  unidad: string; vehicle_id: string; tipo: string | null;
  km: number; dias_con_uso: number; horas_en_movimiento: number; horas_ralenti: number;
  pct_ralenti: number; km_fuera_de_horario: number; km_de_noche: number;
  excesos_velocidad: number; vel_max_kmh: number | null; dia_vel_max: string | null;
  aceleraciones_bruscas: number; frenadas_bruscas: number; arrancones: number; encendidos: number;
  eventos_bruscos_por_100km: number | null;
  jornada_continua_mas_larga_h: number; tramos_largos_sin_pausa: number;
  litros_estimados: number; rendimiento_km_l: number; costo_combustible_mxn: number | null;
  bateria_reposo_min_v: number | null; dias_bateria_baja: number; dias_sin_corriente: number;
  primera_salida_mas_temprana: string | null; ultimo_movimiento_mas_tarde: string | null;
}

/** Suma por unidad + total de flotilla. */
export function summarize(fleet: FleetContext, rows: DailyRow[]) {
  const byV = new Map<string, DailyRow[]>();
  for (const r of rows) (byV.get(r.vehicle_id) ?? byV.set(r.vehicle_id, []).get(r.vehicle_id)!).push(r);

  const units: VehicleSummary[] = fleet.vehicles.map(v => {
    const rs = byV.get(v.id) ?? [];
    const sum = (k: keyof DailyRow) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const km = sum("km"), moving = sum("moving_min"), idle = sum("idle_min");
    const kml = v.fuel_km_per_l ?? fleet.settings.default_km_per_l;
    const litros = km / kml;
    const vmaxRow = rs.reduce<DailyRow | null>((a, r) => (r.vmax ?? 0) > (a?.vmax ?? -1) ? r : a, null);
    const harsh = sum("harsh_accel") + sum("harsh_brake");
    const rests = rs.map(r => r.batt_v_rest).filter((x): x is number => x != null && x > 0);
    const firsts = rs.map(r => r.first_move).filter(Boolean).sort() as string[];
    const lasts = rs.map(r => r.last_move).filter(Boolean).sort() as string[];
    return {
      unidad: vehName(v), vehicle_id: v.id, tipo: v.vehicle_desc ?? v.vehicle_class,
      km: r1(km), dias_con_uso: rs.filter(r => r.km >= 1).length,
      horas_en_movimiento: h(moving), horas_ralenti: h(idle),
      pct_ralenti: moving + idle > 0 ? Math.round((idle / (moving + idle)) * 100) : 0,
      km_fuera_de_horario: r1(sum("km_after_hours")), km_de_noche: r1(sum("km_night")),
      excesos_velocidad: sum("speeding"), vel_max_kmh: vmaxRow?.vmax ?? null, dia_vel_max: vmaxRow?.day ?? null,
      aceleraciones_bruscas: sum("harsh_accel"), frenadas_bruscas: sum("harsh_brake"),
      arrancones: sum("harsh_accel_low"), encendidos: sum("starts"),
      eventos_bruscos_por_100km: km >= 200 ? r1((harsh / km) * 100) : null,
      jornada_continua_mas_larga_h: h(Math.max(0, ...rs.map(r => r.max_drive_min))),
      tramos_largos_sin_pausa: sum("long_drives"),
      litros_estimados: Math.round(litros), rendimiento_km_l: kml,
      costo_combustible_mxn: fleet.settings.fuel_price_mxn ? Math.round(litros * fleet.settings.fuel_price_mxn) : null,
      bateria_reposo_min_v: rests.length ? Math.min(...rests) : null,
      dias_bateria_baja: rests.filter(x => x < 12).length,
      dias_sin_corriente: rs.filter(r => r.power_cut > 0 || r.batt_v_rest === 0).length,
      primera_salida_mas_temprana: firsts[0]?.slice(0, 5) ?? null,
      ultimo_movimiento_mas_tarde: lasts[lasts.length - 1]?.slice(0, 5) ?? null,
    };
  });

  const t = (k: keyof VehicleSummary) => units.reduce((a, u) => a + (Number(u[k]) || 0), 0);
  const total = {
    unidades: fleet.vehicles.length,
    unidades_con_uso: units.filter(u => u.km >= 1).length,
    km: r1(t("km")), horas_en_movimiento: r1(t("horas_en_movimiento")), horas_ralenti: r1(t("horas_ralenti")),
    km_fuera_de_horario: r1(t("km_fuera_de_horario")), km_de_noche: r1(t("km_de_noche")),
    excesos_velocidad: t("excesos_velocidad"), aceleraciones_bruscas: t("aceleraciones_bruscas"),
    frenadas_bruscas: t("frenadas_bruscas"), arrancones: t("arrancones"),
    litros_estimados: Math.round(t("litros_estimados")),
    costo_combustible_mxn: fleet.settings.fuel_price_mxn ? Math.round(t("costo_combustible_mxn")) : null,
    vel_max_kmh: Math.max(0, ...units.map(u => u.vel_max_kmh ?? 0)) || null,
  };
  return { units, total };
}

/** Último reporte de cada unidad (hora, lugar, velocidad, encendido, batería). */
export async function lastPositions(db: SupabaseClient, fleet: FleetContext, vehicleId?: string) {
  const vs = fleet.vehicles.filter(v => !vehicleId || v.id === vehicleId);
  return Promise.all(vs.map(async v => {
    const { data } = await db.from("telematica_points")
      .select("ts, lat, lon, speed_kmh, ignition, batt_vehicle_v, address")
      .eq("vehicle_id", v.id).order("ts", { ascending: false }).limit(1);
    const p = data?.[0];
    const horas = p ? r1((Date.now() - new Date(p.ts).getTime()) / 36e5) : null;
    return {
      unidad: vehName(v),
      ultimo_reporte: p ? new Date(p.ts).toLocaleString("es-MX", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : null,
      horas_desde_ultimo_reporte: horas,
      sin_reportar_24h: horas == null || horas >= 24,
      lugar: p?.address ?? null,
      lat: p?.lat ?? null, lon: p?.lon ?? null,
      velocidad_kmh: p?.speed_kmh ?? null, motor_encendido: p?.ignition ?? null,
      bateria_v: p?.batt_vehicle_v != null ? Number(p.batt_vehicle_v) : null,
    };
  }));
}

/** Cobertura de datos de la flotilla (primer y último día con estadística). */
export async function coverage(db: SupabaseClient, clientId: string) {
  const [a, b] = await Promise.all([
    db.from("telematica_daily_stats").select("day").eq("client_id", clientId).order("day", { ascending: true }).limit(1),
    db.from("telematica_daily_stats").select("day").eq("client_id", clientId).order("day", { ascending: false }).limit(1),
  ]);
  return { desde: a.data?.[0]?.day ?? null, hasta: b.data?.[0]?.day ?? null };
}
