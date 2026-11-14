// Supabase Edge Function — redgps-sync
// Baja de la API de RedGPS el historial nuevo de cada unidad y lo guarda en
// telematica_points; después recalcula telematica_daily_stats. La dispara
// pg_cron cada 15 minutos (job `redgps-sync-15min`).
//
// API (docs.redgps.com/books/webservice/es), base https://api.service24gps.com/api/v1
//   gettoken     apikey + username + password (token vacío) → token de 6 horas
//   history/get  apikey + token + equipo + fechaIni/fechaFin (máx. 15 días por equipo)
// Cada cliente de RedGPS tiene su propia apikey y su propio usuario.
//
// Cuentas: tabla telematica_redgps_accounts (una por flotilla). Las llaves y
// contraseñas viven en Vault y se leen con la RPC telematica_redgps_accounts_secrets()
// (solo service_role). Una cuenta con enabled = false no se toca en el cron.
//
// Autenticación: verify_jwt = false + cabecera `x-redgps-token`, que se compara
// contra el secreto `redgps_sync_token` del Vault.
//
// Body (todo opcional):
//   client   slug o id de una sola flotilla (corre aunque esté enabled = false)
//   dry_run  true = baja y compara contra lo ya guardado, pero no escribe nada
//   hours    horas hacia atrás a pedir, en vez de retomar desde el último punto
//   sample   con dry_run: cuántos renglones crudos de RedGPS devolver (para revisar el formato)

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://api.service24gps.com/api/v1";
const TZ = "America/Mexico_City";
const MAX_BACK_H = 14 * 24;      // la API da máx. 15 días por equipo
const NEW_UNIT_BACK_H = 48;      // unidad sin puntos: últimos 2 días
const OVERLAP_MIN = 10;          // se vuelve a pedir un poco antes del último punto
const CONCURRENCY = 4;
const CHUNK = 1000;

