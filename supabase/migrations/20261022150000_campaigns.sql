-- Módulo Campañas por correo (primer uso: Enlace · cierre de año 2026)
-- Genérico y multi-tenant por client_id: cualquier cliente puede usarlo.
--
-- campaigns            → la campaña (remitente, canal de Slack, ritmo diario)
-- campaign_recipients  → un renglón por destinatario con su correo ya armado
--                         (subject/html) y su etapa de seguimiento.
--
-- El envío lo hace /api/cron/campanas (service role) en tandas de daily_limit
-- para las campañas en status 'sending'. El panel del cliente solo puede
-- mover la etapa, la nota y el monto aportado (grants por columna).

create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 160),
  description   text,
  from_address  text not null,               -- buzón del dominio verificado del cliente
  slack_channel text,
  status        text not null default 'draft'
                check (status in ('draft','sending','paused','done')),
  daily_limit   int  not null default 50 check (daily_limit between 1 and 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.campaign_recipients (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  client_id          uuid not null references public.clients(id) on delete cascade,
  name               text not null,
  email              text not null,
  phone              text,
  owner              text,                    -- asesora / vendedor que lo atiende
  segment            text,                    -- base · medio · alto …
  monthly_amount     numeric(12,2),
  start_year         int,
  subject            text not null,
  html               text not null,           -- {{wa_url}} y {{baja_url}} se llenan al enviar
  from_name          text,
  reply_to           text,
  wa_url             text,                    -- destino real del botón de WhatsApp
  stage              text not null default 'pendiente'
                     check (stage in ('pendiente','enviado','interesado','respondio','llamada',
                                      'aporto','lo_pensara','no_interesa','baja','error')),
  sent_at            timestamptz,
  send_error         text,
  wa_clicked_at      timestamptz,
  wa_click_count     int not null default 0,
  unsubscribed_at    timestamptz,
  contributed_amount numeric(12,2),
  note               text check (note is null or char_length(note) <= 2000),
  stage_updated_at   timestamptz,
  stage_updated_by   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (campaign_id, email)
);

create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id, stage);
create index if not exists campaign_recipients_pending_idx  on public.campaign_recipients (campaign_id) where sent_at is null;

alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;

drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select to authenticated using (public.user_has_access_to_client(client_id));

drop policy if exists campaign_recipients_select on public.campaign_recipients;
create policy campaign_recipients_select on public.campaign_recipients
  for select to authenticated using (public.user_has_access_to_client(client_id));

drop policy if exists campaign_recipients_update on public.campaign_recipients;
create policy campaign_recipients_update on public.campaign_recipients
  for update to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

-- El panel solo toca seguimiento; nada de correo, destinatario ni envío.
revoke insert, update, delete on public.campaigns from anon, authenticated;
revoke insert, update, delete on public.campaign_recipients from anon, authenticated;
grant update (stage, note, contributed_amount, stage_updated_at, stage_updated_by, updated_at)
  on public.campaign_recipients to authenticated;
