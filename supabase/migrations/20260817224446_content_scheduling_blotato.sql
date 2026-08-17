-- ─────────────────────────────────────────────────────────────────────────────
-- Programación directa a Blotato (ventana "Programar")
--
-- Por qué existe, y por qué NO reusa content_posts:
-- El módulo de Contenido está diseñado para el flujo con IA — la IA propone,
-- el cliente aprueba, el arte sale de Canva — y su constraint
-- `content_posts_schedule_requires_approval` obliga ese vaivén borrador→aprobado.
-- Karlita (CANE) no trabaja así: ella hace su imagen y su texto por su cuenta y
-- lo único que quiere es soltarlo con fecha. Un solo paso, sin aprobación.
--
-- Además content_posts guarda UNA pieza de media por publicación (media_url
-- singular). Un carrusel de Instagram son de 2 a 10 imágenes EN ORDEN, y el
-- orden es información: no cabe en una columna escalar sin desnaturalizarla.
--
-- Por eso: tabla aparte. content_posts se queda intacta y la pestaña de
-- Contenido no se entera de que esto existe.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Destinos de Blotato por cliente ──────────────────────────────────────
-- Hasta hoy el accountId de cada cliente se sabía de memoria. Aquí queda en la
-- base, con el nombre que el CLIENTE reconoce — no el nombre crudo de Blotato.
--
-- El caso que obliga a esta distinción: la cuenta de Facebook de CANE aparece en
-- Blotato como "Karla Alonso Ruiz" porque ese es el login admin de la página,
-- pero el destino real es la página institucional CANE. Mostrarle a Karlita
-- "Karla Alonso Ruiz" y "psic.karlaalonso" como dos opciones es pedirle que
-- adivine cuál es cuál.
--
-- Forma: [{ key, label, platform, accountId, pageId?, cadence[] }]
--   key      → identificador estable dentro del cliente (no cambia aunque cambie el label).
--   label    → lo que lee el cliente en el tablero.
--   platform → instagram | facebook (los que hoy soporta la ventana).
--   accountId→ id de cuenta en Blotato.
--   pageId   → obligatorio en Facebook; sale de las subcuentas de Blotato.
--   cadence  → horarios sugeridos EN HORA DE CDMX: [{dow, hour, minute}]
--              dow: 0=domingo … 6=sábado. Es una sugerencia editable, no una regla.
--
-- ⚠️ Vive en la BD a propósito: si Karlita cambia su ritmo o conecta otra cuenta,
-- se arregla con un UPDATE, sin deploy. Misma regla que voice_profile.
alter table public.content_settings
  add column if not exists blotato_accounts jsonb;

comment on column public.content_settings.blotato_accounts is
  'Destinos de publicación en Blotato: [{key, label, platform, accountId, pageId?, cadence:[{dow,hour,minute}]}]. Los horarios de cadence van en hora de CDMX (UTC-6 fijo).';

alter table public.content_settings
  drop constraint if exists content_settings_blotato_accounts_check;

alter table public.content_settings
  add constraint content_settings_blotato_accounts_check
  check (blotato_accounts is null or jsonb_typeof(blotato_accounts) = 'array');


