-- =====================================================================
-- InventarIA - Migración 012: ventas con carrito, caja y ganancia real (Plan v3 · Fase 3)
-- =====================================================================

do $$ begin
  create type public.sale_status as enum ('pagado', 'parcial', 'fiado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pay_method as enum ('efectivo', 'qr', 'transferencia', 'mixto');
exception when duplicate_object then null; end $$;

-- Una venta = un ticket (varias líneas)
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  number bigint,                                  -- correlativo por negocio (lo asigna el trigger)
  customer_id uuid,                               -- Fase 4 (clientes); sin FK todavía
  customer_name text,                             -- nombre libre para fiado/parcial hasta la Fase 4
  status public.sale_status not null default 'pagado',
  method public.pay_method not null default 'efectivo',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,          -- lo cobrado (total si está pagado)
  cost_total numeric(12,2) not null default 0,    -- costo de lo vendido (ganancia real = total − cost_total)
  items integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists sales_user_fecha on public.sales(user_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text,
  variant_label text,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null default 0,
  unit_cost numeric(12,2),
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sale_items_sale on public.sale_items(sale_id);
create index if not exists sale_items_product on public.sale_items(product_id, created_at desc);

-- Dinero que entra o sale de la caja fuera de las ventas (retiro para gastos, aporte de cambio…)
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('ingreso', 'retiro')),
  amount numeric(12,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_user_fecha on public.cash_movements(user_id, created_at desc);

-- Cierre de caja del día
create table if not exists public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sales_count integer not null default 0,
  total_sales numeric(12,2) not null default 0,
  by_method jsonb not null default '{}'::jsonb,   -- {"efectivo": 120, "qr": 80, ...}
  cash_in numeric(12,2) not null default 0,       -- ingresos manuales a caja
  cash_out numeric(12,2) not null default 0,      -- retiros
  expected_cash numeric(12,2) not null default 0, -- efectivo que debería haber
  counted_cash numeric(12,2),                     -- efectivo contado
  difference numeric(12,2),
  profit numeric(12,2) not null default 0,        -- ganancia real del día
  note text,
  closed_at timestamptz not null default now(),
  unique (user_id, day)
);

-- Movimientos de stock ligados a la venta
alter table public.stock_movements add column if not exists sale_id uuid references public.sales(id) on delete set null;

-- Número correlativo de venta por negocio
create or replace function public.sales_number() returns trigger language plpgsql as $$
begin
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.sales where user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists sales_number_trg on public.sales;
create trigger sales_number_trg before insert on public.sales for each row execute function public.sales_number();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['sales','sale_items','cash_movements','cash_closings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_all_own" on public.%I', t, t);
    execute format('create policy "%s_all_own" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
  end loop;
end $$;
