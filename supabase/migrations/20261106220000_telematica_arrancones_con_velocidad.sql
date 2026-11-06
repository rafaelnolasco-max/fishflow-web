-- Telemática · arrancones solo con velocidad reportada — 2026-11-06
-- Los exports viejos ("Rango", JC Trunking sep–oct) no traen velocidad; con
-- coalesce(speed_kmh, 0) cada aceleración brusca de esos puntos contaba como
-- arrancón (≤20 km/h). Ahora un arrancón exige velocidad reportada ≤20 km/h.
do $$
declare def text;
begin
  select pg_get_functiondef('public.telematica_refresh_daily_stats(uuid,date,date)'::regprocedure) into def;
  def := replace(def, 'and coalesce(speed_kmh, 0) <= 20) hal', 'and speed_kmh <= 20) hal');
  execute def;
end $$;
