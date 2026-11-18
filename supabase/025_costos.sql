-- =====================================================================
-- InventarIA - Migración 025: costos y ganancia fuera del alcance del vendedor (Fase 6.9 · C5.2)
-- docs/PLAN_CIMIENTOS.md → C5 · docs/AUDITORIA.md → Auditoría 2 (S1)
--
-- RLS no puede ocultar columnas: si el costo está en una fila que el vendedor puede leer, lo puede leer.
-- Por eso el costo SALE de esas filas a tablas que solo el dueño lee:
--   product_costs (costo del producto y de cada variante) · sale_costs (costo de cada venta)
--   sale_item_costs (costo de cada línea) · cash_closing_profits (ganancia de cada cierre)
-- Se quitan las columnas de costo de products, product_variants, sales, sale_items y cash_closings, y el costo
-- de products.data. Vistas con los mismos nombres de columna para el dueño (al vendedor le llegan vacías):
--   product_summaries.precio_compra · sales_v.cost_total · sale_items_v.unit_cost · cash_closings_v.profit
-- Escribir el costo: el dueño guarda «precio de compra» en el formulario (data) → un disparador lo pasa a
-- product_costs y lo quita de data. Compras y precios en lote escriben product_costs directamente.
-- =====================================================================

begin;

-- 1) Tablas solo del dueño ------------------------------------------------------------------------------
create table if not exists public.product_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  cost numeric(12,2) not null check (cost >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_costs_product on public.product_costs(product_id) where variant_id is null;
create unique index if not exists product_costs_variant on public.product_costs(variant_id) where variant_id is not null;

create table if not exists public.sale_costs (
  sale_id uuid primary key references public.sales(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  cost_total numeric(12,2) not null default 0
);
create table if not exists public.sale_item_costs (
  sale_item_id uuid primary key references public.sale_items(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  unit_cost numeric(12,2) not null
);
create table if not exists public.cash_closing_profits (
  closing_id uuid primary key references public.cash_closings(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  profit numeric(12,2) not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['product_costs','sale_costs','sale_item_costs','cash_closing_profits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_owner_read" on public.%I', t, t);
    execute format('create policy "%s_owner_read" on public.%I for select using (business_id = (select public.current_business_id()) and (select public.is_owner(public.current_business_id())))', t, t);
  end loop;
end $$;

-- 2) Copia de lo que hay hoy (y huella para verificar) --------------------------------------------------
create temporary table _antes on commit drop as select
  (select coalesce(sum(precio_compra), 0) from public.products where precio_compra is not null) as prod_cost,
  (select count(*) from public.products where precio_compra is not null) as prod_n,
  (select coalesce(sum(costo), 0) from public.product_variants where costo is not null) as var_cost,
  (select coalesce(sum(cost_total), 0) from public.sales) as sale_cost,
  (select coalesce(sum(unit_cost), 0) from public.sale_items where unit_cost is not null) as item_cost,
  (select coalesce(sum(profit), 0) from public.cash_closings) as profit;

insert into public.product_costs (business_id, product_id, cost)
select business_id, id, round(precio_compra, 2) from public.products where precio_compra is not null and precio_compra >= 0 and business_id is not null
on conflict do nothing;
insert into public.product_costs (business_id, product_id, variant_id, cost)
select v.business_id, v.product_id, v.id, round(v.costo, 2) from public.product_variants v where v.costo is not null and v.costo >= 0 and v.business_id is not null
on conflict do nothing;
insert into public.sale_costs (sale_id, business_id, cost_total)
select id, business_id, cost_total from public.sales where business_id is not null on conflict do nothing;
insert into public.sale_item_costs (sale_item_id, business_id, unit_cost)
select id, business_id, unit_cost from public.sale_items where unit_cost is not null and business_id is not null on conflict do nothing;
insert into public.cash_closing_profits (closing_id, business_id, profit)
select id, business_id, profit from public.cash_closings where business_id is not null on conflict do nothing;

do $$
declare a record;
begin
  select * into a from _antes;
  if (select coalesce(sum(cost), 0) from public.product_costs where variant_id is null) <> round(a.prod_cost, 2)
     or (select count(*) from public.product_costs where variant_id is null) <> a.prod_n
     or (select coalesce(sum(cost), 0) from public.product_costs where variant_id is not null) <> round(a.var_cost, 2)
     or (select coalesce(sum(cost_total), 0) from public.sale_costs) <> a.sale_cost
     or (select coalesce(sum(unit_cost), 0) from public.sale_item_costs) <> a.item_cost
     or (select coalesce(sum(profit), 0) from public.cash_closing_profits) <> a.profit then
    raise exception 'Verificación 025: los costos copiados no coinciden con los originales';
  end if;
end $$;

-- 3) Quitar el costo de las filas que lee el vendedor -----------------------------------------------------
drop view if exists public.product_summaries;
-- Las entradas por compra guardaban el costo en el movimiento: queda solo en la compra (solo dueño)
update public.stock_movements set precio_unitario = null, total = null where purchase_id is not null;

-- Costo dentro de data (claves precio_compra / costo / cost): fuera, sin tocar fechas ni firmas
alter table public.products disable trigger user;
update public.products p
   set data = p.data - (select array_agg(k) from jsonb_object_keys(p.data) k where lower(k) in ('precio_compra', 'costo', 'cost'))
 where exists (select 1 from jsonb_object_keys(p.data) k where lower(k) in ('precio_compra', 'costo', 'cost'));
alter table public.products enable trigger user;

drop trigger if exists products_price_history_trg on public.products; -- su condición usa la columna del costo
alter table public.products drop column if exists precio_compra;
alter table public.product_variants drop column if exists costo;
alter table public.sales drop column if exists cost_total;
alter table public.sale_items drop column if exists unit_cost;
alter table public.cash_closings drop column if exists profit;

-- 4) El costo ya no es un campo del sistema sincronizado con data -------------------------------------------
create or replace function public.product_system_fields()
returns table (col text, aliases text[], kind text) language sql immutable as $$
  values
    ('nombre',               array['nombre','name','producto','titulo'],          'text'),
    ('marca',                array['marca','brand'],                              'text'),
    ('precio',               array['precio','precio_venta','price'],              'num'),
    ('precio_mayorista',     array['precio_mayorista'],                           'num'),
    ('stock',                array['stock','cantidad','existencias'],             'num'),
    ('codigo_barras',        array['codigo_barras','codigo','sku','barcode','ean'], 'text'),
    ('unidades_por_paquete', array['unidades_por_paquete'],                       'num')
$$;

-- Guardar el costo desde el formulario: se saca de data antes de guardar y se pasa a product_costs después.
-- Solo el dueño (o el servidor) puede fijarlo; si lo manda un vendedor se descarta.
create or replace function public.products_cost_out() returns trigger language plpgsql as $$
declare
  ks text[];
  raw text;
begin
  select array_agg(k) into ks from jsonb_object_keys(coalesce(new.data, '{}'::jsonb)) k where lower(k) in ('precio_compra', 'costo', 'cost');
  if ks is null then return new; end if;
  raw := coalesce(new.data ->> ks[1], '');
  new.data := new.data - ks;
  -- Al crear desde la app, business_id aún no está puesto (lo rellena otro disparador): se usa el negocio activo
  if auth.uid() is null or public.is_owner(coalesce(new.business_id, public.current_business_id())) then
    perform set_config('app.cost_' || replace(new.id::text, '-', ''), case when btrim(raw) = '' then 'null' else raw end, true);
  end if;
  return new;
end $$;
drop trigger if exists products_cost_out_trg on public.products;
create trigger products_cost_out_trg before insert or update on public.products for each row execute function public.products_cost_out();

create or replace function public.products_cost_save() returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text := 'app.cost_' || replace(new.id::text, '-', '');
  raw text := current_setting(k, true);
  v numeric;
begin
  if raw is null or raw = '' then return null; end if;
  perform set_config(k, '', true);
  if raw = 'null' then
    delete from public.product_costs where product_id = new.id and variant_id is null;
    return null;
  end if;
  v := public.safe_num(raw);
  if v is null or v < 0 then return null; end if;
  insert into public.product_costs (business_id, product_id, cost) values (new.business_id, new.id, round(v, 2))
  on conflict (product_id) where variant_id is null do update set cost = excluded.cost, updated_at = now()
  where public.product_costs.cost is distinct from excluded.cost;
  return null;
end $$;
drop trigger if exists products_cost_save_trg on public.products;
create trigger products_cost_save_trg after insert or update on public.products for each row execute function public.products_cost_save();

-- Historial del costo: ahora desde product_costs
create or replace function public.product_costs_history() returns trigger language plpgsql security definer set search_path = public as $$
declare
  src text := coalesce(nullif(current_setting('app.price_source', true), ''), 'ficha');
  old_cost numeric := case when tg_op = 'UPDATE' then old.cost end;
begin
  if tg_op = 'UPDATE' and old.cost is not distinct from new.cost then return null; end if;
  insert into public.price_history (user_id, business_id, product_id, variant_id, field, old_value, new_value, source)
  values (coalesce(public.current_actor(), (select user_id from public.products where id = new.product_id)), new.business_id, new.product_id, new.variant_id,
          'precio_compra', old_cost, new.cost, src);
  return null;
end $$;
drop trigger if exists product_costs_history_trg on public.product_costs;
create trigger product_costs_history_trg after insert or update on public.product_costs for each row execute function public.product_costs_history();

create or replace function public.products_price_history() returns trigger language plpgsql security definer set search_path = public as $$
declare
  src text := coalesce(nullif(current_setting('app.price_source', true), ''), 'ficha');
  who uuid := coalesce(auth.uid(), new.user_id);
begin
  if new.precio is distinct from old.precio and coalesce(abs(new.precio), 0) < 1e10 and coalesce(abs(old.precio), 0) < 1e10 then
    insert into public.price_history (user_id, business_id, product_id, field, old_value, new_value, source) values (who, new.business_id, new.id, 'precio', old.precio, new.precio, src);
  end if;
  if new.precio_mayorista is distinct from old.precio_mayorista and coalesce(abs(new.precio_mayorista), 0) < 1e10 and coalesce(abs(old.precio_mayorista), 0) < 1e10 then
    insert into public.price_history (user_id, business_id, product_id, field, old_value, new_value, source) values (who, new.business_id, new.id, 'precio_mayorista', old.precio_mayorista, new.precio_mayorista, src);
  end if;
  return null;
end $$;
drop trigger if exists products_price_history_trg on public.products;
create trigger products_price_history_trg after update on public.products for each row
  when (old.precio is distinct from new.precio or old.precio_mayorista is distinct from new.precio_mayorista)
  execute function public.products_price_history();

-- Historial: las filas del costo solo las ve el dueño
drop policy if exists "price_history_read" on public.price_history;
create policy "price_history_read" on public.price_history for select
  using (business_id = (select public.current_business_id()) and (field <> 'precio_compra' or (select public.is_owner(public.current_business_id()))));

-- 5) Vistas para el dueño (al vendedor le llegan los costos vacíos) ------------------------------------------
create view public.product_summaries with (security_invoker = true) as
select
  p.id, p.user_id, p.business_id, p.category_id, p.status, p.image_url, p.created_at, p.updated_at,
  p.nombre, p.marca, p.precio,
  (select c.cost from public.product_costs c where c.product_id = p.id and c.variant_id is null) as precio_compra,
  p.stock, p.codigo_barras, p.search, p.min_stock, p.expires_at, p.alerts_off, p.precio_mayorista, p.unidades_por_paquete
from public.products p
where p.deleted_at is null;
grant select on public.product_summaries to authenticated;

create or replace view public.sales_v with (security_invoker = true) as
select s.*, (select c.cost_total from public.sale_costs c where c.sale_id = s.id) as cost_total
from public.sales s;
grant select on public.sales_v to authenticated;

create or replace view public.sale_items_v with (security_invoker = true) as
select i.*, (select c.unit_cost from public.sale_item_costs c where c.sale_item_id = i.id) as unit_cost
from public.sale_items i;
grant select on public.sale_items_v to authenticated;

create or replace view public.cash_closings_v with (security_invoker = true) as
select c.*, (select p.profit from public.cash_closing_profits p where p.closing_id = c.id) as profit
from public.cash_closings c;
grant select on public.cash_closings_v to authenticated;

create or replace view public.product_variant_costs with (security_invoker = true) as
select c.variant_id, c.product_id, c.cost from public.product_costs c where c.variant_id is not null;
grant select on public.product_variant_costs to authenticated;

-- 6) Funciones que leían o escribían costos ---------------------------------------------------------------
create or replace function public._register_sale(
  p_business uuid, p_id uuid, p_lines jsonb, p_method public.pay_method, p_status public.sale_status, p_paid numeric,
  p_discount numeric, p_customer uuid, p_customer_name text, p_note text, p_at timestamptz, p_move_stock boolean,
  p_payments jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sales%rowtype;
  it public.sale_items%rowtype;
  l record;
  mv record;
  resolved jsonb := '[]'::jsonb;
  items jsonb := '[]'::jsonb;
  pays jsonb := '[]'::jsonb;
  cname text := nullif(btrim(p_customer_name), '');
  qty integer;
  price numeric;
  pid uuid;
  vid uuid;
  pname text;
  pcost numeric;
  vlabel text;
  vcost numeric;
  subtotal numeric := 0;
  cost_total numeric := 0;
  disc numeric;
  tot numeric;
  paid numeric := 0;
  amt numeric;
  st public.sale_status;
  meth public.pay_method;
  nmeth integer;
begin
  select * into s from public.sales where id = p_id;
  if found then
    if s.business_id is distinct from p_business then raise exception 'Operación no válida' using errcode = '42501'; end if;
    return jsonb_build_object('sale', to_jsonb(s), 'repeated', true,
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from public.sale_items i where i.sale_id = s.id), '[]'::jsonb));
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'La venta no tiene productos'; end if;
  if p_customer is not null then
    select name into cname from public.customers where id = p_customer and business_id = p_business and deleted_at is null;
    if not found then raise exception 'Cliente no encontrado'; end if;
  end if;

  for l in select value as v from jsonb_array_elements(p_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    qty := (l.v ->> 'qty')::integer;
    price := round(coalesce((l.v ->> 'unit_price')::numeric, 0), 2);
    if qty is null or qty <= 0 then raise exception 'Cantidad no válida'; end if;
    if price < 0 then raise exception 'Precio no válido'; end if;
    pid := (l.v ->> 'product_id')::uuid;
    select id, nombre into pid, pname from public.products where id = pid and business_id = p_business and deleted_at is null;
    if not found then raise exception 'Un producto de la venta ya no existe'; end if;
    pcost := (select cost from public.product_costs where product_id = pid and variant_id is null);
    vid := nullif(l.v ->> 'variant_id', '')::uuid;
    vlabel := null;
    vcost := null;
    if vid is not null then
      select id, label into vid, vlabel from public.product_variants where id = vid and product_id = pid;
      if not found then raise exception 'Una variante de la venta ya no existe'; end if;
      vcost := (select cost from public.product_costs where variant_id = vid);
    elsif p_move_stock and exists (select 1 from public.product_variants where product_id = pid) then
      raise exception 'Elige la variante (talla, color…) de «%»', coalesce(pname, 'producto');
    end if;
    resolved := resolved || jsonb_build_object('pid', pid, 'vid', vid, 'name', pname, 'label', vlabel, 'qty', qty, 'price', price,
      'cost', coalesce(vcost, pcost), 'total', round(qty * price, 2));
    subtotal := subtotal + round(qty * price, 2);
    cost_total := cost_total + qty * coalesce(vcost, pcost, 0);
  end loop;

  disc := least(subtotal, greatest(0, round(coalesce(p_discount, 0), 2)));
  tot := subtotal - disc;

  if p_payments is not null and jsonb_typeof(p_payments) = 'array' and jsonb_array_length(p_payments) > 0 then
    for l in select value as v from jsonb_array_elements(p_payments) loop
      amt := round(coalesce((l.v ->> 'amount')::numeric, 0), 2);
      continue when amt <= 0;
      if (l.v ->> 'method') not in ('efectivo', 'qr', 'transferencia') then raise exception 'Medio de pago no válido'; end if;
      pays := pays || jsonb_build_object('method', l.v ->> 'method', 'amount', amt);
      paid := paid + amt;
    end loop;
    if paid > tot then raise exception 'Lo cobrado (Bs %) es más que el total (Bs %)', paid, tot; end if;
  else
    paid := case when p_status = 'pagado' then tot else least(tot, greatest(0, round(coalesce(p_paid, 0), 2))) end;
    if paid > 0 then
      pays := jsonb_build_array(jsonb_build_object('method', case when p_method = 'mixto' then 'efectivo' else p_method::text end, 'amount', paid));
    end if;
  end if;
  st := case when paid >= tot then 'pagado' when paid > 0 then 'parcial' else 'fiado' end;
  if st <> 'pagado' and p_customer is null then raise exception 'Elige o crea el cliente que va a deber'; end if;
  select count(distinct v ->> 'method') into nmeth from jsonb_array_elements(pays) v;
  meth := case when nmeth = 0 then p_method
               when nmeth = 1 then (pays -> 0 ->> 'method')::public.pay_method
               else 'mixto' end;

  insert into public.sales (id, user_id, business_id, status, method, subtotal, discount, total, paid, items, customer_id, customer_name, note, created_at)
  values (p_id, auth.uid(), p_business, st, meth, subtotal, disc, tot, paid, jsonb_array_length(resolved),
          p_customer, cname, nullif(btrim(p_note), ''), coalesce(p_at, now()))
  returning * into s;
  insert into public.sale_costs (sale_id, business_id, cost_total) values (s.id, p_business, round(cost_total, 2));

  for l in select value as v from jsonb_array_elements(resolved) loop
    pid := (l.v ->> 'pid')::uuid;
    vid := nullif(l.v ->> 'vid', '')::uuid;
    qty := (l.v ->> 'qty')::integer;
    insert into public.sale_items (sale_id, user_id, business_id, product_id, variant_id, product_name, variant_label, qty, unit_price, line_total)
    values (s.id, auth.uid(), p_business, pid, vid, l.v ->> 'name', l.v ->> 'label', qty, (l.v ->> 'price')::numeric, (l.v ->> 'total')::numeric)
    returning * into it;
    if (l.v ->> 'cost') is not null then
      insert into public.sale_item_costs (sale_item_id, business_id, unit_cost) values (it.id, p_business, round((l.v ->> 'cost')::numeric, 2));
    end if;
    items := items || to_jsonb(it);
    if p_move_stock then
      select * into mv from public._move_stock(p_business, pid, vid, -qty);
      insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, precio_unitario, total, stock_resultante, faltante, sale_id, created_at)
      values (auth.uid(), p_business, pid, l.v ->> 'name', vid, l.v ->> 'label', 'venta', qty, (l.v ->> 'price')::numeric, (l.v ->> 'total')::numeric,
              round(mv.stock_after)::integer, mv.faltante, s.id, s.created_at);
    end if;
  end loop;

  for l in select value as v from jsonb_array_elements(pays) loop
    insert into public.payments (user_id, business_id, customer_id, sale_id, kind, amount, method, created_at)
    values (auth.uid(), p_business, p_customer, s.id, 'venta', (l.v ->> 'amount')::numeric, (l.v ->> 'method')::public.pay_method, s.created_at);
  end loop;
  if p_customer is not null and paid < tot then perform public._allocate_credit(p_business, p_customer); end if;

  select * into s from public.sales where id = p_id;
  return jsonb_build_object('sale', to_jsonb(s), 'items', items, 'repeated', false);
