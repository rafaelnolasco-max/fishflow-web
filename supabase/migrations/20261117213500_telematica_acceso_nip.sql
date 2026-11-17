-- Telemática · acceso temporal por NIP a la vista de solo lectura de una flotilla
-- (/flotilla/<slug>). Para clientes de Lukon que aún no tienen usuario y contraseña.
-- El NIP se guarda con bcrypt (pgcrypto); NUNCA en el repo (es público): se da de alta
-- aparte con telematica_pin_set().
-- RLS sin políticas: solo el service role (rutas de API) la lee.

create table if not exists public.telematica_pin_access (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                       -- lo que va en la URL: /flotilla/<slug>
  client_id uuid not null references public.clients(id) on delete cascade,  -- la flotilla
  pin_hash text not null,
  expires_at timestamptz not null,
  session_version int not null default 1,          -- subirlo cierra todas las sesiones
  failed_count int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.telematica_pin_access enable row level security;

-- Alta o cambio de NIP (cambiarlo cierra las sesiones abiertas).
create or replace function public.telematica_pin_set(p_slug text, p_client uuid, p_pin text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{6}$' then raise exception 'El NIP debe ser de 6 dígitos'; end if;
  insert into telematica_pin_access (slug, client_id, pin_hash, expires_at)
  values (p_slug, p_client, crypt(p_pin, gen_salt('bf', 10)), p_expires)
  on conflict (slug) do update
    set client_id = excluded.client_id, pin_hash = excluded.pin_hash, expires_at = excluded.expires_at,
        session_version = telematica_pin_access.session_version + 1, failed_count = 0, locked_until = null;
end $$;

-- Revisa un NIP. 5 errores seguidos bloquean 15 minutos.
-- status: ok | incorrecto | bloqueado | vencido | no_existe
create or replace function public.telematica_pin_check(p_slug text, p_pin text)
returns table (status text, access_id uuid, client_id uuid, session_version int, expires_at timestamptz, locked_until timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare a telematica_pin_access%rowtype;
begin
  select * into a from telematica_pin_access t where t.slug = p_slug for update;
  if not found then return query select 'no_existe'::text, null::uuid, null::uuid, null::int, null::timestamptz, null::timestamptz; return; end if;
  if a.expires_at <= now() then return query select 'vencido'::text, a.id, a.client_id, a.session_version, a.expires_at, null::timestamptz; return; end if;
  if a.locked_until is not null and a.locked_until > now() then
    return query select 'bloqueado'::text, a.id, null::uuid, null::int, null::timestamptz, a.locked_until; return;
  end if;
  if coalesce(p_pin, '') ~ '^[0-9]{6}$' and crypt(p_pin, a.pin_hash) = a.pin_hash then
    update telematica_pin_access set failed_count = 0, locked_until = null, last_login_at = now() where id = a.id;
    return query select 'ok'::text, a.id, a.client_id, a.session_version, a.expires_at, null::timestamptz; return;
  end if;
  if a.failed_count + 1 >= 5 then
    update telematica_pin_access set failed_count = 0, locked_until = now() + interval '15 minutes' where id = a.id;
    return query select 'bloqueado'::text, a.id, null::uuid, null::int, null::timestamptz, now() + interval '15 minutes'; return;
  end if;
  update telematica_pin_access set failed_count = a.failed_count + 1 where id = a.id;
  return query select 'incorrecto'::text, a.id, null::uuid, null::int, null::timestamptz, null::timestamptz;
end $$;

revoke all on function public.telematica_pin_set(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.telematica_pin_check(text, text) from public, anon, authenticated;
grant execute on function public.telematica_pin_set(text, uuid, text, timestamptz) to service_role;
grant execute on function public.telematica_pin_check(text, text) to service_role;
