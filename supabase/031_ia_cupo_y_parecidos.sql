-- =====================================================================
-- InventarIA - Migración 031: cupo de IA compartido y productos parecidos en SQL (P4 · AUDITORIA E5 y E6)
-- docs/PLAN_CIMIENTOS.md → «Pendientes antes de C6» · P4
--
-- ai_quota_state     → qué modelo de Gemini agotó su cupo diario (o se colgó) y hasta cuándo, por clave
--                      («service» o el id de quien usa su propia clave). Antes vivía en la memoria de cada
--                      servidor de Cloudflare: los demás no se enteraban y volvían a probar un modelo agotado.
--                      Solo la usa el servidor (service role): sin políticas, nadie más la lee ni la escribe.
-- similar_products() → candidatos a «posible duplicado» al agregar por foto: mismo código o nombre parecido
--                      (pg_trgm, 020), solo del negocio activo y como quien llama (respeta RLS). Antes se
--                      descargaban hasta 2.000 productos por foto para compararlos en el servidor.
--                      La decisión final (marca o tamaño distintos = otro producto) sigue en lib/duplicates.ts.
-- =====================================================================

begin;

create table if not exists public.ai_quota_state (
  key_id text not null,
  model text not null,
  exhausted_until timestamptz,
  slow_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (key_id, model)
);
alter table public.ai_quota_state enable row level security;
revoke all on public.ai_quota_state from anon, authenticated;

create or replace function public.similar_products(p_name text, p_code text default null, p_exclude uuid default null, p_limit integer default 8)
returns table (id uuid, nombre text, marca text, codigo_barras text, status text, sim real, wsim real)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select lower(btrim(coalesce(p_name, ''))) as n, upper(btrim(coalesce(p_code, ''))) as c)
  select p.id, p.nombre, p.marca, p.codigo_barras, p.status::text,
         similarity(lower(coalesce(p.nombre, '')), q.n) as sim,
         word_similarity(q.n, lower(coalesce(p.nombre, ''))) as wsim
  from public.products p, q
  where p.business_id = public.current_business_id()
    and p.deleted_at is null
    and (p_exclude is null or p.id <> p_exclude)
    and (
      (length(q.c) >= 6 and upper(btrim(coalesce(p.codigo_barras, ''))) = q.c)
      or (length(q.n) >= 3 and (p.search % q.n or q.n <% p.search))
    )
  order by (length(q.c) >= 6 and upper(btrim(coalesce(p.codigo_barras, ''))) = q.c) desc,
           greatest(similarity(lower(coalesce(p.nombre, '')), q.n), word_similarity(q.n, lower(coalesce(p.nombre, '')))) desc,
           (p.status = 'confirmed') desc
  limit greatest(1, least(coalesce(p_limit, 8), 25))
$$;

revoke all on function public.similar_products(text, text, uuid, integer) from public, anon;
grant execute on function public.similar_products(text, text, uuid, integer) to authenticated;

commit;
