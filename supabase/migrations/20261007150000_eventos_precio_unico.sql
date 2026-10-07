-- Eventos: precio todo incluido, comisión FishFlow por boleto, métodos excluidos
-- y "última oportunidad" (cupo extra que el organizador abre desde el panel).
alter table evt_events
  add column if not exists platform_fee numeric not null default 0,          -- FishFlow por boleto (MXN)
  add column if not exists excluded_payment_types text[] not null default '{}', -- ids de MP: ticket, atm, bank_transfer…
  add column if not exists last_chance_extra int not null default 0,          -- lugares extra disponibles
  add column if not exists last_chance_open boolean not null default false;   -- ya se abrieron

-- VIBRA MX (reunión 7-oct-2026): $600 todo incluido, 1 pago, sin OXXO,
-- 500 lugares + 100 de última oportunidad, FishFlow $30 por boleto, coach 12.5%.
update evt_events set
  ticket_types = '{"general":{"label":"Entrada general","short":"General","price":600}}'::jsonb,
  fee_pct = 0, fee_fix = 0,
  installments = 1,
  capacity = 500,
  last_chance_extra = 100,
  platform_fee = 30,
  coach_pct = 0.125,
  excluded_payment_types = array['ticket','atm','bank_transfer']
where slug = 'megaclase';
