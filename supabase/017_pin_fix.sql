-- InventarIA - Migración 017: pgcrypto vive en el esquema extensions; un miembro solo puede cambiar su nombre y su PIN
create or replace function public.verify_pin(p_business uuid, p_user uuid, p_pin text) returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.business_members%rowtype;
begin
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = auth.uid() and active) then return false; end if;
  select * into m from public.business_members where business_id = p_business and user_id = p_user and active;
  if not found or m.pin_hash is null then return false; end if;
  if m.pin_locked_until is not null and m.pin_locked_until > now() then return false; end if;
  if m.pin_hash = encode(extensions.digest(p_pin || p_user::text, 'sha256'), 'hex') then
    update public.business_members set pin_failed = 0, pin_locked_until = null where business_id = p_business and user_id = p_user;
    return true;
  end if;
  update public.business_members
    set pin_failed = pin_failed + 1,
        pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '10 minutes' else null end
    where business_id = p_business and user_id = p_user;
  return false;
end $$;

create or replace function public.set_pin(p_business uuid, p_pin text) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'El PIN debe tener 4 números'; end if;
  update public.business_members set pin_hash = encode(extensions.digest(p_pin || auth.uid()::text, 'sha256'), 'hex'), pin_failed = 0, pin_locked_until = null
    where business_id = p_business and user_id = auth.uid();
end $$;

create or replace function public.set_my_name(p_business uuid, p_name text) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.business_members set display_name = nullif(btrim(p_name), '') where business_id = p_business and user_id = auth.uid();
end $$;

-- Un miembro no puede tocar su propia fila directamente (rol, activo): solo por las funciones de arriba
drop policy if exists "members_self_update" on public.business_members;
