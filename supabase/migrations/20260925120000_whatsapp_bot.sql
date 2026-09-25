-- Asistente de WhatsApp: quién mandó cada saliente y estado del bot por contacto.
alter table public.whatsapp_messages add column if not exists sent_by text
  check (sent_by in ('bot', 'admin', 'system'));

create table if not exists public.whatsapp_contacts (
  wa_id             text primary key,
  name              text,
  bot_paused_until  timestamptz,
  last_intent_at    timestamptz,
  updated_at        timestamptz not null default now()
);
alter table public.whatsapp_contacts enable row level security;
drop policy if exists whatsapp_contacts_admin on public.whatsapp_contacts;
create policy whatsapp_contacts_admin on public.whatsapp_contacts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
