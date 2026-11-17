-- =====================================================================
-- InventarIA - Migración 021: operaciones atómicas (Fase 6.9 · C2)
-- docs/PLAN_CIMIENTOS.md → C2 · docs/AUDITORIA.md → Auditoría 2 (C1, C3, C4, C5, N4, N7)
--
-- Toda escritura de stock o dinero pasa por una función que hace TODO o NADA, en el servidor:
--   adjust_stock · set_stock · register_sale · register_purchase · consign_out · consign_settle · apply_count · set_prices
-- Reglas:
--   · Idempotencia: cada operación lleva un id generado en el celular; repetirla devuelve lo ya guardado.
--   · El stock se cambia con bloqueo de fila (sin «leer → escribir» desde el navegador).
--   · Vender más de lo registrado se permite: el stock queda en 0 y el movimiento guarda `faltante`.
--   · El costo de lo vendido y los nombres se leen en el servidor (no los manda el navegador).
--   · El historial de precios lo escribe un disparador: nadie puede cambiar un precio sin dejar rastro.
-- =====================================================================

begin;

-- 1) Columnas y tablas de apoyo ---------------------------------------------------------------------
alter table public.stock_movements add column if not exists client_id uuid;
alter table public.stock_movements add column if not exists faltante integer not null default 0 check (faltante >= 0);
create unique index if not exists stock_movements_client_id on public.stock_movements(client_id) where client_id is not null;

-- Correlativos por negocio (sin carreras: update … returning)
create table if not exists public.business_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  value bigint not null default 0,
  primary key (business_id, kind)
);
alter table public.business_counters enable row level security; -- sin políticas: solo funciones
insert into public.business_counters (business_id, kind, value)
select business_id, 'sale', coalesce(max(number), 0) from public.sales where business_id is not null group by business_id
on conflict (business_id, kind) do update set value = greatest(public.business_counters.value, excluded.value);
create unique index if not exists sales_business_number on public.sales(business_id, number);

-- Registro de operaciones de varios efectos (para que repetirlas no duplique)
create table if not exists public.op_log (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.op_log enable row level security; -- sin políticas: solo funciones

-- 2) Disparador de C1: si la clave del sistema NO viene en `data`, la columna se conserva ---------------
--    (así un formulario puede guardar `data` sin la clave de stock y no pisa una venta hecha entre medio)
create or replace function public.products_sync_fields() returns trigger language plpgsql as $$
declare
  f record;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  d jsonb := coalesce(new.data, '{}'::jsonb);
  od jsonb := case when tg_op = 'UPDATE' then coalesce(old.data, '{}'::jsonb) end;
  cv jsonb;
  dv jsonb;
  nvar integer;
  total numeric;
  code text;
begin
  for f in select * from public.product_system_fields() loop
    cv := n -> f.col;
    if cv = 'null'::jsonb then cv := null; end if;
    dv := public.data_value(d, f.aliases, f.kind);
    if tg_op = 'INSERT' then
      if cv is not null then
        d := public.data_put(d, f.aliases, cv, f.kind);
      else
        n := jsonb_set(n, array[f.col], coalesce(dv, 'null'::jsonb));
      end if;
    elsif (o -> f.col) is distinct from (n -> f.col) then
      d := public.data_put(d, f.aliases, cv, f.kind);                   -- cambió la columna → data
    elsif public.data_key(d, f.aliases) is null and cv is not null then
      d := public.data_put(d, f.aliases, cv, f.kind);                   -- la clave no vino en data → se conserva
    elsif dv is distinct from public.data_value(od, f.aliases, f.kind) then
      n := jsonb_set(n, array[f.col], coalesce(dv, 'null'::jsonb));      -- cambió data → columna
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    select count(*), coalesce(sum(stock), 0) into nvar, total from public.product_variants where product_id = new.id;
    if nvar > 0 then
      n := jsonb_set(n, '{stock}', to_jsonb(total));
      d := public.data_put(d, array['stock','cantidad','existencias'], to_jsonb(total), 'num');
    end if;
  end if;

  code := nullif(btrim(n ->> 'codigo_barras'), '');
  n := jsonb_set(n, '{codigo_norm}', coalesce(to_jsonb(upper(code)), 'null'::jsonb));
  n := jsonb_set(n, '{search}', to_jsonb(lower(concat_ws(' ', n ->> 'nombre', n ->> 'marca', public.jkey(d, 'descripcion'), new.ai_meta ->> 'etiqueta', code))));
  n := jsonb_set(n, '{data}', d);
  new := jsonb_populate_record(new, n);
  return new;
