-- ─────────────────────────────────────────────────────────────────────────────
-- Detección y reintento de publicaciones fallidas de Blotato.
--
-- Blotato tampoco devuelve accountId en GET /v2/posts?status=failed (mismo
-- hueco que ya resuelve content_published_posts para lo publicado). La
-- atribución usa las MISMAS dos vías 2 y 3 de lib/publishedSync.ts
-- (content_schedules / content_schedule_watch por media o texto+hora); la vía 1
-- (URL de Facebook) no aplica aquí porque una publicación fallida nunca tuvo URL.
--
-- Ciclo de una fila: detectada → alerta inmediata → (si se identificó la cuenta)
-- reintento a los 10 min → si el reintento también falla, segunda alerta y se
-- detiene ahí. Sin reintentos en cadena: mejor avisar dos veces que republicar
-- sin parar algo que Blotato va a seguir rechazando.
--
-- Aplicada en producción el 2026-08-20 vía el conector MCP de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.content_failed_posts (
  id                    uuid primary key default gen_random_uuid(),

  -- Id de la publicación fallida en Blotato.
  blotato_post_id       text not null unique,

  -- NULL = no se pudo identificar la cuenta. Se alerta igual, pero sin reintento.
  client_id             uuid references public.clients(id) on delete cascade,
  target_key            text,
  target_label          text,
  platform              text not null,
  blotato_account_id    text,

  post_text             text not null default '',
  media_urls            text[] not null default '{}',
  error_message         text not null default '',

  attribution           text not null default 'unattributed'
                        check (attribution in (
                          'schedule_row', 'schedule_watch', 'manual', 'unattributed'
                        )),

  failed_at             timestamptz not null,
  detected_at           timestamptz not null default now(),
  alert_sent_at         timestamptz,

  retry_at              timestamptz,
  retried_at            timestamptz,
  retry_submission_id   text,
  retry_result          text check (retry_result in ('success', 'failed')),
  second_alert_sent_at  timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists content_failed_posts_client_idx
  on public.content_failed_posts (client_id, failed_at desc);

-- Para que el cron encuentre rápido "a quién le toca reintentar ahora".
create index if not exists content_failed_posts_pending_retry_idx
  on public.content_failed_posts (retry_at)
  where retried_at is null and retry_at is not null;

drop trigger if exists content_failed_posts_touch on public.content_failed_posts;
create trigger content_failed_posts_touch
  before update on public.content_failed_posts
  for each row execute function set_updated_at();

-- RLS: tabla de operación interna (como content_sync_state). Ningún cliente debe
-- verla — Rafa la revisa desde el correo de alerta y desde Blotato directo, no
-- desde un tablero. Sin políticas = solo el service role la toca.
alter table public.content_failed_posts enable row level security;

notify pgrst, 'reload schema';
