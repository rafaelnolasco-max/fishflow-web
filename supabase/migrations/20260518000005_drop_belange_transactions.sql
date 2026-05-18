-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow · Cambio 5 — Eliminar belange_transactions
--
-- Seguro eliminar: todos los datos fueron migrados a pos_transactions
-- en Cambio 1 y el dashboard de Belange fue confirmado funcionando.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.belange_transactions;
