-- =====================================================================
-- InventarIA - Migración 014: el negocio como unidad de datos (Plan v3 · Fase 6)
-- Varias personas por negocio, con rol (dueño / vendedor). Cada cuenta existente pasa a ser un negocio
-- propio sin que nada cambie para el usuario. Las filas conservan user_id = quién las creó (firma).
-- =====================================================================

create extension if not exists pgcrypto;

-- 1) Negocios y miembros -------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mi negocio',
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'gratis',
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'vendedor' check (role in ('dueno', 'vendedor')),
  display_name text,
  pin_hash text,                       -- sha256(pin + user_id), para cambiar de persona en el mismo celular
  pin_failed integer not null default 0,
  pin_locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index if not exists business_members_user on public.business_members(user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null unique,
  role text not null default 'vendedor' check (role in ('dueno', 'vendedor')),
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- El negocio activo de cada usuario (si pertenece a varios)
alter table public.profiles add column if not exists current_business_id uuid references public.businesses(id) on delete set null;

-- 2) Funciones de pertenencia (security definer: no dependen de RLS de las tablas que consultan)
create or replace function public.my_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select business_id from public.business_members where user_id = auth.uid() and active
$$;

create or replace function public.current_business_id() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.current_business_id from public.profiles p
       where p.id = auth.uid()
         and exists (select 1 from public.business_members m where m.business_id = p.current_business_id and m.user_id = auth.uid() and m.active)),
    (select m.business_id from public.business_members m where m.user_id = auth.uid() and m.active order by m.created_at limit 1)
  )
$$;

create or replace function public.my_role(bid uuid) returns text language sql stable security definer set search_path = public as $$
  select role from public.business_members where business_id = bid and user_id = auth.uid() and active
$$;

-- Al insertar sin business_id, se rellena con el negocio activo del usuario (la app no tiene que enviarlo en cada alta)
create or replace function public.set_business_id() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is null then
    new.business_id := public.current_business_id();
  end if;
  return new;
end $$;

-- 3) business_id en todas las tablas de datos + relleno: un negocio por usuario existente ---------
do $$
declare
  t text;
  tables text[] := array[
    'categories','field_templates','products','product_variants','variant_axes','stock_movements',
    'suppliers','purchases','purchase_items','stock_counts','stock_count_items','price_history',
    'sales','sale_items','cash_movements','cash_closings','customers','payments','consignments','consignment_items'
  ];
  u record;
begin
  -- Un negocio por cada usuario que tenga datos o perfil
  for u in
    select distinct id as user_id from auth.users
  loop
    if not exists (select 1 from public.businesses where owner_id = u.user_id) then
      insert into public.businesses (name, owner_id)
      values (coalesce((select business_name from public.profiles where id = u.user_id), 'Mi negocio'), u.user_id);
    end if;
    insert into public.business_members (business_id, user_id, role, display_name)
    select b.id, u.user_id, 'dueno', (select split_part(email, '@', 1) from auth.users where id = u.user_id)
    from public.businesses b where b.owner_id = u.user_id
    on conflict do nothing;
  end loop;

  foreach t in array tables loop
    execute format('alter table public.%I add column if not exists business_id uuid references public.businesses(id) on delete cascade', t);
    execute format('update public.%I x set business_id = b.id from public.businesses b where x.business_id is null and b.owner_id = x.user_id', t);
    execute format('create index if not exists %I on public.%I(business_id)', t || '_business', t);
    execute format('drop trigger if exists %I on public.%I', t || '_set_business', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.set_business_id()', t || '_set_business', t);
  end loop;
end $$;

-- 4) RLS por negocio (sustituye a las políticas por usuario) --------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'categories','field_templates','products','product_variants','variant_axes','stock_movements',
    'suppliers','purchases','purchase_items','stock_counts','stock_count_items','price_history',
    'sales','sale_items','cash_movements','cash_closings','customers','payments','consignments','consignment_items'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "%s_all_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_business" on public.%I', t, t);
    execute format(
      'create policy "%s_business" on public.%I for all using (business_id in (select public.my_business_ids())) with check (business_id in (select public.my_business_ids()) or business_id is null)',
      t, t);
  end loop;
end $$;

-- Negocios, miembros e invitaciones
alter table public.businesses enable row level security;
drop policy if exists "businesses_member_read" on public.businesses;
create policy "businesses_member_read" on public.businesses for select using (id in (select public.my_business_ids()));
drop policy if exists "businesses_owner_update" on public.businesses;
create policy "businesses_owner_update" on public.businesses for update using (public.my_role(id) = 'dueno');

alter table public.business_members enable row level security;
drop policy if exists "members_read" on public.business_members;
create policy "members_read" on public.business_members for select using (business_id in (select public.my_business_ids()));
drop policy if exists "members_owner_write" on public.business_members;
create policy "members_owner_write" on public.business_members for all using (public.my_role(business_id) = 'dueno') with check (public.my_role(business_id) = 'dueno');
drop policy if exists "members_self_update" on public.business_members;
create policy "members_self_update" on public.business_members for update using (user_id = auth.uid());

