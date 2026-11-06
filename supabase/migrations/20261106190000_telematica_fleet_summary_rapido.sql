-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · tablero de flotilla rápido — 2026-11-06
-- Con el historial completo de SELOME (22 unidades, ~440 mil puntos) el resumen
-- de 30 días tardaba >10 s sobre los puntos crudos y la API lo cortaba
-- ("canceling statement due to statement timeout", límite 8 s).
-- Ahora los totales por unidad y por día salen de telematica_daily_stats
-- (migración 20261106180000) y de los puntos solo se leen agregados simples
-- (sin funciones de ventana) y la última posición de cada unidad por índice.
-- Diferencia aceptada: un exceso que cruza la medianoche cuenta en ambos días.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.telematica_fleet_summary(p_client uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with cfg as (
  select coalesce(s.work_start_hour, 7)::smallint ws, coalesce(s.work_end_hour, 19)::smallint we,
         coalesce(s.work_days, '{1,2,3,4,5,6}')::smallint[] wd, s.sat_end_hour se, coalesce(s.speeding_kmh, 80) vlim
  from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
),
rng as (
  select (p_from at time zone 'America/Mexico_City')::date d0, (p_to at time zone 'America/Mexico_City')::date d1
),
ds as (
  select * from telematica_daily_stats
  where client_id = p_client and day between (select d0 from rng) and (select d1 from rng)
),
per_vehicle as (
  select vehicle_id,
         sum(km) km, sum(moving_min) moving_min,
         count(*) filter (where moving_min > 0) active_days,
         max(vmax) vmax, sum(speeding) speeding, sum(km_after_hours) km_after_hours
  from ds group by vehicle_id
),
flags as (
  select vehicle_id,
         count(*) filter (where event_code = 13
                          and extract(hour from ts at time zone 'America/Mexico_City') < 5) night_starts,
         bool_or(ignition) ign_seen,
         count(*) filter (where event_code in (13, 14)) ign_events,
         count(speed_kmh) speed_reported,
         (max(odometer_m) = min(odometer_m) and count(odometer_m) > 10) odo_frozen
  from telematica_points
  where client_id = p_client and ts >= p_from and ts <= p_to
  group by vehicle_id
),
daily as (
  select day, round(sum(km), 2) km from ds group by day order by day
)
select jsonb_build_object(
  'vehicles', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'device_id', v.device_id, 'alias', v.alias, 'plate', v.plate,
      'photo_url', v.photo_url,
      'fuel_km_per_l', v.fuel_km_per_l,
      'km', coalesce(pv.km, 0), 'moving_min', coalesce(pv.moving_min, 0),
      'active_days', coalesce(pv.active_days, 0), 'vmax', coalesce(pv.vmax, 0),
      'speeding', coalesce(pv.speeding, 0), 'km_after_hours', coalesce(pv.km_after_hours, 0),
      'night_starts', coalesce(f.night_starts, 0),
      'ign_reported', coalesce(f.ign_seen, false) or coalesce(f.ign_events, 0) > 0,
      'speed_reported', coalesce(f.speed_reported, 0) > 0,
      'odo_frozen', coalesce(f.odo_frozen, false),
      'last_ts', lp.ts, 'last_lat', lp.lat, 'last_lon', lp.lon, 'last_address', lp.address
    ) order by coalesce(pv.km, 0) desc)
    from telematica_vehicles v
    left join per_vehicle pv on pv.vehicle_id = v.id
    left join flags f on f.vehicle_id = v.id
    left join lateral (
      select ts, lat, lon, address from telematica_points tp
      where tp.vehicle_id = v.id and tp.ts <= p_to
      order by tp.ts desc limit 1
    ) lp on true
    where v.client_id = p_client and v.active
  ), '[]'::jsonb),
  'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'km', km)) from daily), '[]'::jsonb),
  'settings', (select to_jsonb(c) from cfg c)
);
$function$;
