-- =====================================================================
-- InventarIA - Migración 024: permisos en la base por rol y operación (Fase 6.9 · C5.1)
-- docs/PLAN_CIMIENTOS.md → C5 · docs/AUDITORIA.md → Auditoría 2 (S2, S3, S4, S5, S6, S9 y backups de S1)
--
-- Antes: cualquier miembro podía leer, crear, cambiar y borrar TODO en todos los negocios a los que pertenecía
-- (políticas «for all»), y la firma (quién lo hizo) se podía falsificar. Ahora:
--   · Se ve y se escribe solo en el NEGOCIO ACTIVO (current_business_id); `switch_business` cambia de negocio.
--   · Rol efectivo = el de quien ATIENDE: en un celular compartido, la persona que entró con su PIN (token firmado
--     de 12 h en la cabecera `x-actor-token`); si no, el dueño de la sesión. El uuid suelto `x-actor` ya no vale.
--   · Firma: `user_id` lo pone siempre la base (quien atiende) y no se puede cambiar después; tampoco el negocio.
--   · Ventas, cobros, movimientos, entregas, conteos, cierres y compras: solo por las funciones (sin escritura directa).
--   · Dueño: borrar o mandar a la papelera productos confirmados, categorías/datos/variantes, proveedores, compras,
--     clientes (borrar), equipo, invitaciones, nombre y ajustes del negocio. Nadie cambia el plan desde la app.
--   · Stock de un producto confirmado: solo cambia con una venta, entrada, ajuste o conteo (funciones de 021).
-- =====================================================================

begin;

-- 1) Secreto para firmar el «¿quién atiende?» ------------------------------------------------------------
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security; -- sin políticas: solo funciones
insert into public.app_secrets (name, value) values ('actor_hmac', encode(extensions.gen_random_bytes(32), 'hex')) on conflict (name) do nothing;

-- Token «uid.negocio.vence.firma» que manda el celular compartido; null si falta, venció o no es válido
create or replace function public.request_actor() returns uuid language plpgsql stable security definer set search_path = public, extensions as $$
declare
  h text;
  parts text[];
  u uuid;
  b uuid;
  secret text;
begin
  h := nullif(current_setting('request.headers', true), '')::json ->> 'x-actor-token';
  if h is null or h = '' then return null; end if;
  parts := string_to_array(h, '.');
  if array_length(parts, 1) <> 4 then return null; end if;
  if parts[3]::bigint < extract(epoch from now()) then return null; end if;
  select value into secret from public.app_secrets where name = 'actor_hmac';
  if parts[4] <> encode(extensions.hmac(parts[1] || '.' || parts[2] || '.' || parts[3], secret, 'sha256'), 'hex') then return null; end if;
  u := parts[1]::uuid;
  b := parts[2]::uuid;
  if b is distinct from public.current_business_id() then return null; end if;
  if not exists (select 1 from public.business_members where business_id = b and user_id = u and active) then return null; end if;
  return u;
exception when others then
  return null;
end $$;

-- Quién atiende ahora (token válido o el usuario de la sesión) y con qué rol
create or replace function public.current_actor() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.request_actor(), auth.uid())
$$;
create or replace function public.acting_role(p_business uuid) returns text language sql stable security definer set search_path = public as $$
  select role from public.business_members where business_id = p_business and user_id = public.current_actor() and active
$$;
create or replace function public.is_owner(p_business uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.acting_role(p_business) = 'dueno', false)
$$;

-- Empezar a atender en un celular compartido: valida el PIN (con bloqueo por intentos) y devuelve el token
create or replace function public.start_shift(p_business uuid, p_user uuid, p_pin text) returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  exp bigint := extract(epoch from now() + interval '12 hours')::bigint;
  secret text;
  payload text;
begin
  if p_business is distinct from public.current_business_id() then return null; end if;
  if not public.verify_pin(p_business, p_user, p_pin) then return null; end if;
  select value into secret from public.app_secrets where name = 'actor_hmac';
  payload := p_user::text || '.' || p_business::text || '.' || exp::text;
  return payload || '.' || encode(extensions.hmac(payload, secret, 'sha256'), 'hex');
end $$;

-- 2) Negocio activo: cambiar y listar ---------------------------------------------------------------------
create or replace function public.switch_business(p_business uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = auth.uid() and active) then
    raise exception 'No perteneces a ese negocio' using errcode = '42501';
  end if;
  insert into public.profiles (id, current_business_id) values (auth.uid(), p_business)
  on conflict (id) do update set current_business_id = excluded.current_business_id;
end $$;

create or replace function public.my_businesses() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'role', m.role, 'current', b.id = public.current_business_id()) order by b.name), '[]'::jsonb)
  from public.business_members m join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid() and m.active
