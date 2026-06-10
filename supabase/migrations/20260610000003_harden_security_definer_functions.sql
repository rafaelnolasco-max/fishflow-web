-- Hardening auditoría 2026-06-10
-- 1) Funciones de trigger/cron: nadie las debe poder llamar via API REST
REVOKE ALL ON FUNCTION public.notify_auto_invoice() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tba_audit_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tba_set_user_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_appointment_calls_48h() FROM PUBLIC, anon, authenticated;

-- 2) user_has_access_to_client: la usan las policies RLS de usuarios autenticados
--    → authenticated la conserva, anon no la necesita
REVOKE ALL ON FUNCTION public.user_has_access_to_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_client(uuid) TO authenticated;

-- 3) Fijar search_path en funciones que lo tenían mutable
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.notify_auto_invoice() SET search_path = public;
ALTER FUNCTION public.set_session_number() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.trigger_appointment_calls_48h() SET search_path = public;
