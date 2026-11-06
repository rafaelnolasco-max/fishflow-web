-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · reporte mensual de flotilla (vista del jefe de flotilla) — 2026-11-06
--
-- 1. telematica_fleet_settings.sat_end_hour: el sábado puede cerrar antes que
--    entre semana (SELOME: Lun–Vie 7–19, Sáb 7–15, domingo todo fuera de horario).
--    null = el sábado usa el mismo work_end_hour.
-- 2. telematica_after_hours(): una sola regla de "fuera de horario" para todas
--    las funciones.
-- 3. telematica_daily_stats: resumen por unidad y por día (hora CDMX). Calcular
--    meses sobre los puntos crudos tarda ~30 s con 400 mil puntos; el reporte
--    mensual suma estos días y responde al instante. Se recalcula con
--    telematica_refresh_daily_stats() al importar datos.
--    Mismos criterios que telematica_fleet_summary:
--      · km sin huecos (>20 min y >0.8 km) ni saltos de 5 km o más
--      · en movimiento: <10 min entre reportes y (velocidad >3 km/h o >150 m)
--      · ralentí: ignición encendida, sin moverse, <10 min entre reportes
--      · excesos: episodios separados por más de 10 min
-- 4. telematica_monthly_report(): meses con totales de flotilla y detalle por unidad.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.telematica_fleet_settings add column if not exists sat_end_hour smallint;

create or replace function public.telematica_after_hours(
  lt timestamp, wd smallint[], ws smallint, we smallint, sat_end smallint
) returns boolean
language sql immutable
set search_path to 'public'
as $$
  select not (
    extract(isodow from lt)::int = any (wd::int[])
    and extract(hour from lt) >= ws
    and extract(hour from lt) < case when extract(isodow from lt) = 6 then coalesce(sat_end, we) else we end
  );
$$;

create table if not exists public.telematica_daily_stats (
  vehicle_id      uuid not null references public.telematica_vehicles(id) on delete cascade,
  day             date not null,
  client_id       uuid not null references public.clients(id) on delete cascade,
  km              numeric(10,2) not null default 0,
  moving_min      numeric(8,1)  not null default 0,
  idle_min        numeric(8,1)  not null default 0,
  km_after_hours  numeric(10,2) not null default 0,
  speeding        integer       not null default 0,
  vmax            smallint      not null default 0,
  first_move      time,
  last_move       time,
  points          integer       not null default 0,
  primary key (vehicle_id, day)
);
create index if not exists telematica_daily_stats_client_day on public.telematica_daily_stats (client_id, day);
alter table public.telematica_daily_stats enable row level security;
drop policy if exists telematica_daily_stats_access on public.telematica_daily_stats;
create policy telematica_daily_stats_access on public.telematica_daily_stats for select to authenticated
  using (public.user_has_access_to_client(client_id));

create or replace function public.telematica_refresh_daily_stats(
  p_client uuid, p_from date, p_to date
) returns integer
language plpgsql
set search_path to 'public'
as $$
declare n integer;
begin
  delete from telematica_daily_stats where client_id = p_client and day between p_from and p_to;

  with cfg as (
    select coalesce(s.work_start_hour, 7)::smallint ws, coalesce(s.work_end_hour, 19)::smallint we,
           coalesce(s.work_days, '{1,2,3,4,5,6}')::smallint[] wd, s.sat_end_hour se,
           coalesce(s.speeding_kmh, 80) vlim
    from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
  ),
  p as (
    select vehicle_id, ts, lat, lon, speed_kmh, ignition,
           lag(ts) over w pts, lag(lat) over w plat, lag(lon) over w plon,
           count(speed_kmh) over (partition by vehicle_id) > 0 as has_speed
    from telematica_points
    where client_id = p_client
      and ts >= (p_from::timestamp at time zone 'America/Mexico_City') - interval '1 day'
      and ts <  ((p_to + 1)::timestamp at time zone 'America/Mexico_City')
    window w as (partition by vehicle_id order by ts)
  ),
  s as (
    select p.*,
           2 * 6371 * asin(sqrt(power(sin(radians(lat - plat) / 2), 2)
             + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2))) d_km,
           extract(epoch from ts - pts) / 60.0 m,
           (ts at time zone 'America/Mexico_City') lt
    from p where pts is not null
  ),
  s2 as (
    select s.*,
           case when (m > 20 and d_km > 0.8) or d_km >= 5 then 0 else d_km end d_ok,
           (m < 10 and (coalesce(speed_kmh, 0) > 3 or d_km > 0.15)) moving,
           case when has_speed then coalesce(speed_kmh, 0)
                when m between 0.5 and 5 and d_km / (m / 60) <= 140 then d_km / (m / 60)
                else 0 end v_eff,
           telematica_after_hours(lt, c.wd, c.ws, c.we, c.se) after_hours,
           c.vlim
    from s cross join cfg c
    where lt::date between p_from and p_to
  ),
  ex as (
    select vehicle_id, lt::date as day,
           count(*) filter (where prev is null or ts - prev > interval '10 minutes') n
    from (select vehicle_id, ts, lt, lag(ts) over (partition by vehicle_id order by ts) prev
          from s2 where v_eff >= vlim) o
    group by 1, 2
  ),
  agg as (
    select vehicle_id, lt::date as day,
           round(sum(d_ok)::numeric, 2) km,
           round(sum(case when moving then m else 0 end)::numeric, 1) moving_min,
           round(sum(case when not moving and ignition and m < 10 then m else 0 end)::numeric, 1) idle_min,
           round(sum(case when after_hours then d_ok else 0 end)::numeric, 2) km_after_hours,
           least(round(max(v_eff)), 250)::smallint vmax,
           min(lt::time) filter (where moving) first_move,
           max(lt::time) filter (where moving) last_move,
           count(*) points
    from s2 group by 1, 2
  )
  insert into telematica_daily_stats (vehicle_id, day, client_id, km, moving_min, idle_min, km_after_hours,
                                      speeding, vmax, first_move, last_move, points)
  select a.vehicle_id, a.day, p_client, a.km, a.moving_min, a.idle_min, a.km_after_hours,
         coalesce(ex.n, 0), a.vmax, a.first_move, a.last_move, a.points
  from agg a left join ex on ex.vehicle_id = a.vehicle_id and ex.day = a.day;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.telematica_refresh_daily_stats(uuid, date, date) from public, anon, authenticated;
