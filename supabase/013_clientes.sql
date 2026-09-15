-- =====================================================================
-- InventarIA - Migración 013: clientes, fiado con abonos y entregas en consignación (Plan v3 · Fase 4)
-- Sin fidelización. El cliente es opcional en cada venta.
-- =====================================================================

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  note text,
  credit_limit numeric(12,2),                 -- null = sin límite
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customers_user on public.customers(user_id, name);

-- La venta puede tener cliente (para fiado es obligatorio en la app)
alter table public.sales drop constraint if exists sales_customer_fk;
alter table public.sales add constraint sales_customer_fk foreign key (customer_id) references public.customers(id) on delete set null;
create index if not exists sales_customer on public.sales(customer_id, created_at desc);

-- Abonos: pagos del cliente contra su saldo (se aplican a las ventas más antiguas primero)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method public.pay_method not null default 'efectivo',
  note text,
  created_at timestamptz not null default now()
);
create index if not exists payments_customer on public.payments(customer_id, created_at desc);

-- Entregas en consignación: mercadería que sigue siendo tuya en manos de un revendedor
create table if not exists public.consignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_name text,
  status text not null default 'abierta' check (status in ('abierta', 'liquidada')),
  note text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists consignments_user on public.consignments(user_id, status, created_at desc);

create table if not exists public.consignment_items (
  id uuid primary key default gen_random_uuid(),
  consignment_id uuid not null references public.consignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text,
  variant_label text,
  qty_out integer not null check (qty_out > 0),
  qty_sold integer not null default 0 check (qty_sold >= 0),
  qty_returned integer not null default 0 check (qty_returned >= 0),
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists consignment_items_consignment on public.consignment_items(consignment_id);
create index if not exists consignment_items_product on public.consignment_items(product_id);

alter table public.stock_movements add column if not exists consignment_id uuid references public.consignments(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['customers','payments','consignments','consignment_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_all_own" on public.%I', t, t);
    execute format('create policy "%s_all_own" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
  end loop;
end $$;
