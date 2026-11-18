-- =====================================================================
-- InventarIA - Migración 022: el dinero como pagos (Fase 6.9 · C3)
-- docs/PLAN_CIMIENTOS.md → C3 · docs/AUDITORIA.md → Auditoría 2 (N1, N2, N6, C6)
--
-- Cada cobro es una fila de `payments` con su medio y su fecha:
--   · kind 'venta' = lo que se pagó al vender (puede ser con varios medios: pago mixto real)
--   · kind 'abono' = lo que un cliente paga de su deuda; se reparte entre sus ventas más antiguas
--     (`payment_allocations`) y lo que sobra queda como SALDO A FAVOR, que se usa en su próxima venta fiada.
-- `sales.paid` y `sales.status` se recalculan desde los pagos (nunca se editan a mano).
-- La caja suma los PAGOS del día por medio (ventas + abonos): un abono de una venta vieja entra en la caja
-- de hoy y los cierres de días anteriores no cambian. Cada cierre es una fila nueva (historial).
-- =====================================================================

begin;

-- 1) Pagos: venta o abono, ligados a la venta cuando corresponde ---------------------------------------
alter table public.payments alter column customer_id drop not null;
alter table public.payments add column if not exists sale_id uuid references public.sales(id) on delete cascade;
alter table public.payments add column if not exists kind text not null default 'abono' check (kind in ('venta', 'abono'));
create index if not exists payments_sale on public.payments(sale_id) where sale_id is not null;
create index if not exists payments_business_fecha on public.payments(business_id, created_at desc);

-- Cómo se repartió cada abono entre las ventas del cliente
create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists payment_allocations_payment on public.payment_allocations(payment_id);
create index if not exists payment_allocations_sale on public.payment_allocations(sale_id);
alter table public.payment_allocations enable row level security;
drop policy if exists "payment_allocations_read" on public.payment_allocations;
create policy "payment_allocations_read" on public.payment_allocations for select using (business_id in (select public.my_business_ids()));
-- Sin políticas de escritura: solo las funciones de abajo reparten.

-- 2) Relleno: los abonos existentes se reparten (FIFO, a ventas anteriores al abono) y el resto de lo
--    cobrado de cada venta pasa a ser su pago inicial. Se conserva exactamente `paid` de cada venta.
do $$
declare
  p record;
  s record;
  rem numeric;
  take numeric;
begin
  for p in select * from public.payments where kind = 'abono' and sale_id is null and customer_id is not null order by created_at loop
    rem := p.amount;
    for s in
      select x.id, x.paid - coalesce((select sum(a.amount) from public.payment_allocations a where a.sale_id = x.id), 0) as avail
      from public.sales x
      where x.customer_id = p.customer_id and x.created_at <= p.created_at
      order by x.created_at
    loop
      exit when rem <= 0;
      take := least(rem, s.avail);
      if take > 0 then
        insert into public.payment_allocations (business_id, payment_id, sale_id, amount, created_at)
        values (coalesce(p.business_id, (select business_id from public.sales where id = s.id)), p.id, s.id, take, p.created_at);
        rem := rem - take;
      end if;
    end loop;
  end loop;

  insert into public.payments (user_id, business_id, customer_id, sale_id, kind, amount, method, note, created_at)
  select x.user_id, x.business_id, x.customer_id, x.id, 'venta',
         x.paid - coalesce((select sum(a.amount) from public.payment_allocations a where a.sale_id = x.id), 0),
         case when x.method = 'mixto' then 'efectivo'::public.pay_method else x.method end,
         case when x.method = 'mixto' then 'migrado: pago mixto' end,
         x.created_at
  from public.sales x
  where x.paid - coalesce((select sum(a.amount) from public.payment_allocations a where a.sale_id = x.id), 0) > 0
    and not exists (select 1 from public.payments q where q.sale_id = x.id);
end $$;

