-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · instalaciones de GPS / dashcam (Lukon) — 2026-11-12 · Fase 1
--
-- Alex asigna cada instalación a un instalador (por número, sin nombre). El
-- instalador (por ahora Alex o Rafa desde el panel; los instaladores aún no
-- tienen acceso) registra llegada y salida con hora y ubicación del celular y
-- sube fotos guiadas de antes y después. Al terminar se manda al cliente un
-- reporte con marca LUKON desde instalaciones@gpslukon.com con un botón
-- "Acepto la instalación"; si no responde en 3 días se acepta sola (pg_cron).
--
-- Estados: programada → en_sitio → terminada → aceptada; cancelada.
-- Reprogramar = cambiar scheduled_at (queda en la línea de tiempo).
-- hidden_location y tech_notes son internos: nunca van al reporte del cliente.
-- ─────────────────────────────────────────────────────────────────────────────

create sequence if not exists public.telematica_installation_folio_seq start 1;

create table if not exists public.telematica_installations (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,  -- dueño del servicio (Lukon)
  folio            integer not null unique default nextval('public.telematica_installation_folio_seq'),
  status           text not null default 'programada'
                   check (status in ('programada', 'en_sitio', 'terminada', 'aceptada', 'cancelada')),
  installer_no     smallint check (installer_no between 1 and 20),
  -- Cliente final
  customer_name    text not null,
  customer_email   text,
  customer_phone   text,
  -- Vehículo
  vehicle_brand    text,
  vehicle_model    text,
  vehicle_year     smallint,
  vehicle_plate    text,
  vehicle_color    text,
  -- Servicio y cita
  service          text not null default 'gps' check (service in ('gps', 'dashcam', 'gps_dashcam')),
  address          text,
  scheduled_at     timestamptz,
  notes            text,
  -- Ejecución
  started_at       timestamptz,
  start_lat        double precision,
  start_lon        double precision,
  finished_at      timestamptz,
  finish_lat       double precision,
  finish_lon       double precision,
  device_imei      text,
  sim_iccid        text,
  dashcam_serial   text,
  hidden_location  text,   -- INTERNO: dónde quedó el equipo (antirrobo)
  tech_notes       text,   -- INTERNO
  -- Reporte y aceptación
  report_token     uuid not null unique default gen_random_uuid(),
  report_sent_at   timestamptz,
  report_sent_to   text,
  accepted_at      timestamptz,
  accepted_auto    boolean not null default false,
  accept_ip        text,
  cancel_reason    text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists telematica_installations_client_status on public.telematica_installations (client_id, status, scheduled_at);

create table if not exists public.telematica_installation_photos (
  id               uuid primary key default gen_random_uuid(),
  installation_id  uuid not null references public.telematica_installations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  stage            text not null check (stage in ('antes', 'despues')),
  kind             text not null,
  path             text not null,
  created_by       text,
  created_at       timestamptz not null default now()
);
create index if not exists telematica_installation_photos_inst on public.telematica_installation_photos (installation_id, stage);

create table if not exists public.telematica_installation_events (
  id               bigserial primary key,
  installation_id  uuid not null references public.telematica_installations(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  type             text not null,
  detail           text,
  by               text,
  at               timestamptz not null default now()
);
create index if not exists telematica_installation_events_inst on public.telematica_installation_events (installation_id, at);

alter table public.telematica_installations enable row level security;
alter table public.telematica_installation_photos enable row level security;
alter table public.telematica_installation_events enable row level security;
drop policy if exists telematica_installations_access on public.telematica_installations;
create policy telematica_installations_access on public.telematica_installations for select to authenticated
  using (public.user_has_access_to_client(client_id));
drop policy if exists telematica_installation_photos_access on public.telematica_installation_photos;
create policy telematica_installation_photos_access on public.telematica_installation_photos for select to authenticated
  using (public.user_has_access_to_client(client_id));
drop policy if exists telematica_installation_events_access on public.telematica_installation_events;
create policy telematica_installation_events_access on public.telematica_installation_events for select to authenticated
  using (public.user_has_access_to_client(client_id));

-- Fotos: bucket privado; se sirven con URLs firmadas desde las rutas de API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('installations', 'installations', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

-- Aceptación automática a los 3 días del envío del reporte
create or replace function public.telematica_installations_autoaccept()
returns integer
language plpgsql
set search_path to 'public'
as $$
declare n integer;
begin
  with done as (
    update telematica_installations
       set status = 'aceptada', accepted_at = now(), accepted_auto = true, updated_at = now()
     where status = 'terminada' and accepted_at is null
       and report_sent_at is not null and report_sent_at < now() - interval '3 days'
    returning id, client_id
  )
  insert into telematica_installation_events (installation_id, client_id, type, detail, by)
  select id, client_id, 'aceptada_auto', 'Aceptada automáticamente: el cliente no respondió en 3 días', 'sistema' from done;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.telematica_installations_autoaccept() from public, anon, authenticated;

select cron.schedule('lukon-instalaciones-autoaceptar', '17 * * * *', $$select public.telematica_installations_autoaccept()$$);
