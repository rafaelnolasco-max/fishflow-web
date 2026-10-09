-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · tablero de flotilla (vista del dueño) — 2026-10-09
--
-- 1. telematica_fleet_settings: por flotilla, precio del combustible y horario
--    laboral (para detectar uso fuera de horario). Default Lun–Sáb 7:00–19:00.
-- 2. telematica_vehicles.fuel_km_per_l: rendimiento por unidad (estimado,
--    editable). Sin sensor de combustible, litros = km ÷ rendimiento.
-- 3. telematica_fleet_summary(): agrega en Postgres los puntos de toda la
--    flotilla en un rango (una flotilla de 18 camiones son ~180 mil puntos al
--    mes: no se mandan al navegador). Mismos criterios que el tablero por unidad:
--      · km: suma de distancias entre reportes, sin huecos (>20 min y >0.8 km)
--        ni saltos de más de 5 km
--      · en movimiento: <10 min entre reportes y (velocidad >3 km/h o >150 m)
--      · velocidad: la reportada; si el equipo nunca la manda, la calculada con
--        reportes a ≤5 min (promedio del tramo, tope 140 km/h)
--      · excesos: episodios separados por más de 10 min, no puntos
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.telematica_fleet_settings (
  client_id       uuid primary key references public.clients(id) on delete cascade,
  fuel_price_mxn  numeric(8,2),
  work_start_hour smallint not null default 7,
  work_end_hour   smallint not null default 19,
  work_days       smallint[] not null default '{1,2,3,4,5,6}',   -- ISO: 1 = lunes … 7 = domingo
  speeding_kmh    smallint not null default 80,
  updated_at      timestamptz not null default now()
);
alter table public.telematica_fleet_settings enable row level security;
create policy telematica_fleet_settings_access on public.telematica_fleet_settings for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));

alter table public.telematica_vehicles
  add column if not exists fuel_km_per_l numeric(5,2);

create or replace function public.telematica_fleet_summary(
  p_client uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
with cfg as (
  select coalesce(s.work_start_hour, 7) ws, coalesce(s.work_end_hour, 19) we,
         coalesce(s.work_days, '{1,2,3,4,5,6}') wd, coalesce(s.speeding_kmh, 80) vlim
  from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
),
p as (
  select vehicle_id, ts, lat, lon, speed_kmh, ignition, event_code, odometer_m,
         lag(ts)  over w as pts, lag(lat) over w as plat, lag(lon) over w as plon,
         count(speed_kmh) over (partition by vehicle_id) > 0 as has_speed
  from telematica_points
  where client_id = p_client and ts >= p_from and ts <= p_to
  window w as (partition by vehicle_id order by ts)
),
s as (
  select p.*,
         2 * 6371 * asin(sqrt(power(sin(radians(lat - plat) / 2), 2)
           + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2))) as d_km,
         extract(epoch from ts - pts) / 60.0 as m,
         (ts at time zone 'America/Mexico_City') as lt
  from p where pts is not null
),
s2 as (
  select s.*,
         case when (m > 20 and d_km > 0.8) or d_km >= 5 then 0 else d_km end as d_ok,
         (m < 10 and (coalesce(speed_kmh, 0) > 3 or d_km > 0.15)) as moving,
         -- velocidad reportada; si el equipo nunca la manda, la promedio del tramo (≤5 min, tope 140)
         case when has_speed then coalesce(speed_kmh, 0)
              when m between 0.5 and 5 and d_km / (m / 60) <= 140 then d_km / (m / 60)
              else 0 end as v_eff,
         not (extract(isodow from lt)::int = any (c.wd::int[])
              and extract(hour from lt) >= c.ws
              and extract(hour from lt) <  c.we) as after_hours
  from s cross join cfg c
),
s3 as (
  select s2.*, (v_eff >= (select vlim from cfg)) as over_lim from s2
),
excesos as (
  -- un exceso = un episodio: un punto sobre el límite cuenta como nuevo solo si el
  -- anterior sobre el límite fue hace más de 10 min (evita contar el mismo tramo
  -- de carretera muchas veces cuando la velocidad oscila alrededor del límite)
  select vehicle_id, count(*) filter (where prev is null or ts - prev > interval '10 minutes') as n
  from (select vehicle_id, ts, lag(ts) over (partition by vehicle_id order by ts) as prev
        from s3 where over_lim) o
  group by vehicle_id
),
per_vehicle as (
  select vehicle_id,
         round(sum(d_ok)::numeric, 2) as km,
         round(sum(case when moving then m else 0 end)::numeric, 1) as moving_min,
         count(distinct (lt::date)) filter (where moving) as active_days,
         round(max(v_eff)::numeric, 0) as vmax,
         round(sum(case when after_hours then d_ok else 0 end)::numeric, 2) as km_after_hours,
         count(*) filter (where event_code = 13
                          and extract(hour from lt) < 5) as night_starts,
         bool_or(ignition) as ign_seen,
         count(*) filter (where event_code in (13, 14)) as ign_events,
         count(speed_kmh) as speed_reported,
         (max(odometer_m) = min(odometer_m) and count(odometer_m) > 10) as odo_frozen
  from s3 group by vehicle_id
),
last_pt as (
  select distinct on (vehicle_id) vehicle_id, ts, lat, lon, address
  from telematica_points where client_id = p_client and ts <= p_to
  order by vehicle_id, ts desc
),
daily as (
  select (lt::date) as day, round(sum(d_ok)::numeric, 2) as km
  from s2 group by 1 order by 1
)
select jsonb_build_object(
  'vehicles', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'device_id', v.device_id, 'alias', v.alias, 'plate', v.plate,
      'fuel_km_per_l', v.fuel_km_per_l,
      'km', coalesce(pv.km, 0), 'moving_min', coalesce(pv.moving_min, 0),
      'active_days', coalesce(pv.active_days, 0), 'vmax', coalesce(pv.vmax, 0),
      'speeding', coalesce(ex.n, 0), 'km_after_hours', coalesce(pv.km_after_hours, 0),
      'night_starts', coalesce(pv.night_starts, 0),
      'ign_reported', coalesce(pv.ign_seen, false) or coalesce(pv.ign_events, 0) > 0,
      'speed_reported', coalesce(pv.speed_reported, 0) > 0,
      'odo_frozen', coalesce(pv.odo_frozen, false),
      'last_ts', lp.ts, 'last_lat', lp.lat, 'last_lon', lp.lon, 'last_address', lp.address
    ) order by coalesce(pv.km, 0) desc)
    from telematica_vehicles v
    left join per_vehicle pv on pv.vehicle_id = v.id
    left join last_pt lp on lp.vehicle_id = v.id
    left join excesos ex on ex.vehicle_id = v.id
    where v.client_id = p_client and v.active
  ), '[]'::jsonb),
  'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'km', km)) from daily), '[]'::jsonb),
  'settings', (select to_jsonb(c) from cfg c)
);
$$;

revoke all on function public.telematica_fleet_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.telematica_fleet_summary(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Rendimiento por defecto de la flotilla (km/l) para las unidades sin uno propio
alter table public.telematica_fleet_settings add column if not exists default_km_per_l numeric(5,2) not null default 8;
