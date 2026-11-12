-- El cliente puede NO aceptar la instalación y explicar por qué desde su reporte (12-nov-2026).
-- Estado nuevo 'incidencia': detiene la auto-aceptación (que solo toma 'terminada').
alter table public.telematica_installations drop constraint if exists telematica_installations_status_check;
alter table public.telematica_installations add constraint telematica_installations_status_check
  check (status in ('programada', 'en_sitio', 'terminada', 'incidencia', 'aceptada', 'cancelada'));
alter table public.telematica_installations
  add column if not exists incident_reason text,
  add column if not exists incident_at timestamptz;