$$;

-- 3) Firma: user_id = quien atiende (al crear) e inmutable; el negocio de una fila no se puede cambiar ---------
create or replace function public.set_actor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.user_id := public.current_actor(); end if;  -- con la clave del servidor se respeta lo enviado
  return new;
end $$;

create or replace function public.keep_owner_fields() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.user_id := old.user_id;
    new.business_id := old.business_id;
  end if;
  return new;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'categories','field_templates','products','product_variants','variant_axes','stock_movements',
    'suppliers','purchases','purchase_items','stock_counts','stock_count_items','price_history',
    'sales','sale_items','cash_movements','cash_closings','customers','payments','consignments','consignment_items'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', 'z_' || t || '_set_actor', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.set_actor()', 'z_' || t || '_set_actor', t);
    execute format('drop trigger if exists %I on public.%I', 'z_' || t || '_keep_owner', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.keep_owner_fields()', 'z_' || t || '_keep_owner', t);
  end loop;
end $$;

-- 4) Políticas por operación (reemplazan a «<tabla>_business» for all) --------------------------------------
do $$
declare
  t text;
  all_tables text[] := array[
    'categories','field_templates','products','product_variants','variant_axes','stock_movements',
    'suppliers','purchases','purchase_items','stock_counts','stock_count_items','price_history',
    'sales','sale_items','cash_movements','cash_closings','customers','payments','consignments','consignment_items'
  ];
  cb text := 'business_id = (select public.current_business_id())';
  own text := '(select public.is_owner(public.current_business_id()))';
begin
  foreach t in array all_tables loop
    execute format('drop policy if exists "%s_business" on public.%I', t, t);
    execute format('drop policy if exists "%s_read" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete" on public.%I', t, t);
  end loop;

  -- Lectura del negocio activo (compras y proveedores: solo el dueño)
  foreach t in array array['categories','field_templates','products','product_variants','variant_axes','stock_movements',
                            'stock_counts','stock_count_items','price_history','sales','sale_items','cash_movements',
                            'cash_closings','customers','payments','consignments','consignment_items'] loop
    execute format('create policy "%s_read" on public.%I for select using (%s)', t, t, cb);
  end loop;
  foreach t in array array['suppliers','purchases','purchase_items'] loop
    execute format('create policy "%s_read" on public.%I for select using (%s and %s)', t, t, cb, own);
  end loop;

  -- Cualquiera del equipo crea y edita: productos, variantes, clientes; crea categorías (Revisar puede crearlas);
  -- anota ingresos/retiros de caja
  foreach t in array array['products','product_variants','customers','categories','cash_movements'] loop
    execute format('create policy "%s_insert" on public.%I for insert with check (%s)', t, t, cb);
  end loop;
  foreach t in array array['products','product_variants','customers'] loop
    execute format('create policy "%s_update" on public.%I for update using (%s) with check (%s)', t, t, cb, cb);
  end loop;

  -- Solo el dueño: catálogo (editar/borrar), datos y variantes del catálogo, proveedores, borrar clientes,
  -- movimientos iniciales al importar
  foreach t in array array['categories','field_templates','variant_axes','suppliers'] loop
    execute format('create policy "%s_update" on public.%I for update using (%s and %s) with check (%s)', t, t, cb, own, cb);
    execute format('create policy "%s_delete" on public.%I for delete using (%s and %s)', t, t, cb, own);
  end loop;
  foreach t in array array['field_templates','variant_axes','suppliers','stock_movements'] loop
    execute format('create policy "%s_insert" on public.%I for insert with check (%s and %s)', t, t, cb, own);
  end loop;
  execute format('create policy "customers_delete" on public.customers for delete using (%s and %s)', cb, own);

  -- Borrar productos: el dueño, o cualquiera si es un pendiente (descartar en Revisar)
  execute format('create policy "products_delete" on public.products for delete using (%s and (%s or status = %L))', cb, own, 'draft');
  execute format('create policy "product_variants_delete" on public.product_variants for delete using (%s and (%s or exists (select 1 from public.products p where p.id = product_id and p.status = %L)))', cb, own, 'draft');
  -- Ventas, cobros, movimientos, entregas, conteos, cierres, compras e historial de precios: sin escritura directa
end $$;

drop policy if exists "payment_allocations_read" on public.payment_allocations;
create policy "payment_allocations_read" on public.payment_allocations for select using (business_id = (select public.current_business_id()));

-- Negocio, equipo e invitaciones: según quien atiende (no el dueño de la sesión)
drop policy if exists "businesses_owner_update" on public.businesses;
create policy "businesses_owner_update" on public.businesses for update using (public.is_owner(id)) with check (public.is_owner(id));
drop policy if exists "members_owner_write" on public.business_members;
create policy "members_owner_write" on public.business_members for all using (public.is_owner(business_id)) with check (public.is_owner(business_id));
drop policy if exists "invites_owner" on public.invites;
create policy "invites_owner" on public.invites for all using (public.is_owner(business_id)) with check (public.is_owner(business_id));

