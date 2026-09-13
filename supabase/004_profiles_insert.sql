-- Permite upsert del propio perfil (el trigger lo crea, pero upsert necesita política de INSERT)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
