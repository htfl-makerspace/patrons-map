-- Move PostGIS out of the public schema into `extensions`.
--
-- PostGIS was installed into public, which put spatial_ref_sys,
-- geometry_columns and geography_columns there. They're owned by
-- supabase_admin, so RLS can't be enabled on them and the Supabase advisor
-- keeps flagging them. PostGIS doesn't support ALTER EXTENSION ... SET SCHEMA,
-- so it's dropped and recreated; the census geometries are carried over as
-- EWKB and restored into the new geometry columns.

-- 1. Stash geometries
alter table public.census_block_groups add column geom_ewkb bytea;
alter table public.census_tracts add column geom_ewkb bytea;
update public.census_block_groups set geom_ewkb = st_asewkb(geom);
update public.census_tracts set geom_ewkb = st_asewkb(geom);

-- 2. Reinstall PostGIS in extensions (drops the geom columns + gist indexes)
drop extension postgis cascade;
create extension postgis with schema extensions;

-- 3. Restore geometries and indexes
alter table public.census_block_groups add column geom extensions.geometry(MultiPolygon, 4326);
alter table public.census_tracts add column geom extensions.geometry(MultiPolygon, 4326);
update public.census_block_groups set geom = extensions.st_geomfromewkb(geom_ewkb);
update public.census_tracts set geom = extensions.st_geomfromewkb(geom_ewkb);
alter table public.census_block_groups drop column geom_ewkb;
alter table public.census_tracts drop column geom_ewkb;
create index idx_bg_geom on public.census_block_groups using gist (geom);
create index idx_tract_geom on public.census_tracts using gist (geom);

-- 4. The GEOID trigger calls ST_Contains/ST_Point unqualified; pin its
--    search_path so it resolves them in extensions regardless of caller.
alter function public.assign_census_geoids() set search_path = public, extensions;