-- Respaldos (Excel completo, con costos): solo el dueño
drop policy if exists "backups_select_members" on storage.objects;
drop policy if exists "backups_select_owner" on storage.objects;
create policy "backups_select_owner" on storage.objects for select
  using (bucket_id = 'backups' and public.is_owner((split_part(name, '/', 1))::uuid));

-- 5) Reglas que no dependen de la pantalla ----------------------------------------------------------------
-- Productos: papelera solo el dueño; el stock de un confirmado solo cambia dentro de una operación (021)
create or replace function public.products_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if old.deleted_at is distinct from new.deleted_at and not public.is_owner(old.business_id) then
    raise exception 'Solo el dueño puede mandar productos a la papelera o recuperarlos' using errcode = '42501';
  end if;
  if old.status = 'confirmed' and new.stock is distinct from old.stock and coalesce(current_setting('app.stock_op', true), '') <> 'on' then
    raise exception 'El stock cambia solo con una venta, una entrada, un ajuste o un conteo' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists products_zz_guard_trg on public.products;
create trigger products_zz_guard_trg before update on public.products for each row execute function public.products_guard();

create or replace function public.product_variants_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if exists (select 1 from public.products p where p.id = new.product_id and p.status = 'confirmed')
     and coalesce(current_setting('app.stock_op', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.stock <> 0) or (tg_op = 'UPDATE' and new.stock is distinct from old.stock)) then
    raise exception 'El stock cambia solo con una venta, una entrada, un ajuste o un conteo' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists product_variants_zz_guard_trg on public.product_variants;
create trigger product_variants_zz_guard_trg before insert or update on public.product_variants for each row execute function public.product_variants_guard();

-- Las operaciones marcan que están moviendo stock (dentro de la misma transacción)
create or replace function public._move_stock(p_business uuid, p_product uuid, p_variant uuid, p_delta integer)
returns table (stock_before numeric, stock_after numeric, faltante integer) language plpgsql security definer set search_path = public as $$
declare
  cur numeric;
  nxt numeric;
  f integer := 0;
begin
  perform set_config('app.stock_op', 'on', true);
  if p_variant is not null then
    select v.stock into cur from public.product_variants v join public.products p on p.id = v.product_id
      where v.id = p_variant and v.product_id = p_product and p.business_id = p_business
      for update of v;
    if not found then raise exception 'Variante no encontrada'; end if;
    nxt := cur + p_delta;
    if nxt < 0 then f := ceil(-nxt)::integer; nxt := 0; end if;
    update public.product_variants set stock = nxt::integer where id = p_variant;
  else
    select p.stock into cur from public.products p
      where p.id = p_product and p.business_id = p_business and p.deleted_at is null
      for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    if exists (select 1 from public.product_variants where product_id = p_product) then
      raise exception 'Elige la variante (talla, color…) de este producto';
    end if;
    cur := coalesce(cur, 0);
    nxt := cur + p_delta;
    if nxt < 0 then f := ceil(-nxt)::integer; nxt := 0; end if;
    update public.products set stock = nxt where id = p_product;
  end if;
  return query select cur, nxt, f;
end $$;

-- La suma de variantes también es un movimiento legítimo (agregar/quitar una variante)
create or replace function public.sync_product_stock(pid uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  total integer;
  n integer;
  k text;
begin
  select count(*), coalesce(sum(stock), 0) into n, total from public.product_variants where product_id = pid;
  if n = 0 then return; end if;
  perform set_config('app.stock_op', 'on', true);
  select key into k from (
    select key from public.products p, jsonb_object_keys(p.data) key
    where p.id = pid and lower(key) in ('stock', 'cantidad', 'existencias')
    order by case lower(key) when 'stock' then 0 when 'cantidad' then 1 else 2 end
    limit 1
  ) s;
  if k is null then k := 'stock'; end if;
  update public.products set data = jsonb_set(coalesce(data, '{}'::jsonb), array[k], to_jsonb(total), true), updated_at = now() where id = pid;
end $$;

-- Clientes: quitar (borrado suave) solo el dueño
create or replace function public.customers_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and old.deleted_at is distinct from new.deleted_at and not public.is_owner(old.business_id) then
    raise exception 'Solo el dueño puede quitar clientes' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists customers_zz_guard_trg on public.customers;
create trigger customers_zz_guard_trg before update on public.customers for each row execute function public.customers_guard();

-- Negocio: el plan y el dueño no se cambian desde la app
create or replace function public.businesses_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.plan is distinct from old.plan or new.owner_id is distinct from old.owner_id) then
    raise exception 'El plan y el dueño del negocio no se cambian desde la app' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard_trg on public.businesses;
