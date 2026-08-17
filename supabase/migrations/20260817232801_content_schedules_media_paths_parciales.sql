-- ─────────────────────────────────────────────────────────────────────────────
-- Edición de publicaciones ya programadas.
-- Aplicada en producción el 2026-08-17 vía el conector MCP de Supabase.
--
-- El constraint original exigía que media_paths y media_urls tuvieran el mismo
-- largo, dando por hecho que TODA imagen había pasado por nuestro bucket. Deja
-- de ser cierto al poder editar: una publicación creada directo en Blotato (las
-- 12 de Karlita, por ejemplo) tiene imágenes que solo viven allá, sin ruta
-- nuestra. Si se le agrega una lámina desde el tablero, quedan 3 urls y 1 sola
-- ruta, y el constraint lo rechazaba.
--
-- Nuevo significado, más honesto:
--   media_urls  → las láminas, EN ORDEN. Es el contenido.
--   media_paths → solo los archivos que subimos nosotros, para poder limpiarlos.
--                 No es un arreglo paralelo y puede ser más corto o vacío.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.content_schedules
  drop constraint if exists content_schedules_media_count;

alter table public.content_schedules
  add constraint content_schedules_media_count
  check (array_length(media_urls, 1) between 1 and 10);

comment on column public.content_schedules.media_paths is
  'Rutas en el bucket content-media de las imágenes que subimos nosotros, para poder purgarlas. NO es paralelo a media_urls: las imágenes que ya vivían en Blotato no aparecen aquí.';

comment on column public.content_schedules.media_urls is
  'Las láminas del carrusel, EN ORDEN. La posición es el orden de deslizamiento.';

notify pgrst, 'reload schema';
