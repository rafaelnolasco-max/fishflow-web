-- ─────────────────────────────────────────────────────────────────────────────
-- Módulo Reputación · Canal QR (inbound)
-- Diseño: docs/modulo-reputacion-canal-qr.md (13 ago 2026)
-- Copy:   material-clientes/cafe-moran/copy-canal-qr-moran.md (18 ago 2026)
--
-- Extiende review_settings / review_requests. El negocio NO tiene la lista de
-- contactos: el QR la fabrica. Al capturar contacto con consentimiento se crea
-- el review_request con source='qr' y entra a la secuencia de 3 mensajes ya
-- existente.
--
-- El CTA a Google se muestra a TODOS por igual: filtrar por sentimiento sería
-- review gating y viola la política de Google. google_cta_shown es la bitácora.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extender lo existente ────────────────────────────────────────────────
alter table review_settings
  add column if not exists brand_color     text,
  add column if not exists logo_url        text,
  add column if not exists privacy_url     text,
  add column if not exists incentive_text  text,   -- por COMPLETAR, no por reseñar
  add column if not exists collect_contact boolean not null default true,
  add column if not exists alert_threshold smallint not null default 2,
  add column if not exists alert_email     text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_settings'::regclass
      and conname  = 'review_settings_alert_threshold_check'
  ) then
    alter table review_settings
      add constraint review_settings_alert_threshold_check
      check (alert_threshold between 1 and 5);
  end if;
end $$;

-- source gana 'qr'; el CHECK viejo se reemplaza
alter table review_requests drop constraint if exists review_requests_source_check;
alter table review_requests
  add constraint review_requests_source_check
  check (source in ('csv', 'appointment', 'manual', 'qr'));

alter table review_requests
  add column if not exists response_id uuid;   -- FK más abajo, tras crear la tabla

-- ── 2. Puntos de contacto: un QR cada uno ───────────────────────────────────
create table if not exists review_touchpoints (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  slug       text not null unique,   -- va en fishflow.mx/o/[slug], corto
  label      text not null,          -- "Mesa 6", "Mostrador", "Bolsa 250g"
  kind       text not null default 'mesa'
             check (kind in ('mesa','mostrador','empaque','ticket','sucursal','otro')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists review_touchpoints_client_idx
  on review_touchpoints (client_id, active);

-- ── 3. Preguntas configurables ──────────────────────────────────────────────
create table if not exists review_questions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  position   smallint not null,
  kind       text not null default 'choice'
             check (kind in ('rating','choice','multichoice','text')),
  label_high text,        -- copy si CSAT >= 4  ("¿Qué fue lo mejor?")
  label_low  text,        -- copy si CSAT <= 3  ("¿Qué salió mal?")
  options    jsonb,       -- ["El café","La atención","La rapidez"]
  required   boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now(),

  unique (client_id, position)
);

create index if not exists review_questions_client_idx
  on review_questions (client_id, active, position);

-- ── 4. Respuestas de la encuesta ────────────────────────────────────────────
create table if not exists review_responses (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  touchpoint_id      uuid references review_touchpoints(id) on delete set null,
  csat               smallint check (csat between 1 and 5),
  comment            text,
  -- Pregunta de atribución: de dónde vino el cliente. Es la única del
  -- cuestionario que le dice al dueño dónde poner el dinero.
  attribution        text,
  product_ref        text,            -- fase 2: qué mezcla se llevó
  contact_name       text,
  contact_phone      text,            -- ya normalizado con normalizePhone()
  contact_email      text,
  consent            boolean not null default false,
  consent_at         timestamptz,
  -- Bitácora anti-gating: true en el 100% de las completadas
  google_cta_shown   boolean not null default false,
  google_cta_clicked boolean not null default false,
  outcome            text check (outcome in ('google','private','abandoned')),
  handled            boolean not null default false,
  handled_at         timestamptz,
  ip_hash            text,            -- hash con sal, nunca la IP cruda
  user_agent         text,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists review_responses_client_started_idx
  on review_responses (client_id, started_at desc);
create index if not exists review_responses_client_csat_idx
  on review_responses (client_id, csat);
create index if not exists review_responses_touchpoint_idx
  on review_responses (touchpoint_id, started_at desc);
create index if not exists review_responses_attribution_idx
  on review_responses (client_id, attribution);

alter table review_requests
  drop constraint if exists review_requests_response_id_fkey;
alter table review_requests
  add constraint review_requests_response_id_fkey
  foreign key (response_id) references review_responses(id) on delete set null;

-- ── 5. Respuestas por pregunta ──────────────────────────────────────────────
create table if not exists review_answers (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  response_id  uuid not null references review_responses(id) on delete cascade,
  question_id  uuid references review_questions(id) on delete set null,
  value_text   text,
  value_int    smallint,
  value_choice text[],
  created_at   timestamptz not null default now()
);

create index if not exists review_answers_response_idx
  on review_answers (response_id);

-- ─── RLS centralizada (patrón oficial FishFlow) ─────────────────────────────
alter table review_touchpoints enable row level security;
alter table review_questions   enable row level security;
alter table review_responses   enable row level security;
alter table review_answers     enable row level security;

drop policy if exists review_touchpoints_client_access on review_touchpoints;
create policy review_touchpoints_client_access on review_touchpoints
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists review_questions_client_access on review_questions;
create policy review_questions_client_access on review_questions
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists review_responses_client_access on review_responses;
create policy review_responses_client_access on review_responses
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists review_answers_client_access on review_answers;
create policy review_answers_client_access on review_answers
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

-- ── 6. Vista de agregación para el tablero ──────────────────────────────────
create or replace view review_daily_stats
with (security_invoker = true) as
select
  r.client_id,
  date_trunc('day', r.started_at)::date               as day,
  t.kind                                              as touchpoint_kind,
  count(*) filter (where r.completed_at is not null)  as respuestas,
  round(avg(r.csat) filter (where r.csat is not null), 2) as csat_promedio,
  count(*) filter (where r.google_cta_clicked)        as clics_google,
  count(*) filter (where r.csat <= 2)                 as criticas
from review_responses r
left join review_touchpoints t on t.id = r.touchpoint_id
group by 1, 2, 3;

-- ── 7. Desglose de atribución para el tablero ───────────────────────────────
create or replace view review_attribution_stats
with (security_invoker = true) as
select
  r.client_id,
  date_trunc('month', r.started_at)::date as month,
  coalesce(r.attribution, 'sin responder') as attribution,
  count(*)                                 as respuestas,
  round(avg(r.csat) filter (where r.csat is not null), 2) as csat_promedio
from review_responses r
where r.completed_at is not null
group by 1, 2, 3;

comment on column review_responses.attribution is
  'Cómo llegó el cliente. Tomado del análisis del cuestionario de Don Frank: es la única pregunta con ROI de marketing directo.';
comment on column review_responses.google_cta_shown is
  'Bitácora anti-gating. Debe ser true en el 100% de las respuestas completadas, sin importar el CSAT.';
