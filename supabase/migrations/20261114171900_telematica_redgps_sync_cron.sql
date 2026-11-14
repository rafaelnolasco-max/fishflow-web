-- Dispara redgps-sync cada 15 minutos. Solo procesa cuentas con enabled = true.
select cron.unschedule('redgps-sync-15min') where exists (select 1 from cron.job where jobname = 'redgps-sync-15min');
select cron.schedule('redgps-sync-15min', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://holgtadvlrdvjxxkxcwf.supabase.co/functions/v1/redgps-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-redgps-token', (select decrypted_secret from vault.decrypted_secrets where name = 'redgps_sync_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$cron$);
