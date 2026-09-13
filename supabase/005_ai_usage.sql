-- =====================================================================
-- InventarIA - Migración 005: registro de consumo de IA (por modelo)
-- =====================================================================
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  model text not null,
  purpose text not null,           -- analyze | setup | classify
  status text not null,            -- ok | quota (cupo diario agotado) | limited (por minuto) | error
  quota_limit int,                 -- límite diario reportado por Google en el 429, si lo hubo
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at desc);
create index if not exists ai_usage_model_idx on public.ai_usage(model, created_at desc);

alter table public.ai_usage enable row level security;
-- Los usuarios ven sus propias filas; el backend (service role) escribe y agrega globalmente.
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage for select using (auth.uid() = user_id);
