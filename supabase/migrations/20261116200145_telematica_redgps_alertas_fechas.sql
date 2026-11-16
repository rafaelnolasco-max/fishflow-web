-- Avisos de Recorridos en Slack: fechas en formato numérico (DD/MM HH:MM).
-- 'DD-Mon' salía con el mes en inglés ("16-Nov").

create or replace function telematica_redgps_alerta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_nombre text;
  v_umbral constant int := 3;          -- 3 corridas = 45 min
  v_recordar constant int := 24;       -- cada 24 corridas = 6 h
  v_ok text;
begin
  select name into v_nombre from clients where id = new.client_id;
  v_nombre := coalesce(v_nombre, new.client_id::text);
  v_ok := coalesce(to_char(new.last_ok_at at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), 'nunca');

  -- Falla sostenida (al cruzar el umbral y luego cada 6 h)
  if new.fail_count >= v_umbral and new.fail_count is distinct from old.fail_count
     and (new.fail_count = v_umbral or (new.fail_count - v_umbral) % v_recordar = 0) then
    perform slack_post('slack_webhook_alertas', format(
      E':warning: *Recorridos LUKON · %s* %s: la descarga de RedGPS lleva %s corridas seguidas fallando (%s).\n*Causa probable:* %s\n*Último dato bueno:* %s\n_Detalle técnico:_ `%s`',
      v_nombre,
      case when new.fail_count = v_umbral then 'dejó de bajar datos' else 'sigue sin bajar datos' end,
      new.fail_count,
      case when new.fail_count * 15 < 120 then (new.fail_count * 15) || ' min'
           else round(new.fail_count * 15 / 60.0, 1) || ' h' end,
      telematica_redgps_explica(new.last_error), v_ok,
      left(coalesce(new.last_error, ''), 300)));
  end if;

  -- Recuperación después de haber avisado
  if old.fail_count >= v_umbral and new.fail_count = 0 then
    perform slack_post('slack_webhook_alertas', format(
      ':white_check_mark: *Recorridos LUKON · %s* se recuperó: la descarga volvió a funcionar después de %s corridas fallidas y bajó %s puntos.',
      v_nombre, old.fail_count, coalesce(new.last_points, 0)));
  end if;

  -- Volvió a correr después de un aviso de "sin correr"
  if old.stale_alerted_at is not null and new.last_run_at is distinct from old.last_run_at
     and new.last_run_at > old.stale_alerted_at then
    new.stale_alerted_at := null;
    perform slack_post('slack_webhook_alertas', format(
      ':white_check_mark: *Recorridos LUKON · %s*: la descarga automática volvió a correr.', v_nombre));
  end if;

  return new;
end;
$$;

create or replace function telematica_redgps_vigilante()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in
    select a.client_id, coalesce(c.name, a.client_id::text) nombre, a.last_run_at
    from telematica_redgps_accounts a left join clients c on c.id = a.client_id
    where a.enabled and a.stale_alerted_at is null
      and coalesce(a.last_run_at, a.created_at) < now() - interval '40 minutes'
  loop
    perform slack_post('slack_webhook_alertas', format(
      E':rotating_light: *Recorridos LUKON · %s*: la descarga automática no ha corrido desde %s. Puede ser el cron de Supabase o la función `redgps-sync` cayéndose antes de registrar la corrida.',
      r.nombre,
      coalesce(to_char(r.last_run_at at time zone 'America/Mexico_City', 'DD/MM HH24:MI'), 'que se encendió')));
    update telematica_redgps_accounts set stale_alerted_at = now() where client_id = r.client_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function telematica_redgps_vigilante() from public, anon, authenticated;
revoke all on function telematica_redgps_alerta() from public, anon, authenticated;
