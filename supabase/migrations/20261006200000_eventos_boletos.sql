-- Módulo de venta de boletos para eventos (primer cliente: VIBRA MX · megaclase).
-- Vertical "eventos" → prefijo evt_. Todo se lee y escribe desde las rutas
-- /api/eventos/[slug]/* con la service role; RLS activa sin políticas = nadie
-- más entra. Los cobros van a la cuenta de Mercado Pago del ORGANIZADOR (sus
-- llaves en env MP_<mp_env>_ACCESS_TOKEN), por eso NO usan pos_transactions:
-- ese hub es de FishFlow y dispara facturación automática.

create extension if not exists pgcrypto;

create table if not exists public.evt_events (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  capacity       int  not null,
  max_per_order  int  not null default 10,
  ticket_types   jsonb not null,            -- {"general":{"label":"Entrada general","price":600}, ...}
  fee_pct        numeric not null default 0.04,  -- comisión MP estimada que cubre el cargo por servicio
  fee_fix        numeric not null default 4,
  coach_pct      numeric not null default 0.125,
  installments   int  not null default 1,   -- máximo de pagos a meses que ofrece Checkout Pro
  folio_prefix   text not null,
  mp_env         text not null,             -- MP_<mp_env>_ACCESS_TOKEN / _WEBHOOK_SECRET
  door_pin_hash  text,                      -- sha256 hex
  panel_pin_hash text,
  notify_emails  text[] not null default '{}',
  sales_open     boolean not null default true,
  client_id      uuid references public.clients(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.evt_coaches (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.evt_events(id) on delete cascade,
  code       text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);

create table if not exists public.evt_orders (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.evt_events(id) on delete cascade,
  token             text not null unique default encode(gen_random_bytes(16), 'hex'),
  buyer_name        text not null,
  buyer_email       text not null,
  buyer_phone       text,
  ticket_type       text not null,
  socio             text,
  coach_code        text,
  qty               int  not null check (qty between 1 and 20),
  unit_price        numeric not null,
  unit_svc          numeric not null,
  total             numeric not null,
  attendees         jsonb not null default '[]',
  status            text not null default 'pending'
                    check (status in ('pending','paid','failed','cancelled','refunded')),
  mp_preference_id  text,
  mp_payment_id     text,
  pay_method        text,
  paid_at           timestamptz,
  tickets_issued_at timestamptz,
  email_sent_at     timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists evt_orders_event_status on public.evt_orders(event_id, status);

create table if not exists public.evt_tickets (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.evt_events(id) on delete cascade,
  order_id      uuid not null references public.evt_orders(id) on delete cascade,
  seq           int  not null,
  folio         text not null unique,
  attendee      text not null,
  ticket_type   text not null,
  price         numeric not null,
  svc           numeric not null,
  coach_code    text,
  checked_in_at timestamptz,
  checked_in_by text,
  created_at    timestamptz not null default now(),
  unique (event_id, seq)
);
create index if not exists evt_tickets_order on public.evt_tickets(order_id);

alter table public.evt_events  enable row level security;
alter table public.evt_coaches enable row level security;
alter table public.evt_orders  enable row level security;
alter table public.evt_tickets enable row level security;

-- Emite los boletos de una orden pagada. Idempotente (webhook y regreso de MP
-- pueden llegar juntos) y atómica: bloquea el evento para que dos órdenes no
-- tomen el mismo folio.
create or replace function public.evt_issue_tickets(p_order uuid)
returns setof public.evt_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  o   public.evt_orders;
  e   public.evt_events;
  nxt int;
  i   int;
  nm  text;
begin
  select * into o from evt_orders where id = p_order for update;
  if not found then raise exception 'orden no existe'; end if;
  if o.status <> 'paid' then raise exception 'orden no pagada'; end if;

  if o.tickets_issued_at is null then
    select * into e from evt_events where id = o.event_id for update;
    select coalesce(max(seq), 0) + 1 into nxt from evt_tickets where event_id = e.id;
    for i in 0 .. o.qty - 1 loop
      nm := coalesce(nullif(trim(o.attendees ->> i), ''), o.buyer_name);
      insert into evt_tickets (event_id, order_id, seq, folio, attendee, ticket_type, price, svc, coach_code)
      values (e.id, o.id, nxt + i, e.folio_prefix || '-' || lpad((nxt + i)::text, 4, '0'),
              nm, o.ticket_type, o.unit_price, o.unit_svc, o.coach_code);
    end loop;
    update evt_orders set tickets_issued_at = now() where id = o.id;
  end if;

  return query select * from evt_tickets where order_id = o.id order by seq;
end $$;

revoke all on function public.evt_issue_tickets(uuid) from public, anon, authenticated;
grant execute on function public.evt_issue_tickets(uuid) to service_role;

-- Comisión real que cobra Mercado Pago (para el panel del organizador).
alter table public.evt_orders
  add column if not exists mp_fee numeric,
  add column if not exists net_received numeric,
  add column if not exists mp_status_detail text;

-- Seed VIBRA MX (megaclase): se aplicó por SQL el 6-oct-2026 con los hashes de
-- los PINs de puerta y panel (los PINs en claro solo los tiene Rafa).