interface Account {
  client_id: string; slug: string; username: string | null; apikey: string | null; password: string | null;
  enabled: boolean; token: string | null; token_expires_at: string | null; fail_count: number;
}
interface Row { [k: string]: unknown }
interface Point {
  client_id: string; vehicle_id: string; ts: string; lat: number; lon: number;
  speed_kmh: number | null; heading: number | null; event_code: number | null; ignition: boolean | null;
  odometer_m: number | null; sats: number | null; gsm_signal: number | null;
  batt_gps_pct: number | null; batt_vehicle_v: number | null; address: string | null;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

/** "YYYY-MM-DD HH:MM:SS" en hora de CDMX */
function local(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(String(x).replace("+", ""));
  return Number.isFinite(n) ? n : null;
};
const int = (x: unknown): number | null => { const n = num(x); return n === null ? null : Math.round(n); };
const decode = (s: string) => s
  .replace(/&([aeiouAEIOU])acute;/g, (_, c) => ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" } as Record<string, string>)[c])
  .replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ").replace(/&uuml;/g, "ü").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

/** Renglón de history/get → punto. La hora viene en la zona del campo `gmt` (CDMX = -6). */
function toPoint(r: Row, clientId: string, vehicleId: string): Point | null {
  const lat = num(r.latitud), lon = num(r.longitud);
  const fecha = String(r.fecha ?? ""), hora = String(r.hora ?? "");
  if (lat === null || lon === null || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}:\d{2}$/.test(hora)) return null;
  if (lat === 0 && lon === 0) return null;
  const g = num(r.gmt) ?? -6;
  const sign = g < 0 ? "-" : "+", abs = Math.abs(g);
  const off = `${sign}${String(Math.floor(abs)).padStart(2, "0")}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")}`;
  const ign = String(r.ignicion ?? "");
  const batt = num(r.bateria_gps);
  return {
    client_id: clientId, vehicle_id: vehicleId, ts: `${fecha}T${hora}${off}`, lat, lon,
    speed_kmh: int(r.velocidad), heading: int(r.orientacion), event_code: int(r.idevento),
    ignition: ign === "1" ? true : ign === "0" ? false : null,
    odometer_m: int(r.odometro), sats: int(r.satelites), gsm_signal: int(r.senal),
    batt_gps_pct: batt === null ? null : Math.max(0, Math.min(100, Math.round(batt))),
    batt_vehicle_v: num(r.bateria_veh),
    address: r.domicilio ? decode(String(r.domicilio)).slice(0, 300) : null,
  };
}

async function api(method: string, fields: Record<string, string>): Promise<{ status: number; data: unknown; raw: Row }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${API}/${method}`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let raw: Row;
  try { raw = JSON.parse(text); } catch { raw = { status: res.status, data: text.slice(0, 300) }; }
  return { status: Number(raw.status ?? res.status), data: raw.data, raw };
}

async function getToken(sb: SupabaseClient, a: Account, force = false): Promise<string> {
  if (!force && a.token && a.token_expires_at && new Date(a.token_expires_at).getTime() - Date.now() > 10 * 60_000) return a.token;
  if (!a.apikey) throw new Error("falta la apikey en Vault");
  if (!a.username || !a.password) throw new Error("faltan usuario o contraseña de RedGPS");
  const r = await api("gettoken", { apikey: a.apikey, token: "", username: a.username, password: a.password });
  if (r.status !== 200 || typeof r.data !== "string" || !r.data) {
    throw new Error(`gettoken respondió ${r.status}: ${JSON.stringify(r.data ?? r.raw).slice(0, 200)}`);
  }
  a.token = r.data;
  a.token_expires_at = new Date(Date.now() + 5.5 * 3600_000).toISOString();
  const { error } = await sb.from("telematica_redgps_accounts")
    .update({ token: a.token, token_expires_at: a.token_expires_at }).eq("client_id", a.client_id);
  if (error) throw new Error(error.message);
  return a.token;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function syncAccount(sb: SupabaseClient, a: Account, opt: { dryRun: boolean; hours?: number; sample: number }) {
  const out = {
    client: a.slug, ok: false, units: 0, units_with_data: 0, fetched: 0, inserted: 0, skipped_rows: 0,
    already_stored: 0, errors: [] as string[], samples: [] as unknown[], range: null as null | { from: string; to: string },
    stats_rows: null as number | null,
  };
  const now = new Date();
  try {
    let token = await getToken(sb, a);
    const { data: vehicles, error: vErr } = await sb.rpc("telematica_last_ts", { p_client: a.client_id });
    if (vErr) throw new Error(vErr.message);
    const units = (vehicles ?? []) as { vehicle_id: string; device_id: string; last_ts: string | null }[];
    out.units = units.length;
    let minTs = null as string | null, maxTs = null as string | null;
    let tokenRefreshed = false, stop = false;

    await pool(units, CONCURRENCY, async (u) => {
      if (stop) return;
      const backMs = opt.hours ? opt.hours * 3600_000
        : u.last_ts ? Math.min(MAX_BACK_H * 3600_000, now.getTime() - new Date(u.last_ts).getTime() + OVERLAP_MIN * 60_000)
        : NEW_UNIT_BACK_H * 3600_000;
      const from = new Date(now.getTime() - Math.min(backMs, MAX_BACK_H * 3600_000));
      const fields = { apikey: a.apikey!, token, equipo: u.device_id, fechaIni: local(from), fechaFin: local(new Date(now.getTime() + 3600_000)), format: "DateTime" };
      let r = await api("history/get", fields);
      // Token vencido o inválido: se renueva una sola vez por corrida
      if (r.status !== 200 && !Array.isArray(r.data) && /token/i.test(JSON.stringify(r.raw)) && !tokenRefreshed) {
        tokenRefreshed = true;
        token = await getToken(sb, a, true);
        r = await api("history/get", { ...fields, token });
      }
      if (r.status !== 200 || !Array.isArray(r.data)) {
        // Sin datos en el rango no es error
        const msg = JSON.stringify(r.data ?? r.raw).slice(0, 160);
        if (!/sin datos|no data|no se encontr|no existen|vac[ií]o/i.test(msg) && !(r.status === 200 && !r.data)) {
          out.errors.push(`${u.device_id}: ${r.status} ${msg}`);
          if (r.status === 429 || /l[ií]mite|limit|too many/i.test(msg)) stop = true;
        }
        return;
      }
      const rows = r.data as Row[];
      if (opt.dryRun && out.samples.length < opt.sample) out.samples.push(...rows.slice(-Math.min(2, opt.sample - out.samples.length)));
      const seen = new Set<string>();
      const points: Point[] = [];
      for (const row of rows) {
        const p = toPoint(row, a.client_id, u.vehicle_id);
        if (!p) { out.skipped_rows++; continue; }
        const k = `${new Date(p.ts).getTime()}|${p.event_code}`;
        if (seen.has(k)) continue;
        seen.add(k); points.push(p);
      }
      out.fetched += points.length;
      if (!points.length) return;
      out.units_with_data++;
      for (const p of points) {
        if (!minTs || p.ts < minTs) minTs = p.ts;   // misma zona en toda la cuenta: se comparan como texto
        if (!maxTs || p.ts > maxTs) maxTs = p.ts;
      }
      if (opt.dryRun) {
        // ¿Cuántos de estos puntos ya están guardados? Si la zona horaria estuviera mal, casi ninguno.
        const { data: ex, error } = await sb.from("telematica_points").select("ts, event_code")
          .eq("vehicle_id", u.vehicle_id).gte("ts", new Date(from).toISOString()).limit(20000);
        if (error) { out.errors.push(`${u.device_id}: ${error.message}`); return; }
        const have = new Set((ex ?? []).map(e => `${new Date(e.ts).getTime()}|${e.event_code}`));
        out.already_stored += points.filter(p => have.has(`${new Date(p.ts).getTime()}|${p.event_code}`)).length;
        return;
      }
      for (let i = 0; i < points.length; i += CHUNK) {
        const { data, error } = await sb.from("telematica_points")
          .upsert(points.slice(i, i + CHUNK), { onConflict: "vehicle_id,ts,event_code", ignoreDuplicates: true })
          .select("id");
        if (error) { out.errors.push(`${u.device_id}: ${error.message}`); return; }
        out.inserted += data?.length ?? 0;
      }
    });

    if (minTs && maxTs) out.range = { from: minTs, to: maxTs };
    if (!opt.dryRun && out.inserted > 0 && minTs) {
      const day = (iso: string) => local(new Date(iso)).slice(0, 10);
      const { data: n, error } = await sb.rpc("telematica_refresh_daily_stats", { p_client: a.client_id, p_from: day(minTs), p_to: day(now.toISOString()) });
      if (error) out.errors.push(`resumen diario: ${error.message}`); else out.stats_rows = n as number;
    }
    out.ok = out.errors.length === 0;
  } catch (e) {
    out.errors.push((e as Error).message);
  }
  if (!opt.dryRun) {
    const { error } = await sb.from("telematica_redgps_accounts").update({
      last_run_at: now.toISOString(),
      ...(out.ok ? { last_ok_at: now.toISOString(), last_error: null, fail_count: 0 }
                 : { last_error: out.errors.slice(0, 5).join(" · ").slice(0, 1000), fail_count: a.fail_count + 1 }),
      last_points: out.inserted,
    }).eq("client_id", a.client_id);
    if (error) out.errors.push(error.message);
  }
  return out;
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: token, error: te } = await sb.rpc("telematica_redgps_sync_token");
  if (te || !token || req.headers.get("x-redgps-token") !== token) return json({ error: "no autorizado" }, 401);

  let body: { client?: string; dry_run?: boolean; hours?: number; sample?: number } = {};
  try { body = await req.json(); } catch { /* sin body */ }

  const { data, error } = await sb.rpc("telematica_redgps_accounts_secrets");
  if (error) return json({ error: error.message }, 500);
  let accounts = (data ?? []) as Account[];
  accounts = body.client
    ? accounts.filter(a => a.slug === body.client || a.client_id === body.client)
    : accounts.filter(a => a.enabled);

  const results = [];
  for (const a of accounts) {
    results.push(await syncAccount(sb, a, {
      dryRun: !!body.dry_run,
      hours: body.hours ? Math.min(Number(body.hours), MAX_BACK_H) : undefined,
      sample: body.dry_run ? Math.min(Number(body.sample ?? 4), 10) : 0,
    }));
  }
  return json({ ran_at: new Date().toISOString(), accounts: results.length, results });
});
