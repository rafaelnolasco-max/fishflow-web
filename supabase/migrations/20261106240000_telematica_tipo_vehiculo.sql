-- Telemática · tipo de vehículo — 2026-11-06
-- En JC Trunking las 4 unidades que más "arrancones" marcaban eran camionetas
-- (VW Saveiro, NP300, F-350): una camioneta acelera mucho más fuerte que un
-- tractocamión cargado. El manejo agresivo se compara dentro del mismo tipo:
-- 'ligero' (camionetas y camiones ligeros F-350/F-450) vs 'pesado'
-- (tractocamiones, trailer full, camiones rígidos). Datos del panel de
-- distribuidor (Activos). Rendimiento por unidad: estimado por tipo, editable.
alter table public.telematica_vehicles
  add column if not exists vehicle_class text check (vehicle_class in ('ligero', 'pesado')),
  add column if not exists vehicle_desc text;

update public.telematica_vehicles v set vehicle_class = t.c, vehicle_desc = t.d, fuel_km_per_l = t.k
from (values
  ('0560012547', 'ligero', 'Ford F-350 Super Duty 2008', 6.0),
  ('0950075928', 'pesado', 'Kenworth (tractocamión) 2014', 2.5),
  ('0560017216', 'pesado', 'Freightliner (tractocamión)', 2.5),
  ('0560017215', 'pesado', 'Kenworth (tractocamión)', 2.5),
  ('0560022580', 'pesado', 'Kenworth (tractocamión)', 2.5),
  ('0560024836', 'pesado', 'Kenworth (tractocamión)', 2.5),
  ('0560024838', 'ligero', 'Volkswagen Saveiro 2022', 12.0),
  ('010200167',  'pesado', 'Kenworth T-660 2014 (tractocamión)', 2.5),
  ('0950070804', 'ligero', 'Nissan NP300', 10.0),
  ('0950070805', 'pesado', 'Freightliner Cascadia (tractocamión)', 2.5),
  ('0950118970', 'pesado', 'International (camión)', 3.5),
  ('0950120183', 'pesado', 'Freightliner Cascadia (camión)', 3.0),
  ('0950175628', 'pesado', 'Freightliner Cascadia 125 2015 (full)', 2.2),
  ('0950175629', 'ligero', 'Ford F-350 2024', 6.0),
  ('1600024273', 'ligero', 'Ford F-450 2025', 5.0),
  ('1600049392', 'ligero', 'Ford F-350 2025', 6.0),
  ('1600092183', 'pesado', 'Freightliner (tractocamión)', 2.5)
) t(dev, c, d, k)
where v.device_id = t.dev and v.client_id = (select id from public.clients where slug = 'lukon-jc-trunking');

do $$
declare def text;
begin
  select pg_get_functiondef('public.telematica_monthly_report(uuid)'::regprocedure) into def;
  def := replace(def, 'v.photo_url, v.device_model,', 'v.photo_url, v.device_model, v.vehicle_class, v.vehicle_desc,');
  def := replace(def, 'photo_url, device_model, kmpl,', 'photo_url, device_model, vehicle_class, vehicle_desc, kmpl,');
  def := replace(def, 'from d group by 1, 2, 3, 4, 5, 6, 7, 8', 'from d group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
  execute def;
end $$;
