-- =====================================================================
-- InventarIA - Migración 026: fotos de productos privadas (Fase 6.9 · C5.3)
-- docs/PLAN_CIMIENTOS.md → C5 · docs/AUDITORIA.md → Auditoría 2 (S12, brecha A3)
--
-- Antes el bucket `product-images` era público: cualquiera con la dirección veía la foto.
-- Ahora es privado: la app pide enlaces firmados (1 h, lib/photos.ts) y solo se firman fotos de carpetas
-- de personas del NEGOCIO ACTIVO de quien las pide. `products.image_url` no cambia (sirve para ubicar la foto).
-- Aplicar DESPUÉS de publicar el código que usa enlaces firmados (con el bucket público también funciona).
-- =====================================================================

begin;

update storage.buckets set public = false where id = 'product-images';

drop policy if exists "product_images_public_read" on storage.objects;
drop policy if exists "product_images_member_read" on storage.objects;
create policy "product_images_member_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'product-images'
    and (split_part(name, '/', 1)) in (
      select m.user_id::text from public.business_members m
      where m.business_id = (select public.current_business_id())
    )
  );

commit;
