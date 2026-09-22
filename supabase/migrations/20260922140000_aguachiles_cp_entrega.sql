-- Código postal de la entrega por separado: sirve para definir zonas de envío después.
-- Los Aguachiles, 22-sep-2026. Aplicada vía MCP el mismo día.
alter table public.store_orders add column if not exists delivery_cp text;