grant execute on function public.telematica_refresh_daily_stats(uuid, date, date) to service_role;

create or replace function public.telematica_monthly_report(p_client uuid)
returns jsonb
language sql stable
set search_path to 'public'
as $$
with cfg as (
  select coalesce(s.default_km_per_l, 8) kmpl, s.fuel_price_mxn price
  from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
),
d as (
  select ds.*, v.alias, v.plate, v.device_id, v.photo_url,
         coalesce(v.fuel_km_per_l, (select kmpl from cfg)) kmpl,
         extract(isodow from ds.day)::int dow
  from telematica_daily_stats ds join telematica_vehicles v on v.id = ds.vehicle_id and v.active
  where ds.client_id = p_client
),
pv as (
  select date_trunc('month', day)::date mes, vehicle_id, alias, plate, device_id, photo_url, kmpl,
         round(sum(km), 1) km,
         round(sum(moving_min) / 60, 1) moving_h,
         round(sum(idle_min) / 60, 1) idle_h,
         round(sum(km_after_hours), 1) km_after_hours,
         sum(speeding) speeding, max(vmax) vmax,
         count(*) filter (where moving_min > 5) active_days,
         round(sum(km) / kmpl, 0) liters,
         -- hora promedio de primera salida y última llegada en días hábiles con movimiento
         to_char(avg(first_move) filter (where moving_min > 5 and dow <= 5), 'HH24:MI') first_move_avg,
         to_char(avg(last_move)  filter (where moving_min > 5 and dow <= 5), 'HH24:MI') last_move_avg,
         round(sum(km) filter (where dow = 7), 1) km_sunday
  from d group by 1, 2, 3, 4, 5, 6, 7
),
fleet_units as (select count(*) n from telematica_vehicles where client_id = p_client and active),
m as (
  select mes, min(dd) first_day, max(dd) last_day, count(distinct dd) days_with_data
  from (select date_trunc('month', d.day)::date mes, d.day as dd from d) x group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
  'month', m.mes, 'first_day', m.first_day, 'last_day', m.last_day, 'days_with_data', m.days_with_data,
  'units_total', (select n from fleet_units),
  'units_active', (select count(*) from pv where pv.mes = m.mes and pv.km >= 50),
  'km', (select coalesce(round(sum(km)), 0) from pv where pv.mes = m.mes),
  'moving_h', (select coalesce(round(sum(moving_h)), 0) from pv where pv.mes = m.mes),
  'idle_h', (select coalesce(round(sum(idle_h)), 0) from pv where pv.mes = m.mes),
  'liters', (select coalesce(round(sum(liters)), 0) from pv where pv.mes = m.mes),
  'cost_mxn', (select round(sum(liters) * (select price from cfg)) from pv where pv.mes = m.mes),
  'speeding', (select coalesce(sum(speeding), 0) from pv where pv.mes = m.mes),
  'vmax', (select coalesce(max(vmax), 0) from pv where pv.mes = m.mes),
  'km_after_hours', (select coalesce(round(sum(km_after_hours)), 0) from pv where pv.mes = m.mes),
  'vehicles', (select coalesce(jsonb_agg(to_jsonb(pv) - 'mes' order by pv.km desc), '[]'::jsonb) from pv where pv.mes = m.mes)
) order by m.mes), '[]'::jsonb)
from m;
$$;

revoke all on function public.telematica_monthly_report(uuid) from public, anon;
grant execute on function public.telematica_monthly_report(uuid) to authenticated, service_role;

-- fleet_summary: misma regla de fuera de horario (con sábado corto)
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
         case when has_speed then coalesce(speed_kmh, 0)
              when m between 0.5 and 5 and d_km / (m / 60) <= 140 then d_km / (m / 60)
              else 0 end as v_eff,
         telematica_after_hours(lt, c.wd, c.ws, c.we, c.se) as after_hours
  from s cross join cfg c
),
s3 as (
  select s2.*, (v_eff >= (select vlim from cfg)) as over_lim from s2
),
excesos as (
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
      'photo_url', v.photo_url,
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
$function$;

-- SELOME: Lun–Sáb, 7 a 19 entre semana y sábado hasta las 15
insert into public.telematica_fleet_settings (client_id, work_start_hour, work_end_hour, work_days, sat_end_hour, default_km_per_l)
select id, 7, 19, '{1,2,3,4,5,6}', 15, 8 from public.clients where slug = 'lukon-selome'
on conflict (client_id) do update set sat_end_hour = 15, work_days = '{1,2,3,4,5,6}', updated_at = now();
