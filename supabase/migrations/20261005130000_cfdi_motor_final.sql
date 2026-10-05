-- ─────────────────────────────────────────────────────────────────────────────
-- CFDI — motor final multi-emisor (5-oct-2026)
--
-- Un emisor = una fila en invoice_orgs = una organización en Facturapi con su
-- propio RFC y CSD. FishFlow se factura como un emisor más (client 'fishflow').
--
-- Cambios:
--   1. invoice_orgs: modo test/live, datos del emisor, llaves en Vault, defaults.
--   2. invoices: quién emitió (emisor_org_id), modo, origen, concepto, total,
--      serie/folio, cancelación. Candado de idempotencia por transacción.
--   3. invoice_receptores: datos fiscales guardados de los clientes finales de
--      cada emisor (para facturar en automático sin volver a pedirlos).
--   4. cfdi_org_api_key(): única forma de leer la llave — solo service_role.
--   5. Alta de los emisores FishFlow (datos de su constancia) y Lukon, inactivos.
--   (La service key de notify_auto_invoice() se mueve a Vault en la migración
--    20261005130100, sin escribir el secreto en el repo.)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. invoice_orgs ─────────────────────────────────────────────────────────────
alter table public.invoice_orgs
  add column if not exists modo               text not null default 'test'
    check (modo in ('test','live')),
  add column if not exists emisor_rfc         text,
  add column if not exists emisor_razon       text,
  add column if not exists emisor_cp          text,
  add column if not exists test_key_secret_id uuid,
  add column if not exists live_key_secret_id uuid,
  add column if not exists serie              text,
  add column if not exists payment_form_default text not null default '03',
  add column if not exists cfdi_use_default   text not null default 'G03',
  add column if not exists marca_correo       text not null default 'generica',
  add column if not exists auto_al_pagar      boolean not null default false,
  add column if not exists bcc_email          text;

comment on column public.invoice_orgs.modo is
  'test = timbra contra el sandbox de Facturapi (sin validez fiscal). live = CFDI real ante el SAT.';
comment on column public.invoice_orgs.auto_al_pagar is
  'Si true, un pago en paid de este emisor se timbra solo cuando ya hay datos fiscales del receptor.';
comment on column public.invoice_orgs.facturapi_test_key is
  'OBSOLETA — las llaves viven en Vault (test_key_secret_id). Se deja vacía.';
comment on column public.invoice_orgs.facturapi_live_key is
  'OBSOLETA — las llaves viven en Vault (live_key_secret_id). Se deja vacía.';

create unique index if not exists invoice_orgs_client_id_key on public.invoice_orgs (client_id);

-- 2. invoices ─────────────────────────────────────────────────────────────────
alter table public.invoices
  add column if not exists emisor_org_id   uuid references public.invoice_orgs(id),
  add column if not exists modo            text check (modo in ('test','live')),
  add column if not exists origen          text check (origen in ('manual','auto','autoservicio')),
  add column if not exists concepto        text,
  add column if not exists subtotal        numeric(12,2),
  add column if not exists total           numeric(12,2),
  add column if not exists serie           text,
  add column if not exists folio           text,
  add column if not exists cancel_motivo   text,
  add column if not exists cancel_status   text,
  add column if not exists cancelled_at    timestamptz;

comment on column public.invoices.amount is
  'Monto cobrado (IVA incluido). El desglose fiscal real está en subtotal/total, que regresa Facturapi.';

-- Un pago se timbra una sola vez. 'pending' es el candado que se toma ANTES de
-- llamar a Facturapi: si dos disparos llegan juntos, el segundo choca aquí.
create unique index if not exists invoices_una_por_transaccion
  on public.invoices (transaction_id)
  where transaction_id is not null and status in ('pending','valid');

create index if not exists idx_invoices_emisor_org on public.invoices (emisor_org_id);

-- 3. invoice_receptores ───────────────────────────────────────────────────────
create table if not exists public.invoice_receptores (
  id               uuid primary key default gen_random_uuid(),
  emisor_client_id uuid not null references public.clients(id) on delete cascade,
  email            text not null,
  rfc              text not null,
  razon_social     text not null,
  regimen_fiscal   text not null,
  cp               text not null,
  cfdi_use         text not null default 'G03',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists invoice_receptores_emisor_email
  on public.invoice_receptores (emisor_client_id, lower(email));

alter table public.invoice_receptores enable row level security;

drop policy if exists invoice_receptores_por_cliente on public.invoice_receptores;
create policy invoice_receptores_por_cliente on public.invoice_receptores
  for all to authenticated
  using (public.user_has_access_to_client(emisor_client_id))
  with check (public.user_has_access_to_client(emisor_client_id));

-- 4. Llave de Facturapi — solo service_role ───────────────────────────────────
create or replace function public.cfdi_org_api_key(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from public.invoice_orgs o
  join vault.decrypted_secrets ds
    on ds.id = case when o.modo = 'live' then o.live_key_secret_id
                    else o.test_key_secret_id end
  where o.id = p_org_id
    and o.active;
$$;

revoke all on function public.cfdi_org_api_key(uuid) from public, anon, authenticated;
grant execute on function public.cfdi_org_api_key(uuid) to service_role;

-- 5. Emisor FishFlow (datos de la constancia del 21-jul-2026) ─────────────────
update public.clients
   set rfc            = 'FIS260702QH6',
       razon_social   = 'FISHFLOW',
       regimen_fiscal = '601',
       cp           = '08840'
 where id = 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42';

insert into public.invoice_orgs
  (client_id, emisor_rfc, emisor_razon, emisor_cp, marca_correo, serie, active, modo, bcc_email, sat_product_key, sat_unit_key)
values
  -- Clave 80101507 / E48: las mismas de la factura F-1 que emitió contabilidad (9-sep-2026).
  -- Serie FF para no chocar con el folio sin serie que lleva contabilidad.
  ('b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42', 'FIS260702QH6', 'FISHFLOW', '08840', 'fishflow', 'FF', false, 'test', 'raf@fishflow.mx', '80101507', 'E48')
on conflict (client_id) do nothing;

-- Emisor Lukon: se da de alta inactivo, sin RFC, hasta tener su CSD.
insert into public.invoice_orgs
  (client_id, marca_correo, serie, active, modo, bcc_email)
values
  ('1aa4a82b-e524-40f4-808e-c02e87e82427', 'lukon', 'LK', false, 'test', 'raf@fishflow.mx')
on conflict (client_id) do nothing;

-- 6. Backfill: las facturas viejas salieron de la llave global; no se sabe si
-- era de prueba o productiva, así que modo se queda NULL a propósito.
update public.invoices set origen = 'manual' where origen is null;
