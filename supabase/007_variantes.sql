-- =====================================================================
-- InventarIA - Migración 007: variantes (talla, color, edad…) con stock propio
-- Mismo modelo que el propuesto para MiPuesto: ejes por categoría + una fila por combinación.
-- =====================================================================

-- Ejes por categoría principal: qué varía en esta categoría (hasta 3)
create table if not exists public.variant_axes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  key text not null,                         -- 'talla', 'color', 'edad'
  label text not null,                       -- 'Talla', 'Color', 'Edad'
  options text[] not null default '{}',      -- opciones sugeridas; vacío = libre
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (category_id, key)
);
create index if not exists variant_axes_user on public.variant_axes(user_id);

-- Una fila por combinación. Un producto sin filas aquí se comporta como hasta ahora.
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  "values" jsonb not null default '{}'::jsonb, -- {"talla":"M","color":"Rojo"}
  label text not null,                         -- "M · Rojo" (derivado, para mostrar y buscar)
  codigo_barras text,
  precio numeric(10,2),                        -- nulo = el del producto
  costo numeric(10,2),
  stock integer not null default 0 check (stock >= 0),
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, "values")
);
create index if not exists product_variants_product on public.product_variants(product_id);
create unique index if not exists product_variants_codigo on public.product_variants(user_id, codigo_barras) where codigo_barras is not null and codigo_barras <> '';

-- Movimientos por variante
alter table public.stock_movements add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
alter table public.stock_movements add column if not exists variant_label text;

-- RLS igual que el resto
alter table public.variant_axes enable row level security;
drop policy if exists "variant_axes_all_own" on public.variant_axes;
create policy "variant_axes_all_own" on public.variant_axes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.product_variants enable row level security;
drop policy if exists "product_variants_all_own" on public.product_variants;
create policy "product_variants_all_own" on public.product_variants for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Stock del producto = Σ stock de sus variantes. Se mantiene en products.data (clave stock/cantidad/existencias)
-- para que inventario, alertas, Excel y filtros sigan funcionando sin cambios.
create or replace function public.sync_product_stock(pid uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  total integer;
  n integer;
  k text;
begin
  select count(*), coalesce(sum(stock), 0) into n, total from public.product_variants where product_id = pid;
  if n = 0 then return; end if; -- sin variantes: el stock lo edita el usuario
  select key into k from (
    select key from public.products p, jsonb_object_keys(p.data) key
    where p.id = pid and lower(key) in ('stock', 'cantidad', 'existencias')
    order by case lower(key) when 'stock' then 0 when 'cantidad' then 1 else 2 end
    limit 1
  ) s;
  if k is null then k := 'stock'; end if;
  update public.products set data = jsonb_set(coalesce(data, '{}'::jsonb), array[k], to_jsonb(total), true), updated_at = now() where id = pid;
end $$;

create or replace function public.product_variants_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_product_stock(old.product_id);
    return old;
  end if;
  perform public.sync_product_stock(new.product_id);
  return new;
end $$;

drop trigger if exists product_variants_sync_trg on public.product_variants;
create trigger product_variants_sync_trg
  after insert or update of stock or delete on public.product_variants
  for each row execute function public.product_variants_sync();

-- Si el producto tiene variantes, nadie puede escribir el stock a mano: siempre vale la suma.
create or replace function public.products_stock_guard() returns trigger language plpgsql as $$
declare
  total integer;
  n integer;
  k text;
begin
  select count(*), coalesce(sum(stock), 0) into n, total from public.product_variants where product_id = new.id;
  if n = 0 then return new; end if;
  select key into k from jsonb_object_keys(coalesce(new.data, '{}'::jsonb)) key
    where lower(key) in ('stock', 'cantidad', 'existencias')
    order by case lower(key) when 'stock' then 0 when 'cantidad' then 1 else 2 end limit 1;
  if k is null then k := 'stock'; end if;
  new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), array[k], to_jsonb(total), true);
  return new;
end $$;

drop trigger if exists products_stock_guard_trg on public.products;
create trigger products_stock_guard_trg before update of data on public.products
  for each row execute function public.products_stock_guard();
