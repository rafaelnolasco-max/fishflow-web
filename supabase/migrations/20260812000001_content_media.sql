-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo de Contenido — capa de media (uploader + Supabase Storage)
--
-- Fase 1 de la ruta a Blotato. El cliente produce el arte o el reel en Canva,
-- lo sube desde el tablero y aquí queda con URL pública. Blotato exige una URL
-- descargable por HTTP: no acepta bytes ni URLs firmadas de vida corta, así que
-- sin este paso la automatización de publicación no puede arrancar.
--
-- Multi-tenant: la carpeta raíz del archivo ES el client_id, y las políticas de
-- Storage lo validan con user_has_access_to_client() igual que el resto.
--   Ruta: content-media/{client_id}/{post_id}/{timestamp}-{archivo}
--
-- El timestamp en el nombre no es adorno: la URL pública se cachea en el CDN,
-- y un nombre fijo haría que al reemplazar el arte siguiera sirviéndose el viejo.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Bucket ────────────────────────────────────────────────────────────────
-- 50 MB alcanza para un reel de ~30 s a 1080x1920. quicktime va en la lista
-- porque el carrete del iPhone graba .mov, pero el front avisa que para
-- publicar conviene MP4 (ver MediaUploader).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-media',
  'content-media',
  true,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ─── 2. Políticas de Storage ──────────────────────────────────────────────────
-- Lectura abierta (el bucket es público; la política lo hace explícito).
-- Escritura solo para quien tiene acceso al cliente, y solo dentro de SU carpeta.
drop policy if exists content_media_public_read   on storage.objects;
drop policy if exists content_media_insert_access on storage.objects;
drop policy if exists content_media_update_access on storage.objects;
drop policy if exists content_media_delete_access on storage.objects;

create policy content_media_public_read
  on storage.objects for select
  using (bucket_id = 'content-media');

create policy content_media_insert_access
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'content-media'
    and user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );

create policy content_media_update_access
  on storage.objects for update to authenticated
  using (
    bucket_id = 'content-media'
    and user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'content-media'
    and user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );

create policy content_media_delete_access
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'content-media'
    and user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );


-- ─── 3. Columnas de media en content_posts ────────────────────────────────────
alter table public.content_posts
  add column if not exists media_type        text,
  add column if not exists media_path        text,          -- ruta dentro del bucket
  add column if not exists media_url         text,          -- URL pública (lo que ve Blotato)
  add column if not exists media_size_bytes  bigint,
  add column if not exists media_duration_s  numeric(6,2),  -- solo video
  add column if not exists media_width       int,
  add column if not exists media_height      int,
  add column if not exists media_uploaded_at timestamptz,
  add column if not exists media_deleted_at  timestamptz;   -- retención tras publicar

comment on column public.content_posts.media_url is
  'URL pública del arte o reel. Requisito de Blotato: debe ser descargable por HTTP.';
comment on column public.content_posts.media_deleted_at is
  'Sellado cuando se purga el archivo del bucket tras publicar. La publicación ya vive en la red social.';

alter table public.content_posts
  drop constraint if exists content_posts_media_type_check;
alter table public.content_posts
  add constraint content_posts_media_type_check
  check (media_type is null or media_type in ('image','video'));

-- media_path y media_url viajan juntos o no viajan.
alter table public.content_posts
  drop constraint if exists content_posts_media_pair_check;
alter table public.content_posts
  add constraint content_posts_media_pair_check
  check ((media_path is null) = (media_url is null));


-- ─── 4. Columnas de publicación (listas para Blotato, aún sin usar) ───────────
alter table public.content_posts
  add column if not exists publish_targets text[] not null default '{}',
  add column if not exists blotato_post_id text,
  add column if not exists publish_error   text;

alter table public.content_posts
  drop constraint if exists content_posts_publish_targets_check;
alter table public.content_posts
  add constraint content_posts_publish_targets_check
  check (publish_targets <@ array['instagram','facebook','tiktok']::text[]);


-- ─── 5. scheduled_for: date → timestamptz ─────────────────────────────────────
-- Un reel se programa a una hora, no a un día. Los valores existentes eran
-- fechas de planeación, así que se interpretan a medianoche de CDMX y no en UTC:
-- convertir en UTC les movería el día a quien lo lea desde México.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'content_posts'
       and column_name  = 'scheduled_for'
       and data_type    = 'date'
  ) then
    alter table public.content_posts
      alter column scheduled_for type timestamptz
      using (scheduled_for::timestamp at time zone 'America/Mexico_City');
  end if;
end $$;


-- ─── 6. Estados nuevos ────────────────────────────────────────────────────────
-- 'scheduled' = entregado a Blotato y esperando su hora.
-- 'failed'    = Blotato lo rechazó; publish_error trae el motivo.
alter table public.content_posts
  drop constraint if exists content_posts_status_check;
alter table public.content_posts
  add constraint content_posts_status_check
  check (status in ('draft','approved','scheduled','published','failed'));


-- ─── 7. La regla de oro, como constraint y no como validación de pantalla ─────
-- Ninguna publicación se programa sin que una persona la haya aprobado, y sin
-- archivo ni destino no hay nada que programar. Vive en la base de datos a
-- propósito: así ningún endpoint futuro puede saltársela por descuido.
alter table public.content_posts
  drop constraint if exists content_posts_schedule_requires_approval;
alter table public.content_posts
  add constraint content_posts_schedule_requires_approval
  check (
    status <> 'scheduled'
    or (
      media_url is not null
      and array_length(publish_targets, 1) > 0
      and scheduled_for is not null
    )
  );


-- ─── 8. Índices ───────────────────────────────────────────────────────────────
create index if not exists content_posts_scheduled_idx
  on public.content_posts (client_id, scheduled_for)
  where scheduled_for is not null;

-- Candidatos a purga: ya publicados, con archivo todavía en el bucket.
create index if not exists content_posts_media_cleanup_idx
  on public.content_posts (published_at)
  where published_at is not null
    and media_path is not null
    and media_deleted_at is null;


-- ─── 9. Refrescar el cache del esquema tras el DDL ────────────────────────────
notify pgrst, 'reload schema';