end $$;

-- 3) Historial de precios automático ------------------------------------------------------------------
--    Origen: `app.price_source` (lo fijan las funciones: 'masivo', 'compra'); por defecto 'ficha'.
create or replace function public.products_price_history() returns trigger language plpgsql security definer set search_path = public as $$
declare
  src text := coalesce(nullif(current_setting('app.price_source', true), ''), 'ficha');
  who uuid := coalesce(auth.uid(), new.user_id);
begin
  if new.precio is distinct from old.precio and coalesce(abs(new.precio), 0) < 1e10 and coalesce(abs(old.precio), 0) < 1e10 then
    insert into public.price_history (user_id, business_id, product_id, field, old_value, new_value, source) values (who, new.business_id, new.id, 'precio', old.precio, new.precio, src);
  end if;
  if new.precio_compra is distinct from old.precio_compra and coalesce(abs(new.precio_compra), 0) < 1e10 and coalesce(abs(old.precio_compra), 0) < 1e10 then
    insert into public.price_history (user_id, business_id, product_id, field, old_value, new_value, source) values (who, new.business_id, new.id, 'precio_compra', old.precio_compra, new.precio_compra, src);
  end if;
  if new.precio_mayorista is distinct from old.precio_mayorista and coalesce(abs(new.precio_mayorista), 0) < 1e10 and coalesce(abs(old.precio_mayorista), 0) < 1e10 then
    insert into public.price_history (user_id, business_id, product_id, field, old_value, new_value, source) values (who, new.business_id, new.id, 'precio_mayorista', old.precio_mayorista, new.precio_mayorista, src);
  end if;
  return null;
end $$;
drop trigger if exists products_price_history_trg on public.products;
create trigger products_price_history_trg after update on public.products for each row
  when (old.precio is distinct from new.precio or old.precio_compra is distinct from new.precio_compra or old.precio_mayorista is distinct from new.precio_mayorista)
  execute function public.products_price_history();

-- 4) Funciones internas (no se pueden llamar desde la app) -------------------------------------------
create or replace function public.op_business() returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  b := public.current_business_id();
  if b is null then raise exception 'No perteneces a ningún negocio' using errcode = '42501'; end if;
  return b;
end $$;

create or replace function public.next_number(p_business uuid, p_kind text) returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.business_counters (business_id, kind, value) values (p_business, p_kind, 1)
  on conflict (business_id, kind) do update set value = public.business_counters.value + 1
  returning value into v;
  return v;
end $$;

create or replace function public.sales_number() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is null then new.business_id := public.current_business_id(); end if;
  if new.number is null and new.business_id is not null then new.number := public.next_number(new.business_id, 'sale'); end if;
  return new;
end $$;

-- Mueve el stock de un producto o de una variante con bloqueo de fila. Nunca deja negativo: lo que falta va a `faltante`.
create or replace function public._move_stock(p_business uuid, p_product uuid, p_variant uuid, p_delta integer)
returns table (stock_before numeric, stock_after numeric, faltante integer) language plpgsql security definer set search_path = public as $$
declare
  cur numeric;
  nxt numeric;
  f integer := 0;
begin
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

