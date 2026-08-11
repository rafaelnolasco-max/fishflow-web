-- ─────────────────────────────────────────────────────────────────────────────
-- Varias plantillas de Canva por cliente.
-- Aplicada en producción el 2026-08-11 vía el conector MCP de Supabase.
-- Se versiona aquí para que el historial del repo no dependa del dashboard.
--
-- Bulk Create llena UNA plantilla por corrida: un solo canva_template_url obliga
-- a pasar todas las aprobadas por el mismo diseño. Con un arreglo, el tablero
-- muestra una fila por plantilla y descarga el CSV ya filtrado.
--
-- Forma: [{ "label": "Reflexión — crema", "url": "https://…", "formats": ["reflexion"] }]
--   label   → lo que lee el cliente en el tablero.
--   url     → vínculo de edición de Canva.
--   formats → ids de ContentFormat que llena. null o [] = cualquier formato.
--
-- Compatible hacia atrás: si canva_templates es null, el front usa canva_template_url.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.content_settings
  add column if not exists canva_templates jsonb;

comment on column public.content_settings.canva_templates is
  'Plantillas de Canva del cliente: [{label, url, formats[]}]. null = usar canva_template_url (campo legado).';

alter table public.content_settings
  drop constraint if exists content_settings_canva_templates_check;

alter table public.content_settings
  add constraint content_settings_canva_templates_check
  check (canva_templates is null or jsonb_typeof(canva_templates) = 'array');

-- CANE: las dos plantillas tipográficas de reflexión (misma estructura, distinta paleta).
-- ⚠️ Los vínculos viven en la BD a propósito: se cambian con un UPDATE, sin deploy.
update public.content_settings
   set canva_templates = '[
         {"label": "Reflexión — crema", "url": "https://www.canva.com/design/DAHR7jlRNPo/Np-PJDP-6eTGyEbtx2qB4A/edit", "formats": ["reflexion"]},
         {"label": "Reflexión — verde", "url": "https://www.canva.com/design/DAHR7m2onKI/aAFvUceGN3xdLC5_P1Gzxw/edit", "formats": ["reflexion"]}
       ]'::jsonb
 where client_id = (select id from public.clients where slug = 'cane');
