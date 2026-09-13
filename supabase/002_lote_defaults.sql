-- =====================================================================
-- InventarIA - Migración 002: captura en lote, valores por defecto, metadatos IA
-- =====================================================================

-- Nombre del negocio (se muestra en el inicio)
alter table public.profiles add column if not exists business_name text;

-- Valor por defecto de un campo (se aplica cuando la IA/usuario lo deja vacío)
alter table public.field_templates add column if not exists default_value text;

-- Metadatos de la IA por producto: categoría sugerida, texto leído en etiqueta, etc.
alter table public.products add column if not exists ai_meta jsonb not null default '{}'::jsonb;

-- Búsqueda rápida sobre los datos del producto
create index if not exists products_data_gin on public.products using gin (data jsonb_path_ops);