-- Venta completa (ticket + líneas + stock + movimientos). p_move_stock = false solo para liquidar consignaciones.
create or replace function public._register_sale(
  p_business uuid, p_id uuid, p_lines jsonb, p_method public.pay_method, p_status public.sale_status, p_paid numeric,
  p_discount numeric, p_customer uuid, p_customer_name text, p_note text, p_at timestamptz, p_move_stock boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.sales%rowtype;
  it public.sale_items%rowtype;
  l record;
  mv record;
  resolved jsonb := '[]'::jsonb;
  items jsonb := '[]'::jsonb;
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
  paid numeric;
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
  if p_status <> 'pagado' and p_customer is null then raise exception 'Elige o crea el cliente que va a deber'; end if;

  -- Validar y completar cada línea en el servidor (orden fijo: evita bloqueos cruzados entre ventas simultáneas)
  for l in select value as v from jsonb_array_elements(p_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    qty := (l.v ->> 'qty')::integer;
    price := round(coalesce((l.v ->> 'unit_price')::numeric, 0), 2);
    if qty is null or qty <= 0 then raise exception 'Cantidad no válida'; end if;
    if price < 0 then raise exception 'Precio no válido'; end if;
    pid := (l.v ->> 'product_id')::uuid;
    select id, nombre, precio_compra into pid, pname, pcost from public.products where id = pid and business_id = p_business and deleted_at is null;
    if not found then raise exception 'Un producto de la venta ya no existe'; end if;
    vid := nullif(l.v ->> 'variant_id', '')::uuid;
    vlabel := null;
    vcost := null;
    if vid is not null then
      select id, label, costo into vid, vlabel, vcost from public.product_variants where id = vid and product_id = pid;
      if not found then raise exception 'Una variante de la venta ya no existe'; end if;
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
  paid := case when p_status = 'pagado' then tot else least(tot, greatest(0, round(coalesce(p_paid, 0), 2))) end;

  insert into public.sales (id, user_id, business_id, status, method, subtotal, discount, total, paid, cost_total, items, customer_id, customer_name, note, created_at)
  values (p_id, auth.uid(), p_business, p_status, p_method, subtotal, disc, tot, paid, round(cost_total, 2), jsonb_array_length(resolved),
          p_customer, cname, nullif(btrim(p_note), ''), coalesce(p_at, now()))
  returning * into s;

  for l in select value as v from jsonb_array_elements(resolved) loop
    pid := (l.v ->> 'pid')::uuid;
    vid := nullif(l.v ->> 'vid', '')::uuid;
    qty := (l.v ->> 'qty')::integer;
    insert into public.sale_items (sale_id, user_id, business_id, product_id, variant_id, product_name, variant_label, qty, unit_price, unit_cost, line_total)
    values (s.id, auth.uid(), p_business, pid, vid, l.v ->> 'name', l.v ->> 'label', qty, (l.v ->> 'price')::numeric, (l.v ->> 'cost')::numeric, (l.v ->> 'total')::numeric)
    returning * into it;
    items := items || to_jsonb(it);
    if p_move_stock then
      select * into mv from public._move_stock(p_business, pid, vid, -qty);
      insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, precio_unitario, total, stock_resultante, faltante, sale_id, created_at)
      values (auth.uid(), p_business, pid, l.v ->> 'name', vid, l.v ->> 'label', 'venta', qty, (l.v ->> 'price')::numeric, (l.v ->> 'total')::numeric,
              round(mv.stock_after)::integer, mv.faltante, s.id, s.created_at);
    end if;
  end loop;

  return jsonb_build_object('sale', to_jsonb(s), 'items', items, 'repeated', false);
end $$;

-- 5) Funciones públicas (las llama la app) ------------------------------------------------------------

