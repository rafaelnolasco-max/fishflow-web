-- ─────────────────────────────────────────────────────────────────────────────
-- Canal QR · el cuestionario cambia según DÓNDE se escaneó el código
--
-- El QR del mostrador se abre en el local, minutos después de consumir.
-- El de la bolsa de café se abre en casa, días después. Mismo negocio, dos
-- momentos y dos poblaciones: preguntarles lo mismo desperdicia el único
-- momento en que el cliente está dispuesto a contestar.
--
-- Además deja de estar muerta la columna review_responses.product_ref: la
-- pregunta con role='product' la llena, y eso es lo que habilita la recompra
-- a 21 días (fase 2 del diseño).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Preguntas acotadas a un tipo de punto ────────────────────────────────
-- NULL = la pregunta aplica a todos los puntos (comportamiento anterior).
alter table review_questions
  add column if not exists touchpoint_kind text
    check (touchpoint_kind in ('mesa','mostrador','empaque','ticket','sucursal','otro'));

comment on column review_questions.touchpoint_kind is
  'Limita la pregunta a un tipo de punto de contacto. NULL = aplica a todos.';

-- La posición era única por cliente; ahora dos puntos pueden reusar la misma.
alter table review_questions drop constraint if exists review_questions_client_id_position_key;

create unique index if not exists review_questions_client_kind_pos_idx
  on review_questions (client_id, coalesce(touchpoint_kind, '*'), position);

create index if not exists review_questions_kind_idx
  on review_questions (client_id, touchpoint_kind, active, position);

-- ── 2. Qué significa la respuesta, aparte de dónde se guarda ────────────────
-- El flujo necesita saber que "¿cómo llegaste?" va a review_responses.attribution
-- y "¿cuál te llevaste?" va a product_ref, aunque las dos sean kind='choice'.
-- Sin esto el componente tendría que adivinar por el tipo, y con dos preguntas
-- 'choice' en el mismo cuestionario la adivinanza se rompe.
alter table review_questions
  add column if not exists role text
    check (role in ('attribution','product'));

comment on column review_questions.role is
  'Destino especial de la respuesta en review_responses. NULL = solo va a review_answers.';

-- ── 3. product_ref pasa a ser un dato que el flujo SÍ llena ─────────────────
create index if not exists review_responses_product_idx
  on review_responses (client_id, product_ref)
  where product_ref is not null;

-- ── 4. Seed del PoC: Café Moran's ──────────────────────────────────────────
-- Las 3 preguntas que ya existían quedan como del mostrador.
update review_questions set touchpoint_kind = 'mostrador'
where client_id = '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34'
  and touchpoint_kind is null;

update review_questions set role = 'attribution'
where client_id = '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34'
  and touchpoint_kind = 'mostrador' and position = 2;

-- Cuestionario propio de la bolsa de café empacado.
-- ⚠️ Los nombres de las mezclas son PROVISIONALES: hay que confirmarlos con el
-- dueño antes de imprimir el QR de la bolsa.
insert into review_questions (id, client_id, touchpoint_kind, position, kind, role, label_high, label_low, options, required, active) values
  ('b2000000-0000-4000-8000-000000000001', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34', 'empaque', 1, 'choice', 'product',
   '¿Cuál te llevaste?', '¿Cuál te llevaste?',
   '["De la Casa","Oaxaca","Chiapas","Veracruz","Descafeinado"]'::jsonb, false, true),
  ('b2000000-0000-4000-8000-000000000002', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34', 'empaque', 2, 'multichoice', null,
   '¿Qué te gustó de esta mezcla?', '¿Qué no te convenció?',
   '["El aroma","El cuerpo","La acidez","Lo fresca que llegó","El precio"]'::jsonb, false, true),
  ('b2000000-0000-4000-8000-000000000003', '9f3c7b21-4d58-4e0a-9c16-7a5e2b8d0f34', 'empaque', 3, 'text', null,
   '¿Nos cuentas más?', '¿Qué le faltó?', null, false, true)
on conflict (id) do update set
  touchpoint_kind = excluded.touchpoint_kind, kind = excluded.kind, role = excluded.role,
  label_high = excluded.label_high, label_low = excluded.label_low,
  options = excluded.options, active = excluded.active;

notify pgrst, 'reload schema';
