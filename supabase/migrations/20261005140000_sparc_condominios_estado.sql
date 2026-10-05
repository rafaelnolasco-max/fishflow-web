-- Estado de cada condominio en la cartera de SPARC.
-- Vivook dejo de listar CONDOMINIO SANTA CRUZ 73 y RESIDENCIAL CUMBRES 421 en el
-- corte del 5-oct-2026 (sus cifras ya venian congeladas desde el 9-sep). Hasta que
-- SPARC confirme si siguen bajo administracion, quedan fuera del consolidado y se
-- muestran en la pestana "Por confirmar".
create table if not exists public.sparc_condominios (
  client_id        uuid not null,
  condominio       text not null,
  estado           text not null default 'activo'
                   check (estado in ('activo', 'por_confirmar', 'baja')),
  visto_hasta      date,
  motivo           text,
  resuelto_por     text,
  resuelto_en      timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (client_id, condominio)
);

comment on table public.sparc_condominios is
  'Estado de administracion por condominio. Solo activo entra al consolidado de Cartera y Cobranza.';

alter table public.sparc_condominios enable row level security;

drop policy if exists sparc_condominios_select on public.sparc_condominios;
create policy sparc_condominios_select on public.sparc_condominios
  for select using (user_has_access_to_client(client_id));

drop policy if exists sparc_condominios_update on public.sparc_condominios;
create policy sparc_condominios_update on public.sparc_condominios
  for update using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

-- Alta de los condominios conocidos.
insert into public.sparc_condominios (client_id, condominio, estado, visto_hasta, motivo)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Condominio Dr. Garcia Diego 160',  'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Condominio La Manzanita 33',       'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Condominio Los Cantaros',          'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Condominio Vertiz 1190',           'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RESIDENCIAL CAMPOS ELISEOS 238',   'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RESIDENCIAL CLAVIJERO 68',         'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Residencial San Antonio 455 A.C.', 'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Tarango Hills',                    'activo',        null, null),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'CONDOMINIO SANTA CRUZ 73',         'por_confirmar', '2026-09-21',
   'Dejo de aparecer en la lista de condominios de Vivook el 5-oct-2026; sus cifras no cambiaron entre el 9-sep y el 21-sep.'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'RESIDENCIAL CUMBRES 421',          'por_confirmar', '2026-09-21',
   'Dejo de aparecer en la lista de condominios de Vivook el 5-oct-2026; sus cifras no cambiaron entre el 9-sep y el 21-sep.')
on conflict (client_id, condominio) do nothing;
