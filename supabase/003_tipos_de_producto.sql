-- =====================================================================
-- InventarIA - Migración 003: tipos de producto y asistente inicial
-- =====================================================================

-- Emoji/icono del tipo de producto (categoría de nivel superior)
alter table public.categories add column if not exists icon text;

-- Cuándo completó (o saltó) el asistente inicial
alter table public.profiles add column if not exists onboarded_at timestamptz;
