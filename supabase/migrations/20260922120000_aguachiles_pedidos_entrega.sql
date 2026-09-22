-- Los Aguachiles (Silvia "Chiva") — pedidos a domicilio con hora de entrega.
-- Reutiliza store_* (patrón RMZ); solo agrega lo que la vertical restaurante necesita.

-- 1. Agenda de entrega: dia + franja de una hora (hora CDMX, UTC-6 fijo).
alter table public.store_orders
  add column if not exists delivery_date date,
  add column if not exists delivery_slot text;

create index if not exists store_orders_client_delivery_idx
  on public.store_orders (client_id, delivery_date, delivery_slot);

-- 2. Pago contra entrega en efectivo (transferencia ya existia).
alter table public.store_orders drop constraint if exists store_orders_payment_method_check;
alter table public.store_orders add constraint store_orders_payment_method_check
  check (payment_method = any (array['stripe','mercadopago','transferencia','efectivo']));

-- 3. Nota por partida: nivel de picor del aguachile.
alter table public.store_order_items
  add column if not exists item_note text;

-- 4. La cola de resenas acepta clientes que entran por un pedido entregado.
alter table public.review_requests drop constraint if exists review_requests_source_check;
alter table public.review_requests add constraint review_requests_source_check
  check (source = any (array['csv','appointment','manual','qr','top20','pedido']));