-- Verificación: lo cobrado de cada venta = sus pagos + lo repartido de abonos
do $$
declare bad integer;
begin
  select count(*) into bad from public.sales x
  where round(x.paid, 2) <> round(coalesce((select sum(amount) from public.payments where sale_id = x.id), 0)
                                + coalesce((select sum(amount) from public.payment_allocations where sale_id = x.id), 0), 2);
  if bad > 0 then raise exception 'Verificación 022: % ventas no cuadran con sus pagos', bad; end if;
end $$;

-- 3) `paid` y `status` de la venta se derivan de los pagos -------------------------------------------
create or replace function public.sale_refresh_paid(p_sale uuid) returns void language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if p_sale is null then return; end if;
  v := coalesce((select sum(amount) from public.payments where sale_id = p_sale), 0)
     + coalesce((select sum(amount) from public.payment_allocations where sale_id = p_sale), 0);
  update public.sales s
     set paid = least(v, s.total),
         status = case when v >= s.total then 'pagado'::public.sale_status when v > 0 then 'parcial'::public.sale_status else 'fiado'::public.sale_status end
   where s.id = p_sale and (s.paid is distinct from least(v, s.total)
     or s.status is distinct from (case when v >= s.total then 'pagado'::public.sale_status when v > 0 then 'parcial'::public.sale_status else 'fiado'::public.sale_status end));
end $$;

create or replace function public.payments_refresh_sale() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.sale_refresh_paid(old.sale_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.sale_refresh_paid(new.sale_id); end if;
  return null;
end $$;
drop trigger if exists payments_refresh_sale_trg on public.payments;
create trigger payments_refresh_sale_trg after insert or update or delete on public.payments for each row execute function public.payments_refresh_sale();
drop trigger if exists payment_allocations_refresh_sale_trg on public.payment_allocations;
create trigger payment_allocations_refresh_sale_trg after insert or update or delete on public.payment_allocations for each row execute function public.payments_refresh_sale();

-- 4) Repartir el saldo a favor de un cliente entre sus ventas pendientes (más antiguas primero) ----------
create or replace function public._allocate_credit(p_business uuid, p_customer uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  pay record;
  s record;
  rem numeric;
  take numeric;
begin
  for pay in
    select p.id, p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0) as free
    from public.payments p
    where p.customer_id = p_customer and p.business_id = p_business and p.kind = 'abono'
    order by p.created_at
  loop
    continue when pay.free <= 0;
    rem := pay.free;
    for s in
      select x.id, x.total - x.paid as due from public.sales x
      where x.customer_id = p_customer and x.business_id = p_business and x.paid < x.total
      order by x.created_at
      for update
    loop
      exit when rem <= 0;
      take := least(rem, s.due);
      if take > 0 then
        insert into public.payment_allocations (business_id, payment_id, sale_id, amount) values (p_business, pay.id, s.id, take);
        rem := rem - take;
      end if;
    end loop;
  end loop;
end $$;

-- 5) Saldo por cliente: > 0 debe · < 0 a favor ---------------------------------------------------------
create or replace view public.customer_balances with (security_invoker = true) as
select
  c.id as customer_id,
  c.business_id,
  c.name,
  coalesce(s.sold, 0) as sold,
  coalesce(p.paid, 0) as paid,
  round(coalesce(s.sold, 0) - coalesce(p.paid, 0), 2) as balance,
  s.oldest_open
from public.customers c
left join lateral (select sum(x.total) as sold, min(x.created_at) filter (where x.paid < x.total) as oldest_open from public.sales x where x.customer_id = c.id) s on true
left join lateral (select sum(y.amount) as paid from public.payments y where y.customer_id = c.id) p on true
where c.deleted_at is null;
grant select on public.customer_balances to authenticated;

