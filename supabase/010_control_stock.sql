-- =====================================================================
-- InventarIA - Migración 010: control real de stock (Plan v3 · Fase 2)
-- Stock mínimo, vencimientos, papelera, proveedores y compras, toma de inventario, historial de precios.
-- =====================================================================

-- Stock mínimo y vencimiento por producto / variante; papelera (borrado suave)
alter table public.products add column if not exists min_stock integer check (min_stock is null or min_stock >= 0);
alter table public.products add column if not exists expires_at date;
alter table public.products add column if not exists deleted_at timestamptz;
alter table public.product_variants add column if not exists min_stock integer check (min_stock is null or min_stock >= 0);
alter table public.product_variants add column if not exists expires_at date;
-- Valor por defecto del mínimo para los productos nuevos de una categoría principal
alter table public.categories add column if not exists min_stock_default integer check (min_stock_default is null or min_stock_default >= 0);
create index if not exists products_deleted on public.products(user_id, deleted_at) where deleted_at is not null;
create index if not exists products_expires on public.products(user_id, expires_at) where expires_at is not null;

-- Proveedores y compras
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists suppliers_user on public.suppliers(user_id);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text,                 -- copia para el historial
  doc text,                           -- nº de factura / nota
  note text,
  total numeric(12,2) not null default 0,
  items integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists purchases_user_fecha on public.purchases(user_id, created_at desc);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text,
  variant_label text,
  qty integer not null check (qty > 0),
  unit_cost numeric(12,2),
  expires_at date,
  created_at timestamptz not null default now()
);
create index if not exists purchase_items_purchase on public.purchase_items(purchase_id);
create index if not exists purchase_items_product on public.purchase_items(product_id, created_at desc);

-- Toma de inventario física
create table if not exists public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  category_name text,
  note text,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  items integer not null default 0,        -- productos/variantes contados
  differences integer not null default 0,  -- casillas con diferencia
  diff_units integer not null default 0    -- suma de |contado − esperado|
);
create index if not exists stock_counts_user on public.stock_counts(user_id, started_at desc);

create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text,
  variant_label text,
  expected integer not null default 0,
  counted integer,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists stock_count_items_count on public.stock_count_items(count_id);

-- Historial de precios (venta, compra, mayorista)
create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  field text not null,                -- 'precio' | 'precio_compra' | 'precio_mayorista'
  old_value numeric(12,2),
  new_value numeric(12,2),
  source text,                        -- 'ficha' | 'masivo' | 'compra' | 'tabla'
  created_at timestamptz not null default now()
);
create index if not exists price_history_product on public.price_history(product_id, created_at desc);

-- Movimientos: enlace a compra y a conteo
alter table public.stock_movements add column if not exists purchase_id uuid references public.purchases(id) on delete set null;
alter table public.stock_movements add column if not exists count_id uuid references public.stock_counts(id) on delete set null;

-- RLS
do $$
declare t text;
begin
  foreach t in array array['suppliers','purchases','purchase_items','stock_counts','stock_count_items','price_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_all_own" on public.%I', t, t);
    execute format('create policy "%s_all_own" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
  end loop;
end $$;

-- Vista ligera: agrega mínimo, vencimiento y excluye la papelera
create or replace view public.product_summaries with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.category_id,
  p.status,
  p.image_url,
  p.created_at,
  p.updated_at,
  public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo') as nombre,
  public.jkey(p.data, 'marca', 'brand') as marca,
  public.safe_num(public.jkey(p.data, 'precio', 'precio_venta', 'price')) as precio,
  public.safe_num(public.jkey(p.data, 'precio_compra', 'costo', 'cost')) as precio_compra,
  public.safe_num(public.jkey(p.data, 'stock', 'cantidad', 'existencias')) as stock,
  public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean') as codigo_barras,
  lower(concat_ws(' ',
    public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo'),
    public.jkey(p.data, 'marca', 'brand'),
    public.jkey(p.data, 'descripcion'),
    p.ai_meta->>'etiqueta',
    public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean')
  )) as search,
  p.min_stock,
  p.expires_at,
  public.safe_num(public.jkey(p.data, 'precio_mayorista')) as precio_mayorista,
  public.safe_num(public.jkey(p.data, 'unidades_por_paquete')) as unidades_por_paquete
from public.products p
where p.deleted_at is null;

grant select on public.product_summaries to authenticated;
