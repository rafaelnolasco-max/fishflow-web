-- Monitor normativo de /app/regintel (DOF, COFEPRIS y ARCSA).
-- Mismo patrón que el radar de registros: client_id + RLS con user_has_access_to_client().

-- 1. Fuentes y su salud de lectura
create table if not exists public.regintel_norm_fuentes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  clave text not null,
  pais text not null check (pais in ('MX','EC')),
  organismo text not null check (organismo in ('DOF','COFEPRIS','ARCSA')),
  nombre text not null,
  url text not null,
  tipo text not null check (tipo in ('por_fecha','inventario','noticias')),
  activo boolean not null default true,
  last_checked timestamptz,          -- última lectura exitosa REAL
  last_check_attempt timestamptz,
  last_check_error text,
  consecutive_failures integer not null default 0,
  verificacion text not null default 'sin_leer'
    check (verificacion in ('sin_leer','verificada','no_verificada')),
  linea_base_en timestamptz,         -- desde cuándo hay cobertura real
  documentos integer,                -- tamaño del inventario en la última lectura
  nota text,
  created_at timestamptz not null default now(),
  unique (client_id, clave)
);

-- 2. Inventario por fuente (IDs de documento)
create table if not exists public.regintel_norm_inventario (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  fuente_id uuid not null references public.regintel_norm_fuentes(id) on delete cascade,
  doc_id text not null,
  titulo text,
  url text,
  categoria text,
  subcategoria text,
  fecha_publicacion date,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  estado text not null default 'nuevo'
    check (estado in ('linea_base','nuevo','desaparecido','reemplazado')),
  reemplaza_a text,
  reemplazado_por text,
  unique (fuente_id, doc_id)
);
create index if not exists regintel_norm_inv_client_idx on public.regintel_norm_inventario (client_id, fuente_id);

-- 3. Días y ediciones del DOF ya revisados (idempotencia y recuperación)
create table if not exists public.regintel_norm_dias (
  client_id uuid not null references public.clients(id) on delete cascade,
  fecha date not null,
  edicion text not null check (edicion in ('MAT','VES','EXT')),
  estado text not null check (estado in ('ok','sin_datos','error')),
  notas integer not null default 0,
  error text,
  revisado_en timestamptz not null default now(),
  primary key (client_id, fecha, edicion)
);

-- 4. Corridas
create table if not exists public.regintel_norm_corridas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  inicio timestamptz not null default now(),
  fin timestamptz,
  disparo text not null default 'cron' check (disparo in ('cron','manual','prueba')),
  fuentes_ok integer not null default 0,
  fuentes_fallidas integer not null default 0,
  nuevos integer not null default 0,
  descartados integer not null default 0,
  aviso text check (aviso in ('enviado','sin_novedad','bloqueo','omitido')),
  resumen jsonb
);

-- 5. Hallazgos normativos y descartados
create table if not exists public.regintel_norm_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  fuente_id uuid references public.regintel_norm_fuentes(id) on delete set null,
  inventario_id uuid references public.regintel_norm_inventario(id) on delete set null,
  corrida_id uuid references public.regintel_norm_corridas(id) on delete set null,
  organismo text not null check (organismo in ('DOF','COFEPRIS','ARCSA')),
  doc_ref text not null,             -- código DOF, attachment ID, id ARCSA o URL
  titulo_oficial text not null,
  titulo_breve text,
  resumen text,
  fecha_publicacion date,
  fecha_vigencia date,
  url text,
  dependencia text,
  decision text not null check (decision in ('incluir','descartar')),
  etapa text not null check (etapa in ('prefiltro','clasificador','manual')),
  motivo text,
  tema text,
  verificacion text not null default 'pista_no_verificada'
    check (verificacion in ('documento_completo','resumen_automatico','pista_no_verificada')),
  accion text,
  plazo date,
  prioridad smallint check (prioridad between 1 and 3),
  portafolio text,
  reemplaza_a text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobado','descartado')),
  accion_estado text not null default 'abierta' check (accion_estado in ('abierta','cerrada')),
  origen text not null default 'diario' check (origen in ('diario','revision_inicial','manual')),
  avisado_en timestamptz,
  revisado_por uuid references auth.users(id),
  revisado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, organismo, doc_ref)
);
create index if not exists regintel_norm_items_bandeja_idx on public.regintel_norm_items (client_id, decision, estado);

-- 6. La cola de consultas manuales también recibe bloqueos del monitor
alter table public.regintel_consultas_manuales
  add column if not exists origen text not null default 'registros',
  add column if not exists url text;

-- RLS
alter table public.regintel_norm_fuentes enable row level security;
alter table public.regintel_norm_inventario enable row level security;
alter table public.regintel_norm_dias enable row level security;
alter table public.regintel_norm_corridas enable row level security;
alter table public.regintel_norm_items enable row level security;

create policy regintel_norm_fuentes_access on public.regintel_norm_fuentes for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy regintel_norm_inventario_access on public.regintel_norm_inventario for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy regintel_norm_dias_access on public.regintel_norm_dias for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy regintel_norm_corridas_access on public.regintel_norm_corridas for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));
create policy regintel_norm_items_access on public.regintel_norm_items for all to authenticated
  using (public.user_has_access_to_client(client_id)) with check (public.user_has_access_to_client(client_id));

-- Semilla: las seis fuentes, exactamente las de la especificación
insert into public.regintel_norm_fuentes (client_id, clave, pais, organismo, nombre, url, tipo) values
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','dof','MX','DOF','Diario Oficial de la Federación','https://dof.gob.mx/index_113.php','por_fecha'),
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','cofepris_portada','MX','COFEPRIS','COFEPRIS · Portada (comunicados)','https://www.gob.mx/cofepris','noticias'),
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','cofepris_docs_med','MX','COFEPRIS','COFEPRIS · Documentos informativos de medicamentos','https://www.gob.mx/cofepris/documentos/documentos-informativos-de-medicamentos','inventario'),
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','cofepris_formatos','MX','COFEPRIS','COFEPRIS · Formatos vigentes','https://www.gob.mx/cofepris/acciones-y-programas/formatos-vigentes','inventario'),
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','arcsa_docs','EC','ARCSA','ARCSA · Documentos vigentes','https://www.controlsanitario.gob.ec/documentos-vigentes/','inventario'),
  ('c2b2a692-7f39-42a1-841a-5ae31e21e851','arcsa_noticias','EC','ARCSA','ARCSA · Noticias (Comunicamos)','https://www.controlsanitario.gob.ec/category/comunicamos/','noticias')
on conflict (client_id, clave) do nothing;

-- 7. Cola del clasificador (aplicado como regintel_normativo_cola_clasificador)
alter table public.regintel_norm_items drop constraint if exists regintel_norm_items_decision_check;
alter table public.regintel_norm_items add constraint regintel_norm_items_decision_check check (decision in ('incluir','descartar','por_clasificar'));
alter table public.regintel_norm_items add column if not exists intentos smallint not null default 0;
alter table public.regintel_norm_items add column if not exists ultimo_error text;

-- 8. Job programado (aplicado como regintel_normativo_cron)
-- Lunes a viernes 21:15 CDMX (UTC-6) = 03:15 UTC de martes a sábado.
select cron.schedule('regintel-normativo-diario', '15 3 * * 2-6', $$
  select net.http_post(
    url := 'https://holgtadvlrdvjxxkxcwf.supabase.co/functions/v1/regintel-normativo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-regintel-token', (select decrypted_secret from vault.decrypted_secrets where name = 'regintel_scan_token')
    ),
    body := '{"fase":"inicio","disparo":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
