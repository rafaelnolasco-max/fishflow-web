-- ─────────────────────────────────────────────────────────────────────────────
-- Telemática · módulo "Recorridos" (add-on de Lukon para sus clientes)
-- 2026-10-09
--
-- 1. clients.parent_client_id: un cliente de Lukon es una fila en `clients`
--    con parent_client_id = Lukon. Quien tiene acceso al padre (Alejandro,
--    Rafa) ve también a los hijos; el cliente final solo ve lo suyo.
-- 2. Tablas de la vertical telematica_*:
--    telematica_vehicles  — unidad (equipo GPS, placa, alias)
--    telematica_points    — cada registro del log GPS
--    telematica_imports   — bitácora de cada archivo cargado
-- 3. Semilla: "Lukon · Flotilla demo" con los dos autos del log de Alex.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists parent_client_id uuid references public.clients(id);
create index if not exists clients_parent_idx on public.clients(parent_client_id);

-- Acceso heredado: tener acceso al padre da acceso a sus hijos.
-- Sin parent_client_id el resultado es idéntico al de antes.
create or replace function public.user_has_access_to_client(p_client_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_client_access uca
    where uca.user_id = auth.uid()
      and (
        uca.client_id = p_client_id
        or uca.client_id = (select c.parent_client_id from public.clients c where c.id = p_client_id)
      )
  );
$$;

create table if not exists public.telematica_vehicles (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  device_id   text not null,               -- "Nombre" en el export (IMEI corto del equipo)
  plate       text,
  alias       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (client_id, device_id)
);

create table if not exists public.telematica_points (
  id            bigint generated always as identity primary key,
  client_id     uuid not null references public.clients(id) on delete cascade,
  vehicle_id    uuid not null references public.telematica_vehicles(id) on delete cascade,
  ts            timestamptz not null,       -- hora local CDMX del export, guardada con zona
  lat           double precision not null,
  lon           double precision not null,
  speed_kmh     smallint,
  heading       smallint,
  event_code    integer,                    -- "Tipo dato - evento" de la plataforma
  ignition      boolean,
  odometer_m    bigint,
  sats          smallint,
  gsm_signal    smallint,
  batt_gps_pct  smallint,
  batt_vehicle_v numeric(5,2),
  address       text,
  unique (vehicle_id, ts, event_code)       -- re-subir el mismo archivo no duplica
);
create index if not exists telematica_points_vehicle_ts on public.telematica_points(vehicle_id, ts);
create index if not exists telematica_points_client_ts  on public.telematica_points(client_id, ts);

create table if not exists public.telematica_imports (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  vehicle_id    uuid references public.telematica_vehicles(id) on delete set null,
  filename      text,
  rows_read     integer not null default 0,
  rows_inserted integer not null default 0,
  ts_min        timestamptz,
  ts_max        timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists telematica_imports_client on public.telematica_imports(client_id, created_at desc);

alter table public.telematica_vehicles enable row level security;
alter table public.telematica_points   enable row level security;
alter table public.telematica_imports  enable row level security;

create policy telematica_vehicles_access on public.telematica_vehicles for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy telematica_points_access on public.telematica_points for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy telematica_imports_access on public.telematica_imports for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));

-- Semilla: flotilla demo de Lukon (sin cobro ni factura automática)
insert into public.clients (name, slug, vertical, gateway_primary, factura_auto, active, parent_client_id)
select 'Lukon · Flotilla demo', 'lukon-flotilla-demo', 'telematica_gps', 'none', false, true, c.id
from public.clients c
where c.slug = 'lukon'
  and not exists (select 1 from public.clients where slug = 'lukon-flotilla-demo');

insert into public.telematica_vehicles (client_id, device_id, plate, alias)
select d.id, v.device_id, v.plate, v.alias
from public.clients d
cross join (values
  ('0560024837', '273XZU', 'Auto A'),
  ('1600091318', null,     'Auto B')
) as v(device_id, plate, alias)
where d.slug = 'lukon-flotilla-demo'
on conflict (client_id, device_id) do nothing;
