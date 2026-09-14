-- FishFlow Finanzas — captura de gastos por screenshot del app del banco
-- ─────────────────────────────────────────────────────────────────────────────
-- Cambia la entrada de "teclear cada consumo" a "una foto al final del día".
-- El screenshot se lee con visión, cae en un buffer de borradores, y solo pasa
-- a finance_transactions cuando el usuario confirma.
--
-- Tres decisiones que están aquí y no en el código:
--  1) MONEDA. Hasta hoy `amount` era MXN implícito y no había campo de divisa.
--     Los cargos en el extranjero nacen en USD y el monto en pesos se fija
--     días después con el tipo de cambio del banco. Se guarda el original como
--     verdad y el MXN como derivado marcado estimado.
--  2) DEDUPLICACIÓN. El screenshot de hoy casi siempre arrastra los cargos de
--     ayer. Sin índice único se duplica cada viaje.
--  3) APRENDIZAJE. finance_merchant_rules es la memoria de clasificación: se
--     llena con las correcciones del usuario, no con reglas precargadas.

-- ─── 1. finance_transactions: moneda, trazabilidad y dedup ───────────────────

alter table public.finance_transactions
  add column if not exists amount_original numeric,
  add column if not exists currency        text    not null default 'MXN',
  add column if not exists fx_rate_used    numeric,
  add column if not exists fx_estimated    boolean not null default false,
  add column if not exists source          text    not null default 'manual',
  add column if not exists merchant_key    text,
  add column if not exists dedupe_hash     text;

comment on column public.finance_transactions.amount        is 'Siempre MXN. Derivado de amount_original cuando currency <> MXN.';
comment on column public.finance_transactions.amount_original is 'Monto en la divisa en que nació el cargo. NULL en capturas viejas (MXN).';
comment on column public.finance_transactions.fx_estimated  is 'true mientras el MXN venga de un tipo de cambio estimado y no del banco.';
comment on column public.finance_transactions.source        is 'manual | chat | voz | screenshot';

alter table public.finance_transactions
  drop constraint if exists finance_transactions_currency_chk;
alter table public.finance_transactions
  add constraint finance_transactions_currency_chk check (currency ~ '^[A-Z]{3}$');

alter table public.finance_transactions
  drop constraint if exists finance_transactions_source_chk;
alter table public.finance_transactions
  add constraint finance_transactions_source_chk
  check (source in ('manual','chat','voz','screenshot'));

-- Parcial: solo lo que entra por screenshot lleva hash. La captura manual y la
-- del chat siguen pudiendo repetir un mismo movimiento a propósito.
create unique index if not exists finance_tx_dedupe
  on public.finance_transactions (client_id, dedupe_hash)
  where dedupe_hash is not null;

-- ─── 2. finance_captures — un renglón por screenshot ─────────────────────────

create table if not exists public.finance_captures (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  image_path      text not null,
  mime            text not null,
  size_bytes      integer,
  status          text not null default 'uploaded'
                    check (status in ('uploaded','extracted','reviewed','failed')),
  model_raw       jsonb,
  model_error     text,
  rows_found      integer not null default 0,
  rows_unreadable integer not null default 0,
  card_last4      text,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

comment on table public.finance_captures is
  'Screenshot subido. model_raw guarda la respuesta cruda del modelo para poder depurar sin volver a pagar el llamado.';

create index if not exists finance_captures_client_fecha
  on public.finance_captures (client_id, created_at desc);

-- ─── 3. finance_tx_drafts — el buffer de revisión ────────────────────────────

create table if not exists public.finance_tx_drafts (
  id              uuid primary key default gen_random_uuid(),
  capture_id      uuid not null references public.finance_captures(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  tx_date         date not null,
  merchant_raw    text not null,
  merchant_key    text not null,
  concept         text not null,
  amount_original numeric not null check (amount_original > 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  amount          numeric,
  fx_rate_used    numeric,
  tx_type         text check (tx_type in ('ingreso','fijo','placer','futuro','extraordinario')),
  category        text,
  confidence      numeric check (confidence >= 0 and confidence <= 1),
  rule_hit        boolean not null default false,
  txn_state       text not null default 'posted' check (txn_state in ('authorized','posted')),
  dedupe_hash     text not null,
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','discarded','duplicate')),
  tx_id           uuid references public.finance_transactions(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on column public.finance_tx_drafts.rule_hit is
  'true si el rubro vino de finance_merchant_rules y no del modelo. Sirve para medir si el aprendizaje sirve.';
comment on column public.finance_tx_drafts.txn_state is
  'authorized = pre-autorización que puede cambiar de monto (propina, hotel). Reconciliación pendiente (F3).';

create index if not exists finance_drafts_pendientes
  on public.finance_tx_drafts (client_id, status, confidence)
  where status = 'pending';

create index if not exists finance_drafts_captura
  on public.finance_tx_drafts (capture_id);

-- ─── 4. finance_merchant_rules — memoria de clasificación ────────────────────

create table if not exists public.finance_merchant_rules (
  client_id     uuid not null references public.clients(id) on delete cascade,
  merchant_key  text not null,
  tx_type       text not null check (tx_type in ('ingreso','fijo','placer','futuro','extraordinario')),
  category      text,
  concept_label text,
  hit_count     integer not null default 1,
  updated_at    timestamptz not null default now(),
  primary key (client_id, merchant_key)
);

comment on table public.finance_merchant_rules is
  'Se llena SOLO con las correcciones del usuario. Una regla gana siempre contra la propuesta del modelo.';
comment on column public.finance_merchant_rules.concept_label is
  'Nombre legible que el usuario quiere ver en el tablero, en vez del string del banco.';

-- ─── 5. RLS — mismo patrón que finance_transactions ──────────────────────────

alter table public.finance_captures       enable row level security;
alter table public.finance_tx_drafts      enable row level security;
alter table public.finance_merchant_rules enable row level security;

drop policy if exists finance_captures_access       on public.finance_captures;
drop policy if exists finance_tx_drafts_access      on public.finance_tx_drafts;
drop policy if exists finance_merchant_rules_access on public.finance_merchant_rules;

create policy finance_captures_access
  on public.finance_captures for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy finance_tx_drafts_access
  on public.finance_tx_drafts for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy finance_merchant_rules_access
  on public.finance_merchant_rules for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

-- ─── 6. Bucket privado finance-uploads ───────────────────────────────────────
-- Los screenshots traen los últimos 4 dígitos de la tarjeta y el saldo: nunca
-- en un bucket público. La subida la hace el servidor con service-role, igual
-- que en Descubrimiento; estas políticas son para que el dueño pueda releer
-- su propia imagen desde el navegador.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-uploads',
  'finance-uploads',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists finance_uploads_read   on storage.objects;
drop policy if exists finance_uploads_delete on storage.objects;

create policy finance_uploads_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'finance-uploads'
    and public.user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );

create policy finance_uploads_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'finance-uploads'
    and public.user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );
