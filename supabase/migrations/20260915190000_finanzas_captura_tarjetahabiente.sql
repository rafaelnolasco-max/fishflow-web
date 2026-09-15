-- FishFlow Finanzas — de quién fue el cargo
-- ─────────────────────────────────────────────────────────────────────────────
-- Los estados de cuenta ponen, bajo el comercio, el nombre del tarjetahabiente
-- adicional que hizo el cargo. Antes ese nombre solo se ignoraba para que no
-- contaminara el nombre del comercio; ahora se guarda.
--
-- Decisión: NO se descarta automáticamente. Un cargo de tarjeta adicional lo
-- paga el titular igual, así que excluirlo por sistema subestimaría el gasto
-- real del mes. Se marca en la hoja de revisión y el usuario decide.
--
-- Tampoco entra al dedupe_hash ni a la clasificación: el mismo cargo es el
-- mismo cargo, y el rubro depende del comercio, no de quién pagó.

alter table public.finance_tx_drafts
  add column if not exists cardholder text;

alter table public.finance_transactions
  add column if not exists cardholder text;

comment on column public.finance_tx_drafts.cardholder is
  'Tarjetahabiente adicional que aparece bajo el comercio. NULL = el titular.';

comment on column public.finance_transactions.cardholder is
  'Tarjetahabiente adicional que hizo el cargo. NULL = el titular.';

create index if not exists finance_tx_cardholder
  on public.finance_transactions (client_id, cardholder)
  where cardholder is not null;
