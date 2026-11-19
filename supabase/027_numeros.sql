-- =====================================================================
-- InventarIA - Migración 027: Números en SQL (Fase 6.9 · C7.7 · AUDITORIA E3)
-- docs/RECONSTRUCCION_VISUAL.md → C7.7 · docs/AUDITORIA.md → E3
--
-- Inicio, Resumen del día y Reportes cargaban TODOS los productos y hasta 3000 ventas / 6000 líneas al
-- navegador para sumar. Ahora lo calcula la base y devuelve solo el resultado:
--   restock_lines()            → lo que está bajo su mínimo, con la MISMA regla que la lista de pedido
--                                (por variante si tiene; mínimo de variante › producto › categoría principal ›
--                                negocio; avisos silenciados del producto o su categoría no cuentan)
--   today_summary()            → Inicio y Números › Hoy (ventas de hoy y ayer, por reponer, agotados, por
--                                vencer, sin precio, fiados). La ganancia solo para el dueño.
--   insights_report(p_period)  → Números › Ventas y Productos (solo dueño): comparativo, ventas por día,
--                                más vendidos, mejores clientes, ganancia por categoría, parados, valor.
-- Días en la zona del negocio (023). No cambia tablas ni nada que use la versión publicada.
-- =====================================================================

begin;

-- 1) Por reponer: una sola regla --------------------------------------------------------------------------
create or replace function public._restock(p_business uuid)
returns table (product_id uuid, variant_id uuid, stock numeric, min_stock integer)
language sql stable security definer set search_path = public as $$
  with b as (
    select coalesce(min_stock_default, 3) as dmin from public.businesses where id = p_business
  ),
  p as (
    select p.id, coalesce(p.stock, 0) as stock,
           coalesce(p.min_stock, t.min_stock_default, (select dmin from b), 3)::integer as pmin
      from public.products p
      left join public.categories c on c.id = p.category_id
      left join public.categories t on t.id = coalesce(c.parent_id, c.id)
     where p.business_id = p_business and p.status = 'confirmed' and p.deleted_at is null
       and not coalesce(p.alerts_off, false)
       and not coalesce(c.alerts_off, false) and not coalesce(t.alerts_off, false)
  )
  -- Con variantes: cada variante con su mínimo (o el del producto)
  select p.id, v.id, v.stock::numeric, coalesce(v.min_stock, p.pmin)::integer
    from p join public.product_variants v on v.product_id = p.id
   where v.stock <= coalesce(v.min_stock, p.pmin)
  union all
  -- Sin variantes: el stock del producto
  select p.id, null::uuid, p.stock, p.pmin
    from p
   where not exists (select 1 from public.product_variants v where v.product_id = p.id)
     and p.stock <= p.pmin
$$;

create or replace function public.restock_lines()
returns table (product_id uuid, variant_id uuid, stock numeric, min_stock integer)
language sql stable security definer set search_path = public as $$
  select * from public._restock(public.op_business())
$$;

-- 2) Resumen de hoy (Inicio y Números › Hoy) ------------------------------------------------------------
create or replace function public.today_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  owner boolean := public.is_owner(b);
  tz text := public.business_tz(b);
  today date := public.business_day(b);
  t0 timestamptz := today::timestamp at time zone tz;
  y0 timestamptz := (today - 1)::timestamp at time zone tz;
  exp_days integer := coalesce((select expiry_days from public.businesses where id = b), 30);
  r jsonb;
