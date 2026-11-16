-- Recorridos · aviso a #cli-lukon cuando una unidad deja de reportar (24 h sin datos) y cuando vuelve.
-- Solo flotillas con descarga automática encendida (telematica_redgps_accounts.enabled): en las de carga
-- manual "sin datos" solo significa que nadie ha subido el archivo.
-- Lo dispara el cron de Vercel /api/cron/lukon-unidades (el webhook de #cli-lukon vive en Vercel).

alter table telematica_vehicles
  add column if not exists silent_alerted_at timestamptz,   -- cuándo se avisó que se calló
  add column if not exists silent_last_ts timestamptz;      -- su último dato en ese momento

-- Unidades a avisar: 'callada' (24 h+ sin datos y sin aviso) o 'volvio' (avisada y ya trae datos más nuevos)
create or replace function telematica_unidades_silencio(p_horas int default 24)
returns table (vehicle_id uuid, estado text, flotilla text, client_slug text, alias text, plate text, device_id text,
               last_ts timestamptz, silent_last_ts timestamptz, last_address text, last_batt_v numeric, last_ignition boolean)
language sql stable set search_path to 'public' as $$
  with v as (
    select v.id, v.alias, v.plate, v.device_id, v.silent_alerted_at, v.silent_last_ts,
           c.name flotilla, c.slug, lp.ts, lp.address, lp.batt_vehicle_v, lp.ignition
    from telematica_vehicles v
    join telematica_redgps_accounts a on a.client_id = v.client_id and a.enabled
    join clients c on c.id = v.client_id
    left join lateral (
      select p.ts, p.address, p.batt_vehicle_v, p.ignition from telematica_points p
      where p.vehicle_id = v.id order by p.ts desc limit 1
    ) lp on true
    where v.active
  )
  select id, case when silent_alerted_at is null then 'callada' else 'volvio' end, flotilla, slug, alias, plate, device_id,
         ts, silent_last_ts, address, batt_vehicle_v, ignition
  from v
  where (silent_alerted_at is null and (ts is null or ts < now() - make_interval(hours => p_horas)))
     or (silent_alerted_at is not null and ts > silent_last_ts)
  order by flotilla, alias nulls last, device_id;
$$;

-- Marca lo ya avisado. Para 'callada' guarda el último dato que tenía; para 'volvio' limpia.
create or replace function telematica_unidades_silencio_marcar(p_calladas uuid[], p_volvieron uuid[])
returns void language sql set search_path to 'public' as $$
  update telematica_vehicles v
     set silent_alerted_at = now(),
         silent_last_ts = coalesce((select p.ts from telematica_points p where p.vehicle_id = v.id order by p.ts desc limit 1), 'epoch'::timestamptz)
   where v.id = any (coalesce(p_calladas, '{}'));
  update telematica_vehicles set silent_alerted_at = null, silent_last_ts = null
   where id = any (coalesce(p_volvieron, '{}'));
$$;

revoke all on function telematica_unidades_silencio(int) from public, anon, authenticated;
revoke all on function telematica_unidades_silencio_marcar(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function telematica_unidades_silencio(int) to service_role;
grant execute on function telematica_unidades_silencio_marcar(uuid[], uuid[]) to service_role;
