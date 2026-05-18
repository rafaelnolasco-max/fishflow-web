-- ─────────────────────────────────────────────────────────────────────────────
-- FishFlow · Cambio 3 — Tablas notifications + notification_templates
--
-- Una sola tabla para todos los canales y todos los clientes.
-- Seed de templates iniciales para Belange (WhatsApp).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── notifications ─────────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel              TEXT        NOT NULL
                                   CHECK (channel IN ('whatsapp','email','sms','push')),
  provider             TEXT        NOT NULL,              -- 'twilio','sendgrid','meta','firebase'
  recipient            TEXT        NOT NULL,              -- teléfono, email o device token
  template_id          UUID,                              -- FK agregada abajo (evita circular)
  body                 TEXT,                              -- mensaje ya renderizado
  status               TEXT        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued','sent','delivered','failed','cancelled')),
  provider_message_id  TEXT,
  provider_response    JSONB,
  related_entity_type  TEXT,                              -- 'pos_transaction','invoice', etc.
  related_entity_id    UUID,
  scheduled_for        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── notification_templates ────────────────────────────────────────────────────
CREATE TABLE public.notification_templates (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vertical       TEXT        NOT NULL,        -- 'estetica','tintoreria', etc.
  trigger_event  TEXT        NOT NULL,        -- 'payment_received_confirmation','transaction_invoice_ready'
  channel        TEXT        NOT NULL
                             CHECK (channel IN ('whatsapp','email','sms','push')),
  language       TEXT        NOT NULL DEFAULT 'es',
  subject        TEXT,                        -- para email
  body           TEXT        NOT NULL,        -- template con {{variables}}
  variables      JSONB       NOT NULL DEFAULT '[]',
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, trigger_event, channel, language)
);

-- FK notifications → templates (después de crear ambas tablas)
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.notification_templates(id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Se reemplazará en Cambio 4 por políticas basadas en user_client_access

ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_authenticated_select"
  ON public.notifications FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "notifications_authenticated_insert"
  ON public.notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "notif_templates_authenticated_select"
  ON public.notification_templates FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "notif_templates_authenticated_all"
  ON public.notification_templates FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── Índices ───────────────────────────────────────────────────────────────────

CREATE INDEX notif_pending_idx
  ON public.notifications (scheduled_for)
  WHERE status = 'queued';                               -- cola de pendientes

CREATE INDEX notif_client_recent_idx
  ON public.notifications (client_id, created_at DESC);  -- por cliente reciente

CREATE INDEX notif_entity_idx
  ON public.notifications (related_entity_type, related_entity_id);

CREATE INDEX notif_templates_client_idx
  ON public.notification_templates (client_id, trigger_event, channel);

-- ── Trigger updated_at ────────────────────────────────────────────────────────

CREATE TRIGGER notification_templates_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Seed: templates iniciales para Belange ────────────────────────────────────

INSERT INTO public.notification_templates
  (client_id, vertical, trigger_event, channel, language, subject, body, variables)
VALUES
  (
    '33933663-79d2-4caa-86fe-7ea046082b7f',
    'estetica',
    'payment_received_confirmation',
    'whatsapp',
    'es',
    NULL,
    'Hola {{client_name}} 👋 Tu pago de {{amount}} por {{service}} en Belange Studio fue registrado. ¡Gracias por tu visita!',
    '["client_name","amount","service"]'::jsonb
  ),
  (
    '33933663-79d2-4caa-86fe-7ea046082b7f',
    'estetica',
    'transaction_invoice_ready',
    'whatsapp',
    'es',
    NULL,
    'Hola {{client_name}}, tu factura por {{amount}} está lista. Puedes descargarla aquí: {{invoice_url}}',
    '["client_name","amount","invoice_url"]'::jsonb
  );
