-- Respuesta sugerida a solicitudes de servicio (panel de Mario Citalán, 5-oct-2026).
--
-- reply_draft   jsonb: { clasificacion: 'normal'|'crisis'|'spam', motivo, asunto,
--                        correo, whatsapp, generado_at }. La IA propone; nada sale solo.
-- reply_sent_at  cuándo se respondió desde el panel.
-- reply_sent_via 'email' | 'whatsapp'.
--
-- Columnas genéricas en `leads` (nullable): cualquier cliente con solicitudes
-- puede reutilizarlas.
alter table public.leads
  add column if not exists reply_draft    jsonb,
  add column if not exists reply_sent_at  timestamptz,
  add column if not exists reply_sent_via text;

alter table public.leads drop constraint if exists leads_reply_sent_via_check;
alter table public.leads
  add constraint leads_reply_sent_via_check
  check (reply_sent_via is null or reply_sent_via in ('email', 'whatsapp'));
