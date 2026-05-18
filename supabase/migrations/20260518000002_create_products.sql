-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow · Cambio 2 — Tabla products (inventario multi-tenant)
--
-- Objetivo: infraestructura para inventario de productos por cliente.
-- Belange usará esto en el futuro para registrar productos vendidos
-- con stock real, costos y precios sugeridos.
--
-- Nota: product_id en pos_transactions queda nullable hasta que
-- Belange empiece a cargar su catálogo de productos.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.products (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID          NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name             TEXT          NOT NULL,
  sku              TEXT,
  cost             NUMERIC(12,2),
  suggested_price  NUMERIC(12,2),
  current_stock    NUMERIC(12,3) NOT NULL DEFAULT 0,
  min_stock        NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit             TEXT          NOT NULL DEFAULT 'pza',   -- pza, ml, g, lt, etc.
  category         TEXT,
  active           BOOLEAN       NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  UNIQUE (client_id, sku)  -- SKU único por cliente, no global
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Se reemplazará en Cambio 4 por políticas basadas en user_client_access

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_authenticated_select"
  ON public.products FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "products_authenticated_insert"
  ON public.products FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "products_authenticated_update"
  ON public.products FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── FK desde pos_transactions (pendiente desde Cambio 1) ─────────────────────

ALTER TABLE public.pos_transactions
  ADD CONSTRAINT pos_transactions_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id);

-- ── Índices ───────────────────────────────────────────────────────────────────

CREATE INDEX products_client_id_idx ON public.products (client_id);
CREATE INDEX products_name_idx      ON public.products (client_id, lower(name));

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
