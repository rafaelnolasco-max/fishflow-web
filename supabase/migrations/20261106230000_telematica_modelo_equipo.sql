-- Telemática · modelo del equipo GPS — 2026-11-06
-- JC Trunking mezcla 4 modelos Suntech (ST4215, ST4315, ST3340LC, ST640LC) y el
-- acelerómetro no marca igual en todos (el ST640LC no reporta aceleración/frenada
-- brusca). El reporte compara el manejo agresivo de cada unidad contra las de su
-- mismo modelo. Modelos tomados del panel de distribuidor (services.lukon.com.mx → Equipos).
alter table public.telematica_vehicles add column if not exists device_model text;

update public.telematica_vehicles v set device_model = t.m from (values
('1600024273','Suntech ST4215'),('1600049392','Suntech ST4215'),('1600092183','Suntech ST4215'),
('0950175629','Suntech ST4315'),('0950175628','Suntech ST4315'),('0950120183','Suntech ST4315'),('0950118970','Suntech ST4315'),
('0950075928','Suntech ST4315'),('0950070805','Suntech ST4315'),('0950070804','Suntech ST4315'),
('0560024838','Suntech ST3340LC'),('0560024836','Suntech ST3340LC'),('0560022580','Suntech ST3340LC'),('0560017216','Suntech ST3340LC'),
('0560017215','Suntech ST3340LC'),('0560012547','Suntech ST3340LC'),('010200167','Suntech ST640LC'),
('1600091316','Suntech ST4215'),('1600091318','Suntech ST4215')) t(d, m)
where v.device_id = t.d;
update public.telematica_vehicles set device_model = 'Suntech ST4215'
where client_id = (select id from clients where slug = 'lukon-selome') and device_id like '16000921%';

do $$
declare def text;
begin
  select pg_get_functiondef('public.telematica_monthly_report(uuid)'::regprocedure) into def;
  def := replace(def, 'select ds.*, v.alias, v.plate, v.device_id, v.photo_url,', 'select ds.*, v.alias, v.plate, v.device_id, v.photo_url, v.device_model,');
  def := replace(def, 'date_trunc(''month'', day)::date mes, vehicle_id, alias, plate, device_id, photo_url, kmpl,', 'date_trunc(''month'', day)::date mes, vehicle_id, alias, plate, device_id, photo_url, device_model, kmpl,');
  def := replace(def, 'from d group by 1, 2, 3, 4, 5, 6, 7', 'from d group by 1, 2, 3, 4, 5, 6, 7, 8');
  execute def;
end $$;
