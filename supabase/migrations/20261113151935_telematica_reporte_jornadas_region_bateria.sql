-- telematica_monthly_report: agrega jornadas largas, manejo nocturno, batería y regiones (llaves nuevas; las anteriores no cambian).
create or replace function public.telematica_monthly_report(p_client uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with cfg as (
  select coalesce(s.default_km_per_l, 8) kmpl, s.fuel_price_mxn price
  from (select 1) x left join telematica_fleet_settings s on s.client_id = p_client
),
d as (
  select ds.*, v.alias, v.plate, v.device_id, v.photo_url, v.device_model, v.vehicle_class, v.vehicle_desc,
         coalesce(v.fuel_km_per_l, (select kmpl from cfg)) kmpl,
         extract(isodow from ds.day)::int dow
  from telematica_daily_stats ds join telematica_vehicles v on v.id = ds.vehicle_id and v.active
  where ds.client_id = p_client
),
pv0 as (
  select date_trunc('month', day)::date mes, vehicle_id, alias, plate, device_id, photo_url, device_model, vehicle_class, vehicle_desc, kmpl,
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
         sum(harsh_brake) harsh_brake, sum(starts) starts,
         -- jornadas largas y manejo nocturno
         round(sum(km_night), 1) km_night,
         round(sum(night_min) / 60, 1) night_h,
         count(*) filter (where km_night >= 20) night_days,
         count(*) filter (where moving_min >= 600) long_days,
         sum(long_drives) long_drives,
         round(max(max_drive_min) / 60, 1) max_drive_h,
         round(max(moving_min) / 60, 1) max_day_h,
         -- batería
         round(avg(batt_v_rest), 2) batt_v_rest,
         min(batt_v_rest) batt_v_rest_min,
         count(*) filter (where batt_v_rest < 12.0) batt_low_days,
         min(batt_v_min) batt_v_min,
         min(batt_gps_min) batt_gps_min,
         sum(power_cut) power_cut,
         count(*) filter (where power_cut > 0) power_cut_days
  from d group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
),
vr as (
  select date_trunc('month', r.day)::date mes, r.vehicle_id, r.state, round(sum(r.km), 1) km
  from telematica_daily_regions r join telematica_vehicles v on v.id = r.vehicle_id and v.active
  where r.client_id = p_client
  group by 1, 2, 3
),
vra as (
  select mes, vehicle_id,
         (array_agg(state order by km desc))[1] top_state,
         count(*) filter (where km >= 20) states_n,
         jsonb_agg(jsonb_build_object('state', state, 'km', km) order by km desc) filter (where km >= 1) regions
  from vr group by 1, 2
),
pv as (
  select pv0.*, vra.top_state, coalesce(vra.states_n, 0) states_n, coalesce(vra.regions, '[]'::jsonb) regions
  from pv0 left join vra on vra.mes = pv0.mes and vra.vehicle_id = pv0.vehicle_id
),
mr as (
  select mes, state, round(sum(km)) km, count(*) filter (where km >= 20) units,
         round(100 * sum(km) / nullif(sum(sum(km)) over (partition by mes), 0), 1) pct
  from vr group by 1, 2
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
  'km_night', (select coalesce(round(sum(km_night)), 0) from pv where pv.mes = m.mes),
  'night_h', (select coalesce(round(sum(night_h)), 0) from pv where pv.mes = m.mes),
  'long_days', (select coalesce(sum(long_days), 0) from pv where pv.mes = m.mes),
  'long_drives', (select coalesce(sum(long_drives), 0) from pv where pv.mes = m.mes),
  'max_drive_h', (select coalesce(max(max_drive_h), 0) from pv where pv.mes = m.mes),
  'batt_low_units', (select count(*) from pv where pv.mes = m.mes and pv.batt_low_days >= 3),
  'power_cut_units', (select count(*) from pv where pv.mes = m.mes and pv.power_cut > 0),
  'regions', (select coalesce(jsonb_agg(jsonb_build_object('state', mr.state, 'km', mr.km, 'units', mr.units, 'pct', mr.pct)
                                        order by mr.km desc), '[]'::jsonb)
              from mr where mr.mes = m.mes and mr.km >= 1),
  'vehicles', (select coalesce(jsonb_agg(to_jsonb(pv) - 'mes' order by pv.km desc), '[]'::jsonb) from pv where pv.mes = m.mes)
) order by m.mes), '[]'::jsonb)
from m;
$function$;