alter table public.invites enable row level security;
drop policy if exists "invites_owner" on public.invites;
create policy "invites_owner" on public.invites for all using (public.my_role(business_id) = 'dueno') with check (public.my_role(business_id) = 'dueno');

-- 5) Correlativo de venta por negocio ---------------------------------------------------------
create or replace function public.sales_number() returns trigger language plpgsql as $$
begin
  if new.business_id is null then new.business_id := public.current_business_id(); end if;
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.sales where business_id = new.business_id;
  end if;
  return new;
end $$;

-- 6) Aceptar invitación (security definer: el invitado aún no es miembro) ----------------------
create or replace function public.accept_invite(p_code text, p_display_name text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invites%rowtype;
begin
  select * into inv from public.invites where code = upper(btrim(p_code)) and used_at is null and expires_at > now();
  if not found then raise exception 'Código no válido o vencido'; end if;
  insert into public.business_members (business_id, user_id, role, display_name)
  values (inv.business_id, auth.uid(), inv.role, coalesce(p_display_name, (select split_part(email, '@', 1) from auth.users where id = auth.uid())))
  on conflict (business_id, user_id) do update set active = true, role = excluded.role;
  update public.invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  update public.profiles set current_business_id = inv.business_id where id = auth.uid();
  return inv.business_id;
end $$;

-- 7) PIN: verificar sin exponer el hash ----------------------------------------------------------
create or replace function public.verify_pin(p_business uuid, p_user uuid, p_pin text) returns boolean language plpgsql security definer set search_path = public as $$
declare
  m public.business_members%rowtype;
begin
  -- Solo alguien del mismo negocio puede intentar
  if not exists (select 1 from public.business_members where business_id = p_business and user_id = auth.uid() and active) then return false; end if;
  select * into m from public.business_members where business_id = p_business and user_id = p_user and active;
  if not found or m.pin_hash is null then return false; end if;
  if m.pin_locked_until is not null and m.pin_locked_until > now() then return false; end if;
  if m.pin_hash = encode(digest(p_pin || p_user::text, 'sha256'), 'hex') then
    update public.business_members set pin_failed = 0, pin_locked_until = null where business_id = p_business and user_id = p_user;
    return true;
  end if;
  update public.business_members
    set pin_failed = pin_failed + 1,
        pin_locked_until = case when pin_failed + 1 >= 5 then now() + interval '10 minutes' else null end
    where business_id = p_business and user_id = p_user;
  return false;
end $$;

create or replace function public.set_pin(p_business uuid, p_pin text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_pin !~ '^[0-9]{4}$' then raise exception 'El PIN debe tener 4 números'; end if;
  update public.business_members set pin_hash = encode(digest(p_pin || auth.uid()::text, 'sha256'), 'hex'), pin_failed = 0, pin_locked_until = null
    where business_id = p_business and user_id = auth.uid();
end $$;

-- Usuarios nuevos: negocio propio al registrarse
create or replace function public.handle_new_user_business() returns trigger language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  insert into public.businesses (name, owner_id) values ('Mi negocio', new.id) returning id into bid;
  insert into public.business_members (business_id, user_id, role, display_name) values (bid, new.id, 'dueno', split_part(new.email, '@', 1));
  return new;
end $$;
drop trigger if exists on_auth_user_created_business on auth.users;
create trigger on_auth_user_created_business after insert on auth.users for each row execute function public.handle_new_user_business();

-- 8) Vista ligera: agrega business_id y quita el costo para vendedores ----------------------------
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
  public.jkey(p.data, 'nombre', 'name', 'producto', 'titulo') as nombre,
  public.jkey(p.data, 'marca', 'brand') as marca,
  public.safe_num(public.jkey(p.data, 'precio', 'precio_venta', 'price')) as precio,
  case when public.my_role(p.business_id) = 'dueno' then public.safe_num(public.jkey(p.data, 'precio_compra', 'costo', 'cost')) else null end as precio_compra,
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

-- 9) Storage: las fotos siguen en la carpeta del usuario que las subió; lectura pública ya existía.
--    Miembros del mismo negocio pueden borrar/actualizar fotos de sus compañeros.
drop policy if exists "product_images_update_own" on storage.objects;
create policy "product_images_update_own" on storage.objects for update
  using (bucket_id = 'product-images' and (split_part(name, '/', 1))::uuid in (select user_id from public.business_members where business_id in (select public.my_business_ids())));
drop policy if exists "product_images_delete_own" on storage.objects;
create policy "product_images_delete_own" on storage.objects for delete
  using (bucket_id = 'product-images' and (split_part(name, '/', 1))::uuid in (select user_id from public.business_members where business_id in (select public.my_business_ids())));
