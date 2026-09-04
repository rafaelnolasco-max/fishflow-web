-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo Descubrimiento — el cuestionario de prospecto como link, no como PDF
--
-- Sustituye la hoja impresa que se le manda a un prospecto antes de la junta.
-- El prospecto abre un link con token, contesta desde el celular entre cliente
-- y cliente, sube una foto de un documento suyo y ve en pantalla cómo quedaría
-- ese papel dentro del sistema. El cuestionario es la primera demo.
--
-- El cuestionario vive como DATOS (discovery_templates.blocks, jsonb), no como
-- código: el siguiente prospecto de otra vertical es una fila nueva y un link
-- nuevo, sin tocar el repo. Ese es el punto del módulo.
--
-- Dueño de las filas: FishFlow como cliente de sí misma
-- (b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42), igual que el módulo de Publicaciones.
--
-- Seguridad: las rutas públicas NO llevan candado de sesión porque el prospecto
-- no tiene cuenta — el token ES la credencial. Por eso el token es largo, la
-- invitación caduca, y todo lo público pasa por service-role en el servidor.
-- Nadie sube nada a Storage desde el navegador.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. El cuestionario como datos ────────────────────────────────────────────
create table if not exists public.discovery_templates (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  vertical    text not null,
  intro       text,
  -- [{ id, label, title, questions: [{ id, n, type, label, hint, options[],
  --    required, warning }] }]  — type: text|textarea|choice|multi|photo
  blocks      jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.discovery_templates.blocks is
  'Bloques y preguntas del cuestionario. Cambiar de vertical es cambiar este jsonb, no el código.';


-- ─── 2. Una invitación = un prospecto = un link ───────────────────────────────
create table if not exists public.discovery_invites (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  template_id    uuid not null references public.discovery_templates(id) on delete restrict,
  public_token   text not null unique,
  prospect_name  text not null,
  prospect_org   text,
  prospect_email text,
  prospect_phone text,
  status         text not null default 'sent',
  -- { [question_id]: valor }  — se reescribe en cada autoguardado
  answers        jsonb not null default '{}'::jsonb,
  progress       int not null default 0,
  opened_at      timestamptz,
  last_saved_at  timestamptz,
  submitted_at   timestamptz,
  expires_at     timestamptz not null default (now() + interval '45 days'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.discovery_invites
  drop constraint if exists discovery_invites_status_check;
alter table public.discovery_invites
  add constraint discovery_invites_status_check
  check (status in ('sent','opened','in_progress','submitted'));

-- El token es la única credencial de la ruta pública: que no pueda quedar corto.
alter table public.discovery_invites
  drop constraint if exists discovery_invites_token_len_check;
alter table public.discovery_invites
  add constraint discovery_invites_token_len_check
  check (char_length(public_token) >= 24);

alter table public.discovery_invites
  drop constraint if exists discovery_invites_progress_check;
alter table public.discovery_invites
  add constraint discovery_invites_progress_check
  check (progress between 0 and 100);

-- Enviado quiere decir enviado: con sello de tiempo o no está enviado.
alter table public.discovery_invites
  drop constraint if exists discovery_invites_submitted_check;
alter table public.discovery_invites
  add constraint discovery_invites_submitted_check
  check (status <> 'submitted' or submitted_at is not null);


-- ─── 3. Lo que el prospecto sube, y lo que la IA leyó de ello ─────────────────
create table if not exists public.discovery_attachments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  invite_id    uuid not null references public.discovery_invites(id) on delete cascade,
  question_id  text,
  kind         text not null default 'documento',
  storage_path text not null,
  mime         text,
  size_bytes   bigint,
  ai_processed boolean not null default false,
  ai_result    jsonb,
  ai_error     text,
  created_at   timestamptz not null default now()
);

comment on table public.discovery_attachments is
  'Fotos que sube el prospecto. Bucket PRIVADO: puede traer datos de terceros aunque se pida taparlos.';


-- ─── 4. Índices ───────────────────────────────────────────────────────────────
create index if not exists discovery_invites_client_idx
  on public.discovery_invites (client_id, status);
create index if not exists discovery_invites_template_idx
  on public.discovery_invites (template_id);
create index if not exists discovery_attachments_invite_idx
  on public.discovery_attachments (invite_id, created_at);
create index if not exists discovery_templates_active_idx
  on public.discovery_templates (client_id) where active;


-- ─── 5. updated_at ────────────────────────────────────────────────────────────
drop trigger if exists set_updated_at on public.discovery_templates;
create trigger set_updated_at before update on public.discovery_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.discovery_invites;
create trigger set_updated_at before update on public.discovery_invites
  for each row execute function public.set_updated_at();


-- ─── 6. RLS ───────────────────────────────────────────────────────────────────
-- Solo el equipo que tiene acceso al cliente ve esto desde el navegador. El
-- prospecto nunca habla con la base directo: pasa por rutas con service-role.
alter table public.discovery_templates   enable row level security;
alter table public.discovery_invites     enable row level security;
alter table public.discovery_attachments enable row level security;

drop policy if exists discovery_templates_access   on public.discovery_templates;
drop policy if exists discovery_invites_access     on public.discovery_invites;
drop policy if exists discovery_attachments_access on public.discovery_attachments;

create policy discovery_templates_access
  on public.discovery_templates for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy discovery_invites_access
  on public.discovery_invites for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy discovery_attachments_access
  on public.discovery_attachments for all to authenticated
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));


-- ─── 7. Bucket privado ────────────────────────────────────────────────────────
-- Privado a propósito: aquí puede caer la foto de un documento con datos de un
-- tercero. Nada de URLs públicas; se leen con liga firmada de vida corta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'discovery-uploads',
  'discovery-uploads',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Ruta: discovery-uploads/{client_id}/{invite_id}/{uuid}-archivo
-- Sin política de insert para anon: la subida la hace el servidor con
-- service-role. El navegador del prospecto nunca toca Storage.
drop policy if exists discovery_uploads_read   on storage.objects;
drop policy if exists discovery_uploads_delete on storage.objects;

create policy discovery_uploads_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'discovery-uploads'
    and public.user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );

create policy discovery_uploads_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'discovery-uploads'
    and public.user_has_access_to_client(((storage.foldername(name))[1])::uuid)
  );


-- ─── 8. Refrescar el cache del esquema tras el DDL ────────────────────────────
notify pgrst, 'reload schema';