begin
  with
  s as (
    select s.total, s.created_at, coalesce(c.cost_total, 0) as cost
      from public.sales s left join public.sale_costs c on c.sale_id = s.id
     where s.business_id = b and s.created_at >= y0
  ),
  rl as (select * from public._restock(b)),
  rp as (select product_id, min(stock) as stock from rl group by product_id),
  prods as (
    select p.id, p.nombre, coalesce(p.stock, 0) as stock, p.precio, p.expires_at, p.alerts_off, p.category_id
      from public.products p
     where p.business_id = b and p.status = 'confirmed' and p.deleted_at is null
  ),
  expiring as (
    select p.id, coalesce(p.nombre, 'Sin nombre') as name, (p.expires_at - today) as days
      from prods p
      left join public.categories c on c.id = p.category_id
      left join public.categories t on t.id = coalesce(c.parent_id, c.id)
     where p.expires_at is not null and p.expires_at - today <= exp_days
       and not coalesce(p.alerts_off, false) and not coalesce(c.alerts_off, false) and not coalesce(t.alerts_off, false)
  ),
  debts as (
    select coalesce(s.customer_id::text, s.customer_name, 'Sin nombre') as k,
           max(coalesce(cu.name, s.customer_name, 'Sin nombre')) as name, max(s.customer_id::text) as customer_id,
           sum(s.total - s.paid) as amount, min(s.created_at) as oldest
      from public.sales s left join public.customers cu on cu.id = s.customer_id
     where s.business_id = b and s.status <> 'pagado'
     group by 1
    having sum(s.total - s.paid) > 0
  )
  select jsonb_build_object(
    'day', today,
    'is_owner', owner,
    'today', (select jsonb_build_object('total', coalesce(sum(total), 0), 'count', count(*), 'profit', case when owner then coalesce(sum(total - cost), 0) end) from s where created_at >= t0),
    'yesterday', (select jsonb_build_object('total', coalesce(sum(total), 0), 'count', count(*), 'profit', case when owner then coalesce(sum(total - cost), 0) end) from s where created_at < t0),
    'sales_ever', exists (select 1 from public.sales where business_id = b),
    'closed_today', exists (select 1 from public.cash_closings where business_id = b and day = today),
    'restock', jsonb_build_object('products', (select count(*) from rp), 'out', (select count(*) from rp where stock <= 0), 'lines', (select count(*) from rl)),
    'out', jsonb_build_object(
      'count', (select count(*) from prods where stock <= 0),
      'names', coalesce((select jsonb_agg(n) from (select coalesce(nombre, 'Sin nombre') as n from prods where stock <= 0 order by nombre limit 5) x), '[]'::jsonb)
    ),
    'expiring', jsonb_build_object(
      'count', (select count(*) from expiring),
      'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'days', days) order by days) from (select * from expiring order by days limit 6) x), '[]'::jsonb)
    ),
    'no_price', (select count(*) from prods where precio is null),
    'debts', jsonb_build_object(
      'total', coalesce((select sum(amount) from debts), 0),
      'customers', (select count(*) from debts),
      'old', (select count(*) from debts where oldest < now() - interval '30 days' and customer_id is not null),
      'old_list', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'customer_id', customer_id, 'amount', amount, 'days', extract(day from now() - oldest)::integer) order by oldest)
                            from (select * from debts where oldest < now() - interval '30 days' order by oldest limit 6) x), '[]'::jsonb)
    )
  ) into r;
  return r;
end $$;

-- 3) Números del dueño ------------------------------------------------------------------------------------
create or replace function public.insights_report(p_period text default 'mes')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  tz text := public.business_tz(b);
  today date := public.business_day(b);
  d_from date;
  t_from timestamptz;
  pt_from timestamptz;
  pt_to timestamptz;
  r jsonb;
