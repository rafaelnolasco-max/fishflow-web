-- Alta del cliente Los Aguachiles, acceso de Rafa y menu (generado de mockups/losaguachiles/menu.py).
insert into public.clients (id, name, slug, vertical, gateway_primary)
values ('09d07921-9cef-4cff-905e-b0962f903487', 'Los Aguachiles', 'aguachiles', 'restaurante', 'none')
on conflict (id) do update set name = excluded.name, slug = excluded.slug, vertical = excluded.vertical;

insert into public.user_client_access (user_id, client_id, role)
select u.id, '09d07921-9cef-4cff-905e-b0962f903487', 'admin' from auth.users u where u.email = 'rafaelnolasco@gmail.com'
and not exists (select 1 from public.user_client_access a where a.user_id = u.id and a.client_id = '09d07921-9cef-4cff-905e-b0962f903487');

insert into public.store_products (id, client_id, category, name, description, price, sort_order, active)
values
  ('0e065b48-ff0e-44bd-92fd-a2f35e142a46', '09d07921-9cef-4cff-905e-b0962f903487', 'Aguachiles', 'Aguachile Verde', 'Camarón, chile serrano, limón, pepino y cebolla morada.', 155, 10, true),
  ('4c633d1e-88f7-40d7-88eb-863f7deea7c0', '09d07921-9cef-4cff-905e-b0962f903487', 'Aguachiles', 'Aguachile Rojo', 'Camarón en salsa de chile de árbol. El que más pica.', 155, 20, true),
  ('3a02e72f-3a75-4b9f-ad40-5ee37195676d', '09d07921-9cef-4cff-905e-b0962f903487', 'Aguachiles', 'Aguachile Negro', 'Camarón en salsa negra de chile morita y soya.', 170, 30, true),
  ('6e989100-b4b2-4f6f-8637-2e2334e92c55', '09d07921-9cef-4cff-905e-b0962f903487', 'Aguachiles', 'Aguachile Mixto', 'Camarón y pulpo en el mismo plato.', 180, 40, true),
  ('30f957dd-9d7c-4fe7-8fcd-f40b2ee949db', '09d07921-9cef-4cff-905e-b0962f903487', 'Ceviches', 'Ceviche de Camarón', 'Camarón picado con jitomate, cebolla y cilantro.', 155, 50, true),
  ('382d3340-cb20-4249-b312-fa1aed61144b', '09d07921-9cef-4cff-905e-b0962f903487', 'Ceviches', 'Ceviche de Pulpo', 'Pulpo suave, curado en limón.', 165, 60, true),
  ('9ffb63ea-1769-46ba-b409-5705302a49cb', '09d07921-9cef-4cff-905e-b0962f903487', 'Ceviches', 'Ceviche Mixto', 'Camarón y pulpo.', 180, 70, true),
  ('4b42ac69-f528-4e51-8306-34ae8890522a', '09d07921-9cef-4cff-905e-b0962f903487', 'Micheladas', 'Michelada', 'Preparada al momento, con su chamoy y chile.', 100, 80, true),
  ('00f1dee7-9fc1-4e6f-8745-0bda4d8f3cdc', '09d07921-9cef-4cff-905e-b0962f903487', 'Micheladas', 'Michelada con Clamato', 'La clásica, con clamato.', 120, 90, true)
on conflict (id) do update set category = excluded.category, name = excluded.name,
  description = excluded.description, price = excluded.price, sort_order = excluded.sort_order;

insert into public.review_settings (client_id, business_display_name, msg_template_1, msg_template_2, msg_template_3, review_goal, brand_color)
values ('09d07921-9cef-4cff-905e-b0962f903487', 'Los Aguachiles',
  'Hola {nombre}, soy Chiva de Los Aguachiles 🦐 ¿Qué tal estuvo tu pedido?',
  '¡Qué gusto leerte! ¿Nos ayudarías con una reseña en Google? A un negocio chiquito como el nuestro le ayuda un montón 🌶️',
  '¡Mil gracias! Aquí está el link directo, son 30 segundos: {link}',
  25, '#E8207A')
on conflict (client_id) do nothing;

notify pgrst, 'reload schema';
