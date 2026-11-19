-- Descuento por boleto cuando el comprador usa un código de coach válido.
-- VIBRA megaclase (acordado con Rodrigo 18-nov-2026): $600 sin código, $500 con código.
-- La comisión del coach (coach_pct) se calcula sobre el precio cobrado (evt_orders.unit_price).
alter table public.evt_events add column if not exists coach_discount numeric not null default 0;
update public.evt_events set coach_discount = 100 where slug = 'megaclase';
