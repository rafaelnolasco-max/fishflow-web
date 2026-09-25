-- WhatsApp Cloud API — bitácora de mensajes entrantes, salientes y estados.
-- Multi-tenant por client_id (nullable: NULL = línea corporativa de FishFlow).
-- Solo escribe el service role (webhook y lib/whatsapp.ts). Lectura: admin o
-- usuarios con acceso al cliente.

create table if not exists public.whatsapp_messages (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients(id) on delete set null,
  phone_number_id  text not null,
  wa_message_id    text unique,
  direction        text not null check (direction in ('inbound', 'outbound')),
  contact_wa_id    text not null,
  contact_name     text,
  msg_type         text not null default 'text',
  body             text,
  template_name    text,
  status           text,
  status_at        timestamptz,
  error            jsonb,
  raw              jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists whatsapp_messages_contact_idx
  on public.whatsapp_messages (contact_wa_id, created_at desc);
create index if not exists whatsapp_messages_client_idx
  on public.whatsapp_messages (client_id, created_at desc);

alter table public.whatsapp_messages enable row level security;

drop policy if exists whatsapp_messages_select on public.whatsapp_messages;
create policy whatsapp_messages_select on public.whatsapp_messages
  for select to authenticated
  using (
    public.is_admin()
    or (client_id is not null and public.user_has_access_to_client(client_id))
  );
