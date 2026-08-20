-- ─────────────────────────────────────────────────────────────────────────────
-- Motor de Promociones · vertical-agnóstico (cafetería, estética, restaurante)
-- 20 ago 2026 — Rafa Fish / FishFlow
--
-- Por qué existe: el canal QR ya fabrica la lista de contactos y la encuesta de
-- Café Moran's promete en pantalla "tu café del próximo martes va con 10% menos".
-- Nada cumplía esa promesa. Este módulo la cumple y, más importante, la mide.
--
-- La pieza que da el valor no es el envío: es el CÓDIGO ÚNICO POR PERSONA con
-- caducidad. Sin código no hay canje verificable, sin canje no hay número que
-- enseñarle al dueño, y sin número no hay renovación del contrato.
--
-- Mismo motor para las tres verticales. Lo único que cambia por cliente es el
-- copy y la ventana de días; nada de tablas nuevas por vertical.
--
-- Aplicada en producción el 20 ago 2026 en 7 tramos (el conector MCP corta los
-- payloads largos). Este archivo es el consolidado equivalente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Libreta de contactos, genérica multi-tenant ──────────────────────────
-- No es "los del QR": es la libreta del negocio. En Moran's la llena el QR, en
-- Belange la llenarán las citas y el punto de venta. Por eso es tabla genérica
-- y no una con prefijo de vertical.
create table if not exists contacts (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  name                 text,
  phone                text,               -- normalizado +52XXXXXXXXXX
  email                text,
  -- Solo día y mes: para felicitar no hace falta la edad, y el año es un dato
  -- personal que no tenemos por qué guardar.
  birthday_month       smallint check (birthday_month between 1 and 12),
  birthday_day         smallint check (birthday_day between 1 and 31),
  source               text not null default 'manual'
                       check (source in ('qr','manual','csv','appointment','pos','import')),
  -- Consentimiento de MERCADOTECNIA, separado del de seguimiento de reseñas.
  -- Mezclarlos es lo que vuelve impugnable el envío frente a la LFPDPPP.
  consent_marketing    boolean not null default false,
  consent_marketing_at timestamptz,
  consent_text         text,               -- el texto exacto que la persona aceptó
  opt_out_at           timestamptz,        -- baja: gana siempre sobre el consent
  tags                 text[] not null default '{}',
  last_seen_at         timestamptz,
  -- Denormalizado a propósito: con esto el segmento de una campaña se resuelve
  -- con una sola consulta a contacts, sin cruzar review_responses por teléfono.
  last_csat            smallint check (last_csat between 1 and 5),
  last_product         text,
  last_touchpoint_kind text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  check (phone is not null or email is not null)
);

-- Dedupe por cliente. Parciales porque una persona puede dejar solo teléfono o
-- solo correo, y NULL no colisiona consigo mismo en un unique normal.
create unique index if not exists contacts_client_phone_idx
  on contacts (client_id, phone) where phone is not null;
create unique index if not exists contacts_client_email_idx
  on contacts (client_id, lower(email)) where email is not null;
create index if not exists contacts_client_consent_idx
  on contacts (client_id, consent_marketing) where opt_out_at is null;
create index if not exists contacts_birthday_idx
  on contacts (client_id, birthday_month, birthday_day) where birthday_month is not null;
create index if not exists contacts_last_seen_idx
  on contacts (client_id, last_seen_at desc nulls last);
create index if not exists contacts_segmento_idx
  on contacts (client_id, consent_marketing, last_csat, last_seen_at desc)
  where opt_out_at is null;

comment on table contacts is
  'Libreta única del negocio. La alimentan el canal QR, las citas y el POS. El consentimiento de mercadotecnia vive aquí, no en review_responses.';
comment on column contacts.opt_out_at is
  'Baja explícita. Manda sobre consent_marketing: si tiene fecha, no se le envía nada aunque el consent siga en true.';
comment on column contacts.consent_text is
  'Texto exacto de la casilla que la persona aceptó. Es la prueba del consentimiento frente a la LFPDPPP.';
comment on column contacts.last_csat is
  'Última calificación que dejó. Denormalizado desde review_responses para que el segmento sea una sola consulta.';