-- 6) Venta con pagos (reemplaza a la de 021: agrega `p_payments` al final) ------------------------------
drop function if exists public.register_sale(uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz);
drop function if exists public._register_sale(uuid, uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, boolean);

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

  -- Pagos: lista explícita (varios medios) o, si no viene, uno solo con el medio elegido
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

  insert into public.sales (id, user_id, business_id, status, method, subtotal, discount, total, paid, cost_total, items, customer_id, customer_name, note, created_at)
  values (p_id, auth.uid(), p_business, st, meth, subtotal, disc, tot, paid, round(cost_total, 2), jsonb_array_length(resolved),
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

  for l in select value as v from jsonb_array_elements(pays) loop
    insert into public.payments (user_id, business_id, customer_id, sale_id, kind, amount, method, created_at)
    values (auth.uid(), p_business, p_customer, s.id, 'venta', (l.v ->> 'amount')::numeric, (l.v ->> 'method')::public.pay_method, s.created_at);
  end loop;
  -- Si el cliente tenía saldo a favor, se usa en esta venta
  if p_customer is not null and paid < tot then perform public._allocate_credit(p_business, p_customer); end if;

  select * into s from public.sales where id = p_id;
  return jsonb_build_object('sale', to_jsonb(s), 'items', items, 'repeated', false);
end $$;

-- Venta con carrito. Líneas: [{product_id, variant_id, qty, unit_price}] · Pagos (opcional): [{method, amount}]
create or replace function public.register_sale(
  p_id uuid, p_lines jsonb, p_method public.pay_method default 'efectivo', p_status public.sale_status default 'pagado',
  p_paid numeric default 0, p_discount numeric default 0, p_customer uuid default null, p_customer_name text default null,
  p_note text default null, p_at timestamptz default null, p_payments jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public._register_sale(public.op_business(), p_id, p_lines, p_method, p_status, p_paid, p_discount, p_customer, p_customer_name, p_note, p_at, true, p_payments);
end $$;

-- 7) Abono de un cliente ------------------------------------------------------------------------------
create or replace function public.register_payment(p_id uuid, p_customer uuid, p_amount numeric, p_method public.pay_method default 'efectivo', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  p public.payments%rowtype;
  applied numeric;
  amt numeric := round(coalesce(p_amount, 0), 2);
begin
  select * into p from public.payments where id = p_id;
  if not found then
    if amt <= 0 then raise exception 'Escribe cuánto paga'; end if;
    if p_method not in ('efectivo', 'qr', 'transferencia') then raise exception 'Medio de pago no válido'; end if;
    if not exists (select 1 from public.customers where id = p_customer and business_id = b and deleted_at is null) then raise exception 'Cliente no encontrado'; end if;
    insert into public.payments (id, user_id, business_id, customer_id, kind, amount, method, note)
    values (p_id, auth.uid(), b, p_customer, 'abono', amt, p_method, nullif(btrim(p_note), ''))
    returning * into p;
    perform public._allocate_credit(b, p_customer);
  elsif p.business_id is distinct from b then
    raise exception 'Operación no válida' using errcode = '42501';
  end if;
  applied := coalesce((select sum(amount) from public.payment_allocations where payment_id = p.id), 0);
  return jsonb_build_object('payment', to_jsonb(p), 'applied', applied, 'left', p.amount - applied,
    'balance', (select round(coalesce((select sum(total) from public.sales where customer_id = p.customer_id), 0)
                           - coalesce((select sum(amount) from public.payments where customer_id = p.customer_id), 0), 2)));
end $$;

-- 8) Caja: resumen del día y cierre (historial) -----------------------------------------------------------
alter table public.cash_closings add column if not exists collected_abonos numeric(12,2) not null default 0;
drop index if exists public.cash_closings_business_day;
create index if not exists cash_closings_business_day_at on public.cash_closings(business_id, day, closed_at desc);

create or replace function public.cash_summary(p_day date default null, p_tz text default 'America/La_Paz')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  d date := coalesce(p_day, (now() at time zone p_tz)::date);
  t0 timestamptz := (d::timestamp at time zone p_tz);
  t1 timestamptz := ((d + 1)::timestamp at time zone p_tz);
  owner boolean := public.my_role(b) = 'dueno';
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
  select count(*), coalesce(sum(total), 0), coalesce(sum(total - cost_total), 0) into n, sold, profit
    from public.sales where business_id = b and created_at >= t0 and created_at < t1;
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
  -- Lo que quedó fiado de las ventas de hoy (sin contar abonos posteriores)
  select coalesce(sum(x.total - coalesce((select sum(p.amount) from public.payments p where p.sale_id = x.id and p.kind = 'venta'), 0)), 0)
    into credit from public.sales x where x.business_id = b and x.created_at >= t0 and x.created_at < t1;
  select coalesce(sum(amount) filter (where tipo = 'ingreso'), 0), coalesce(sum(amount) filter (where tipo = 'retiro'), 0)
    into c_in, c_out from public.cash_movements where business_id = b and created_at >= t0 and created_at < t1;
  return jsonb_build_object(
    'day', d,
    'sales_count', n,
    'total_sales', sold,
    'collected_sales', v_sales,
    'collected_abonos', v_abonos,
    'credit_given', credit,
    'by_method', by_m,
    'abonos_by_method', ab_m,
    'cash_in', c_in,
    'cash_out', c_out,
    'expected_cash', cash + c_in - c_out,
    'profit', case when owner then round(profit, 2) end,
    'last_closing', (select to_jsonb(c) from public.cash_closings c where c.business_id = b and c.day = d order by c.closed_at desc limit 1)
  );
end $$;

create or replace function public.close_cash(p_id uuid, p_day date default null, p_counted numeric default null, p_note text default null, p_tz text default 'America/La_Paz')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  c public.cash_closings%rowtype;
  sm jsonb;
  d date := coalesce(p_day, (now() at time zone p_tz)::date);
  profit numeric;
begin
  select * into c from public.cash_closings where id = p_id;
  if found then return to_jsonb(c) || jsonb_build_object('repeated', true); end if;
  if p_counted is not null and p_counted < 0 then raise exception 'El efectivo contado no puede ser negativo'; end if;
  sm := public.cash_summary(d, p_tz);
  -- La ganancia se guarda siempre (la ve solo el dueño); se calcula aquí porque el resumen la oculta al vendedor
  select coalesce(sum(total - cost_total), 0) into profit from public.sales
    where business_id = b and created_at >= (d::timestamp at time zone p_tz) and created_at < ((d + 1)::timestamp at time zone p_tz);
  insert into public.cash_closings (id, user_id, business_id, day, sales_count, total_sales, by_method, cash_in, cash_out,
                                    expected_cash, counted_cash, difference, profit, note, collected_abonos)
  values (p_id, auth.uid(), b, d, (sm ->> 'sales_count')::integer, (sm ->> 'total_sales')::numeric, sm -> 'by_method',
          (sm ->> 'cash_in')::numeric, (sm ->> 'cash_out')::numeric, (sm ->> 'expected_cash')::numeric,
          round(p_counted, 2), case when p_counted is null then null else round(p_counted - (sm ->> 'expected_cash')::numeric, 2) end,
          round(profit, 2), nullif(btrim(p_note), ''), (sm ->> 'collected_abonos')::numeric)
  returning * into c;
  return to_jsonb(c) || jsonb_build_object('repeated', false);
end $$;

-- 9) Permisos ----------------------------------------------------------------------------------------
revoke all on function public._register_sale(uuid, uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, boolean, jsonb) from public, anon, authenticated;
revoke all on function public._allocate_credit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sale_refresh_paid(uuid) from public, anon, authenticated;
revoke all on function public.register_sale(uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, jsonb) from public, anon;
revoke all on function public.register_payment(uuid, uuid, numeric, public.pay_method, text) from public, anon;
revoke all on function public.cash_summary(date, text) from public, anon;
revoke all on function public.close_cash(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.register_sale(uuid, jsonb, public.pay_method, public.sale_status, numeric, numeric, uuid, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.register_payment(uuid, uuid, numeric, public.pay_method, text) to authenticated;
grant execute on function public.cash_summary(date, text) to authenticated;
grant execute on function public.close_cash(uuid, date, numeric, text, text) to authenticated;

commit;
