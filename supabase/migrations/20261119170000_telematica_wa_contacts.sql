-- Telemática · contactos de WhatsApp por flotilla (línea FishFlow por ahora; LUKON después).
-- weekly_summary: recibe la plantilla del resumen semanal (lunes).
-- bot: sus mensajes a la línea los contesta el bot de la flotilla, no el autorespondedor
--      de la landing de FishFlow, y no generan aviso de "nueva conversación".
-- RLS sin políticas: solo el service role.
create table if not exists public.telematica_wa_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10}$'),  -- 10 dígitos, sin 52
  name text,
  weekly_summary boolean not null default true,
  bot boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, phone)
);
alter table public.telematica_wa_contacts enable row level security;
create index if not exists telematica_wa_contacts_phone on public.telematica_wa_contacts (phone) where active;
