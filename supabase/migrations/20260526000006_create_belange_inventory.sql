-- ============================================================
-- Migración 6: Inventario de productos Belange
-- Fecha: 2026-05-26
-- ============================================================

create table if not exists belange_inventory (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  name            text not null,
  brand           text,
  category        text,                          -- capilares | afeitado | tratamientos | coloracion
  cost            numeric(10,2),                 -- costo de compra — NUNCA exponer en UI de cliente
  suggested_price numeric(10,2),                 -- precio de lista — se auto-llena en formulario
  stock_qty       integer not null default 0,
  min_stock       integer not null default 2,    -- umbral de alerta de stock bajo
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Índices
create index if not exists belange_inventory_client_id_idx on belange_inventory(client_id);
create index if not exists belange_inventory_active_idx    on belange_inventory(client_id, active);

-- Trigger para updated_at automático
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists belange_inventory_updated_at on belange_inventory;
create trigger belange_inventory_updated_at
  before update on belange_inventory
  for each row execute function update_updated_at_column();

-- RLS
alter table belange_inventory enable row level security;

-- Solo usuarios con acceso al cliente Belange pueden leer
create policy "belange_inventory_select" on belange_inventory
  for select using (
    client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    and auth.uid() in (
      select user_id from user_client_access
      where client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    )
  );

-- Solo usuarios con acceso pueden insertar/actualizar
create policy "belange_inventory_insert" on belange_inventory
  for insert with check (
    client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    and auth.uid() in (
      select user_id from user_client_access
      where client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    )
  );

create policy "belange_inventory_update" on belange_inventory
  for update using (
    client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    and auth.uid() in (
      select user_id from user_client_access
      where client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'
    )
  );

-- ============================================================
-- Carga inicial: 33 productos del inventario de Belange
-- (2026-05-26 — inventario físico proporcionado por Alberto)
-- cost = null (pendiente de confirmar con Belange)
-- ============================================================

insert into belange_inventory (client_id, name, brand, category, suggested_price, stock_qty, min_stock) values
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Anti.Gravity.Spray',                      'Kevin.Murphy',     'capilares',   450,   4,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shimmer Lights Blonde Conditioner',        'Shimmer Lights',   'capilares',   350,   3,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Spray Kenra',                              'Kenra',            'capilares',   290,  12,  3),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Protector térmico',                        'Terramar',         'capilares',   300,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Óleo 98 ml',                               'Terramar',         'capilares',   250,   3,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Óleo protector con argán 120 ml',          'Terramar',         'capilares',   380,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Óleo medio litro',                         'Terramar',         'capilares',  1000,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shaper Plus',                              'Sebastian',        'capilares',   350,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'WellaPlex No. 3 Hair Stabilizer',          'Wella',            'tratamientos',450,   8,  3),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Dúo anticaída',                            'Terramar',         'capilares',   650,   3,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Cera',                                     'Terramar',         'capilares',   280,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Gel',                                      'Terramar',         'capilares',   200,   5,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Aceite para afeitado',                     'Terramar',         'afeitado',    450,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Bálsamo 2 en 1 después del afeitado',      'Terramar',         'afeitado',    450,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Crema para afeitar',                       'Terramar',         'afeitado',    400,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Grooming capilar',                         'Terramar',         'capilares',   260,   4,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shampoo (1 L)',                            'Nioxin',           'capilares',   850,   3,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Mascarilla 1 L',                           'Nioxin',           'tratamientos',900,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Mascarilla ácido hialurónico 1 L',         'Avyna',            'tratamientos',550,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Dúo Color Safe 300 ml',                   'Nioxin',           'capilares',   700,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shampoo 300 ml',                           'Nioxin',           'capilares',   350,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Favoloso 18',                              'Rossano Ferretti', 'tratamientos',480,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Invigo Mascarilla 500 ml',                 'Wella',            'tratamientos',750,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'WellaPlex No. 2 Mascarilla 500 ml',        'Wella',            'tratamientos',750,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Dúo ácido hialurónico',                   'Avyna',            'tratamientos',700,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shampoo de argán',                         'Avyna',            'capilares',   350,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shampoo matizador para rubios',            'Avyna',            'coloracion',  350,   3,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Dúo de argán',                             'Avyna',            'capilares',   700,   1,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Shampoo de goji',                          'Avyna',            'capilares',   350,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Mascarilla de goji',                       'Avyna',            'tratamientos',350,   2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Mascarilla de carbón para rostro',         null,               'tratamientos',300,   4,  2),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Dúo MUCOTA',                               'MUCOTA',           'tratamientos',1250,  2,  1),
  ('33933663-79d2-4caa-86fe-7ea046082b7f', 'Poción 10',                                null,               'tratamientos',350,   1,  1);
