-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · manejo agresivo — 2026-11-06
-- SELOME sospecha que varias unidades rompen el clutch por malos cambios y
-- arrancones. El GPS no ve el pedal ni las RPM, pero el acelerómetro del equipo
-- (Suntech ST4215 en RedGPS) reporta eventos 45 = aceleración brusca y
-- 44 = frenada brusca; 13 = ignición ON.
--   · Un mismo arrancón llega como varios puntos: se cuenta un episodio si el
--     anterior del mismo tipo fue hace más de 30 s (oct-2026 SELOME: 20,609
--     puntos de aceleración → 15,212 episodios).
--   · harsh_accel_low: aceleraciones bruscas a 20 km/h o menos = saliendo de
--     parado, las que más castigan el clutch.
--   · starts: encendidos (cuánto "para y arranca" la unidad).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.telematica_daily_stats
  add column if not exists harsh_accel     integer not null default 0,
  add column if not exists harsh_accel_low integer not null default 0,
  add column if not exists harsh_brake     integer not null default 0,
  add column if not exists starts          integer not null default 0;

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
  ev as (
    select vehicle_id, (ts at time zone 'America/Mexico_City')::date as day, event_code, speed_kmh, ts,
           lag(ts) over (partition by vehicle_id, event_code order by ts) prev
    from telematica_points
    where client_id = p_client and event_code in (13, 44, 45)
      and ts >= (p_from::timestamp at time zone 'America/Mexico_City')
      and ts <  ((p_to + 1)::timestamp at time zone 'America/Mexico_City')
  ),
  evc as (
    select vehicle_id, day,
           count(*) filter (where event_code = 45 and (prev is null or ts - prev > interval '30 seconds')) ha,
           count(*) filter (where event_code = 45 and (prev is null or ts - prev > interval '30 seconds') and coalesce(speed_kmh, 0) <= 20) hal,
           count(*) filter (where event_code = 44 and (prev is null or ts - prev > interval '30 seconds')) hb,
           count(*) filter (where event_code = 13) st
    from ev group by 1, 2
  ),
  agg as (
    select vehicle_id, lt::date as day,
           round(sum(d_ok)::numeric, 2) km,
           round(sum(case when moving then m else 0 end)::numeric, 1) moving_min,
           round(sum(case when not moving and ignition and m < 10 then m else 0 end)::numeric, 1) idle_min,
           round(sum(case when after_hours then d_ok else 0 end)::numeric, 2) km_after_hours,
           least(round(max(v_eff)), 250)::smallint vmax,
           min(lt::time) filter (where moving and extract(hour from lt) >= 4) first_move,
           max(lt::time) filter (where moving) last_move,
           count(*) points
    from s2 group by 1, 2
  )
  insert into telematica_daily_stats (vehicle_id, day, client_id, km, moving_min, idle_min, km_after_hours,
                                      speeding, vmax, first_move, last_move, points,
                                      harsh_accel, harsh_accel_low, harsh_brake, starts)
  select a.vehicle_id, a.day, p_client, a.km, a.moving_min, a.idle_min, a.km_after_hours,
         coalesce(ex.n, 0), a.vmax, a.first_move, a.last_move, a.points,
         coalesce(e.ha, 0), coalesce(e.hal, 0), coalesce(e.hb, 0), coalesce(e.st, 0)
  from agg a
  left join ex on ex.vehicle_id = a.vehicle_id and ex.day = a.day
  left join evc e on e.vehicle_id = a.vehicle_id and e.day = a.day;

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
         to_char(avg(first_move) filter (where moving_min > 5 and dow <= 5), 'HH24:MI') first_move_avg,
         to_char(avg(last_move)  filter (where moving_min > 5 and dow <= 5), 'HH24:MI') last_move_avg,
         round(sum(km) filter (where dow = 7), 1) km_sunday,
         sum(harsh_accel) harsh_accel, sum(harsh_accel_low) harsh_accel_low,
         sum(harsh_brake) harsh_brake, sum(starts) starts
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
  'harsh_accel', (select coalesce(sum(harsh_accel), 0) from pv where pv.mes = m.mes),
  'harsh_accel_low', (select coalesce(sum(harsh_accel_low), 0) from pv where pv.mes = m.mes),
  'harsh_brake', (select coalesce(sum(harsh_brake), 0) from pv where pv.mes = m.mes),
  'starts', (select coalesce(sum(starts), 0) from pv where pv.mes = m.mes),
  'vehicles', (select coalesce(jsonb_agg(to_jsonb(pv) - 'mes' order by pv.km desc), '[]'::jsonb) from pv where pv.mes = m.mes)
) order by m.mes), '[]'::jsonb)
from m;
$$;

revoke all on function public.telematica_monthly_report(uuid) from public, anon;
grant execute on function public.telematica_monthly_report(uuid) to authenticated, service_role;
