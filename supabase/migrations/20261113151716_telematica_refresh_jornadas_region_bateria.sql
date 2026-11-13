-- telematica_refresh_daily_stats: además llena manejo nocturno, tramos largos, batería y km por estado.
create or replace function public.telematica_refresh_daily_stats(p_client uuid, p_from date, p_to date)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare n integer;
begin
  delete from telematica_daily_stats where client_id = p_client and day between p_from and p_to;
  delete from telematica_daily_regions where client_id = p_client and day between p_from and p_to;

  with cfg as (
    select coalesce(s.work_start_hour, 7)::smallint ws, coalesce(s.work_end_hour, 19)::smallint we,
           coalesce(s.work_days, '{1,2,3,4,5,6}')::smallint[] wd, s.sat_end_hour se,
           coalesce(s.speeding_kmh, 80) vlim
    from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
  ),
  p as (
    select vehicle_id, ts, lat, lon, speed_kmh, ignition, batt_vehicle_v, batt_gps_pct,
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
  sm as (
    select s.*, (m < 10 and (coalesce(speed_kmh, 0) > 3 or d_km > 0.15)) moving from s
  ),
  s2 as (
    select sm.*,
           case when (m > 20 and d_km > 0.8) or d_km >= 5 then 0 else d_km end d_ok,
           case when has_speed then coalesce(speed_kmh, 0)
                when m between 0.5 and 5 and d_km / (m / 60) <= 140 then d_km / (m / 60)
                else 0 end v_eff,
           telematica_after_hours(lt, c.wd, c.ws, c.we, c.se) after_hours,
           (extract(hour from lt) >= 22 or extract(hour from lt) < 5) night,
           c.vlim
    from sm cross join cfg c
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
           count(*) filter (where event_code = 45 and (prev is null or ts - prev > interval '30 seconds') and speed_kmh <= 20) hal,
           count(*) filter (where event_code = 44 and (prev is null or ts - prev > interval '30 seconds')) hb,
           count(*) filter (where event_code = 13) st
    from ev group by 1, 2
  ),
  -- Tramos de manejo continuo: se cortan con una pausa de 30 min o más. Cuentan el día en que terminan.
  mv as (
    select vehicle_id, pts, ts,
           case when lag(ts) over (partition by vehicle_id order by ts) is null
                  or pts - lag(ts) over (partition by vehicle_id order by ts) > interval '30 minutes'
                then 1 else 0 end brk
    from sm where moving
  ),
  isl as (
    select vehicle_id, pts, ts, sum(brk) over (partition by vehicle_id order by ts) g from mv
  ),
  tr as (
    select vehicle_id, (max(ts) at time zone 'America/Mexico_City')::date as day,
           extract(epoch from max(ts) - min(pts)) / 60.0 dur, max(ts) fin
    from isl group by vehicle_id, g
  ),
  trd as (
    select vehicle_id, day, round(max(dur)::numeric, 1) max_drive, count(*) filter (where dur >= 300) long_drives
    from tr
    where day between p_from and p_to
      and fin < ((p_to + 1)::timestamp at time zone 'America/Mexico_City') - interval '30 minutes'
    group by 1, 2
  ),
  agg as (
    select vehicle_id, lt::date as day,
           round(sum(d_ok)::numeric, 2) km,
           round(sum(case when moving then m else 0 end)::numeric, 1) moving_min,
           round(sum(case when not moving and ignition and m < 10 then m else 0 end)::numeric, 1) idle_min,
           round(sum(case when after_hours then d_ok else 0 end)::numeric, 2) km_after_hours,
           round(sum(case when night then d_ok else 0 end)::numeric, 2) km_night,
           round(sum(case when night and moving then m else 0 end)::numeric, 1) night_min,
           least(round(max(v_eff)), 250)::smallint vmax,
           min(lt::time) filter (where moving and extract(hour from lt) >= 4) first_move,
           max(lt::time) filter (where moving) last_move,
           count(*) points,
           round(avg(batt_vehicle_v) filter (where ignition is false and batt_vehicle_v > 0), 2) batt_v_rest,
           min(batt_vehicle_v) filter (where batt_vehicle_v > 0) batt_v_min,
           min(batt_gps_pct) batt_gps_min,
           count(*) filter (where batt_vehicle_v = 0) power_cut
    from s2 group by 1, 2
  ),
  reg as (
    insert into telematica_daily_regions (vehicle_id, day, state, client_id, km, points)
    select s2.vehicle_id, s2.lt::date, coalesce(g.state, 'Sin identificar'), p_client,
           round(sum(s2.d_ok)::numeric, 2), count(*)
    from s2 left join telematica_geo_cells g
      on g.lat_r = round(s2.lat::numeric, 1) and g.lon_r = round(s2.lon::numeric, 1)
    group by 1, 2, 3
    returning 1
  )
  insert into telematica_daily_stats (vehicle_id, day, client_id, km, moving_min, idle_min, km_after_hours,
                                      speeding, vmax, first_move, last_move, points,
                                      harsh_accel, harsh_accel_low, harsh_brake, starts,
                                      km_night, night_min, max_drive_min, long_drives,
                                      batt_v_rest, batt_v_min, batt_gps_min, power_cut)
  select a.vehicle_id, a.day, p_client, a.km, a.moving_min, a.idle_min, a.km_after_hours,
         coalesce(ex.n, 0), a.vmax, a.first_move, a.last_move, a.points,
         coalesce(e.ha, 0), coalesce(e.hal, 0), coalesce(e.hb, 0), coalesce(e.st, 0),
         a.km_night, a.night_min, coalesce(t.max_drive, 0), coalesce(t.long_drives, 0),
         a.batt_v_rest, a.batt_v_min, a.batt_gps_min, a.power_cut
  from agg a
  left join ex on ex.vehicle_id = a.vehicle_id and ex.day = a.day
  left join evc e on e.vehicle_id = a.vehicle_id and e.day = a.day
  left join trd t on t.vehicle_id = a.vehicle_id and t.day = a.day;

  get diagnostics n = row_count;
  return n;
end;
$function$;