-- Sumar o restar stock fuera de una venta: entrada (+), salida/retiro (−) o ajuste (±).
create or replace function public.adjust_stock(
  p_id uuid, p_product uuid, p_variant uuid, p_delta integer, p_tipo public.movement_type,
  p_motivo text default null, p_precio numeric default null, p_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  m public.stock_movements%rowtype;
  mv record;
  pname text;
  vlabel text;
begin
  select * into m from public.stock_movements where client_id = p_id;
  if found then
    return jsonb_build_object('movement_id', m.id, 'stock', m.stock_resultante, 'faltante', m.faltante, 'repeated', true,
      'product_stock', (select stock from public.products where id = m.product_id));
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'La cantidad no puede ser 0'; end if;
  if p_tipo = 'venta' then raise exception 'Las ventas se registran con register_sale'; end if;
  if p_tipo = 'entrada' and p_delta < 0 then raise exception 'Una entrada suma stock'; end if;
  if p_tipo = 'salida' and p_delta > 0 then raise exception 'Un retiro resta stock'; end if;
  select * into mv from public._move_stock(b, p_product, p_variant, p_delta);
  select nombre into pname from public.products where id = p_product;
  select label into vlabel from public.product_variants where id = p_variant;
  insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, precio_unitario, total, motivo, stock_resultante, faltante, client_id, created_at)
  values (auth.uid(), b, p_product, pname, p_variant, vlabel, p_tipo, abs(p_delta), p_precio,
          case when p_precio is not null then round(p_precio * abs(p_delta), 2) end, nullif(btrim(p_motivo), ''),
          round(mv.stock_after)::integer, mv.faltante, p_id, coalesce(p_at, now()))
  returning * into m;
  return jsonb_build_object('movement_id', m.id, 'stock', mv.stock_after, 'faltante', mv.faltante, 'repeated', false,
    'product_stock', (select stock from public.products where id = p_product));
end $$;

