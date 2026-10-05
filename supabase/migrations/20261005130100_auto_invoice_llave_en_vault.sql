-- ─────────────────────────────────────────────────────────────────────────────
-- notify_auto_invoice(): la service role key estaba escrita en el cuerpo de la
-- función (visible para cualquiera que lea pg_proc). Ahora se lee de Vault.
--
-- PRERREQUISITO (una vez, fuera del repo — el secreto NUNCA va en git):
--   select vault.create_secret('<service_role_key>', 'auto_invoice_service_key',
--          'Bearer para que notify_auto_invoice llame a la Edge Function auto-invoice');
--
-- Si el secreto no existe, la función NO truena el UPDATE del pago: registra un
-- WARNING y sigue (el cobro es más importante que el recibo).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.notify_auto_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_url    text := 'https://holgtadvlrdvjxxkxcwf.supabase.co/functions/v1/auto-invoice';
  v_secret text;
begin
  if new.status = 'paid' and (old.status is null or old.status <> 'paid') then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'auto_invoice_service_key'
     limit 1;

    if v_secret is null then
      raise warning 'notify_auto_invoice: falta el secreto auto_invoice_service_key en Vault (pago %)', new.id;
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body    := jsonb_build_object(
        'record', jsonb_build_object(
          'id',             new.id,
          'client_id',      new.client_id,
          'amount',         new.amount,
          'currency',       new.currency,
          'service',        new.service,
          'provider',       new.provider,
          'payment_method', new.payment_method,
          'metadata',       new.metadata
        )
      )
    );
  end if;
  return new;
end;
$$;
