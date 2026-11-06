-- Telemática · "Sale" del reporte mensual — 2026-11-06
-- first_move tomaba el primer movimiento del día; un viaje que cruza la
-- medianoche lo dejaba en 00:xx (SELOME 04 "salía" a las 00:58 en promedio).
-- Ahora es el primer movimiento a partir de las 4:00; el manejo de madrugada
-- sigue contando como fuera de horario.
do $$
declare def text;
begin
  select pg_get_functiondef('public.telematica_refresh_daily_stats(uuid,date,date)'::regprocedure) into def;
  def := replace(def, 'min(lt::time) filter (where moving) first_move', 'min(lt::time) filter (where moving and extract(hour from lt) >= 4) first_move');
  execute def;
end $$;

-- Puntos por unidad para el selector de flotillas (suma del resumen diario;
-- contar los puntos crudos unidad por unidad tardaba ~8 s)
create or replace function public.telematica_points_by_vehicle(p_clients uuid[])
returns table (vehicle_id uuid, points bigint)
language sql stable
set search_path to 'public'
as $$
  select vehicle_id, sum(points)::bigint from telematica_daily_stats where client_id = any (p_clients) group by vehicle_id;
$$;
revoke all on function public.telematica_points_by_vehicle(uuid[]) from public, anon;
grant execute on function public.telematica_points_by_vehicle(uuid[]) to authenticated, service_role;
