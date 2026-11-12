-- Telemática · ralentí por unidad en el tablero de Flotilla — 2026-11-12
-- Pedido de Rafa: el ralentí (motor encendido sin moverse) por auto es una
-- métrica clave para cada conductor. telematica_fleet_summary ahora regresa
-- idle_min por unidad (suma del resumen diario).
do $$
declare def text;
begin
  select pg_get_functiondef('public.telematica_fleet_summary(uuid,timestamptz,timestamptz)'::regprocedure) into def;
  def := replace(def, 'sum(km) km, sum(moving_min) moving_min,', 'sum(km) km, sum(moving_min) moving_min, sum(idle_min) idle_min,');
  def := replace(def, '''moving_min'', coalesce(pv.moving_min, 0),', '''moving_min'', coalesce(pv.moving_min, 0), ''idle_min'', coalesce(pv.idle_min, 0),');
  execute def;
end $$;
