-- InventarIA - Migración 018: el hash del PIN no viaja al cliente (tabla aparte sin políticas; solo funciones)
create table if not exists public.member_pins (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null,
  pin_failed integer not null default 0,
  pin_locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
alter table public.member_pins enable row level security; -- sin políticas: nadie lo lee desde el cliente

insert into public.member_pins (business_id, user_id, pin_hash, pin_failed, pin_locked_until)
select business_id, user_id, pin_hash, pin_failed, pin_locked_until from public.business_members where pin_hash is not null
on conflict do nothing;

alter table public.business_members add column if not exists has_pin boolean not null default false;
update public.business_members set has_pin = (pin_hash is not null);
alter table public.business_members drop column if exists pin_hash;
alter table public.business_members drop column if exists pin_failed;
alter table public.business_members drop column if exists pin_locked_until;

create or replace function public.verify_pin(p_business uuid, p_user uuid, p_pin text) returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.member_pins%rowtype;
begin
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = auth.uid() and active) then return false; end if;
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = p_user and active) then return false; end if;
  select * into m from public.member_pins where business_id = p_business and user_id = p_user;
  if not found then return false; end if;
  if m.pin_locked_until is not null and m.pin_locked_until > now() then return false; end if;
  if m.pin_hash = encode(extensions.digest(p_pin || p_user::text, 'sha256'), 'hex') then
    update public.member_pins set pin_failed = 0, pin_locked_until = null where business_id = p_business and user_id = p_user;
    return true;
  end if;
  update public.member_pins
    set pin_failed = pin_failed + 1,
        pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '10 minutes' else null end
    where business_id = p_business and user_id = p_user;
  return false;
end $$;

create or replace function public.set_pin(p_business uuid, p_pin text) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'El PIN debe tener 4 números'; end if;
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = auth.uid() and active) then raise exception 'No eres miembro de este negocio'; end if;
  insert into public.member_pins (business_id, user_id, pin_hash)
  values (p_business, auth.uid(), encode(extensions.digest(p_pin || auth.uid()::text, 'sha256'), 'hex'))
  on conflict (business_id, user_id) do update set pin_hash = excluded.pin_hash, pin_failed = 0, pin_locked_until = null, updated_at = now();
  update public.business_members set has_pin = true where business_id = p_business and user_id = auth.uid();
end $$;

create or replace view public.member_names with (security_invoker = true) as
select m.business_id, m.user_id, coalesce(m.display_name, 'Miembro') as name, m.role, m.active
from public.business_members m;
