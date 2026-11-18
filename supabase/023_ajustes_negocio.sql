-- =====================================================================
-- InventarIA - Migración 023: ajustes del negocio y zona horaria (Fase 6.9 · C4)
-- docs/PLAN_CIMIENTOS.md → C4 · docs/AUDITORIA.md → Auditoría 2 (N3, N5, E4, V6)
--
-- El nombre, la moneda, la zona horaria y los avisos son del NEGOCIO (antes, del perfil de cada usuario:
-- el vendedor veía «Mi negocio» en los tickets y otros mínimos de reposición).
-- `session_context()` entrega en UNA llamada lo que la app pedía con ~7 consultas en cada pantalla.
-- La caja corta el día en la zona del negocio (no la del celular).
-- =====================================================================

begin;

-- 1) Ajustes en el negocio --------------------------------------------------------------------------
alter table public.businesses add column if not exists timezone text not null default 'America/La_Paz';
alter table public.businesses add column if not exists currency text not null default 'Bs' check (char_length(btrim(currency)) between 1 and 5);
alter table public.businesses add column if not exists min_stock_default integer check (min_stock_default is null or min_stock_default >= 0);
alter table public.businesses add column if not exists expiry_days integer check (expiry_days is null or expiry_days between 1 and 365);

-- Zona horaria válida (lista de Postgres)
create or replace function public.businesses_check_tz() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Zona horaria no válida: %', new.timezone;
  end if;
  new.currency := btrim(new.currency);
  new.name := coalesce(nullif(btrim(new.name), ''), 'Mi negocio');
  return new;
end $$;
drop trigger if exists businesses_check_tz_trg on public.businesses;
create trigger businesses_check_tz_trg before insert or update of timezone, currency, name on public.businesses
  for each row execute function public.businesses_check_tz();

-- 2) Copia desde el perfil del dueño (lo que hasta hoy se guardaba por usuario) -----------------------
update public.businesses b
   set name = btrim(p.business_name)
  from public.profiles p
 where p.id = b.owner_id and b.name = 'Mi negocio' and nullif(btrim(p.business_name), '') is not null;
update public.businesses b
   set min_stock_default = coalesce(b.min_stock_default, p.min_stock_default),
       expiry_days = coalesce(b.expiry_days, p.expiry_days)
  from public.profiles p
 where p.id = b.owner_id;

-- 3) Día del negocio -------------------------------------------------------------------------------
create or replace function public.business_tz(p_business uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.businesses where id = p_business), 'America/La_Paz')
$$;
create or replace function public.business_day(p_business uuid, p_at timestamptz default now()) returns date language sql stable security definer set search_path = public as $$
  select (p_at at time zone public.business_tz(p_business))::date
$$;

-- 4) Todo lo que la app necesita al abrir, en una llamada --------------------------------------------
create or replace function public.session_context() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b uuid;
begin
  if uid is null then return null; end if;
  b := public.current_business_id();
  if b is null then
    return jsonb_build_object('me', uid, 'business', null, 'role', null, 'members', '[]'::jsonb, 'businesses', 0);
  end if;
  return jsonb_build_object(
    'me', uid,
    'business', (select to_jsonb(x) from (select id, name, owner_id, plan, timezone, currency, min_stock_default, expiry_days, created_at from public.businesses where id = b) x),
    'role', public.my_role(b),
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at)
                           from (select business_id, user_id, role, display_name, active, has_pin, created_at from public.business_members where business_id = b) m), '[]'::jsonb),
    'businesses', (select count(*) from public.business_members where user_id = uid and active),
    'today', public.business_day(b),
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.products where business_id = b and status = 'draft' and deleted_at is null),
      'confirmed', (select count(*) from public.products where business_id = b and status = 'confirmed' and deleted_at is null))
  );
end $$;

-- 5) Caja: el día se corta en la zona del negocio (p_tz pasa a ser opcional; mismas firmas que 022) ----
create or replace function public.cash_summary(p_day date default null, p_tz text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  tz text := coalesce(nullif(btrim(p_tz), ''), public.business_tz(b));
  d date := coalesce(p_day, (now() at time zone tz)::date);
  t0 timestamptz := (d::timestamp at time zone tz);
  t1 timestamptz := ((d + 1)::timestamp at time zone tz);
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
  select coalesce(sum(x.total - coalesce((select sum(p.amount) from public.payments p where p.sale_id = x.id and p.kind = 'venta'), 0)), 0)
    into credit from public.sales x where x.business_id = b and x.created_at >= t0 and x.created_at < t1;
  select coalesce(sum(amount) filter (where tipo = 'ingreso'), 0), coalesce(sum(amount) filter (where tipo = 'retiro'), 0)
    into c_in, c_out from public.cash_movements where business_id = b and created_at >= t0 and created_at < t1;
  return jsonb_build_object(
    'day', d,
    'tz', tz,
    'from', t0,
    'to', t1,
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
  select coalesce(sum(total - cost_total), 0) into profit from public.sales
    where business_id = b and created_at >= (d::timestamp at time zone tz) and created_at < ((d + 1)::timestamp at time zone tz);
  insert into public.cash_closings (id, user_id, business_id, day, sales_count, total_sales, by_method, cash_in, cash_out,
                                    expected_cash, counted_cash, difference, profit, note, collected_abonos)
  values (p_id, auth.uid(), b, d, (sm ->> 'sales_count')::integer, (sm ->> 'total_sales')::numeric, sm -> 'by_method',
          (sm ->> 'cash_in')::numeric, (sm ->> 'cash_out')::numeric, (sm ->> 'expected_cash')::numeric,
          round(p_counted, 2), case when p_counted is null then null else round(p_counted - (sm ->> 'expected_cash')::numeric, 2) end,
          round(profit, 2), nullif(btrim(p_note), ''), (sm ->> 'collected_abonos')::numeric)
  returning * into c;
  return to_jsonb(c) || jsonb_build_object('repeated', false);
end $$;

-- 6) Permisos ----------------------------------------------------------------------------------------
revoke all on function public.session_context() from public, anon;
grant execute on function public.session_context() to authenticated;
revoke all on function public.business_day(uuid, timestamptz) from public, anon;
grant execute on function public.business_day(uuid, timestamptz) to authenticated;
revoke all on function public.business_tz(uuid) from public, anon;
grant execute on function public.business_tz(uuid) to authenticated;

commit;
