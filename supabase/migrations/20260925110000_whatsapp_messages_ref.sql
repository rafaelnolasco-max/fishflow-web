-- Referencia externa del envío (p. ej. uid de la reserva de Cal.com) para no
-- mandar dos veces la misma plantilla por el mismo evento.
alter table public.whatsapp_messages add column if not exists ref text;
create unique index if not exists whatsapp_messages_template_ref_uq
  on public.whatsapp_messages (template_name, ref)
  where ref is not null and direction = 'outbound' and status <> 'failed';
