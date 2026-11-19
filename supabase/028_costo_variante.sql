-- =====================================================================
-- InventarIA - Migración 028: costo por variante desde la ficha (Pendientes antes de C6 · P2)
-- docs/PLAN_CIMIENTOS.md → «Pendientes antes de C6»
--
-- El costo de cada talla/color vive en product_costs (025, solo el dueño lo lee) y hasta ahora solo lo
-- escribía «Llegó mercadería» (register_purchase). La ficha › Precios ahora lo edita con set_prices:
-- una fila { product_id, variant_id, field: 'precio_compra', value } pone (o quita, con value vacío) el
-- costo de esa variante. Sin variant_id todo funciona igual que antes (compatible con la versión publicada).
-- La venta ya usa el costo de la variante y, si no tiene, el del producto (register_sale, 025).
-- El historial de precios lo escribe el disparador de product_costs (guarda variant_id).
-- =====================================================================

begin;

create or replace function public.set_prices(p_rows jsonb, p_source text default 'masivo')
returns integer language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.op_business();
  r record;
  f text;
  v numeric;
  pid uuid;
  vid uuid;
  n integer;
  changed integer := 0;
begin
  if not public.is_owner(b) then raise exception 'Solo el dueño cambia precios en lote' using errcode = '42501'; end if;
  perform set_config('app.price_source', coalesce(nullif(btrim(p_source), ''), 'masivo'), true);
  for r in select value as x from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '') loop
    f := r.x ->> 'field';
    if f not in ('precio', 'precio_mayorista', 'precio_compra') then raise exception 'Precio no válido'; end if;
    v := case when nullif(r.x ->> 'value', '') is null then null else round((r.x ->> 'value')::numeric, 2) end;
    if v is not null and v < 0 then raise exception 'Un precio no puede ser negativo'; end if;
    pid := (r.x ->> 'product_id')::uuid;
    vid := nullif(r.x ->> 'variant_id', '')::uuid;
    if not exists (select 1 from public.products where id = pid and business_id = b and deleted_at is null) then continue; end if;
    if vid is not null then
      -- Por variante solo el costo (el precio de venta de la variante se guarda en product_variants)
      if f <> 'precio_compra' then raise exception 'Por variante solo se cambia el costo'; end if;
      if not exists (select 1 from public.product_variants where id = vid and product_id = pid) then continue; end if;
      if v is null then
        delete from public.product_costs where variant_id = vid;
      else
        insert into public.product_costs (business_id, product_id, variant_id, cost) values (b, pid, vid, v)
        on conflict (variant_id) where variant_id is not null do update set cost = excluded.cost, updated_at = now()
        where public.product_costs.cost is distinct from excluded.cost;
      end if;
    elsif f = 'precio_compra' then
      if v is null then
        delete from public.product_costs where product_id = pid and variant_id is null;
      else
        insert into public.product_costs (business_id, product_id, cost) values (b, pid, v)
        on conflict (product_id) where variant_id is null do update set cost = excluded.cost, updated_at = now()
        where public.product_costs.cost is distinct from excluded.cost;
      end if;
    else
      update public.products set
        precio = case when f = 'precio' then v else precio end,
        precio_mayorista = case when f = 'precio_mayorista' then v else precio_mayorista end
      where id = pid and (case f when 'precio' then precio else precio_mayorista end) is distinct from v;
    end if;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  return changed;
end $$;

revoke all on function public.set_prices(jsonb, text) from public, anon;
grant execute on function public.set_prices(jsonb, text) to authenticated;

commit;
