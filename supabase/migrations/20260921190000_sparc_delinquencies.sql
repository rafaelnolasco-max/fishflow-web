-- Adeudos vencidos por unidad (reporte Morosos de Vivook). Alimenta /app/sparc/cobranza.
-- Sin nombres ni datos de contacto de condominos: solo unidad, saldo, composicion y antiguedad.
create table public.sparc_delinquencies (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.clients(id) on delete cascade,
  snapshot_date           date not null,
  condominio              text not null,
  unidad                  text not null,
  saldo                   numeric(14,2) not null,
  saldo_ordinario         numeric(14,2),
  saldo_extraordinario    numeric(14,2),
  saldo_inicial           numeric(14,2),
  vencimiento_mas_antiguo date,
  num_adeudos             integer,
  con_convenio            boolean not null default false,
  source                  text not null default 'vivook',
  created_at              timestamptz not null default now(),
  unique (client_id, snapshot_date, condominio, unidad)
);
create index sparc_delinquencies_client_date_idx
  on public.sparc_delinquencies (client_id, snapshot_date desc);
alter table public.sparc_delinquencies enable row level security;
create policy sparc_delinquencies_select on public.sparc_delinquencies
  for select to authenticated using (public.user_has_access_to_client(client_id));
comment on table public.sparc_delinquencies is
  'Adeudos vencidos por unidad (reporte Morosos de Vivook), agregados por unidad y fecha de corte. Sin datos personales de condominos.';
