-- ===========================================================================
-- Just enough Supabase to run `rls-test.sql` against a plain PostgreSQL.
--
-- The RLS test is the only way to know whether the policies hold, and it must
-- not be run against anything real — it truncates `auth.users`. Pointing it at a
-- throwaway Supabase project works but needs a project; this makes a local
-- postgres do instead.
--
--     createdb -p 55432 lite_test
--     psql -p 55432 -d lite_test -f supabase/local-shim.sql
--     psql -p 55432 -d lite_test -f supabase/schema.sql
--     psql -p 55432 -d lite_test -f supabase/rls-test.sql
--
-- What it fakes, and nothing more:
--   * the three roles PostgREST connects as
--   * `auth.users`, and `auth.uid()` reading the JWT claim from a GUC — which
--     is how Supabase does it, and why the test can impersonate with
--     set_config('request.jwt.claim.sub', ...)
--   * the default privileges that make `set role authenticated` behave like a
--     real client: RLS sits on TOP of GRANTs, so without these every query
--     fails for the wrong reason and the test reads as passing.
--
-- It is NOT a Supabase emulator. No GoTrue, no PostgREST, no Realtime — the
-- publication below exists only so schema.sql's last line has something to add
-- a table to.
-- ===========================================================================

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Applies to everything schema.sql is about to create. Supabase sets these up
-- the same way, which is why a real project needs no per-table grants.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

/**
 * Who is calling. Supabase reads the `sub` claim out of the request's JWT and
 * exposes it as a GUC; the test sets that GUC directly, which is what lets it
 * run as five different people without five sessions.
 */
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- schema.sql's final line adds bus_locations to this.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
