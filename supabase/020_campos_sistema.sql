-- =====================================================================
-- InventarIA - Migración 020: campos del sistema como columnas (Fase 6.9 · C1)
-- docs/PLAN_CIMIENTOS.md → C1 · docs/AUDITORIA.md → Auditoría 2 (C2, M2, E1, E2, S11)
--
-- products gana columnas reales para nombre, marca, precios, stock y código. Un disparador las mantiene
-- sincronizadas con `data` EN LOS DOS SENTIDOS mientras dure la transición:
--   · si cambia la columna → se copia a `data` con la clave que ya use el producto (stock/cantidad/existencias…)
--   · si cambia `data`     → se copia a la columna
-- Con variantes, el stock es siempre la suma de las variantes (absorbe products_stock_guard).
-- Las columnas son `numeric` sin precisión fija: `data` es texto libre y un valor raro no debe romper un guardado.
-- =====================================================================

begin;

create extension if not exists pg_trgm with schema extensions;

-- 1) Columnas ----------------------------------------------------------------------------------
alter table public.products
  add column if not exists nombre text,
  add column if not exists marca text,
  add column if not exists precio numeric,
  add column if not exists precio_compra numeric,
  add column if not exists precio_mayorista numeric,
  add column if not exists stock numeric,
  add column if not exists codigo_barras text,
  add column if not exists unidades_por_paquete numeric,
  add column if not exists codigo_norm text,   -- upper(btrim(codigo_barras)): búsqueda exacta por código
  add column if not exists search text;        -- nombre, marca, descripción, etiqueta y código en minúsculas

-- 2) Qué columna corresponde a qué claves de `data` (en orden de preferencia) -----------------------
create or replace function public.product_system_fields()
returns table (col text, aliases text[], kind text) language sql immutable as $$
  values
    ('nombre',               array['nombre','name','producto','titulo'],          'text'),
    ('marca',                array['marca','brand'],                              'text'),
    ('precio',               array['precio','precio_venta','price'],              'num'),
    ('precio_compra',        array['precio_compra','costo','cost'],               'num'),
    ('precio_mayorista',     array['precio_mayorista'],                           'num'),
    ('stock',                array['stock','cantidad','existencias'],             'num'),
    ('codigo_barras',        array['codigo_barras','codigo','sku','barcode','ean'], 'text'),
    ('unidades_por_paquete', array['unidades_por_paquete'],                       'num')
$$;

-- Clave real de `data` que corresponde a los alias (sin importar mayúsculas), aunque esté vacía
create or replace function public.data_key(d jsonb, aliases text[]) returns text language sql immutable as $$
  select x.k
  from unnest(aliases) with ordinality a(name, ord)
  join lateral (select key as k from jsonb_object_keys(coalesce(d, '{}'::jsonb)) key where lower(key) = lower(a.name) limit 1) x on true
  order by a.ord
  limit 1
$$;

-- Valor de `data` para una columna, ya convertido (jsonb; null si no hay)
create or replace function public.data_value(d jsonb, aliases text[], kind text) returns jsonb language sql immutable as $$
  select case
    when kind = 'num' then to_jsonb(public.safe_num(public.jkey(d, variadic aliases)))
    else to_jsonb(public.jkey(d, variadic aliases))
  end
$$;

-- Escribe un valor de columna en `data` respetando la clave existente; no crea claves para valores nulos
create or replace function public.data_put(d jsonb, aliases text[], v jsonb, kind text) returns jsonb language plpgsql immutable as $$
declare
  k text := public.data_key(d, aliases);
  val jsonb := v;
begin
  if val = 'null'::jsonb then val := null; end if;
  if k is null then
    if val is null then return coalesce(d, '{}'::jsonb); end if;
    k := aliases[1];
  end if;
  if val is not null and kind = 'num' then val := to_jsonb(trim_scale((val #>> '{}')::numeric)); end if;
  return jsonb_set(coalesce(d, '{}'::jsonb), array[k], coalesce(val, 'null'::jsonb), true);
end $$;

-- 3) Disparador de sincronización ----------------------------------------------------------------
create or replace function public.products_sync_fields() returns trigger language plpgsql as $$
declare
  f record;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  d jsonb := coalesce(new.data, '{}'::jsonb);
  od jsonb := case when tg_op = 'UPDATE' then coalesce(old.data, '{}'::jsonb) end;
  cv jsonb;
  dv jsonb;
  nvar integer;
  total numeric;
  code text;
begin
  for f in select * from public.product_system_fields() loop
    cv := n -> f.col;
    if cv = 'null'::jsonb then cv := null; end if;
    dv := public.data_value(d, f.aliases, f.kind);
    if tg_op = 'INSERT' then
      if cv is not null then
        d := public.data_put(d, f.aliases, cv, f.kind);                 -- columna explícita: manda
      else
        n := jsonb_set(n, array[f.col], coalesce(dv, 'null'::jsonb));    -- se toma de data
      end if;
    elsif (o -> f.col) is distinct from (n -> f.col) then
      d := public.data_put(d, f.aliases, cv, f.kind);                   -- cambió la columna → data
    elsif dv is distinct from public.data_value(od, f.aliases, f.kind) then
      n := jsonb_set(n, array[f.col], coalesce(dv, 'null'::jsonb));      -- cambió data → columna
    end if;
  end loop;

  -- Con variantes, el stock del producto es la suma de sus variantes (nadie lo escribe a mano)
  if tg_op = 'UPDATE' then
    select count(*), coalesce(sum(stock), 0) into nvar, total from public.product_variants where product_id = new.id;
    if nvar > 0 then
      n := jsonb_set(n, '{stock}', to_jsonb(total));
      d := public.data_put(d, array['stock','cantidad','existencias'], to_jsonb(total), 'num');
    end if;
  end if;

  code := nullif(btrim(n ->> 'codigo_barras'), '');
  n := jsonb_set(n, '{codigo_norm}', coalesce(to_jsonb(upper(code)), 'null'::jsonb));
  n := jsonb_set(n, '{search}', to_jsonb(lower(concat_ws(' ', n ->> 'nombre', n ->> 'marca', public.jkey(d, 'descripcion'), new.ai_meta ->> 'etiqueta', code))));
  n := jsonb_set(n, '{data}', d);
  new := jsonb_populate_record(new, n);
  return new;
end $$;

-- 4) Relleno inicial desde `data` (disparadores apagados: no cambia updated_at ni la firma) -----------
alter table public.products disable trigger user;
update public.products p set
  nombre               = public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo'),
  marca                = public.jkey(p.data, 'marca', 'brand'),
  precio               = public.safe_num(public.jkey(p.data, 'precio', 'precio_venta', 'price')),
  precio_compra        = public.safe_num(public.jkey(p.data, 'precio_compra', 'costo', 'cost')),
  precio_mayorista     = public.safe_num(public.jkey(p.data, 'precio_mayorista')),
  stock                = public.safe_num(public.jkey(p.data, 'stock', 'cantidad', 'existencias')),
  codigo_barras        = public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean'),
  unidades_por_paquete = public.safe_num(public.jkey(p.data, 'unidades_por_paquete')),
  codigo_norm          = upper(nullif(btrim(public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean')), '')),
  search               = lower(concat_ws(' ',
                           public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo'),
                           public.jkey(p.data, 'marca', 'brand'),
                           public.jkey(p.data, 'descripcion'),
                           p.ai_meta ->> 'etiqueta',
                           nullif(btrim(public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean')), '')));
alter table public.products enable trigger user;

drop trigger if exists products_stock_guard_trg on public.products;
drop trigger if exists products_sync_fields_trg on public.products;
create trigger products_sync_fields_trg before insert or update on public.products
  for each row execute function public.products_sync_fields();

-- 5) Índices por negocio y búsqueda ------------------------------------------------------------------
create index if not exists products_business_status on public.products(business_id, status) where deleted_at is null;
create index if not exists products_business_code on public.products(business_id, codigo_norm) where codigo_norm is not null;
create index if not exists products_search_trgm on public.products using gin (search extensions.gin_trgm_ops);

-- 6) Vista ligera: lee columnas (mismas columnas y orden que 014; el costo sigue oculto al vendedor) ---
drop view if exists public.product_summaries;
create view public.product_summaries with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.business_id,
  p.category_id,
  p.status,
  p.image_url,
  p.created_at,
  p.updated_at,
  p.nombre,
  p.marca,
  p.precio,
  case when public.my_role(p.business_id) = 'dueno' then p.precio_compra else null end as precio_compra,
  p.stock,
  p.codigo_barras,
  p.search,
  p.min_stock,
  p.expires_at,
  p.alerts_off,
  p.precio_mayorista,
  p.unidades_por_paquete
from public.products p
where p.deleted_at is null;
grant select on public.product_summaries to authenticated;

-- 7) Código de barras de variante: único por negocio (antes por usuario) -----------------------------
drop index if exists public.product_variants_codigo;
create unique index if not exists product_variants_codigo_business on public.product_variants(business_id, codigo_barras)
  where codigo_barras is not null and codigo_barras <> '';

-- 8) Verificación: cada columna coincide con lo que dice `data` (si no, se deshace todo) ----------------
do $$
declare bad integer;
begin
  select count(*) into bad from public.products p
  where p.nombre is distinct from public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo')
     or p.marca is distinct from public.jkey(p.data, 'marca', 'brand')
     or p.precio is distinct from public.safe_num(public.jkey(p.data, 'precio', 'precio_venta', 'price'))
     or p.precio_compra is distinct from public.safe_num(public.jkey(p.data, 'precio_compra', 'costo', 'cost'))
     or p.stock is distinct from public.safe_num(public.jkey(p.data, 'stock', 'cantidad', 'existencias'))
     or p.codigo_barras is distinct from public.jkey(p.data, 'codigo_barras', 'codigo', 'sku', 'barcode', 'ean');
  if bad > 0 then raise exception 'Verificación 020: % productos no coinciden con data', bad; end if;
  -- productos con variantes: stock = suma de variantes
  select count(*) into bad from public.products p
  where exists (select 1 from public.product_variants v where v.product_id = p.id)
    and p.stock is distinct from (select sum(v.stock) from public.product_variants v where v.product_id = p.id);
  if bad > 0 then raise exception 'Verificación 020: % productos con variantes no suman', bad; end if;
end $$;

commit;
