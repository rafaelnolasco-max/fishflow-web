-- ─────────────────────────────────────────────────────────────────────────────
-- Remitente de correo parametrizado por cliente + trazabilidad del envío del CFDI
--
-- Contexto: el envío del CFDI de Lukon tenía el remitente hardcodeado. En vez de
-- amarrar el client_id de Lukon en el código, el remitente vive en la tabla
-- clients para que cualquier cliente nuevo con dominio propio herede el flujo.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists email_from     text,
  add column if not exists email_reply_to text;

comment on column public.clients.email_from is
  'Remitente completo del correo transaccional de este cliente, formato "Marca <buzon@dominio>". El dominio debe estar verificado en Resend. NULL = usa el remitente genérico de FishFlow.';

comment on column public.clients.email_reply_to is
  'Reply-To del correo transaccional de este cliente. NULL = raf@fishflow.mx.';

-- Trazabilidad: saber si el CFDI ya se envió y a quién, sin depender de los logs.
alter table public.invoices
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_to      text;

comment on column public.invoices.email_sent_at is
  'Momento en que se envió el CFDI (PDF+XML) por correo. NULL = no se ha enviado.';

comment on column public.invoices.email_to is
  'Destinatario al que se envió el CFDI.';

-- Lukon: dominio gpslukon.com verificado en Resend el 14-ago-2026.
update public.clients
set email_from     = 'Lukon <facturacion@gpslukon.com>',
    email_reply_to = 'aalmarazmo@lukon.com.mx'
where id = '1aa4a82b-e524-40f4-808e-c02e87e82427'
  and email_from is null;
