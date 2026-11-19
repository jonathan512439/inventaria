-- =====================================================================
-- InventarIA - Migración 030: logo del negocio y modo de uso (Ronda de validación 1 · R9 y R10)
-- docs/PLAN_CIMIENTOS.md → «Ronda de validación 1» · docs/RECONSTRUCCION_VISUAL.md §8
--
--   businesses.logo_url  → dirección pública del logo (bucket `business-logos`, <negocio>/logo-<n>.webp).
--                          Un logo no es un dato sensible: el bucket es PÚBLICO (sale en el ticket impreso
--                          y en la cabecera sin firmar enlaces). Solo el dueño sube, cambia o borra.
--   businesses.mode      → 'completo' (inventario y ventas, el de siempre) o 'inventario' (solo control de
--                          productos: sin ventas, caja ni clientes). Es una preferencia de PANTALLA, no de
--                          seguridad: la base no cambia permisos por modo. Cambiarlo no borra nada.
--   session_context()    → devuelve también logo_url y mode.
-- Compatible con la versión publicada (solo agrega columnas y campos).
-- =====================================================================

begin;

alter table public.businesses add column if not exists logo_url text;
alter table public.businesses add column if not exists mode text not null default 'completo';
alter table public.businesses drop constraint if exists businesses_mode_check;
alter table public.businesses add constraint businesses_mode_check check (mode in ('completo', 'inventario'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 524288, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "logos_owner_insert" on storage.objects;
create policy "logos_owner_insert" on storage.objects for insert
  with check (bucket_id = 'business-logos' and public.is_owner((split_part(name, '/', 1))::uuid));
drop policy if exists "logos_owner_update" on storage.objects;
create policy "logos_owner_update" on storage.objects for update
  using (bucket_id = 'business-logos' and public.is_owner((split_part(name, '/', 1))::uuid));
drop policy if exists "logos_owner_delete" on storage.objects;
create policy "logos_owner_delete" on storage.objects for delete
  using (bucket_id = 'business-logos' and public.is_owner((split_part(name, '/', 1))::uuid));
-- Para listar y reemplazar el archivo propio (la lectura pública no necesita política)
drop policy if exists "logos_owner_select" on storage.objects;
create policy "logos_owner_select" on storage.objects for select
  using (bucket_id = 'business-logos' and public.is_owner((split_part(name, '/', 1))::uuid));

create or replace function public.session_context() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b uuid;
begin
  if uid is null then return null; end if;
  b := public.current_business_id();
  if b is null then
    return jsonb_build_object('me', uid, 'business', null, 'role', null, 'acting_role', null, 'actor', uid, 'members', '[]'::jsonb, 'businesses', 0);
  end if;
  return jsonb_build_object(
    'me', uid,
    'business', (select to_jsonb(x) from (select id, name, owner_id, plan, timezone, currency, min_stock_default, expiry_days, logo_url, mode, created_at from public.businesses where id = b) x),
    'role', public.my_role(b),
    'actor', public.current_actor(),
    'acting_role', public.acting_role(b),
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at)
                           from (select business_id, user_id, role, display_name, active, has_pin, created_at from public.business_members where business_id = b) m), '[]'::jsonb),
    'businesses', (select count(*) from public.business_members where user_id = uid and active),
    'today', public.business_day(b),
    'counts', jsonb_build_object(
      'pending', (select count(*) from public.products where business_id = b and status = 'draft' and deleted_at is null),
      'confirmed', (select count(*) from public.products where business_id = b and status = 'confirmed' and deleted_at is null))
  );
end $$;

commit;
