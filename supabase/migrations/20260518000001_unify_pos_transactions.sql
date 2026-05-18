-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow · Cambio 1 — Unificar pos_transactions
-- Migra belange_transactions → pos_transactions con metadata JSONB
--
-- Instrucciones:
--   Supabase Dashboard → SQL Editor → New Query → pegar → Run
--
-- SEGURIDAD: belange_transactions NO se elimina en esta migración.
-- Eliminar manualmente solo después de confirmar que la app funciona.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Expandir CHECK de provider para incluir entradas manuales ──────────────

ALTER TABLE public.pos_transactions
  DROP CONSTRAINT pos_transactions_provider_check;

ALTER TABLE public.pos_transactions
  ADD CONSTRAINT pos_transactions_provider_check
  CHECK (provider = ANY (ARRAY[
    'mercadopago'::text,
    'conekta'::text,
    'clip'::text,
    'stripe'::text,
    'manual'::text       -- entradas manuales sin gateway de pago
  ]));


-- ── 2. Columna product_id (sin FK por ahora — se agrega cuando exista products) ─

ALTER TABLE public.pos_transactions
  ADD COLUMN IF NOT EXISTS product_id UUID;

-- TODO: cuando se cree la tabla products, ejecutar:
-- ALTER TABLE public.pos_transactions
--   ADD CONSTRAINT pos_transactions_product_id_fkey
--   FOREIGN KEY (product_id) REFERENCES public.products(id);


-- ── 3. Índice en client_id para queries multi-tenant eficientes ───────────────

CREATE INDEX IF NOT EXISTS pos_transactions_client_id_idx
  ON public.pos_transactions (client_id);


-- ── 4. RLS Policies para pos_transactions ────────────────────────────────────
-- Por ahora: cualquier usuario autenticado puede leer e insertar.
-- Cuando se cree user_client_access, estas políticas se reemplazarán
-- por filtros basados en client_id para aislamiento real multi-tenant.

CREATE POLICY "pos_authenticated_select"
  ON public.pos_transactions
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "pos_authenticated_insert"
  ON public.pos_transactions
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "pos_authenticated_update"
  ON public.pos_transactions
  FOR UPDATE
  USING  (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');


-- ── 5. Migrar belange_transactions → pos_transactions ─────────────────────────
-- Belange client_id: 33933663-79d2-4caa-86fe-7ea046082b7f (tabla clients)
-- amount = precio de servicio + precio de producto
-- Los campos específicos de Belange van en metadata JSONB

INSERT INTO public.pos_transactions (
  client_id,
  provider,
  amount,
  currency,
  status,
  payment_method,
  service,
  metadata,
  vertical,
  created_at,
  updated_at
)
SELECT
  '33933663-79d2-4caa-86fe-7ea046082b7f'::uuid           AS client_id,
  'manual'                                                AS provider,
  price + COALESCE(precio_producto, 0)                   AS amount,
  'MXN'                                                  AS currency,
  'paid'                                                 AS status,
  payment_method,
  service,
  jsonb_build_object(
    'client_name',    client_name,
    'price_service',  price,
    'producto',       producto,
    'precio_producto', precio_producto,
    'migrated_from',  'belange_transactions',
    'original_id',    id::text
  )                                                      AS metadata,
  'estetica'                                             AS vertical,
  created_at,
  created_at                                             AS updated_at
FROM public.belange_transactions
WHERE (price + COALESCE(precio_producto, 0)) > 0;


-- ── Verificación post-migración ───────────────────────────────────────────────
-- Ejecuta estas queries por separado para confirmar:
--
-- SELECT COUNT(*) FROM public.belange_transactions;
--   → debe ser 35
--
-- SELECT COUNT(*) FROM public.pos_transactions
--   WHERE client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'::uuid;
--   → debe ser 35 (o cercano, si algún registro tenía amount = 0)
--
-- SELECT id, amount, payment_method, metadata->>'client_name' AS cliente,
--        created_at
-- FROM public.pos_transactions
-- WHERE client_id = '33933663-79d2-4caa-86fe-7ea046082b7f'::uuid
-- ORDER BY created_at DESC
-- LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
