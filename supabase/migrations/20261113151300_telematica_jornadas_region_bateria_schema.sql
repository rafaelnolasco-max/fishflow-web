-- Recorridos: jornadas largas / manejo nocturno, km por estado y salud de batería (13-nov-2026)

alter table telematica_daily_stats
  add column if not exists km_night numeric not null default 0,        -- km entre 22:00 y 05:00
  add column if not exists night_min numeric not null default 0,       -- minutos en movimiento entre 22:00 y 05:00
  add column if not exists max_drive_min numeric not null default 0,   -- tramo continuo más largo sin pausa de 30 min
  add column if not exists long_drives smallint not null default 0,    -- tramos de 5 h o más sin pausa de 30 min
  add column if not exists batt_v_rest numeric,                        -- voltaje promedio con motor apagado
  add column if not exists batt_v_min numeric,                         -- voltaje mínimo del día (>0)
  add column if not exists batt_gps_min smallint,                      -- batería interna del GPS, mínimo %
  add column if not exists power_cut integer not null default 0;       -- puntos con 0 V (equipo sin corriente del vehículo)

create table if not exists telematica_daily_regions (
  vehicle_id uuid not null references telematica_vehicles(id) on delete cascade,
  day date not null,
  state text not null,
  client_id uuid not null references clients(id) on delete cascade,
  km numeric not null default 0,
  points integer not null default 0,
  primary key (vehicle_id, day, state)
);
create index if not exists telematica_daily_regions_client_day on telematica_daily_regions (client_id, day);
alter table telematica_daily_regions enable row level security;
drop policy if exists telematica_daily_regions_access on telematica_daily_regions;
create policy telematica_daily_regions_access on telematica_daily_regions
  for select to authenticated using (user_has_access_to_client(client_id));

-- Celdas de ~11 km (0.1°) → estado, aprendidas de las direcciones que sí traen estado
create table if not exists telematica_geo_cells (
  lat_r numeric(4,1) not null,
  lon_r numeric(5,1) not null,
  state text not null,
  n integer not null default 0,
  primary key (lat_r, lon_r)
);
alter table telematica_geo_cells enable row level security;
drop policy if exists telematica_geo_cells_read on telematica_geo_cells;
create policy telematica_geo_cells_read on telematica_geo_cells for select to authenticated using (true);

create or replace function telematica_state_key(seg text)
returns text language sql immutable set search_path to 'public' as $$
  select case regexp_replace(lower(translate(regexp_replace(coalesce(seg, ''), '^\s*\d{5}\s+', ''),
                                             'áéíóúüÁÉÍÓÚÜ', 'aeiouuaeiouu')), '[^a-z]', '', 'g')
    when 'aguascalientes' then 'Aguascalientes' when 'ags' then 'Aguascalientes'
    when 'bajacalifornia' then 'Baja California' when 'bc' then 'Baja California'
    when 'bajacaliforniasur' then 'Baja California Sur' when 'bcs' then 'Baja California Sur'
    when 'campeche' then 'Campeche' when 'camp' then 'Campeche'
    when 'chiapas' then 'Chiapas' when 'chis' then 'Chiapas'
    when 'chihuahua' then 'Chihuahua' when 'chih' then 'Chihuahua'
    when 'coahuila' then 'Coahuila' when 'coah' then 'Coahuila' when 'coahuiladezaragoza' then 'Coahuila'
    when 'colima' then 'Colima' when 'col' then 'Colima'
    when 'cdmx' then 'Ciudad de México' when 'df' then 'Ciudad de México'
    when 'ciudaddemexico' then 'Ciudad de México' when 'cddemexico' then 'Ciudad de México'
    when 'mexicocity' then 'Ciudad de México' when 'federaldistrict' then 'Ciudad de México'
    when 'distritofederal' then 'Ciudad de México'
    when 'durango' then 'Durango' when 'dgo' then 'Durango'
    when 'guanajuato' then 'Guanajuato' when 'gto' then 'Guanajuato'
    when 'guerrero' then 'Guerrero' when 'gro' then 'Guerrero'
    when 'hidalgo' then 'Hidalgo' when 'hgo' then 'Hidalgo'
    when 'jalisco' then 'Jalisco' when 'jal' then 'Jalisco'
    when 'estadodemexico' then 'Estado de México' when 'mex' then 'Estado de México'
    when 'stateofmexico' then 'Estado de México' when 'edomex' then 'Estado de México'
    when 'mexico' then 'Estado de México'
    when 'michoacan' then 'Michoacán' when 'mich' then 'Michoacán' when 'michoacandeocampo' then 'Michoacán'
    when 'morelos' then 'Morelos' when 'mor' then 'Morelos'
    when 'nayarit' then 'Nayarit' when 'nay' then 'Nayarit'
    when 'nuevoleon' then 'Nuevo León' when 'nl' then 'Nuevo León'
    when 'oaxaca' then 'Oaxaca' when 'oax' then 'Oaxaca'
    when 'puebla' then 'Puebla' when 'pue' then 'Puebla'
    when 'queretaro' then 'Querétaro' when 'qro' then 'Querétaro' when 'queretarodearteaga' then 'Querétaro'
    when 'quintanaroo' then 'Quintana Roo' when 'qroo' then 'Quintana Roo'
    when 'sanluispotosi' then 'San Luis Potosí' when 'slp' then 'San Luis Potosí'
    when 'sinaloa' then 'Sinaloa' when 'sin' then 'Sinaloa'
    when 'sonora' then 'Sonora' when 'son' then 'Sonora'
    when 'tabasco' then 'Tabasco' when 'tab' then 'Tabasco'
    when 'tamaulipas' then 'Tamaulipas' when 'tamps' then 'Tamaulipas'
    when 'tlaxcala' then 'Tlaxcala' when 'tlax' then 'Tlaxcala'
    when 'veracruz' then 'Veracruz' when 'ver' then 'Veracruz' when 'veracruzdeignaciodelallave' then 'Veracruz'
    when 'yucatan' then 'Yucatán' when 'yuc' then 'Yucatán'
    when 'zacatecas' then 'Zacatecas' when 'zac' then 'Zacatecas'
    else null end;
$$;

-- Estado a partir de la dirección de RedGPS. El último segmento "México" es el país y no cuenta;
-- si después de quitarlo solo queda la localidad, devuelve null y el estado se resuelve por celda.
create or replace function telematica_state_from_address(addr text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare s text[]; n int;
begin
  if addr is null then return null; end if;
  s := regexp_split_to_array(addr, '\s*,\s*');
  n := array_length(s, 1);
  if n is null then return null; end if;
  if n > 1 and lower(translate(s[n], 'éÉ', 'eE')) in ('mexico', 'mexico.') then n := n - 1;
  elsif n = 1 then return null;
  end if;
  return telematica_state_key(s[n]);
end;
$$;

-- Llenado de celdas (volver a correr si aparecen zonas nuevas "Sin identificar")
insert into telematica_geo_cells (lat_r, lon_r, state, n)
select lat_r, lon_r, state, n from (
  select round(lat::numeric,1) lat_r, round(lon::numeric,1) lon_r, telematica_state_from_address(address) state, count(*) n,
         row_number() over (partition by round(lat::numeric,1), round(lon::numeric,1) order by count(*) desc) rn
  from telematica_points where lat is not null and lon is not null and lat between 14 and 33 and lon between -119 and -86
  group by 1,2,3 having telematica_state_from_address(address) is not null
) x where rn = 1
on conflict (lat_r, lon_r) do update set state = excluded.state, n = excluded.n;
