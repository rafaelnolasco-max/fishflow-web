-- Ubicación exacta de la entrega (pin confirmado por el cliente en el mapa).
-- Los Aguachiles, 22-sep-2026. Aplicada vía MCP el mismo día.
alter table public.store_orders
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision;