begin
  if not public.is_owner(b) then raise exception 'Solo el dueño ve los números del negocio' using errcode = '42501'; end if;
  if p_period = '7d' then d_from := today - 6;
  elsif p_period = '90d' then d_from := today - 89;
  else d_from := date_trunc('month', today)::date;
  end if;
  t_from := d_from::timestamp at time zone tz;
  -- Periodo anterior: el mes anterior completo, o el mismo largo justo antes
  if p_period in ('7d', '90d') then
    pt_from := t_from - (now() - t_from);
  else
    pt_from := (date_trunc('month', today) - interval '1 month')::date::timestamp at time zone tz;
  end if;
  pt_to := t_from;

  with
  s as (
    select s.id, s.total, s.created_at, s.customer_id, coalesce(c.cost_total, 0) as cost
      from public.sales s left join public.sale_costs c on c.sale_id = s.id
     where s.business_id = b and s.created_at >= least(pt_from, (today - 13)::timestamp at time zone tz)
  ),
  it as (
    select i.product_id, coalesce(i.product_name, 'Producto') as name, i.qty, i.line_total, i.qty * coalesce(ic.unit_cost, 0) as cost
      from public.sale_items i left join public.sale_item_costs ic on ic.sale_item_id = i.id
     where i.business_id = b and i.created_at >= t_from
  ),
  byp as (
    select it.product_id, max(it.name) as name, sum(it.qty) as units, sum(it.line_total) as revenue, sum(it.line_total - it.cost) as profit
      from it group by it.product_id, case when it.product_id is null then it.name end
  ),
  prods as (
    select p.id, p.nombre, coalesce(p.stock, 0) as stock, coalesce(p.precio, 0) as precio, p.category_id,
           coalesce((select pc.cost from public.product_costs pc where pc.product_id = p.id and pc.variant_id is null), 0) as cost
      from public.products p
     where p.business_id = b and p.status = 'confirmed' and p.deleted_at is null
  ),
  topcat as (
    select p.id as product_id, t.id as cat_id, t.name as cat_name, t.icon as cat_icon
      from prods p
      left join public.categories c on c.id = p.category_id
      left join public.categories t on t.id = coalesce(c.parent_id, c.id)
  ),
  last_sale as (
    select i.product_id, max(i.created_at) as at from public.sale_items i where i.business_id = b and i.product_id is not null group by i.product_id
  ),
  dead as (
    select p.id, coalesce(p.nombre, 'Sin nombre') as name, p.stock, p.stock * p.precio as value, ls.at as last_sale
      from prods p left join last_sale ls on ls.product_id = p.id
     where p.stock > 0 and (ls.at is null or ls.at < now() - interval '60 days')
  )
  select jsonb_build_object(
    'period', p_period,
    'now', (select jsonb_build_object('total', coalesce(sum(total), 0), 'profit', coalesce(sum(total - cost), 0), 'count', count(*)) from s where created_at >= t_from),
    'prev', (select jsonb_build_object('total', coalesce(sum(total), 0), 'profit', coalesce(sum(total - cost), 0), 'count', count(*)) from s where created_at >= pt_from and created_at < pt_to),
    'per_day', (
      select jsonb_agg(jsonb_build_object('day', g.d, 'total', coalesce(x.total, 0), 'count', coalesce(x.n, 0)) order by g.d)
        from (select (today - k) as d from generate_series(0, 13) k) g
        left join (select (created_at at time zone tz)::date as day, sum(total) as total, count(*) as n from s group by 1) x on x.day = g.d
    ),
    'top_units', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', y.product_id, 'name', y.name, 'units', y.units, 'revenue', y.revenue, 'stock', p.stock) order by y.units desc, y.revenue desc)
        from (select * from byp order by units desc, revenue desc limit 10) y left join prods p on p.id = y.product_id
    ), '[]'::jsonb),
    'top_profit', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'units', units, 'profit', profit) order by profit desc)
        from (select * from byp order by profit desc limit 5) y
    ), '[]'::jsonb),
    'top_customers', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.customer_id, 'name', cu.name, 'total', x.total, 'count', x.n) order by x.total desc)
        from (select customer_id, sum(total) as total, count(*) as n from s where created_at >= t_from and customer_id is not null group by 1 order by 2 desc limit 5) x
        join public.customers cu on cu.id = x.customer_id
    ), '[]'::jsonb),
    'margins', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.cat_id, 'name', coalesce(m.cat_name, 'Sin categoría'), 'icon', m.cat_icon, 'revenue', m.revenue, 'cost', m.cost, 'profit', m.revenue - m.cost, 'units', m.units) order by m.revenue desc)
        from (
          select tc.cat_id, max(tc.cat_name) as cat_name, max(tc.cat_icon) as cat_icon, sum(it.line_total) as revenue, sum(it.cost) as cost, sum(it.qty) as units
            from it left join topcat tc on tc.product_id = it.product_id
           group by tc.cat_id
        ) m
    ), '[]'::jsonb),
    'dead', jsonb_build_object(
      'count', (select count(*) from dead),
      'value', coalesce((select sum(value) from dead), 0),
      'list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock, 'value', value, 'last_sale', last_sale) order by value desc) from (select * from dead order by value desc limit 15) d), '[]'::jsonb)
    ),
    'inventory', (select jsonb_build_object('sale', coalesce(sum(greatest(stock, 0) * precio), 0), 'cost', coalesce(sum(greatest(stock, 0) * cost), 0), 'units', coalesce(sum(greatest(stock, 0)), 0)) from prods),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('id', cat_id, 'name', coalesce(cat_name, 'Sin categoría'), 'icon', cat_icon, 'units', units, 'sale', sale) order by sale desc)
        from (
          select tc.cat_id, max(tc.cat_name) as cat_name, max(tc.cat_icon) as cat_icon, sum(greatest(p.stock, 0)) as units, sum(greatest(p.stock, 0) * p.precio) as sale
            from prods p join topcat tc on tc.product_id = p.id
           group by tc.cat_id
          having sum(greatest(p.stock, 0)) > 0
        ) c
    ), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public._restock(uuid) from public, anon, authenticated;
revoke all on function public.restock_lines() from public, anon;
revoke all on function public.today_summary() from public, anon;
revoke all on function public.insights_report(text) from public, anon;
grant execute on function public.restock_lines() to authenticated;
grant execute on function public.today_summary() to authenticated;
grant execute on function public.insights_report(text) to authenticated;

commit;
