-- ─────────────────────────────────────────────────────────────────────────────
-- Historial de publicaciones ya publicadas + sus métricas.
--
-- POR QUÉ ESTAS TABLAS Y NO UNA LLAMADA DIRECTA A BLOTATO
--
-- La API de Blotato NO devuelve el accountId en nada de lo ya publicado:
-- ni GET /v2/posts, ni GET /v2/published-posts, ni GET /v2/posts/{id}/analytics.
-- Y Blotato es UN solo espacio de trabajo con las cuentas de TODOS los clientes
-- de FishFlow. Sin un identificador de cuenta no hay forma de pintar el
-- historial en el tablero de un cliente sin arriesgarse a enseñarle el de otro.
--
-- Así que la atribución se hace de nuestro lado y se guarda. Tres vías, en orden
-- de confianza (ver lib/publishedSync.ts):
--   1. Facebook: el URL publicado es facebook.com/{pageId}_{postId} — el pageId
--      viene dentro y se cruza contra content_settings.blotato_accounts.
--   2. Lo que se programó DESDE el tablero: cruce por blotato_media_urls.
--   3. content_schedule_watch: lo que vimos en GET /v2/schedules mientras
--      todavía era futuro. Ese endpoint SÍ trae accountId. Es la única forma de
--      atribuir un Instagram programado desde la interfaz de Blotato.
-- Lo que no cae en ninguna se queda con client_id NULL y no se le muestra a
-- nadie. Fail closed: mejor que a la clienta le falte un post a que vea los de
-- otro cliente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Lo que Blotato tiene programado, capturado antes de que se publique ──
-- Se llena como efecto secundario de GET /api/content/schedule, que ya lista
-- /v2/schedules en cada carga del tablero. No cuesta una llamada extra.
create table if not exists public.content_schedule_watch (
  blotato_schedule_id text primary key,
  client_id           uuid not null references public.clients(id) on delete cascade,
  target_key          text not null,
  target_label        text not null,
  platform            text not null check (platform in ('instagram', 'facebook')),
  blotato_account_id  text not null,

  -- Las URLs que Blotato hospeda. Son las MISMAS que aparecen en el post ya
  -- publicado, y por eso sirven de llave para cruzarlos.
  blotato_media_urls  text[] not null default '{}',
  post_text           text not null default '',
  scheduled_at        timestamptz not null,

  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);

create index if not exists content_schedule_watch_client_idx
  on public.content_schedule_watch (client_id, scheduled_at desc);

-- ─── 2. El historial ─────────────────────────────────────────────────────────
create table if not exists public.content_published_posts (
  id                uuid primary key default gen_random_uuid(),

  -- Id de la publicación en Blotato. Es la llave para pedir sus analíticas.
  blotato_post_id   text not null unique,

  -- NULL = todavía no sabemos de quién es. Nunca se muestra en un tablero.
  client_id         uuid references public.clients(id) on delete cascade,
  target_key        text,
  target_label      text,

  platform          text not null,
  post_url          text,
  post_text         text not null default '',
  media_urls        text[] not null default '{}',
  published_at      timestamptz not null,

  attribution       text not null default 'unattributed'
                    check (attribution in (
                      'facebook_page', 'schedule_row', 'schedule_watch',
                      'manual', 'unattributed'
                    )),

  -- Métrica cacheada. Blotato mide en checkpoints fijos (en el plan Starter:
  -- al día 1 y al día 7 desde que se publica) y sus endpoints devuelven la
  -- última foto tomada, no un dato en vivo. Guardarla aquí evita pedirle a
  -- Blotato lo mismo en cada carga del tablero, y nos deja pintar
  -- "medido el ..." en pantalla, que es la mitad de entender el número.
  metrics           jsonb,
  metrics_fetched_at timestamptz,
  metrics_error     text,

  -- Cuándo le preguntamos a Blotato por última vez (haya traído algo o no).
  metrics_synced_at timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists content_published_posts_client_idx
  on public.content_published_posts (client_id, published_at desc)
  where client_id is not null;

create index if not exists content_published_posts_pending_idx
  on public.content_published_posts (metrics_synced_at nulls first)
  where client_id is not null;

drop trigger if exists content_published_posts_touch on public.content_published_posts;
create trigger content_published_posts_touch
  before update on public.content_published_posts
  for each row execute function set_updated_at();

-- ─── 3. Enlace con lo que se programó desde el tablero ───────────────────────
-- Hasta hoy una fila de content_schedules se quedaba en 'scheduled' para
-- siempre: nadie la volvía a mirar después de que Blotato la publicaba.
alter table public.content_schedules
  add column if not exists blotato_post_id text;

alter table public.content_schedules
  add column if not exists published_at timestamptz;

-- ─── 4. Reloj del sincronizador ──────────────────────────────────────────────
-- Para no salir a Blotato en cada carga de pantalla. Una fila por alcance.
create table if not exists public.content_sync_state (
  scope        text primary key,
  last_run_at  timestamptz not null default now(),
  last_error   text
);

-- ─── 5. RLS (patrón oficial FishFlow) ────────────────────────────────────────
alter table public.content_published_posts enable row level security;
alter table public.content_schedule_watch  enable row level security;
alter table public.content_sync_state      enable row level security;

-- `client_id is not null` explícito: user_has_access_to_client(null) devuelve
-- null, y un null en USING no deja pasar la fila — pero dejarlo escrito evita
-- que un cambio futuro en esa función abra el historial sin atribuir.
drop policy if exists content_published_posts_client_access on public.content_published_posts;
create policy content_published_posts_client_access on public.content_published_posts
  for all
  using      (client_id is not null and user_has_access_to_client(client_id))
  with check (client_id is not null and user_has_access_to_client(client_id));

drop policy if exists content_schedule_watch_client_access on public.content_schedule_watch;
create policy content_schedule_watch_client_access on public.content_schedule_watch
  for all
  using      (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

-- El reloj no es de nadie: solo lo toca el service role, que se salta RLS.
-- Sin políticas = nadie más lo lee ni lo escribe.
