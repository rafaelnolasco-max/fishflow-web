-- ════════════════════════════════════════════════════════════════════════════
-- Módulo Revisión en línea (21-oct-2026)
-- ════════════════════════════════════════════════════════════════════════════
-- Liga privada (fishflow.mx/revision/<token>) donde el cliente revisa piezas
-- antes de publicarlas — correos, copys, guiones — y deja su visto bueno o
-- comentarios por pieza. Primer uso: correo de cierre de año de Enlace.
--
-- Igual que Descubrimiento: el revisor no tiene cuenta, el token es la
-- credencial, y todo lo público pasa por service-role desde el servidor.
-- Las tablas son genéricas (multi-tenant por client_id): otro cliente es
-- sembrar otra fila, no escribir otra pantalla.

create table if not exists public.content_reviews (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  public_token  text not null unique check (char_length(public_token) >= 24),
  title         text not null,
  intro         text,
  -- Preguntas generales que el cliente debe responder (lista de textos).
  questions     jsonb not null default '[]'::jsonb,
  -- Piezas a revisar: [{id, n, titulo, subtitulo, tag, asunto, html, nota}]
  items         jsonb not null default '[]'::jsonb,
  -- Envoltura opcional: HTML con {{contenido}}; cada item.html se inserta ahí.
  shell_html    text,
  -- Quiénes pueden comentar (se elige en pantalla).
  reviewers     text[] not null default '{}',
  -- Canal de Slack al que avisa cada comentario (ver lib/slack.ts).
  slack_channel text,
  status        text not null default 'open' check (status in ('open','closed')),
  expires_at    timestamptz not null default (now() + interval '15 days'),
  created_at    timestamptz not null default now()
);

create table if not exists public.content_review_comments (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.content_reviews(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  -- null = comentario general, no de una pieza
  item_id     text,
  author      text not null check (char_length(author) between 1 and 80),
  verdict     text not null check (verdict in ('aprobado','cambios','comentario')),
  body        text not null default '' check (char_length(body) <= 4000),
  created_at  timestamptz not null default now()
);

create index if not exists content_review_comments_review_idx
  on public.content_review_comments (review_id, created_at);

alter table public.content_reviews         enable row level security;
alter table public.content_review_comments enable row level security;

drop policy if exists content_reviews_access          on public.content_reviews;
drop policy if exists content_review_comments_access  on public.content_review_comments;

-- Solo usuarios con acceso al cliente (y Rafa). El público entra por la API.
create policy content_reviews_access
  on public.content_reviews for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy content_review_comments_access
  on public.content_review_comments for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));