-- ── 2. Campañas ─────────────────────────────────────────────────────────────
-- El segmento se guarda como criterio (jsonb), no como lista congelada: una
-- campaña de cumpleaños resuelve a gente distinta cada día que corre.
create table if not exists promo_campaigns (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  kind          text not null default 'manual'
                check (kind in ('cumpleanos','recompra','reactivacion','dia_muerto','manual')),
  channel       text not null default 'whatsapp'
                check (channel in ('whatsapp','email','ambos')),
  -- Copy con marcadores: {{nombre}} {{codigo}} {{vence}} {{negocio}} {{oferta}} {{producto}}
  body          text not null,
  subject       text,                       -- solo para correo
  offer_label   text not null,              -- "10% en tu café"
  -- { csat_min, dias_sin_ver, touchpoint_kind, product_ref }
  segment       jsonb not null default '{}'::jsonb,
  valid_hours   integer not null default 72 check (valid_hours between 1 and 8760),
  status        text not null default 'borrador'
                check (status in ('borrador','activa','pausada','terminada')),
  scheduled_for timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists promo_campaigns_client_idx
  on promo_campaigns (client_id, status, created_at desc);

comment on column promo_campaigns.segment is
  'Criterio de audiencia, no lista de destinatarios. Se resuelve en cada corrida.';

-- ── 3. Códigos: la unidad de medición del módulo ────────────────────────────
-- Alfabeto sin caracteres ambiguos (nada de O/0 ni I/1): quien teclea esto es el
-- cajero, leyendo la pantalla de un celular ajeno con la fila esperando.
--
-- NO hay unique (campaign_id, contact_id): "Martes de 10%" se corre cada semana
-- y le tiene que poder dar un código nuevo a la misma persona. Lo que hay que
-- evitar no es el segundo código sino el segundo código VIVO, y eso no se puede
-- expresar en un índice (now() no es inmutable). Se resuelve en la corrida:
-- PromosTab excluye a quien ya trae un código pendiente o enviado sin usar.
create table if not exists promo_codes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  campaign_id  uuid not null references promo_campaigns(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  code         text not null check (code ~ '^[2-9A-HJ-NP-Z]{5}$'),
  state        text not null default 'pendiente'
               check (state in ('pendiente','enviado','canjeado','vencido','cancelado')),
  expires_at   timestamptz not null,
  sent_at      timestamptz,
  sent_channel text check (sent_channel in ('whatsapp','email')),
  redeemed_at  timestamptz,
  redeemed_by  text,                        -- quién lo marcó en el tablero
  created_at   timestamptz not null default now(),

  unique (client_id, code)
);

create index if not exists promo_codes_campaign_idx on promo_codes (campaign_id, state);
create index if not exists promo_codes_client_state_idx on promo_codes (client_id, state, expires_at);
create index if not exists promo_codes_contact_idx on promo_codes (contact_id, created_at desc);
create index if not exists promo_codes_campaign_contact_idx on promo_codes (campaign_id, contact_id, state);

comment on table promo_codes is
  'Un código por persona por corrida. Es la única prueba de que la promoción movió caja.';

-- ── 4. Configuración por cliente ────────────────────────────────────────────
alter table review_settings
  add column if not exists collect_birthday   boolean not null default false,
  add column if not exists collect_email      boolean not null default false,
  add column if not exists promo_consent_text text;

comment on column review_settings.promo_consent_text is
  'Texto de la casilla de consentimiento de promociones en la encuesta pública. Distinto del consentimiento de seguimiento de reseñas.';

-- ── 5. RLS (patrón oficial FishFlow) ────────────────────────────────────────
alter table contacts        enable row level security;
alter table promo_campaigns enable row level security;
alter table promo_codes     enable row level security;

drop policy if exists contacts_client_access on contacts;
create policy contacts_client_access on contacts
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists promo_campaigns_client_access on promo_campaigns;
create policy promo_campaigns_client_access on promo_campaigns
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

drop policy if exists promo_codes_client_access on promo_codes;
create policy promo_codes_client_access on promo_codes
  for all using (user_has_access_to_client(client_id))
  with check (user_has_access_to_client(client_id));

-- ── 6. Métrica de la campaña ────────────────────────────────────────────────
-- Es lo que se le enseña al dueño cuando pregunta para qué paga el módulo.
create or replace view promo_campaign_stats
with (security_invoker = true) as
select
  c.client_id,
  c.id as campaign_id,
  c.name,
  c.kind,
  c.status,
  count(k.id) as codigos,
  count(k.id) filter (where k.state in ('enviado','canjeado')) as enviados,
  count(k.id) filter (where k.state = 'canjeado') as canjeados,
  round(
    100.0 * count(k.id) filter (where k.state = 'canjeado')
    / nullif(count(k.id) filter (where k.state in ('enviado','canjeado')), 0)
  , 1) as tasa_canje,
  max(k.redeemed_at) as ultimo_canje,
  c.created_at
from promo_campaigns c
left join promo_codes k on k.campaign_id = c.id
group by c.client_id, c.id, c.name, c.kind, c.status, c.created_at;

-- ── 7. Vencimiento de códigos ───────────────────────────────────────────────
-- Se llama desde el tablero al abrir la pestaña. No se usa pg_cron todavía: con
-- el volumen actual no lo justifica y un cron mal puesto es deuda silenciosa.
create or replace function promo_vencer_codigos(p_client_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  n integer;
begin
  update promo_codes
     set state = 'vencido'
   where client_id = p_client_id
     and state in ('pendiente','enviado')
     and expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ── 8. Seed de Café Moran's ─────────────────────────────────────────────────
-- Se pide cumpleaños en la encuesta para que la campaña de cumpleaños tenga de
-- dónde agarrarse. El correo queda apagado a propósito: teclearlo de pie y con
-- la fila detrás es donde más se abandona la encuesta.
update review_settings
   set collect_birthday = true,
       collect_email    = false,
       promo_consent_text = 'Quiero recibir las promociones de Café Moran''s por WhatsApp.'
 where client_id = '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34';

-- Las 4 campañas entran como BORRADOR: nada sale sin que el dueño lo apruebe.
insert into promo_campaigns (id, client_id, name, kind, channel, offer_label, valid_hours, segment, body) values
  ('c1000000-0000-4000-8000-000000000001', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34',
   'Martes de 10%', 'dia_muerto', 'whatsapp', '10% en tu café', 72, '{"csat_min":3}'::jsonb,
   'Hola {{nombre}}, es martes en Moran''s. Tu 10% de descuento está listo: enseña el código {{codigo}} en el mostrador. Vence {{vence}}.'),
  ('c1000000-0000-4000-8000-000000000002', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34',
   'Cumpleaños', 'cumpleanos', 'whatsapp', 'Café de la casa gratis', 168, '{}'::jsonb,
   'Feliz cumpleaños, {{nombre}}. Tu café de la casa va por cuenta de Moran''s: enseña el código {{codigo}} cuando vengas. Vence {{vence}}.'),
  ('c1000000-0000-4000-8000-000000000003', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34',
   'Recompra de bolsa a 21 días', 'recompra', 'whatsapp', '15% en tu próxima bolsa', 120,
   '{"dias_sin_ver":21,"touchpoint_kind":"empaque"}'::jsonb,
   'Hola {{nombre}}, ya van tres semanas de tu bolsa de {{producto}}. Si vienes por la siguiente, va con 15% menos: código {{codigo}}, vence {{vence}}.'),
  ('c1000000-0000-4000-8000-000000000004', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34',
   'Te extrañamos (45 días)', 'reactivacion', 'whatsapp', 'Café gratis con tu pan', 96,
   '{"dias_sin_ver":45,"csat_min":3}'::jsonb,
   'Hola {{nombre}}, hace rato que no te vemos por Moran''s. Vuelve esta semana y el café va con tu pan: código {{codigo}}, vence {{vence}}.')
on conflict (id) do update set
  name = excluded.name, kind = excluded.kind, channel = excluded.channel,
  offer_label = excluded.offer_label, valid_hours = excluded.valid_hours,
  segment = excluded.segment, body = excluded.body, updated_at = now();

notify pgrst, 'reload schema';
