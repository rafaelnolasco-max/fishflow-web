-- Prueba de apagado remoto (corte de motor) al cerrar instalaciones con GPS. Pedido de Alex, 12-nov-2026.
-- 'exitosa' = se probó y funcionó; 'no_aplica' = el vehículo no lleva corte de motor. Dashcam sola: null.
alter table public.telematica_installations
  add column if not exists remote_cutoff_test text check (remote_cutoff_test in ('exitosa', 'no_aplica'));
