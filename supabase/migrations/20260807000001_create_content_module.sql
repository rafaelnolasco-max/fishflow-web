-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo de Contenido (multi-tenant, por client_id)
-- Genera posts para redes sociales con la voz del cliente. La IA propone,
-- el cliente aprueba. El arte se produce en Canva (Bulk Create) desde el CSV
-- que exporta el tablero: FishFlow pone el texto, Canva pone el diseño.
--
-- Nota: la Autofill API de Canva exige plan Enterprise. Los clientes de
-- FishFlow tienen Canva Pro, así que el puente es Bulk Create vía CSV,
-- que sí está incluido en Pro y no requiere integración por API.
--
-- Formatos NO están fijados por CHECK a propósito: cada vertical define los
-- suyos en el front (psicología usa otros que estética o telemática).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists content_settings (
  client_id            uuid primary key references clients(id) on delete cascade,
  brand_display_name   text,
  social_handle        text,
  voice_profile        text,    -- perfil de voz: se inyecta como system prompt
  signature            text,    -- firma al pie del arte (ej. "Psic. Karla Alonso")
  default_hashtags     text,
  canva_template_url   text,    -- plantilla de Canva Pro para Bulk Create
  sensitive            boolean not null default false,  -- vertical de salud
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists content_posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  format        text not null default 'reflexion',
  topic         text,          -- de qué trata (entrada del usuario)
  hook          text,          -- texto que va DENTRO de la imagen
  caption       text,          -- pie de publicación
  hashtags      text,
  visual_note   text,          -- indicación de arte para Canva
  status        text not null default 'draft'
                check (status in ('draft', 'approved', 'published')),
  scheduled_for date,
  published_at  timestamptz,
  source        text not null default 'ai'
                check (source in ('ai', 'manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists content_posts_client_created_idx
  on content_posts (client_id, created_at desc);
create index if not exists content_posts_client_status_idx
  on content_posts (client_id, status);

-- Triggers de updated_at (función compartida ya existente)
drop trigger if exists content_settings_touch on content_settings;
create trigger content_settings_touch
  before update on content_settings
  for each row execute function set_updated_at();

drop trigger if exists content_posts_touch on content_posts;
create trigger content_posts_touch
  before update on content_posts
  for each row execute function set_updated_at();

-- ─── RLS centralizada (patrón oficial FishFlow) ──────────────────────────────
alter table content_settings enable row level security;
alter table content_posts    enable row level security;

drop policy if exists content_settings_client_access on content_settings;
create policy content_settings_client_access on content_settings
  for all
  using      (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists content_posts_client_access on content_posts;
create policy content_posts_client_access on content_posts
  for all
  using      (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));
