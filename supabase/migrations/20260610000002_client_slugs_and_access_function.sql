-- Slug por cliente (= segmento de ruta /app/[slug]) + función de acceso para middleware
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS slug text UNIQUE;

UPDATE public.clients SET slug = CASE vertical
  WHEN 'estetica' THEN 'belange'
  WHEN 'neurofeedback' THEN 'cane'
  WHEN 'autolavado' THEN 'autolavado'
  WHEN 'telematica_gps' THEN 'lukon'
  WHEN 'veterinaria' THEN 'sieckvet'
  WHEN 'administracion_edificios' THEN 'sparc'
  WHEN 'telecom' THEN 'tba'
  WHEN 'therapy' THEN 'therapyos'
END;

-- Función para el middleware: ¿el usuario autenticado tiene acceso al cliente con este slug?
CREATE OR REPLACE FUNCTION public.user_has_access_to_slug(p_slug text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_client_access uca
    JOIN public.clients c ON c.id = uca.client_id
    WHERE uca.user_id = auth.uid() AND c.slug = p_slug
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_access_to_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_slug(text) TO authenticated;
