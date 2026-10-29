-- Lock down the public schema so only signed-in users can read data.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Unaffected: the patrons-geojson edge function and the Python scripts use the
-- service role key, which bypasses RLS and grants.

-- 1. Every table in public: RLS on, existing policies replaced by a single
--    read-only policy for signed-in users. spatial_ref_sys is skipped: it
--    belongs to the PostGIS extension and can't be altered (handled in step 2).
do $$
declare
  t record;
  p record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'spatial_ref_sys'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);

    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t.tablename
    loop
      execute format('drop policy %I on public.%I', p.policyname, t.tablename);
    end loop;

    execute format('revoke all on public.%I from anon', t.tablename);
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated',
      t.tablename
    );
    execute format('grant select on public.%I to authenticated', t.tablename);
    execute format(
      'create policy "signed-in users can read" on public.%I for select to authenticated using (true)',
      t.tablename
    );
  end loop;
end $$;

-- 2. Views (incl. PostGIS geometry_columns/geography_columns), sequences and
--    spatial_ref_sys: no anon access. spatial_ref_sys only holds public
--    coordinate-system definitions, but there's no reason to expose it.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on public.spatial_ref_sys from anon, authenticated;

-- 3. Tables created later don't get anon access by default.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 4. Keep-alive endpoint for the Railway cron (keepalive/index.mjs).
--    Hits Postgres without touching any table.
create or replace function public.keepalive()
returns int
language sql
stable
as $$ select 1 $$;

grant execute on function public.keepalive() to anon;

-- Verify (run separately):
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by 1;
-- select grantee, table_name, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2;
