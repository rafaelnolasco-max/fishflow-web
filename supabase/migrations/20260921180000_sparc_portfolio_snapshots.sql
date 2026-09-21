-- Cortes de cartera por condominio exportados de Vivook (Panel del Administrador).
-- Alimenta /app/sparc/cartera: vista consolidada de todos los condominios de SPARC.
-- Un renglon por condominio por fecha de corte. Solo lectura desde el panel;
-- la carga la hace FishFlow (service role) a partir de los Excel de Vivook.
create table public.sparc_portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  snapshot_date date not null,
  condominio    text not null,
  viviendas     integer,
  usuarios      integer,
  ingresos      numeric(14,2),
  egresos       numeric(14,2),
  cxc           numeric(14,2),
  cxp           numeric(14,2),
  bancos        numeric(14,2),
  morosidad_pct numeric(6,2),
  source        text not null default 'vivook',
  created_at    timestamptz not null default now(),
  unique (client_id, snapshot_date, condominio)
);
create index sparc_portfolio_snapshots_client_date_idx
  on public.sparc_portfolio_snapshots (client_id, snapshot_date desc);
alter table public.sparc_portfolio_snapshots enable row level security;
create policy sparc_portfolio_snapshots_select on public.sparc_portfolio_snapshots
  for select to authenticated using (public.user_has_access_to_client(client_id));
comment on table public.sparc_portfolio_snapshots is
  'Cortes de cartera por condominio exportados de Vivook (Panel del Administrador). Un renglon por condominio por fecha de corte.';
