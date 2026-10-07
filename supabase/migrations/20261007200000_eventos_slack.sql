-- Eventos: aviso a Slack por cada venta (y devolución) de boletos.
-- Mismo patrón que #pagos (slack_post + pg_net + Vault). Cada evento elige su
-- canal guardando en evt_events.slack_secret el NOMBRE del secreto de Vault con
-- la URL del Incoming Webhook. Sin secreto, no avisa.
-- VIBRA MX → #cli-megaclase (secreto slack_webhook_cli_megaclase, creado con vault.create_secret).
-- Aplicada 7-oct-2026 por SQL. Nota: el MCP de Supabase se colgaba con emojis en el SQL
-- y con DROP (pide confirmación); en la BD los emojis van como shortcodes de Slack.

alter table evt_events add column if not exists slack_secret text;

create or replace function public.notify_slack_evt_order()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $$
declare
  ev       evt_events;
  v_sold   int;
  v_cap    int;
  v_folios text;
  v_coach  text;
  v_pay    text;
  v_txt    text;
  v_prev   int;
  m        int;
begin
  select * into ev from evt_events where id = new.event_id;
  if ev.slack_secret is null then return new; end if;
  v_cap := ev.capacity + case when ev.last_chance_open then ev.last_chance_extra else 0 end;

  select count(*) into v_sold
    from evt_tickets t join evt_orders o on o.id = t.order_id
   where t.event_id = ev.id and o.status = 'paid';

  -- Venta: los boletos se acaban de emitir
  if tg_op = 'UPDATE' and old.tickets_issued_at is null and new.tickets_issued_at is not null and new.status = 'paid' then
    select string_agg(folio, ', ' order by seq) into v_folios from evt_tickets where order_id = new.id;
    if new.coach_code is not null then
      select ' · coach ' || c.code || coalesce(' (' || c.name || ')', '') into v_coach
        from evt_coaches c where c.event_id = ev.id and c.code = new.coach_code;
    end if;
    v_pay := case new.pay_method
      when 'credit_card' then 'Tarjeta de crédito' when 'debit_card' then 'Tarjeta de débito'
      when 'prepaid_card' then 'Tarjeta prepago' when 'account_money' then 'Saldo Mercado Pago'
      else coalesce(new.pay_method, '—') end;
    v_txt := ':admission_tickets: *' || ev.name || '* · ' || new.qty || case when new.qty = 1 then ' boleto' else ' boletos' end
          || ' · ' || public.fmt_mxn(new.total, 'MXN') || coalesce(v_coach, ' · directo')
          || E'\nVan *' || v_sold || ' / ' || v_cap || '*'
          || case when ev.platform_fee > 0 then ' · FishFlow acumulado: ' || public.fmt_mxn(v_sold * ev.platform_fee, 'MXN') else '' end
          || E'\n' || v_pay || ' · ' || coalesce(v_folios, '') || ' · ' || new.buyer_name;
    perform public.slack_post(ev.slack_secret, v_txt);

    -- Metas: mitad, 80% y cupo lleno
    v_prev := v_sold - new.qty;
    foreach m in array array[ceil(v_cap * 0.5)::int, ceil(v_cap * 0.8)::int, v_cap] loop
      if v_prev < m and v_sold >= m then
        perform public.slack_post(ev.slack_secret,
          case when m = v_cap
            then ':fire: *' || ev.name || ' AGOTADO* · ' || v_sold || ' / ' || v_cap ||
                 case when not ev.last_chance_open and ev.last_chance_extra > 0
                      then E'\nSe pueden abrir ' || ev.last_chance_extra || ' lugares de última oportunidad desde el panel.' else '' end
            else ':dart: *' || ev.name || '* llegó a ' || v_sold || ' / ' || v_cap || ' boletos' end);
      end if;
    end loop;

  -- Devolución o contracargo de una orden ya pagada
  elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status = 'refunded' then
    perform public.slack_post(ev.slack_secret,
      ':leftwards_arrow_with_hook: *' || ev.name || '* · devolución de ' || new.qty || ' boleto(s) · ' || public.fmt_mxn(new.total, 'MXN')
      || ' · ' || new.buyer_name || E'\nQuedan *' || v_sold || ' / ' || v_cap || '* vendidos');
  end if;
  return new;
exception when others then
  raise warning 'notify_slack_evt_order: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_slack_evt_order() from public, anon, authenticated;

drop trigger if exists trg_slack_evt_order on evt_orders;
create trigger trg_slack_evt_order
  after update of tickets_issued_at, status on evt_orders
  for each row execute function public.notify_slack_evt_order();

update evt_events set slack_secret = 'slack_webhook_cli_megaclase' where slug = 'megaclase';
