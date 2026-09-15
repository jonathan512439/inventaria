-- =====================================================================
-- InventarIA - Migración 009: clave de IA propia (BYOK) y consumo por clave
-- =====================================================================

-- La clave se guarda cifrada (AES-GCM) con un secreto del servidor; solo el service role lee esta tabla.
create table if not exists public.ai_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'gemini',
  key_ciphertext text not null,
  iv text not null,
  last4 text not null,
  created_at timestamptz not null default now()
);
alter table public.ai_keys enable row level security;
-- Sin políticas: ningún cliente (anon/authenticated) puede leer ni escribir; solo el servidor con service role.

-- Consumo hecho con clave propia (no cuenta contra el cupo del servicio)
alter table public.ai_usage add column if not exists own_key boolean not null default false;
create index if not exists ai_usage_own_key_fecha on public.ai_usage(own_key, created_at desc);
