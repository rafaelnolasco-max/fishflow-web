-- ─────────────────────────────────────────────────────────────────────────────
-- Guardrails por vertical en el módulo de Contenido + alta de JJ Laboral.
-- Aplicada en producción el 2026-08-11 vía el conector MCP de Supabase.
-- Se versiona aquí para que el historial del repo no dependa del dashboard.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Guardrails por vertical.
--    Hasta hoy `sensitive` significaba "aplica las reglas de salud". Con el alta
--    de un despacho laboral hacen falta reglas distintas (no inventar cifras ni
--    números de artículo, no prometer resultados de juicio), así que separamos
--    el "sí requiere cuidado" del "cuál cuidado".
--    Compatible hacia atrás: guardrails NULL + sensitive = true sigue aplicando
--    las reglas de salud en /api/content/draft.
alter table public.content_settings
  add column if not exists guardrails text;

comment on column public.content_settings.guardrails is
  'Conjunto de reglas de cuidado a inyectar en el prompt: salud | legal | NULL. NULL + sensitive=true equivale a salud.';

alter table public.content_settings
  drop constraint if exists content_settings_guardrails_check;

alter table public.content_settings
  add constraint content_settings_guardrails_check
  check (guardrails is null or guardrails in ('salud', 'legal'));

update public.content_settings
   set guardrails = 'salud'
 where sensitive = true and guardrails is null;

-- 2. Alta de JJ Laboral Asociados (vertical legal_laboral).
--    Despacho de derecho laboral en CDMX. Solo usa el módulo de Contenido:
--    sin tablas propias, todo vive en content_posts / content_settings.
insert into public.clients (id, name, slug, vertical, gateway_primary, connection_type, active)
values (
  '9b4f2a17-6d3c-4e58-8f21-c0a75e3b91d4',
  'JJ Laboral Asociados',
  'jjlaboral',
  'legal_laboral',
  'none',
  'api',
  true
)
on conflict (id) do nothing;

-- 3. Voz del despacho.
--    ⚠️ El texto vive en la BD a propósito: se ajusta con un UPDATE, sin deploy.
--    Esta es la calibración inicial del 2026-08-11, leída de su feed real.
--    Si se edita en producción, este archivo queda desactualizado por diseño:
--    la fuente de verdad es content_settings.voice_profile.
insert into public.content_settings (
  client_id, brand_display_name, social_handle, signature,
  default_hashtags, sensitive, guardrails, voice_profile
) values (
  '9b4f2a17-6d3c-4e58-8f21-c0a75e3b91d4',
  'JJ Laboral Asociados',
  '@jjlaboral',
  'JJ Laboral - Defendemos tus derechos laborales.',
  '#JJLaboral #DerechosLaborales #LeyFederalDelTrabajo #AsesoríaLaboral #TrabajadoresMéxico',
  true,
  'legal',
  '(ver content_settings.voice_profile en producción)'
)
on conflict (client_id) do nothing;
