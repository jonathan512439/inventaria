-- =====================================================================
-- InventarIA - Migración 029: unirse con invitación sin crear un negocio propio (Ronda de validación 1 · R1)
-- docs/PLAN_CIMIENTOS.md → «Ronda de validación 1»
--
-- Antes: toda cuenta nueva recibía su «Mi negocio» (disparador de 014). Quien llegaba por un enlace de
-- invitación quedaba dueño de un negocio vacío y vendedor en el negocio que lo invitó (el selector de
-- negocios y las pantallas de dueño lo confundían).
-- Ahora:
--   · El registro manda el código en los metadatos (`invite_code`). Si es válido, el disparador une a la
--     persona a ese negocio con el rol de la invitación y NO crea negocio propio. Si no vale, se crea como antes.
--   · accept_invite (cuenta que ya existía) borra el negocio propio de la persona si está VACÍO
--     (sin productos, ventas, clientes, movimientos ni compras, y sin otros miembros).
--   · Limpieza única: los «Mi negocio» vacíos de personas que ya están en otro negocio (1 al aplicar).
-- =====================================================================

begin;

create or replace function public._business_is_empty(b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.products where business_id = b)
     and not exists (select 1 from public.sales where business_id = b)
     and not exists (select 1 from public.customers where business_id = b)
     and not exists (select 1 from public.stock_movements where business_id = b)
     and not exists (select 1 from public.purchases where business_id = b)
     and (select count(*) from public.business_members where business_id = b) <= 1
$$;

-- Unirse con un código (interno: lo usan accept_invite y el registro)
create or replace function public._join_with_invite(p_user uuid, p_code text, p_display_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invites%rowtype;
begin
  select * into inv from public.invites where code = upper(btrim(p_code)) and used_at is null and expires_at > now() for update;
  if not found then raise exception 'Código no válido o vencido'; end if;
  insert into public.business_members (business_id, user_id, role, display_name)
  values (inv.business_id, p_user, inv.role, coalesce(nullif(btrim(p_display_name), ''), (select split_part(email, '@', 1) from auth.users where id = p_user)))
  on conflict (business_id, user_id) do update set active = true, role = excluded.role;
  update public.invites set used_by = p_user, used_at = now() where id = inv.id;
  update public.profiles set current_business_id = inv.business_id where id = p_user;
  -- El negocio propio que se creó solo y quedó vacío ya no sirve: se quita para no confundir
  delete from public.businesses b
  where b.owner_id = p_user and b.id <> inv.business_id and public._business_is_empty(b.id);
  return inv.business_id;
end $$;

create or replace function public.accept_invite(p_code text, p_display_name text default null) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión para unirte' using errcode = '42501'; end if;
  return public._join_with_invite(auth.uid(), p_code, p_display_name);
end $$;

-- Cuenta nueva: con código válido se une a ese negocio; sin código (o si no vale), su propio «Mi negocio»
create or replace function public.handle_new_user_business() returns trigger language plpgsql security definer set search_path = public as $$
declare
  bid uuid;
  code text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')), '');
begin
  if code is not null then
    begin
      perform public._join_with_invite(new.id, code, null);
      return new;
    exception when others then
      null; -- código vencido o usado: sigue como una cuenta normal
    end;
  end if;
  insert into public.businesses (name, owner_id) values ('Mi negocio', new.id) returning id into bid;
  insert into public.business_members (business_id, user_id, role, display_name) values (bid, new.id, 'dueno', split_part(new.email, '@', 1));
  return new;
end $$;

-- Limpieza única (ver encabezado)
delete from public.businesses b
where b.name = 'Mi negocio'
  and public._business_is_empty(b.id)
  and exists (select 1 from public.business_members m where m.user_id = b.owner_id and m.business_id <> b.id and m.active);

revoke all on function public._business_is_empty(uuid) from public, anon, authenticated;
revoke all on function public._join_with_invite(uuid, text, text) from public, anon, authenticated;
revoke all on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;

commit;
