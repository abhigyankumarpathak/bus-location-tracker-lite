-- Bus Tracker (lite) — the SHARED-PROJECT schema.
--
-- Run this INSTEAD of schema.sql when you want lite to live in the same Supabase
-- project as the full app, so its existing accounts and test data are already
-- there and you can sign in with the same logins.
--
-- ===========================================================================
-- How the two apps share one project
-- ===========================================================================
--
-- Four tables are SHARED — lite reuses the full app's, untouched:
--
--     organization      profiles      invites      guardian_links
--
-- That is what makes the same logins work in both apps. A profile is a profile;
-- an invite is an invite. Lite reads the three roles it understands and treats
-- `driver` and `coordinator` as "no access here", which is correct — those
-- people have the full app.
--
-- Seven tables are OWNED by lite and created below. None of their names collide
-- with anything in the full app:
--
--     buses   bus_devices   stops   bus_stops   student_stops
--     bus_locations   alerts_sent
--
-- Nothing here alters, drops or writes to a full-app table. The full app cannot
-- tell this ran. Deleting every table below leaves it exactly as it was.
--
-- ===========================================================================
-- Two things to know before running it
-- ===========================================================================
--
-- 1. The full app's `user_role` enum has five values; lite understands three.
--    Lite does NOT create its own enum here — it reuses the full app's, so a
--    profile row means the same thing to both. An admin in one is an admin in
--    the other.
--
-- 2. This is for DEVELOPMENT. When you publish lite for real, give it its own
--    project and run `schema.sql`, which is standalone and owns all eleven
--    tables. Sharing a project means a schema change in one app can surprise the
--    other, which is fine while testing and not fine in production.
--
-- Run `import-from-full.sql` afterwards to copy the full app's vehicles, hubs,
-- route stops and rider assignments into lite's tables, so there is something
-- to look at immediately.
-- ===========================================================================

-- Refuse to run in the wrong place, rather than half-creating things.
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception
      'This is the SHARED-project schema and expects the full app''s tables to exist. Either run the full app''s schema.sql first, or use lite''s own schema.sql for a standalone project.';
  end if;
  if to_regclass('public.buses') is not null then
    raise notice 'Lite tables already exist — this will drop and recreate them.';
  end if;
end
$$;

drop table if exists
  alerts_sent, bus_locations, student_stops, bus_stops, stops,
  bus_devices, buses cascade;

-- ---------------------------------------------------------------------------
-- The seven tables lite owns. Identical to schema.sql, minus the four shared
-- ones and the signup trigger, which the full app already installs.
-- ---------------------------------------------------------------------------

create table buses (
  id     uuid primary key default gen_random_uuid(),
  label  text not null,
  plate  text,
  active boolean not null default true
);

-- The tracker's credential in its own table: RLS is row-level, not
-- column-level, and every signed-in student can read the bus list.
create table bus_devices (
  bus_id     uuid primary key references buses on delete cascade,
  device_key text unique not null default encode(gen_random_bytes(24), 'hex'),
  rotated_at timestamptz not null default now()
);

