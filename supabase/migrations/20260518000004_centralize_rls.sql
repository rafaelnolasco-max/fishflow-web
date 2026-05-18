-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow · Cambio 4 — RLS centralizado con user_client_access
--
-- Objetivo:
--   - Insertar TBA como cliente en la tabla clients
--   - Crear tabla user_client_access (relación usuario ↔ cliente + rol)
--   - Función SECURITY DEFINER user_has_access_to_client()
--   - Reemplazar políticas RLS "authenticated" por políticas basadas en acceso
--     real por cliente en: pos_transactions, products, notifications,
--     notification_templates
--
-- Nota: tba_opportunities y tba_opportunities_log NO tienen client_id —
--   sus políticas no se tocan en esta migración.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 0. Expandir gateway_primary para soportar clientes sin gateway ────────────

ALTER TABLE public.clients
  DROP CONSTRAINT clients_gateway_primary_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_gateway_primary_check
  CHECK (gateway_primary = ANY (ARRAY[
    'mercadopago'::text,
    'conekta'::text,
    'clip'::text,
    'stripe'::text,
    'none'::text        -- clientes CRM / sin gateway de pago
  ]));


-- ── 1. Insertar TBA en clients ────────────────────────────────────────────────

INSERT INTO public.clients (id, name, gateway_primary, vertical, connection_type)
VALUES (
  'c2d4e6f8-a0b2-4c6e-8a0b-2c4d6e8f0a2b',
  'TBA Telecom',
  'none',
  'telecom',
  'api'
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Tabla user_client_access ───────────────────────────────────────────────

CREATE TABLE public.user_client_access (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, client_id)
);

-- Índice para lookup rápido en la función helper
CREATE INDEX uca_user_client_idx ON public.user_client_access (user_id, client_id);


-- ── 3. Función helper SECURITY DEFINER ───────────────────────────────────────
-- Ejecuta con privilegios de superusuario para leer user_client_access
-- aunque el llamador sea un usuario de fila normal.

CREATE OR REPLACE FUNCTION public.user_has_access_to_client(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_client_access
    WHERE user_id  = auth.uid()
      AND client_id = p_client_id
  );
$$;


-- ── 4. RLS en user_client_access ─────────────────────────────────────────────

ALTER TABLE public.user_client_access ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve sus propias filas
CREATE POLICY "uca_select_own"
  ON public.user_client_access FOR SELECT
  USING (user_id = auth.uid());


-- ── 5. Reemplazar RLS en pos_transactions ────────────────────────────────────

DROP POLICY IF EXISTS "pos_authenticated_select" ON public.pos_transactions;
DROP POLICY IF EXISTS "pos_authenticated_insert"  ON public.pos_transactions;
DROP POLICY IF EXISTS "pos_authenticated_update"  ON public.pos_transactions;

CREATE POLICY "pos_client_select"
  ON public.pos_transactions FOR SELECT
  USING (user_has_access_to_client(client_id));

CREATE POLICY "pos_client_insert"
  ON public.pos_transactions FOR INSERT
  WITH CHECK (user_has_access_to_client(client_id));

CREATE POLICY "pos_client_update"
  ON public.pos_transactions FOR UPDATE
  USING  (user_has_access_to_client(client_id))
  WITH CHECK (user_has_access_to_client(client_id));


-- ── 6. Reemplazar RLS en products ────────────────────────────────────────────

DROP POLICY IF EXISTS "products_authenticated_select" ON public.products;
DROP POLICY IF EXISTS "products_authenticated_insert"  ON public.products;
DROP POLICY IF EXISTS "products_authenticated_update"  ON public.products;

CREATE POLICY "products_client_select"
  ON public.products FOR SELECT
  USING (user_has_access_to_client(client_id));

CREATE POLICY "products_client_insert"
  ON public.products FOR INSERT
  WITH CHECK (user_has_access_to_client(client_id));

CREATE POLICY "products_client_update"
  ON public.products FOR UPDATE
  USING  (user_has_access_to_client(client_id))
  WITH CHECK (user_has_access_to_client(client_id));


-- ── 7. Reemplazar RLS en notifications ───────────────────────────────────────

DROP POLICY IF EXISTS "notifications_authenticated_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_authenticated_insert"  ON public.notifications;

CREATE POLICY "notifications_client_select"
  ON public.notifications FOR SELECT
  USING (user_has_access_to_client(client_id));

CREATE POLICY "notifications_client_insert"
  ON public.notifications FOR INSERT
  WITH CHECK (user_has_access_to_client(client_id));


-- ── 8. Reemplazar RLS en notification_templates ───────────────────────────────

DROP POLICY IF EXISTS "notif_templates_authenticated_select" ON public.notification_templates;
DROP POLICY IF EXISTS "notif_templates_authenticated_all"    ON public.notification_templates;

CREATE POLICY "notif_templates_client_select"
  ON public.notification_templates FOR SELECT
  USING (user_has_access_to_client(client_id));

CREATE POLICY "notif_templates_client_all"
  ON public.notification_templates FOR ALL
  USING  (user_has_access_to_client(client_id))
  WITH CHECK (user_has_access_to_client(client_id));
