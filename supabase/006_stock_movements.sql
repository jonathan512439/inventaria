-- =====================================================================
-- InventarIA - Migración 006: movimientos de stock (entradas, ventas, salidas)
-- =====================================================================
do $$ begin
  create type public.movement_type as enum ('entrada', 'venta', 'salida', 'ajuste');
exception when duplicate_object then null; end $$;

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text,                       -- copia para el historial aunque se borre el producto
  tipo public.movement_type not null,
  cantidad integer not null check (cantidad > 0),   -- siempre positiva; el tipo dice si suma o resta
  precio_unitario numeric(10,2),           -- en ventas: precio al que se vendió
  total numeric(10,2),                     -- en ventas: cantidad × precio
  motivo text,                             -- salida/ajuste: 'retiro', 'merma', 'regalo', 'conteo'…
  stock_resultante integer,                -- stock del producto tras el movimiento
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_user_fecha on public.stock_movements(user_id, created_at desc);
create index if not exists stock_movements_producto on public.stock_movements(product_id, created_at desc);

alter table public.stock_movements enable row level security;
drop policy if exists "stock_movements_all_own" on public.stock_movements;
create policy "stock_movements_all_own" on public.stock_movements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