create or replace function add_bus_device() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into bus_devices (bus_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_bus_created after insert on buses
  for each row execute function add_bus_device();

create table stops (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  address text,
  lat     double precision not null,
  lng     double precision not null,
  active  boolean not null default true
);

create table bus_stops (
  id       uuid primary key default gen_random_uuid(),
  bus_id   uuid not null references buses on delete cascade,
  stop_id  uuid not null references stops on delete cascade,
  position int not null,
  unique (bus_id, stop_id),
  unique (bus_id, position) deferrable initially deferred
);
create index bus_stops_order_idx on bus_stops (bus_id, position);

create table student_stops (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles on delete cascade,
  bus_id     uuid not null references buses on delete cascade,
  stop_id    uuid not null references stops on delete cascade,
  uses_it    boolean not null default true,
  unique (student_id, bus_id, stop_id)
);
create index student_stops_student_idx on student_stops (student_id);

create table bus_locations (
  id          bigserial primary key,
  bus_id      uuid not null references buses on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  heading     double precision,
  speed       double precision,
  recorded_at timestamptz not null default now()
);
create index bus_locations_recent_idx on bus_locations (bus_id, recorded_at desc);

create table alerts_sent (
  id        uuid primary key default gen_random_uuid(),
  bus_id    uuid not null references buses on delete cascade,
  stop_id   uuid not null references stops on delete cascade,
  milestone text not null,
  sent_at   timestamptz not null default now(),
  unique (bus_id, stop_id, milestone)
);

-- ---------------------------------------------------------------------------
-- Helpers.
--
-- `my_role()`, `is_active()`, `is_admin()` and `is_guardian_of()` ALREADY EXIST
-- in the full app's schema with the same names and the same meanings, so they
-- are not recreated here — replacing them would edit the full app's behaviour,
-- which this file must never do.
--
-- Only `my_bus_ids()` is new, because only lite has buses.
-- ---------------------------------------------------------------------------

create or replace function my_bus_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct ss.bus_id
  from student_stops ss
  where ss.uses_it
    and (ss.student_id = auth.uid() or is_guardian_of(ss.student_id));
$$;

-- ---------------------------------------------------------------------------
-- Admin configuration.
--
-- Identical to schema.sql. Both names are new — the full app has neither — so
-- these add to the shared project rather than replacing anything in it.
-- ---------------------------------------------------------------------------

/**
 * Replace a bus's ordered run, in one transaction.
 *
 * `unique (bus_id, position)` is DEFERRABLE INITIALLY DEFERRED, and deferral
 * only reaches to the end of a TRANSACTION — while every PostgREST call is its
 * own. So "move this stop up" from the client is two updates in two
 * transactions, and the first one collides on a position the second was about
 * to vacate. The whole ordered list arrives here instead and is renumbered 1..n
 * together.
 *
 * Returns how many student assignments it dropped. A stop that is no longer on
 * the run cannot have anyone assigned to it on this bus, and leaving those rows
 * would promise a family a stop the bus never reaches.
 */
create or replace function set_bus_run(target_bus uuid, ordered_stops uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  keep uuid[] := coalesce(ordered_stops, '{}'::uuid[]);
  dropped int;
begin
  if not is_admin() then
    raise exception 'Only an administrator can change a run.';
  end if;

  if (select count(distinct s) from unnest(keep) s) <> coalesce(array_length(keep, 1), 0) then
    raise exception 'A stop can appear only once on a run.';
  end if;

  delete from student_stops
   where bus_id = target_bus and not (stop_id = any (keep));
  get diagnostics dropped = row_count;

  delete from bus_stops
   where bus_id = target_bus and not (stop_id = any (keep));

  insert into bus_stops (bus_id, stop_id, position)
  select target_bus, s.stop_id, s.ord::int
    from unnest(keep) with ordinality as s(stop_id, ord)
      on conflict (bus_id, stop_id) do update set position = excluded.position;

  return dropped;
end;
$$;

grant execute on function set_bus_run(uuid, uuid[]) to authenticated;

/**
 * Issue a bus's tracker a fresh key, invalidating the old one. Generated in the
 * database because a device_key is a password, and the client has no business
 * choosing one.
 */
create or replace function rotate_device_key(target_bus uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  fresh text := encode(gen_random_bytes(24), 'hex');
begin
  if not is_admin() then
    raise exception 'Only an administrator can rotate a tracker key.';
  end if;

  insert into bus_devices (bus_id, device_key, rotated_at)
  values (target_bus, fresh, now())
      on conflict (bus_id) do update set device_key = fresh, rotated_at = now();

  return fresh;
end;
$$;

grant execute on function rotate_device_key(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS on lite's tables only. The full app's policies are untouched.
--
-- Note `is_admin()` here is the FULL app's version, which is true for its
-- `admin` role. A full-app coordinator is deliberately NOT an admin in lite:
-- they get read access like any signed-in user and cannot configure anything.
-- ---------------------------------------------------------------------------

alter table buses         enable row level security;
alter table bus_devices   enable row level security;
alter table stops         enable row level security;
alter table bus_stops     enable row level security;
alter table student_stops enable row level security;
alter table bus_locations enable row level security;
alter table alerts_sent   enable row level security;

create policy "read buses" on buses for select using (is_active());
create policy "admins write buses" on buses for all
  using (is_admin()) with check (is_admin());

create policy "read stops" on stops for select using (is_active());
create policy "admins write stops" on stops for all
  using (is_admin()) with check (is_admin());

create policy "read bus stops" on bus_stops for select using (is_active());
create policy "admins write bus stops" on bus_stops for all
  using (is_admin()) with check (is_admin());

create policy "admins read device keys" on bus_devices for select using (is_admin());
create policy "admins rotate device keys" on bus_devices for update
  using (is_admin()) with check (is_admin());

create policy "read own assignment" on student_stops for select using (
  is_active() and (student_id = auth.uid() or is_guardian_of(student_id))
);
create policy "admins write assignments" on student_stops for all
  using (is_admin()) with check (is_admin());

create policy "watch my bus" on bus_locations for select using (
  is_admin() or (is_active() and bus_id in (select my_bus_ids()))
);

create policy "admins read alerts sent" on alerts_sent for select using (is_admin());

alter publication supabase_realtime add table bus_locations;
