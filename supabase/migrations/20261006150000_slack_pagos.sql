-- Avisos de cobros y facturas al Slack interno de FishFlow (#pagos / #alertas).
--
-- Se hace con triggers + pg_net (mismo patrón que notify_auto_invoice) para
-- cubrir TODOS los caminos: webhooks de Stripe y Mercado Pago, cobros desde
-- /admin y la Edge Function auto-invoice.
--
-- Las URLs de los Incoming Webhooks de Slack viven en Vault:
--   slack_webhook_pagos    → #pagos
--   slack_webhook_alertas  → #alertas
-- Si falta el secreto, el aviso se omite sin romper nada.
-- Aplicada el 2026-10-06 desde el editor SQL del dashboard.
--
-- Fuera de alcance a propósito: provider = 'manual' (ventas de mostrador,
-- p. ej. Belange), que se registran por decenas al día.

create or replace function public.slack_post(p_secret text, p_text text)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $$
declare
  v_url text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = p_secret
   limit 1;
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('text', p_text)
  );
exception when others then
  raise warning 'slack_post(%): %', p_secret, sqlerrm;
end;
$$;

revoke all on function public.slack_post(text, text) from public, anon, authenticated;

create or replace function public.fmt_mxn(p numeric, p_currency text)
returns text language sql immutable as $$
  select '$' || to_char(coalesce(p, 0), 'FM999,999,990.00') || ' ' || coalesce(nullif(p_currency, ''), 'MXN')
$$;

-- ── Cobros ───────────────────────────────────────────────────────────────────
create or replace function public.notify_slack_pago()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $$
declare
  v_cliente text;
  v_prov    text;
  v_txt     text;
begin
  if coalesce(new.provider, 'manual') = 'manual' then
    return new;
  end if;
  if new.status not in ('paid', 'failed') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_cliente from clients where id = new.client_id;
  v_prov := case new.provider when 'mercadopago' then 'Mercado Pago' when 'stripe' then 'Stripe' else new.provider end;

  if new.status = 'paid' then
    v_txt := ':moneybag: *Pago recibido* · ' || fmt_mxn(new.amount, new.currency)
          || E'\n' || coalesce(v_cliente, 'Sin cliente') || ' · ' || coalesce(new.service, 'Sin concepto')
          || E'\n_' || v_prov || coalesce(' · ' || new.payment_method, '') || '_';
  else
    v_txt := ':x: *Pago no completado* · ' || fmt_mxn(new.amount, new.currency)
          || E'\n' || coalesce(v_cliente, 'Sin cliente') || ' · ' || coalesce(new.service, 'Sin concepto')
          || E'\n_' || v_prov || coalesce(' · ' || new.payment_method, '') || ' (rechazado o voucher OXXO vencido)_';
  end if;

  perform slack_post('slack_webhook_pagos', v_txt);
  return new;
exception when others then
  raise warning 'notify_slack_pago: %', sqlerrm;
  return new;
end;
$$;

create or replace trigger trigger_slack_pago
  after insert or update of status on public.pos_transactions
  for each row execute function public.notify_slack_pago();

-- ── Facturas CFDI ────────────────────────────────────────────────────────────
create or replace function public.notify_slack_factura()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $$
declare
  v_cliente text;
  v_receptor text;
  v_folio text;
  v_txt text;
begin
  if new.status not in ('valid', 'error') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select name into v_cliente from clients where id = new.client_id;
  v_receptor := coalesce(new.receptor_razon, new.receptor_rfc, 'receptor sin nombre');
  v_folio    := nullif(concat_ws('-', new.serie, new.folio::text), '');

  if new.status = 'valid' then
    v_txt := ':receipt: *Factura timbrada*' || coalesce(' ' || v_folio, '') || ' · ' || fmt_mxn(coalesce(new.total, new.amount), new.currency)
          || E'\n' || coalesce(v_cliente, 'Sin cliente') || ' → ' || v_receptor;
    perform slack_post('slack_webhook_pagos', v_txt);
  else
    v_txt := ':warning: *Factura con error* · ' || fmt_mxn(coalesce(new.total, new.amount), new.currency)
          || E'\n' || coalesce(v_cliente, 'Sin cliente') || ' → ' || v_receptor
          || E'\n```' || left(coalesce(new.error_message, 'sin detalle'), 600) || '```';
    perform slack_post('slack_webhook_pagos', v_txt);
    perform slack_post('slack_webhook_alertas', v_txt);
  end if;
  return new;
exception when others then
  raise warning 'notify_slack_factura: %', sqlerrm;
  return new;
end;
$$;

create or replace trigger trigger_slack_factura
  after insert or update of status on public.invoices
  for each row execute function public.notify_slack_factura();
