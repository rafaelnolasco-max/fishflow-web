-- FishFlow — cierre de la auditoría de seguridad del 14-sep-2026
-- ─────────────────────────────────────────────────────────────────────────────
-- Hallazgo crítico: el módulo vet_inv tenía política FOR ALL concedida a `anon`
-- con USING true / WITH CHECK true en cuatro tablas, más dos RPC SECURITY
-- DEFINER ejecutables sin sesión y cinco vistas SECURITY DEFINER. La anon key
-- viaja en el bundle del navegador, así que cualquiera podía leer, alterar y
-- BORRAR los 10,810 movimientos del libro de inventario (con columna
-- `controlado`: es medicamento controlado, no tornillos).
--
-- Se verificó antes de aplicar: `vet_inv` no aparece en NINGÚN archivo del
-- repo —ni en app/, ni en public/demos, ni en docs— así que cerrarlo no rompe
-- nada de fishflow-web. Si un consumidor externo lo usaba, se notará y se
-- re-otorga con un check de cliente adentro.

-- ─── 1. vet_inv: candado normal del sistema ─────────────────────────────────
drop policy if exists vet_inv_prod_all  on public.vet_inv_productos;
drop policy if exists vet_inv_mov_all   on public.vet_inv_movimientos;
drop policy if exists vet_inv_suc_all   on public.vet_inv_sucursales;
drop policy if exists vet_inv_exist_all on public.vet_inv_existencias;

drop policy if exists vet_inv_prod_acceso  on public.vet_inv_productos;
drop policy if exists vet_inv_mov_acceso   on public.vet_inv_movimientos;
drop policy if exists vet_inv_suc_acceso   on public.vet_inv_sucursales;
drop policy if exists vet_inv_exist_acceso on public.vet_inv_existencias;

create policy vet_inv_prod_acceso on public.vet_inv_productos
  for all to authenticated
  using      (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy vet_inv_mov_acceso on public.vet_inv_movimientos
  for all to authenticated
  using      (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

create policy vet_inv_suc_acceso on public.vet_inv_sucursales
  for all to authenticated
  using      (public.user_has_access_to_client(client_id))
  with check (public.user_has_access_to_client(client_id));

-- existencias NO tiene client_id: se llega por sucursal. Mismo patrón que
-- autolavado_precios.
create policy vet_inv_exist_acceso on public.vet_inv_existencias
  for all to authenticated
  using (exists (
    select 1 from public.vet_inv_sucursales s
    where s.id = vet_inv_existencias.sucursal_id
      and public.user_has_access_to_client(s.client_id)))
  with check (exists (
    select 1 from public.vet_inv_sucursales s
    where s.id = vet_inv_existencias.sucursal_id
      and public.user_has_access_to_client(s.client_id)));

-- ─── 2. Las dos RPC de escritura ────────────────────────────────────────────
-- Son SECURITY DEFINER y NO validan el cliente por dentro: cualquier sesión
-- podía escribir inventario de cualquier clínica.
--
-- ⚠ LECCIÓN: revocar a `anon` y `authenticated` NO basta. Postgres otorga
-- EXECUTE a PUBLIC por omisión al crear una función, y ese permiso heredado
-- sobrevive al revoke por rol. Hay que revocar de PUBLIC. Se descubrió porque
-- has_function_privilege('anon', …) seguía en true después del primer revoke.
revoke execute on function public.vet_inv_alta_producto(
  text, text, text, numeric, uuid, numeric) from anon, authenticated, public;
revoke execute on function public.vet_inv_registrar_movimiento(
  uuid, uuid, text, numeric, text, text, text, boolean, text) from anon, authenticated, public;

-- ─── 3. Las 5 vistas: que respeten la RLS de quien consulta ────────────────
alter view public.vet_inv_kpis             set (security_invoker = true);
alter view public.vet_inv_por_turno        set (security_invoker = true);
alter view public.vet_inv_por_causa        set (security_invoker = true);
alter view public.vet_inv_top_productos    set (security_invoker = true);
alter view public.vet_inv_resumen_sucursal set (security_invoker = true);

-- ─── 4. leads: la política se llamaba "service role" y estaba abierta a todos
-- Las cuatro rutas públicas que crean leads (demo/enlace-lead, leads/ai,
-- demo/mario-criterio, mario/solicitud) usan SERVICE_ROLE_KEY, que evade RLS
-- por definición y nunca necesitó esta política. Verificado en el código.
drop policy if exists "service role can insert leads" on public.leads;

-- ─── 5. search_path fijo ────────────────────────────────────────────────────
alter function public.vet_inv_ean13(text) set search_path = 'public', 'extensions';

-- ─── Lo que NO se toca, a propósito ─────────────────────────────────────────
-- is_admin(), user_has_access_to_client() y user_has_access_to_slug() quedan
-- ejecutables por `authenticated`. El advisor las marca, pero es por diseño:
-- una política de RLS que las invoca corre con el rol de quien consulta, así
-- que necesita EXECUTE. Revocarlas tumbaría la RLS de TODO el sistema.
--
-- clients, invoices, invoice_orgs, content_failed_posts y content_sync_state
-- tienen RLS activa y cero políticas. Eso es fail-closed, no un descuido:
-- solo el service role las alcanza. El advisor lo reporta como INFO.
