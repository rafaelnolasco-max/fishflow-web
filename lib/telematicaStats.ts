// FishFlow — Telemática: recálculo del resumen diario (telematica_daily_stats).
// El reporte mensual y el tablero de flotilla leen de esa tabla en vez de los
// puntos crudos (con 400 mil puntos el cálculo directo pasa del límite de 8 s
// de la API). Se recalcula en tramos de 10 días: un mes completo de una flotilla
// de 22 unidades tarda ~6 s, demasiado cerca del límite.

import type { SupabaseClient } from "@supabase/supabase-js";

const day = (d: Date) => d.toISOString().slice(0, 10);

const STEP_DAYS = 10;

/** Recalcula los días [from, to] (YYYY-MM-DD, hora CDMX) de una flotilla, en tramos de STEP_DAYS. */
export async function refreshDailyStats(db: SupabaseClient, clientId: string, from: string, to: string) {
  let cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cur <= end) {
    const stepEnd = new Date(cur.getTime() + (STEP_DAYS - 1) * 86400e3);
    const stop = stepEnd < end ? stepEnd : end;
    const { error } = await db.rpc("telematica_refresh_daily_stats", { p_client: clientId, p_from: day(cur), p_to: day(stop) });
    if (error) throw new Error(`Resumen diario ${day(cur)}–${day(stop)}: ${error.message}`);
    cur = new Date(stop.getTime() + 86400e3);
  }
}

/** Día CDMX (UTC-6 fijo) de un timestamp ISO. */
export const cdmxDay = (iso: string) => new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 10);
