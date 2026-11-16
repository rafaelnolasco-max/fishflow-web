-- Recorridos · avisos a Slack (#alertas) de la descarga automática de RedGPS.
--   1) Falla: una flotilla lleva 3 corridas seguidas fallando (45 min). Recordatorio cada 6 h mientras siga.
--   2) Recuperación: vuelve a bajar bien después de haber avisado.
--   3) Sin correr: el vigilante ve que una flotilla encendida no ha corrido en 40 min
--      (cron caído, función que truena antes de registrar). Avisa una vez y avisa al volver.
-- Usa slack_post('slack_webhook_alertas', …) (secreto en Vault, canal #alertas).
-- Las funciones se reemplazan en 20261116200145_telematica_redgps_alertas_fechas.sql (fechas DD/MM).

alter table telematica_redgps_accounts
  add column if not exists stale_alerted_at timestamptz;

create or replace function telematica_redgps_explica(p_error text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_error is null then 'sin detalle'
    when p_error ~ '30500' then 'RedGPS rechazó las credenciales (usuario, contraseña o llave API). ¿Las cambiaron?'
    when p_error ~ '30600' then 'RedGPS dice que el equipo no está autorizado para este usuario'
    when p_error ~ '30400' then 'RedGPS rechazó el token y no se pudo renovar'
    when p_error ~ '99500' then 'el servicio de RedGPS no está disponible'
    when p_error ~* 'faltan usuario|falta la apikey' then 'faltan credenciales de RedGPS en Vault'
    when p_error ~* 'timeout|timed out|aborted' then 'RedGPS no respondió a tiempo'
    when p_error ~* 'resumen diario' then 'bajó los datos pero falló el recálculo del panel'
    else 'error no reconocido'
  end;
$$;

create or replace function telematica_redgps_alerta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  return new;  -- cuerpo real en 20261116200145_telematica_redgps_alertas_fechas.sql
end;
$$;

drop trigger if exists telematica_redgps_alerta on telematica_redgps_accounts;
create trigger telematica_redgps_alerta
  before update on telematica_redgps_accounts
  for each row execute function telematica_redgps_alerta();

create or replace function telematica_redgps_vigilante()
returns integer language plpgsql security definer set search_path to 'public' as $$
begin
  return 0;  -- cuerpo real en 20261116200145_telematica_redgps_alertas_fechas.sql
end;
$$;
revoke all on function telematica_redgps_vigilante() from public, anon, authenticated;
revoke all on function telematica_redgps_alerta() from public, anon, authenticated;

select cron.unschedule('redgps-vigilante') where exists (select 1 from cron.job where jobname = 'redgps-vigilante');
select cron.schedule('redgps-vigilante', '8,23,38,53 * * * *', 'select public.telematica_redgps_vigilante()');
