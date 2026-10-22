-- Módulo Revisión en línea · panel de Rafa en /admin/revisiones
-- Cada comentario de "cambios" o "comentario" se puede marcar como resuelto
-- con una nota ("ajustado: cambié el asunto"). El cliente ve "✓ Ajustado"
-- bajo su comentario en la liga pública.
-- La versión de cada pieza vive dentro de items (jsonb): { v, ajustada_at }.

alter table public.content_review_comments
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text
    check (resolution_note is null or char_length(resolution_note) <= 2000);

alter table public.content_reviews
  add column if not exists updated_at timestamptz not null default now();

create index if not exists content_review_comments_pending_idx
  on public.content_review_comments (review_id)
  where resolved_at is null and verdict <> 'aprobado';
