-- =====================================================================
-- InventarIA - Migración 015: firma de quién hace cada cosa (Fase 6)
-- Tras el PIN, el celular envía la cabecera x-actor con el usuario que atiende; la base firma
-- las filas con él (solo si es miembro activo del mismo negocio). Si no hay cabecera, firma auth.uid().
-- =====================================================================

create or replace function public.request_actor() returns uuid language plpgsql stable as $$
declare h text;
begin
  h := current_setting('request.headers', true)::json->>'x-actor';
  if h is null or h = '' then return null; end if;
  return h::uuid;
exception when others then
  return null;
end $$;

create or replace function public.set_actor() returns trigger language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  a := public.request_actor();
  if a is not null and new.business_id is not null
     and exists (select 1 from public.business_members where business_id = new.business_id and user_id = a and active)
     and exists (select 1 from public.business_members where business_id = new.business_id and user_id = auth.uid() and active) then
    new.user_id := a;
  end if;
  return new;
end $$;

do $$
declare
  t text;
  tables text[] := array['products','stock_movements','sales','sale_items','payments','stock_counts','stock_count_items','purchases','purchase_items','cash_movements','cash_closings','consignments','consignment_items','price_history'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_actor', t);
    -- después de set_business (orden alfabético de disparadores: "set_actor" < "set_business"; forzamos con nombre z_)
    execute format('create trigger %I before insert on public.%I for each row execute function public.set_actor()', 'z_' || t || '_set_actor', t);
  end loop;
end $$;

-- Nombre visible de quien firmó (para listas): se resuelve con esta vista ligera
create or replace view public.member_names with (security_invoker = true) as
select m.business_id, m.user_id, coalesce(m.display_name, 'Miembro') as name, m.role, m.active
from public.business_members m;
grant select on public.member_names to authenticated;
