-- Eventos: costos fijos del organizador que el panel resta al final del reparto
-- para mostrar la ganancia bruta (artista, renta, etc.). Aplicada 7-oct-2026 por SQL.
alter table evt_events add column if not exists fixed_costs jsonb not null default '[]'::jsonb;
-- VIBRA MX: Mike Gavilán 2,500 USD a 17.5 MXN/USD
update evt_events set fixed_costs = '[{"label":"Mike Gavilán (2,500 USD × 17.5)","amount":43750}]'::jsonb where slug = 'megaclase';
