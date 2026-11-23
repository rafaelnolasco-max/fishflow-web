-- Varias cuentas de RedGPS por flotilla (flotilla demo: una cuenta por coche).
alter table telematica_redgps_accounts
  add column id uuid not null default gen_random_uuid(),
  add column label text,
  add column device_ids text[];
comment on column telematica_redgps_accounts.device_ids is 'Equipos que baja esta cuenta; null = todas las unidades de la flotilla';
comment on column telematica_redgps_accounts.label is 'Nombre corto de la cuenta dentro de la flotilla (avisos)';
alter table telematica_redgps_accounts drop constraint telematica_redgps_accounts_pkey;
alter table telematica_redgps_accounts add primary key (id);
create index telematica_redgps_accounts_client_idx on telematica_redgps_accounts(client_id);
create unique index telematica_redgps_accounts_client_user_uq on telematica_redgps_accounts(client_id, username);

drop function if exists public.telematica_redgps_accounts_secrets();
create function public.telematica_redgps_accounts_secrets()
 returns table(id uuid, client_id uuid, slug text, label text, device_ids text[], username text, apikey text, password text, enabled boolean, token text, token_expires_at timestamptz, fail_count integer)
 language sql security definer set search_path to 'public', 'vault'
as $$
  select a.id, a.client_id, c.slug, a.label, a.device_ids, a.username,
         (select decrypted_secret from vault.decrypted_secrets s where s.name = a.apikey_secret),
         (select decrypted_secret from vault.decrypted_secrets s where s.name = a.password_secret),
         a.enabled, a.token, a.token_expires_at, a.fail_count
  from telematica_redgps_accounts a join clients c on c.id = a.client_id
  order by c.slug, a.label nulls first;
$$;
revoke all on function public.telematica_redgps_accounts_secrets() from public, anon, authenticated;
grant execute on function public.telematica_redgps_accounts_secrets() to service_role;

create or replace function public.telematica_redgps_vigilante()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare r record; n int := 0;
begin
  for r in
    select a.id, coalesce(c.name, a.client_id::text) || coalesce(' (' || a.label || ')', '') nombre, a.last_run_at
    from telematica_redgps_accounts a left join clients c on c.id = a.client_id
    where a.enabled and a.stale_alerted_at is null
      and coalesce(a.last_run_at, a.created_at) < now() - interval '40 minutes'
  loop
    perform slack_post('slack_webhook_alertas', format(
      E':rotating_light: *Recorridos LUKON · %s*: la descarga automática no ha corrido desde %s. Puede ser el cron de Supabase o la función `redgps-sync` cayéndose antes de registrar la corrida.',
      r.nombre,
      coalesce(to_char(r.last_run_at at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), 'que se encendió')));
    update telematica_redgps_accounts set stale_alerted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

create or replace function public.telematica_unidades_silencio(p_horas integer default 24)
 returns table(vehicle_id uuid, estado text, flotilla text, client_slug text, alias text, plate text, device_id text, last_ts timestamptz, silent_last_ts timestamptz, last_address text, last_batt_v numeric, last_ignition boolean)
 language sql stable set search_path to 'public'
as $function$
  with v as (
    select v.id, v.alias, v.plate, v.device_id, v.silent_alerted_at, v.silent_last_ts,
           c.name flotilla, c.slug, lp.ts, lp.address, lp.batt_vehicle_v, lp.ignition
    from telematica_vehicles v
    join clients c on c.id = v.client_id
    left join lateral (
      select p.ts, p.address, p.batt_vehicle_v, p.ignition from telematica_points p
      where p.vehicle_id = v.id order by p.ts desc limit 1
    ) lp on true
    where v.active
      and exists (select 1 from telematica_redgps_accounts a
                  where a.client_id = v.client_id and a.enabled
                    and (a.device_ids is null or v.device_id = any(a.device_ids)))
  )
  select id, case when silent_alerted_at is null then 'callada' else 'volvio' end, flotilla, slug, alias, plate, device_id,
         ts, silent_last_ts, address, batt_vehicle_v, ignition
  from v
  where (silent_alerted_at is null and (ts is null or ts < now() - make_interval(hours => p_horas)))
     or (silent_alerted_at is not null and ts > silent_last_ts)
  order by flotilla, alias nulls last, device_id;
$function$;

-- Avisos de falla: agrega la cuenta al nombre de la flotilla
create or replace function public.telematica_redgps_alerta()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_nombre text;
  v_umbral constant int := 3;
  v_recordar constant int := 24;
  v_ok text;
begin
  select name into v_nombre from clients where id = new.client_id;
  v_nombre := coalesce(v_nombre, new.client_id::text) || coalesce(' (' || new.label || ')', '');
  v_ok := coalesce(to_char(new.last_ok_at at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), 'nunca');

  if new.fail_count >= v_umbral and new.fail_count is distinct from old.fail_count
     and (new.fail_count = v_umbral or (new.fail_count - v_umbral) % v_recordar = 0) then
    perform slack_post('slack_webhook_alertas', format(
      E':warning: *Recorridos LUKON · %s* %s: la descarga de RedGPS lleva %s corridas seguidas fallando (%s).\n*Causa probable:* %s\n*Último dato bueno:* %s\n_Detalle técnico:_ `%s`',
      v_nombre,
      case when new.fail_count = v_umbral then 'dejó de bajar datos' else 'sigue sin bajar datos' end,
      new.fail_count,
      case when new.fail_count * 15 < 120 then (new.fail_count * 15) || ' min'
           else round(new.fail_count * 15 / 60.0, 1) || ' h' end,
      telematica_redgps_explica(new.last_error), v_ok,
      left(coalesce(new.last_error, ''), 300)));
  end if;

  if old.fail_count >= v_umbral and new.fail_count = 0 then
    perform slack_post('slack_webhook_alertas', format(
      ':white_check_mark: *Recorridos LUKON · %s* se recuperó: la descarga volvió a funcionar después de %s corridas fallidas y bajó %s puntos.',
      v_nombre, old.fail_count, coalesce(new.last_points, 0)));
  end if;

  if old.stale_alerted_at is not null and new.last_run_at is distinct from old.last_run_at
     and new.last_run_at > old.stale_alerted_at then
    new.stale_alerted_at := null;
    perform slack_post('slack_webhook_alertas', format(
      ':white_check_mark: *Recorridos LUKON · %s*: la descarga automática volvió a correr.', v_nombre));
  end if;

  return new;
end;
$function$;
