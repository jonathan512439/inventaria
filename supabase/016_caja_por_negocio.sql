-- InventarIA - Migración 016: un cierre de caja por negocio y día (no por usuario)
alter table public.cash_closings drop constraint if exists cash_closings_user_id_day_key;
create unique index if not exists cash_closings_business_day on public.cash_closings(business_id, day);
