-- =====================================================================
-- 019 · Respaldos: bucket privado `backups` con un archivo .xlsx por negocio y fecha.
-- Ruta: {business_id}/{YYYY-MM-DD}-{auto|manual}.xlsx
-- Los miembros del negocio pueden ver y descargar; solo el dueño puede subir o borrar.
-- El respaldo semanal lo sube GitHub Actions con la clave de servicio (scripts/backup.mts).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "backups_select_members" on storage.objects;
create policy "backups_select_members" on storage.objects for select
  using (bucket_id = 'backups' and (split_part(name, '/', 1))::uuid in (select public.my_business_ids()));

drop policy if exists "backups_insert_owner" on storage.objects;
create policy "backups_insert_owner" on storage.objects for insert
  with check (bucket_id = 'backups' and public.my_role((split_part(name, '/', 1))::uuid) = 'dueno');

drop policy if exists "backups_update_owner" on storage.objects;
create policy "backups_update_owner" on storage.objects for update
  using (bucket_id = 'backups' and public.my_role((split_part(name, '/', 1))::uuid) = 'dueno');

drop policy if exists "backups_delete_owner" on storage.objects;
create policy "backups_delete_owner" on storage.objects for delete
  using (bucket_id = 'backups' and public.my_role((split_part(name, '/', 1))::uuid) = 'dueno');
