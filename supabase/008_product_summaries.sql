-- =====================================================================
-- InventarIA - Migración 008: vista ligera del inventario (Fase 0 · paginación real)
-- El nivel 1 del inventario, el Inicio y la búsqueda leen esta vista (≈200 B por producto)
-- en lugar de descargar todo `data` de cada producto.
-- =====================================================================

-- Número seguro desde texto ("12,5" → 12.5; basura → null)
create or replace function public.safe_num(t text) returns numeric language plpgsql immutable as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return replace(btrim(t), ',', '.')::numeric;
exception when others then
  return null;
end $$;

-- Primer valor de `data` cuya clave coincide (sin importar mayúsculas) con alguna de las dadas, en orden
create or replace function public.jkey(data jsonb, variadic keys text[]) returns text language sql immutable as $$
  select v.value
  from unnest(keys) with ordinality as k(name, ord)
  join lateral (
    select value from jsonb_each_text(coalesce(data, '{}'::jsonb)) where lower(key) = lower(k.name) limit 1
  ) v on true
  where v.value is not null and btrim(v.value) <> ''
  order by k.ord
  limit 1
$$;

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
  )) as search
from public.products p;

grant select on public.product_summaries to authenticated;

-- Índice para la búsqueda por nombre (ilike) sin recorrer todo `data`
create index if not exists products_user_status on public.products(user_id, status);