-- ─── 2. Historial propio de lo programado ────────────────────────────────────
-- Blotato es quien publica, pero no puede ser la única fuente de verdad: sus
-- `GET /schedules` solo devuelve lo FUTURO, así que en cuanto una publicación
-- sale al aire desaparece de esa lista y el cliente se queda sin historial.
-- Esta tabla es nuestra copia, y sobrevive a que Blotato se caiga o se cambie.
create table if not exists public.content_schedules (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,

  -- Destino, congelado al momento de programar. Se guardan los tres datos y no
  -- solo la `key`: si mañana se reetiqueta el destino en content_settings, el
  -- historial debe seguir diciendo a dónde se fue ESTA publicación.
  target_key          text not null,
  target_label        text not null,
  platform            text not null check (platform in ('instagram', 'facebook')),
  blotato_account_id  text not null,
  blotato_page_id     text,

  -- Contenido. `text` es lo que se mandó a Blotato (pie + hashtags ya unidos);
  -- caption y hashtags se guardan por separado para poder reeditar sin reparsear.
  caption             text not null default '',
  hashtags            text not null default '',

  -- El carrusel. Arreglos paralelos y ORDENADOS: la posición ES el orden de las
  -- láminas. media_paths apunta a nuestro bucket; blotato_media_urls a la copia
  -- que Blotato hospeda y que es la que realmente se publica.
  media_paths         text[] not null default '{}',
  media_urls          text[] not null default '{}',
  blotato_media_urls  text[] not null default '{}',

  scheduled_at        timestamptz not null,

  blotato_submission_id text,   -- lo que devuelve POST /v2/posts
  blotato_schedule_id   text,   -- id de GET /v2/schedules; se conoce al listar

  status              text not null default 'scheduled'
                      check (status in ('scheduled', 'published', 'failed', 'canceled')),
  error               text,
  created_by          text,     -- email de quien la programó, para soporte

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Facebook sin pageId no se publica: Blotato lo rechaza. Se atrapa aquí y no
-- solo en la pantalla, para que ninguna ruta futura pueda saltárselo.
alter table public.content_schedules
  drop constraint if exists content_schedules_facebook_needs_page;
alter table public.content_schedules
  add constraint content_schedules_facebook_needs_page
  check (platform <> 'facebook' or blotato_page_id is not null);

-- Sin imagen no hay publicación que programar en Instagram ni en Facebook.
-- El tope de 10 es el de un carrusel de Instagram.
alter table public.content_schedules
  drop constraint if exists content_schedules_media_count;
alter table public.content_schedules
  add constraint content_schedules_media_count
  check (
    array_length(media_urls, 1) between 1 and 10
    and array_length(media_paths, 1) = array_length(media_urls, 1)
  );

create index if not exists content_schedules_client_when_idx
  on public.content_schedules (client_id, scheduled_at desc);

create index if not exists content_schedules_blotato_idx
  on public.content_schedules (blotato_schedule_id)
  where blotato_schedule_id is not null;

drop trigger if exists content_schedules_touch on public.content_schedules;
create trigger content_schedules_touch
  before update on public.content_schedules
  for each row execute function set_updated_at();


-- ─── 3. RLS (patrón oficial FishFlow) ────────────────────────────────────────
alter table public.content_schedules enable row level security;

drop policy if exists content_schedules_client_access on public.content_schedules;
create policy content_schedules_client_access on public.content_schedules
  for all
  using      (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));


-- ─── 4. Destinos de CANE ─────────────────────────────────────────────────────
-- Cadencia acordada con Karlita: martes y miércoles 20:30 y jueves 21:00 para su
-- Instagram personal; lunes 12:00 para el Facebook institucional de CANE.
-- Las horas son de CDMX. México no tiene horario de verano desde 2022, así que
-- CDMX es UTC-6 todo el año y la conversión es una resta fija (ver lib/socialTargets.ts).
--
-- Va por UUID y como UPSERT, no por `where slug = 'cane'`: un UPDATE contra una
-- fila que no existe no falla, simplemente no hace nada, y el tablero termina
-- diciendo "no hay cuentas conectadas" sin que nadie sepa por qué.
insert into public.content_settings (client_id, blotato_accounts)
values (
  'a9b8c7d6-e5f4-3210-9876-fedcba543210',
  '[
         {
           "key": "cane_fb",
           "label": "CANE",
           "platform": "facebook",
           "accountId": "45905",
           "pageId": "344770755658967",
           "cadence": [{"dow": 1, "hour": 12, "minute": 0}]
         },
         {
           "key": "karla_ig",
           "label": "Psic. Karla Alonso",
           "platform": "instagram",
           "accountId": "64435",
           "cadence": [
             {"dow": 2, "hour": 20, "minute": 30},
             {"dow": 3, "hour": 20, "minute": 30},
             {"dow": 4, "hour": 21, "minute": 0}
           ]
         }
   ]'::jsonb
)
on conflict (client_id) do update
  set blotato_accounts = excluded.blotato_accounts;


-- ─── 5. Refrescar el cache del esquema tras el DDL ───────────────────────────
notify pgrst, 'reload schema';