end $$;

create or replace function public.register_purchase(p_id uuid, p_supplier uuid, p_doc text, p_note text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  pu public.purchases%rowtype;
  sname text;
  l record;
  mv record;
  qty integer;
  cost numeric;
  exp date;
  pid uuid;
  vid uuid;
  pname text;
  vlabel text;
  total numeric;
  n integer;
begin
  select * into pu from public.purchases where id = p_id;
  if found then return jsonb_build_object('purchase', to_jsonb(pu), 'repeated', true); end if;
  if p_supplier is not null then
    select name into sname from public.suppliers where id = p_supplier and business_id = b;
    if not found then raise exception 'Proveedor no encontrado'; end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'La compra no tiene productos'; end if;
  select coalesce(sum((v ->> 'qty')::integer * coalesce(nullif(v ->> 'unit_cost', '')::numeric, 0)), 0), count(*)
    into total, n from jsonb_array_elements(p_lines) v where coalesce((v ->> 'qty')::integer, 0) > 0;
  if n = 0 then raise exception 'La compra no tiene productos'; end if;

  insert into public.purchases (id, user_id, business_id, supplier_id, supplier_name, doc, note, total, items)
  values (p_id, auth.uid(), b, p_supplier, sname, nullif(btrim(p_doc), ''), nullif(btrim(p_note), ''), round(total, 2), n)
  returning * into pu;

  perform set_config('app.price_source', 'compra', true);
  for l in select value as v from jsonb_array_elements(p_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    qty := coalesce((l.v ->> 'qty')::integer, 0);
    continue when qty <= 0;
    cost := round(nullif(l.v ->> 'unit_cost', '')::numeric, 2);
    if cost is not null and cost < 0 then raise exception 'Costo no válido'; end if;
    exp := nullif(l.v ->> 'expires_at', '')::date;
    pid := (l.v ->> 'product_id')::uuid;
    vid := nullif(l.v ->> 'variant_id', '')::uuid;
    select nombre into pname from public.products where id = pid and business_id = b and deleted_at is null;
    if not found then raise exception 'Un producto de la compra ya no existe'; end if;
    vlabel := null;
    if vid is not null then
      select label into vlabel from public.product_variants where id = vid and product_id = pid;
      if not found then raise exception 'Una variante de la compra ya no existe'; end if;
    end if;
    insert into public.purchase_items (purchase_id, user_id, business_id, product_id, variant_id, product_name, variant_label, qty, unit_cost, expires_at)
    values (p_id, auth.uid(), b, pid, vid, pname, vlabel, qty, cost, exp);
    select * into mv from public._move_stock(b, pid, vid, qty);
    if cost is not null then
      insert into public.product_costs (business_id, product_id, cost) values (b, pid, cost)
      on conflict (product_id) where variant_id is null do update set cost = excluded.cost, updated_at = now()
      where public.product_costs.cost is distinct from excluded.cost;
      if vid is not null then
        insert into public.product_costs (business_id, product_id, variant_id, cost) values (b, pid, vid, cost)
        on conflict (variant_id) where variant_id is not null do update set cost = excluded.cost, updated_at = now()
        where public.product_costs.cost is distinct from excluded.cost;
      end if;
    end if;
    if exp is not null then
      if vid is not null then update public.product_variants set expires_at = exp where id = vid;
      else update public.products set expires_at = exp where id = pid; end if;
    end if;
    -- El costo NO va en el movimiento (lo verían los vendedores): queda en la compra
    insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, motivo, stock_resultante, purchase_id)
    values (auth.uid(), b, pid, pname, vid, vlabel, 'entrada', qty, case when sname is not null then 'compra · ' || sname else 'compra' end,
            round(mv.stock_after)::integer, p_id);
  end loop;
  return jsonb_build_object('purchase', to_jsonb(pu), 'repeated', false);
end $$;

create or replace function public.set_prices(p_rows jsonb, p_source text default 'masivo')
returns integer language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  r record;
  f text;
  v numeric;
  pid uuid;
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
    pid := (r.x ->> 'product_id')::uuid;
    if not exists (select 1 from public.products where id = pid and business_id = b and deleted_at is null) then continue; end if;
    if f = 'precio_compra' then
      if v is null then
        delete from public.product_costs where product_id = pid and variant_id is null;
      else
        insert into public.product_costs (business_id, product_id, cost) values (b, pid, v)
        on conflict (product_id) where variant_id is null do update set cost = excluded.cost, updated_at = now()
        where public.product_costs.cost is distinct from excluded.cost;
      end if;
    else
      update public.products set
        precio = case when f = 'precio' then v else precio end,
        precio_mayorista = case when f = 'precio_mayorista' then v else precio_mayorista end
      where id = pid and (case f when 'precio' then precio else precio_mayorista end) is distinct from v;
    end if;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  return changed;
end $$;

create or replace function public.cash_summary(p_day date default null, p_tz text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  tz text := coalesce(nullif(btrim(p_tz), ''), public.business_tz(b));
  d date := coalesce(p_day, (now() at time zone tz)::date);
  t0 timestamptz := (d::timestamp at time zone tz);
  t1 timestamptz := ((d + 1)::timestamp at time zone tz);
  owner boolean := public.is_owner(b);
  n integer;
  sold numeric;
  profit numeric;
  by_m jsonb;
  ab_m jsonb;
  v_sales numeric;
  v_abonos numeric;
  credit numeric;
  c_in numeric;
  c_out numeric;
  cash numeric;
begin
  select count(*), coalesce(sum(s.total), 0), coalesce(sum(s.total - coalesce(c.cost_total, 0)), 0) into n, sold, profit
    from public.sales s left join public.sale_costs c on c.sale_id = s.id
    where s.business_id = b and s.created_at >= t0 and s.created_at < t1;
  select jsonb_build_object(
           'efectivo', coalesce(sum(amount) filter (where method = 'efectivo'), 0),
           'qr', coalesce(sum(amount) filter (where method = 'qr'), 0),
           'transferencia', coalesce(sum(amount) filter (where method = 'transferencia'), 0)),
         jsonb_build_object(
           'efectivo', coalesce(sum(amount) filter (where method = 'efectivo' and kind = 'abono'), 0),
           'qr', coalesce(sum(amount) filter (where method = 'qr' and kind = 'abono'), 0),
           'transferencia', coalesce(sum(amount) filter (where method = 'transferencia' and kind = 'abono'), 0)),
         coalesce(sum(amount) filter (where kind = 'venta'), 0),
         coalesce(sum(amount) filter (where kind = 'abono'), 0),
         coalesce(sum(amount) filter (where method = 'efectivo'), 0)
    into by_m, ab_m, v_sales, v_abonos, cash
    from public.payments where business_id = b and created_at >= t0 and created_at < t1;
  select coalesce(sum(x.total - coalesce((select sum(p.amount) from public.payments p where p.sale_id = x.id and p.kind = 'venta'), 0)), 0)
    into credit from public.sales x where x.business_id = b and x.created_at >= t0 and x.created_at < t1;
  select coalesce(sum(amount) filter (where tipo = 'ingreso'), 0), coalesce(sum(amount) filter (where tipo = 'retiro'), 0)
    into c_in, c_out from public.cash_movements where business_id = b and created_at >= t0 and created_at < t1;
  return jsonb_build_object(
    'day', d, 'tz', tz, 'from', t0, 'to', t1,
    'sales_count', n, 'total_sales', sold,
    'collected_sales', v_sales, 'collected_abonos', v_abonos, 'credit_given', credit,
    'by_method', by_m, 'abonos_by_method', ab_m,
    'cash_in', c_in, 'cash_out', c_out, 'expected_cash', cash + c_in - c_out,
    'profit', case when owner then round(profit, 2) end,
    'last_closing', (select to_jsonb(c) from public.cash_closings c where c.business_id = b and c.day = d order by c.closed_at desc limit 1)
  );
end $$;

create or replace function public.close_cash(p_id uuid, p_day date default null, p_counted numeric default null, p_note text default null, p_tz text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  tz text := coalesce(nullif(btrim(p_tz), ''), public.business_tz(b));
  c public.cash_closings%rowtype;
  sm jsonb;
  d date := coalesce(p_day, (now() at time zone tz)::date);
  profit numeric;
begin
  select * into c from public.cash_closings where id = p_id;
  if found then return to_jsonb(c) || jsonb_build_object('repeated', true); end if;
  if p_counted is not null and p_counted < 0 then raise exception 'El efectivo contado no puede ser negativo'; end if;
  sm := public.cash_summary(d, tz);
  select coalesce(sum(s.total - coalesce(sc.cost_total, 0)), 0) into profit
    from public.sales s left join public.sale_costs sc on sc.sale_id = s.id
    where s.business_id = b and s.created_at >= (d::timestamp at time zone tz) and s.created_at < ((d + 1)::timestamp at time zone tz);
  insert into public.cash_closings (id, user_id, business_id, day, sales_count, total_sales, by_method, cash_in, cash_out,
                                    expected_cash, counted_cash, difference, note, collected_abonos)
  values (p_id, auth.uid(), b, d, (sm ->> 'sales_count')::integer, (sm ->> 'total_sales')::numeric, sm -> 'by_method',
          (sm ->> 'cash_in')::numeric, (sm ->> 'cash_out')::numeric, (sm ->> 'expected_cash')::numeric,
          round(p_counted, 2), case when p_counted is null then null else round(p_counted - (sm ->> 'expected_cash')::numeric, 2) end,
          nullif(btrim(p_note), ''), (sm ->> 'collected_abonos')::numeric)
  returning * into c;
  insert into public.cash_closing_profits (closing_id, business_id, profit) values (c.id, b, round(profit, 2));
  return to_jsonb(c) || jsonb_build_object('repeated', false);
end $$;

revoke all on function public._register_sale(uuid, uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, boolean, jsonb) from public, anon, authenticated;

commit;
