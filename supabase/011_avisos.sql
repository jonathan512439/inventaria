-- =====================================================================
-- InventarIA - Migración 011: ajustes de avisos (reposición y vencimiento)
-- El usuario decide desde cuántas unidades avisar y qué categorías/productos avisan.
-- =====================================================================

-- Preferencias generales del negocio
alter table public.profiles add column if not exists min_stock_default integer check (min_stock_default is null or min_stock_default >= 0);
alter table public.profiles add column if not exists expiry_days integer check (expiry_days is null or expiry_days between 1 and 365);

-- Silenciar avisos por categoría y por producto (descartar de la lista sin borrar nada)
alter table public.categories add column if not exists alerts_off boolean not null default false;
alter table public.products add column if not exists alerts_off boolean not null default false;

-- Vista ligera: añade alerts_off (se recrea porque cambia el orden de columnas)
drop view if exists public.product_summaries;
create view public.product_summaries with (security_invoker = true) as
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
  p.alerts_off,
  public.safe_num(public.jkey(p.data, 'precio_mayorista')) as precio_mayorista,
  public.safe_num(public.jkey(p.data, 'unidades_por_paquete')) as unidades_por_paquete
from public.products p
where p.deleted_at is null;

grant select on public.product_summaries to authenticated;
