-- Recorridos: descarga automática desde la API de RedGPS (Edge Function redgps-sync, cada 15 min).
-- Las llaves y contraseñas viven en Vault; esta tabla solo guarda el NOMBRE del secreto.
-- Secretos esperados en Vault: redgps_sync_token, redgps_apikey_<slug>, redgps_password_<slug>.

create table if not exists telematica_redgps_accounts (
  client_id uuid primary key references clients(id) on delete cascade,
  username text,
  apikey_secret text not null,        -- nombre del secreto en vault
  password_secret text,               -- nombre del secreto en vault
  enabled boolean not null default false,
  token text,
  token_expires_at timestamptz,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_points integer,
  fail_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table telematica_redgps_accounts enable row level security;  -- sin políticas: solo service_role
revoke all on telematica_redgps_accounts from anon, authenticated;

-- Token que debe mandar quien dispare la función (pg_cron)
create or replace function telematica_redgps_sync_token()
returns text language sql security definer set search_path to 'public', 'vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'redgps_sync_token';
$$;
revoke all on function telematica_redgps_sync_token() from public, anon, authenticated;
grant execute on function telematica_redgps_sync_token() to service_role;

-- Cuentas con sus secretos ya descifrados (solo service_role)
create or replace function telematica_redgps_accounts_secrets()
returns table (client_id uuid, slug text, username text, apikey text, password text, enabled boolean,
               token text, token_expires_at timestamptz, fail_count integer)
language sql security definer set search_path to 'public', 'vault' as $$
  select a.client_id, c.slug, a.username,
         (select decrypted_secret from vault.decrypted_secrets s where s.name = a.apikey_secret),
         (select decrypted_secret from vault.decrypted_secrets s where s.name = a.password_secret),
         a.enabled, a.token, a.token_expires_at, a.fail_count
  from telematica_redgps_accounts a join clients c on c.id = a.client_id;
$$;
revoke all on function telematica_redgps_accounts_secrets() from public, anon, authenticated;
grant execute on function telematica_redgps_accounts_secrets() to service_role;

-- Último punto guardado de cada unidad activa (de ahí retoma la descarga)
create or replace function telematica_last_ts(p_client uuid)
returns table (vehicle_id uuid, device_id text, last_ts timestamptz)
language sql stable set search_path to 'public' as $$
  select v.id, v.device_id,
         (select p.ts from telematica_points p where p.vehicle_id = v.id order by p.ts desc limit 1)
  from telematica_vehicles v where v.client_id = p_client and v.active;
$$;
revoke all on function telematica_last_ts(uuid) from public, anon, authenticated;
grant execute on function telematica_last_ts(uuid) to service_role;