-- Dejar el stock en un valor exacto (corrección desde la ficha o la tabla): registra un ajuste por la diferencia.
create or replace function public.set_stock(p_id uuid, p_product uuid, p_variant uuid, p_value integer, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  cur numeric;
  delta integer;
begin
  if exists (select 1 from public.stock_movements where client_id = p_id) then
    return public.adjust_stock(p_id, p_product, p_variant, 1, 'ajuste');   -- devuelve lo ya registrado
  end if;
  if p_value is null or p_value < 0 then raise exception 'El stock no puede ser negativo'; end if;
  if p_variant is not null then
    select v.stock into cur from public.product_variants v join public.products p on p.id = v.product_id
      where v.id = p_variant and v.product_id = p_product and p.business_id = b for update of v;
  else
    select stock into cur from public.products where id = p_product and business_id = b and deleted_at is null for update;
  end if;
  if not found then raise exception 'Producto no encontrado'; end if;
  delta := p_value - round(coalesce(cur, 0))::integer;
  if delta = 0 then
    return jsonb_build_object('stock', p_value, 'changed', false, 'product_stock', (select stock from public.products where id = p_product));
  end if;
  return public.adjust_stock(p_id, p_product, p_variant, delta, 'ajuste',
    format('%s%s · %s', case when delta > 0 then '+' else '−' end, abs(delta), coalesce(nullif(btrim(p_motivo), ''), 'corrección a mano')))
    || jsonb_build_object('changed', true);
end $$;

-- Venta con carrito. Las líneas: [{product_id, variant_id, qty, unit_price}]
create or replace function public.register_sale(
  p_id uuid, p_lines jsonb, p_method public.pay_method default 'efectivo', p_status public.sale_status default 'pagado',
  p_paid numeric default 0, p_discount numeric default 0, p_customer uuid default null, p_customer_name text default null,
  p_note text default null, p_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._register_sale(public.op_business(), p_id, p_lines, p_method, p_status, p_paid, p_discount, p_customer, p_customer_name, p_note, p_at, true);
end $$;

-- Compra / entrada de mercadería. Líneas: [{product_id, variant_id, qty, unit_cost, expires_at}]
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
    cost := nullif(l.v ->> 'unit_cost', '')::numeric;
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
    if vid is not null then
      update public.product_variants set costo = coalesce(cost, costo), expires_at = coalesce(exp, expires_at) where id = vid;
    end if;
    update public.products
      set precio_compra = coalesce(cost, precio_compra),
          expires_at = case when vid is null then coalesce(exp, expires_at) else expires_at end
      where id = pid;
    insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, precio_unitario, motivo, stock_resultante, purchase_id)
    values (auth.uid(), b, pid, pname, vid, vlabel, 'entrada', qty, cost, case when sname is not null then 'compra · ' || sname else 'compra' end,
            round(mv.stock_after)::integer, p_id);
  end loop;
  return jsonb_build_object('purchase', to_jsonb(pu), 'repeated', false);
end $$;

-- Entregar mercadería a un revendedor (sigue siendo tuya). Líneas: [{product_id, variant_id, qty, unit_price}]
create or replace function public.consign_out(p_id uuid, p_customer uuid, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  c public.consignments%rowtype;
  cname text;
  l record;
  mv record;
  qty integer;
  price numeric;
  pid uuid;
  vid uuid;
  pname text;
  vlabel text;
begin
  select * into c from public.consignments where id = p_id;
  if found then return jsonb_build_object('consignment', to_jsonb(c), 'repeated', true); end if;
  select name into cname from public.customers where id = p_customer and business_id = b and deleted_at is null;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'La entrega no tiene productos'; end if;
  insert into public.consignments (id, user_id, business_id, customer_id, customer_name, note)
  values (p_id, auth.uid(), b, p_customer, cname, nullif(btrim(p_note), ''))
  returning * into c;
  for l in select value as v from jsonb_array_elements(p_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    qty := (l.v ->> 'qty')::integer;
    price := round(coalesce((l.v ->> 'unit_price')::numeric, 0), 2);
    if qty is null or qty <= 0 then raise exception 'Cantidad no válida'; end if;
    pid := (l.v ->> 'product_id')::uuid;
    vid := nullif(l.v ->> 'variant_id', '')::uuid;
    select nombre into pname from public.products where id = pid and business_id = b and deleted_at is null;
    if not found then raise exception 'Un producto de la entrega ya no existe'; end if;
    vlabel := null;
    if vid is not null then
      select label into vlabel from public.product_variants where id = vid and product_id = pid;
      if not found then raise exception 'Una variante de la entrega ya no existe'; end if;
    end if;
    insert into public.consignment_items (consignment_id, user_id, business_id, product_id, variant_id, product_name, variant_label, qty_out, unit_price)
    values (c.id, auth.uid(), b, pid, vid, pname, vlabel, qty, price);
    select * into mv from public._move_stock(b, pid, vid, -qty);
    insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, motivo, stock_resultante, faltante, consignment_id)
    values (auth.uid(), b, pid, pname, vid, vlabel, 'salida', qty, 'entregado a ' || cname, round(mv.stock_after)::integer, mv.faltante, c.id);
  end loop;
  return jsonb_build_object('consignment', to_jsonb(c), 'repeated', false);
end $$;

-- Rendir cuentas: lo vendido pasa a ser una venta (sin volver a mover stock: ya salió al entregar);
-- lo devuelto vuelve al estante. Filas: [{item_id, sold, returned}]
create or replace function public.consign_settle(p_id uuid, p_consignment uuid, p_rows jsonb, p_pay public.sale_status default 'pagado', p_method public.pay_method default 'efectivo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  prev jsonb;
  c public.consignments%rowtype;
  it public.consignment_items%rowtype;
  r record;
  mv record;
  sold integer;
  ret integer;
  sold_u integer := 0;
  ret_u integer := 0;
  remaining integer;
  sale_lines jsonb := '[]'::jsonb;
  sale jsonb := null;
  result jsonb;
begin
  select o.result into prev from public.op_log o where o.id = p_id;
  if found then return prev || jsonb_build_object('repeated', true); end if;
  select * into c from public.consignments where id = p_consignment and business_id = b for update;
  if not found then raise exception 'Entrega no encontrada'; end if;
  if c.status <> 'abierta' then raise exception 'Esta entrega ya está cerrada'; end if;
  for r in select value as v from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into it from public.consignment_items where id = (r.v ->> 'item_id')::uuid and consignment_id = c.id for update;
    if not found then raise exception 'Producto de la entrega no encontrado'; end if;
    sold := greatest(0, coalesce((r.v ->> 'sold')::integer, 0));
    ret := greatest(0, coalesce((r.v ->> 'returned')::integer, 0));
    if sold + ret > it.qty_out - it.qty_sold - it.qty_returned then
      raise exception 'De «%» se anotó más de lo que tiene pendiente', coalesce(it.product_name, 'un producto');
    end if;
    if sold > 0 then
      if it.product_id is null then raise exception '«%» ya no existe en el inventario', coalesce(it.product_name, 'Un producto'); end if;
      sale_lines := sale_lines || jsonb_build_object('product_id', it.product_id, 'variant_id', it.variant_id, 'qty', sold, 'unit_price', it.unit_price);
    end if;
    if ret > 0 and it.product_id is not null then
      select * into mv from public._move_stock(b, it.product_id, it.variant_id, ret);
      insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, motivo, stock_resultante, consignment_id)
      values (auth.uid(), b, it.product_id, it.product_name, it.variant_id, it.variant_label, 'entrada', ret, 'devuelto por ' || coalesce(c.customer_name, 'revendedor'),
              round(mv.stock_after)::integer, c.id);
    end if;
    update public.consignment_items set qty_sold = qty_sold + sold, qty_returned = qty_returned + ret where id = it.id;
    sold_u := sold_u + sold;
    ret_u := ret_u + ret;
  end loop;
  if sold_u + ret_u = 0 then raise exception 'Escribe cuánto vendió o cuánto devuelve'; end if;
  if jsonb_array_length(sale_lines) > 0 then
    sale := public._register_sale(b, p_id, sale_lines, p_method, p_pay, 0, 0, c.customer_id, c.customer_name, 'consignación', null, false);
  end if;
  select coalesce(sum(qty_out - qty_sold - qty_returned), 0) into remaining from public.consignment_items where consignment_id = c.id;
  if remaining = 0 then
    update public.consignments set status = 'liquidada', closed_at = now() where id = c.id;
  end if;
  result := jsonb_build_object('sale', sale -> 'sale', 'sold', sold_u, 'returned', ret_u, 'remaining', remaining);
  insert into public.op_log (id, business_id, kind, result) values (p_id, b, 'consign_settle', result);
  return result || jsonb_build_object('repeated', false);
end $$;

-- Conteo físico: deja el stock igual a lo contado (sobre el stock REAL al cerrar, no el de la pantalla).
-- Filas: [{product_id, variant_id, expected, counted, reason}]
create or replace function public.apply_count(p_id uuid, p_category uuid, p_category_name text, p_rows jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  sc public.stock_counts%rowtype;
  r record;
  mv record;
  pid uuid;
  vid uuid;
  pname text;
  vlabel text;
  expected integer;
  counted integer;
  cur numeric;
  delta integer;
  reason text;
  n_items integer := 0;
  n_diff integer := 0;
  units integer := 0;
  adjusted integer := 0;
begin
  select * into sc from public.stock_counts where id = p_id;
  if found then return jsonb_build_object('count', to_jsonb(sc), 'repeated', true); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Escribe cuántas unidades hay de al menos un producto'; end if;
  select count(*), count(*) filter (where (v ->> 'counted')::integer <> coalesce((v ->> 'expected')::integer, 0)),
         coalesce(sum(abs((v ->> 'counted')::integer - coalesce((v ->> 'expected')::integer, 0))), 0)
    into n_items, n_diff, units from jsonb_array_elements(p_rows) v;
  insert into public.stock_counts (id, user_id, business_id, category_id, category_name, note, items, differences, diff_units, closed_at)
  values (p_id, auth.uid(), b,
          (select id from public.categories where id = p_category and business_id = b), nullif(btrim(p_category_name), ''),
          nullif(btrim(p_note), ''), n_items, n_diff, units, now())
  returning * into sc;
  for r in select value as v from jsonb_array_elements(p_rows) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    pid := (r.v ->> 'product_id')::uuid;
    vid := nullif(r.v ->> 'variant_id', '')::uuid;
    counted := (r.v ->> 'counted')::integer;
    expected := coalesce((r.v ->> 'expected')::integer, 0);
    reason := nullif(btrim(r.v ->> 'reason'), '');
    if counted is null or counted < 0 then raise exception 'Cantidad contada no válida'; end if;
    select nombre into pname from public.products where id = pid and business_id = b and deleted_at is null;
    if not found then raise exception 'Un producto del conteo ya no existe'; end if;
    vlabel := null;
    if vid is not null then
      select label into vlabel from public.product_variants where id = vid and product_id = pid;
      if not found then raise exception 'Una variante del conteo ya no existe'; end if;
      select stock into cur from public.product_variants where id = vid for update;
    else
      select stock into cur from public.products where id = pid for update;
    end if;
    insert into public.stock_count_items (count_id, user_id, business_id, product_id, variant_id, product_name, variant_label, expected, counted, reason)
    values (p_id, auth.uid(), b, pid, vid, pname, vlabel, expected, counted, case when counted <> expected then coalesce(reason, 'conteo') end);
    delta := counted - round(coalesce(cur, 0))::integer;
    if delta <> 0 then
      select * into mv from public._move_stock(b, pid, vid, delta);
      insert into public.stock_movements (user_id, business_id, product_id, product_name, variant_id, variant_label, tipo, cantidad, motivo, stock_resultante, count_id)
      values (auth.uid(), b, pid, pname, vid, vlabel, 'ajuste', abs(delta),
              format('%s%s · %s', case when delta > 0 then '+' else '−' end, abs(delta), coalesce(reason, 'conteo')), counted, p_id);
      adjusted := adjusted + 1;
    end if;
  end loop;
  return jsonb_build_object('count', to_jsonb(sc), 'adjusted', adjusted, 'repeated', false);
end $$;

-- Cambio de precios en lote (venta, mayorista o compra). Filas: [{product_id, field, value}]. El historial lo escribe el disparador.
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

-- 6) Permisos de ejecución ----------------------------------------------------------------------------
revoke all on function public.op_business() from public, anon, authenticated;
revoke all on function public.next_number(uuid, text) from public, anon, authenticated;
revoke all on function public._move_stock(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public._register_sale(uuid, uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, boolean) from public, anon, authenticated;

revoke all on function public.adjust_stock(uuid, uuid, uuid, integer, public.movement_type, text, numeric, timestamptz) from public, anon;
revoke all on function public.set_stock(uuid, uuid, uuid, integer, text) from public, anon;
revoke all on function public.register_sale(uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.register_purchase(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.consign_out(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.consign_settle(uuid, uuid, jsonb, public.sale_status, public.pay_method) from public, anon;
revoke all on function public.apply_count(uuid, uuid, text, jsonb, text) from public, anon;
revoke all on function public.set_prices(jsonb, text) from public, anon;
grant execute on function public.adjust_stock(uuid, uuid, uuid, integer, public.movement_type, text, numeric, timestamptz) to authenticated;
grant execute on function public.set_stock(uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.register_sale(uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.register_purchase(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.consign_out(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.consign_settle(uuid, uuid, jsonb, public.sale_status, public.pay_method) to authenticated;
grant execute on function public.apply_count(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.set_prices(jsonb, text) to authenticated;

commit;
