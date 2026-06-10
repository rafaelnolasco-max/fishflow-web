-- Habilitar RLS en sparc_staff (única tabla sin RLS — auditoría 2026-06-10)
ALTER TABLE public.sparc_staff ENABLE ROW LEVEL SECURITY;

-- SELECT: mismo patrón que el resto de tablas sparc_* (acceso via user_client_access)
CREATE POLICY sparc_staff_select ON public.sparc_staff
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_client_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.client_id = sparc_staff.client_id
    )
  );