create trigger businesses_guard_trg before update on public.businesses for each row execute function public.businesses_guard();

-- Equipo: el negocio nunca queda sin un dueño activo
create or replace function public.members_keep_owner() returns trigger language plpgsql security definer set search_path = public as $$
declare bid uuid := coalesce(new.business_id, old.business_id);
begin
  if auth.uid() is null then return null; end if; -- borrados en cascada del servidor (p. ej. eliminar una cuenta)
  if exists (select 1 from public.businesses where id = bid)
     and not exists (select 1 from public.business_members where business_id = bid and role = 'dueno' and active) then
    raise exception 'El negocio necesita al menos un dueño activo' using errcode = '42501';
  end if;
  return null;
end $$;
drop trigger if exists members_keep_owner_trg on public.business_members;
create trigger members_keep_owner_trg after update or delete on public.business_members for each row execute function public.members_keep_owner();

-- Compras: solo el dueño (también por register_purchase); precios en lote: solo el dueño
create or replace function public.purchases_owner() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_owner(new.business_id) then
    raise exception 'Solo el dueño anota compras' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists purchases_owner_trg on public.purchases;
create trigger purchases_owner_trg before insert on public.purchases for each row execute function public.purchases_owner();

create or replace function public.set_prices(p_rows jsonb, p_source text default 'masivo')
returns integer language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  r record;
  f text;
  v numeric;
  n integer;
  changed integer := 0;
begin
  if not public.is_owner(b) then raise exception 'Solo el dueño cambia precios en lote' using errcode = '42501'; end if;
  perform set_config('app.price_source', coalesce(nullif(btrim(p_source), ''), 'masivo'), true);
  for r in select value as x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) order by value ->> 'product_id' loop
    f := r.x ->> 'field';
    if f not in ('precio', 'precio_mayorista', 'precio_compra') then raise exception 'Precio no válido'; end if;
    v := case when nullif(r.x ->> 'value', '') is null then null else round((r.x ->> 'value')::numeric, 2) end;
    if v is not null and v < 0 then raise exception 'Un precio no puede ser negativo'; end if;
    update public.products set
      precio = case when f = 'precio' then v else precio end,
      precio_mayorista = case when f = 'precio_mayorista' then v else precio_mayorista end,
      precio_compra = case when f = 'precio_compra' then v else precio_compra end
    where id = (r.x ->> 'product_id')::uuid and business_id = b and deleted_at is null
      and (case f when 'precio' then precio when 'precio_mayorista' then precio_mayorista else precio_compra end) is distinct from v;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  return changed;
end $$;

-- 6) session_context: agrega quién atiende y su rol efectivo ------------------------------------------
create or replace function public.session_context() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b uuid;
begin
  if uid is null then return null; end if;
  b := public.current_business_id();
  if b is null then
    return jsonb_build_object('me', uid, 'business', null, 'role', null, 'acting_role', null, 'actor', uid, 'members', '[]'::jsonb, 'businesses', 0);
  end if;
  return jsonb_build_object(
    'me', uid,
    'business', (select to_jsonb(x) from (select id, name, owner_id, plan, timezone, currency, min_stock_default, expiry_days, created_at from public.businesses where id = b) x),
    'role', public.my_role(b),
    'actor', public.current_actor(),
    'acting_role', public.acting_role(b),
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at)
                           from (select business_id, user_id, role, display_name, active, has_pin, created_at from public.business_members where business_id = b) m), '[]'::jsonb),
    'businesses', (select count(*) from public.business_members where user_id = uid and active),
    'today', public.business_day(b),
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.products where business_id = b and status = 'draft' and deleted_at is null),
      'confirmed', (select count(*) from public.products where business_id = b and status = 'confirmed' and deleted_at is null))
  );
end $$;

-- 7) Permisos de ejecución ----------------------------------------------------------------------------
revoke all on function public.request_actor() from public, anon, authenticated;
revoke all on function public.start_shift(uuid, uuid, text) from public, anon;
grant execute on function public.start_shift(uuid, uuid, text) to authenticated;
revoke all on function public.switch_business(uuid) from public, anon;
grant execute on function public.switch_business(uuid) to authenticated;
revoke all on function public.my_businesses() from public, anon;
grant execute on function public.my_businesses() to authenticated;
grant execute on function public.current_actor() to authenticated;
grant execute on function public.acting_role(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
revoke all on function public.current_actor() from anon;
revoke all on function public.acting_role(uuid) from anon;
revoke all on function public.is_owner(uuid) from anon;

commit;
