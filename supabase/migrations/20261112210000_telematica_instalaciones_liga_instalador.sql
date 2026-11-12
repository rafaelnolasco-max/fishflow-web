-- Liga privada por orden para el instalador (sin cuenta). 12-nov-2026.
-- Se genera desde el panel ("Enviar al instalador"); generar una nueva anula la anterior.
-- Solo permite empezar, subir fotos y terminar mientras la orden está programada o en sitio.
alter table public.telematica_installations
  add column if not exists installer_token uuid unique;
