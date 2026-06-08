-- FishFlow — Servicio de transcripción compartido (aditivo, multi-tenant)
-- Aplicado vía MCP el 2026-06-08. Independiente de cualquier cliente.

-- 1) Tabla compartida de transcripciones
create table public.transcriptions (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  module           text not null,                       -- 'therapy_session', 'vet_consult', etc.
  source_type      text not null default 'recorder',    -- recorder | fireflies | phone | whatsapp | upload
  ref_id           uuid,                                 -- referencia genérica (patient_id, mascota_id…)
  storage_bucket   text not null default 'audio',
  storage_path     text not null,
  status           text not null default 'pending',      -- pending | processing | done | error
  transcript       text,
  language         text default 'es',
  duration_seconds int,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index transcriptions_client_module_idx on public.transcriptions (client_id, module);
create index transcriptions_ref_idx on public.transcriptions (ref_id);

alter table public.transcriptions enable row level security;
create policy "client members manage transcriptions"
  on public.transcriptions for all
  using (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

-- 2) Bucket de audio privado, scopeado por client_id en la ruta: {client_id}/{module}/archivo
insert into storage.buckets (id, name, public) values ('audio','audio', false)
  on conflict (id) do nothing;

create policy "client members read audio" on storage.objects for select
  using (bucket_id='audio' and public.user_has_access_to_client( ((storage.foldername(name))[1])::uuid ));
create policy "client members upload audio" on storage.objects for insert
  with check (bucket_id='audio' and public.user_has_access_to_client( ((storage.foldername(name))[1])::uuid ));
create policy "service role full access audio" on storage.objects for all
  using (bucket_id='audio' and auth.role()='service_role')
  with check (bucket_id='audio' and auth.role()='service_role');

-- 3) sessions: columnas nuevas aditivas
alter table public.sessions
  add column if not exists audio_path       text,
  add column if not exists transcription_id uuid references public.transcriptions(id),
  add column if not exists source_type      text default 'manual',   -- manual | recorder | fireflies
  add column if not exists approved_at      timestamptz,             -- gate "aprobar antes de enviar"
  add column if not exists sent_at          timestamptz;             -- cuándo se envió al paciente

-- 4) patients: consentimiento de grabación
alter table public.patients
  add column if not exists recording_consent    boolean not null default false,
  add column if not exists recording_consent_at timestamptz;
