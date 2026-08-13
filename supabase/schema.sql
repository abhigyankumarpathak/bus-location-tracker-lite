-- Bus Tracker (lite) — schema, RLS, triggers.
--
-- The STANDALONE schema: everything this app needs, in a project of its own.
-- Use this when publishing.
--
-- To develop against the FULL app's existing project instead — so its test
-- accounts and data are already there — run `schema-shared.sql` rather than this
-- file. That one creates only the tables lite OWNS and reuses the four the full
-- app already has (organization, profiles, invites, guardian_links), which is
-- what makes the same logins work in both apps. See supabase/SETUP.md.
--
-- Run once in the Supabase SQL Editor. It DROPS this app's tables first, so it
-- is safe to re-run while setting up and destructive afterwards.
--
-- ===========================================================================
-- What is NOT here, and must not creep in
-- ===========================================================================
-- No trips. No rider statuses. No boarding record. No driver. This app knows
-- where a BUS is; it never claims to know where a CHILD is. Every table below
-- describes a vehicle, a place, or who is allowed to look at them.
-- ===========================================================================

drop table if exists
  alerts_sent, bus_locations, student_stops, bus_stops, stops,
  bus_devices, buses, guardian_links, invites, profiles, organization cascade;

drop type if exists user_role, account_status cascade;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- Three roles. The full app's `driver` and `coordinator` do not exist here:
-- there is no driver in the product, and the coordinator's job was running an
-- exception queue that this app cannot generate.
--
-- NOTE: the values are a SUBSET of the full app's enum, and deliberately spelled
-- the same, so a profile row means the same thing in both apps when they share a
-- project. Do not rename these.
create type user_role as enum ('student', 'parent', 'admin');

create type account_status as enum ('pending', 'active', 'suspended');

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------

create table organization (
  id         int primary key default 1 check (id = 1),
  name       text not null default 'Bus Tracker',

  -- The timezone the buses run in. Nothing compares a wall clock yet — there
  -- are no planned times — but it is stored from the first schema because the
  -- full app shipped without it and every comparison was four hours out, and
  -- retrofitting it touched five functions. A region name, never 'EST'.
  time_zone  text not null default 'UTC',

  -- Minutes-away milestones that trigger a notification (phase 6).
  alert_minutes int[] not null default '{15,5}',

  -- How close the bus must be to count as "at the stop".
  geofence_radius_m int not null default 100 check (geofence_radius_m > 0)
);

insert into organization (id) values (1);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  role       user_role not null,
  full_name  text not null default '',
  email      text,
  phone      text,
  status     account_status not null default 'active',
  expo_push_token text,
  created_at timestamptz not null default now()
);

-- Blueprint-equivalent: an account comes into existence ONLY by redeeming an
-- invite, and the invite carries the role. Nobody self-selects. This is the one
-- piece of the full app's auth model worth every line, so it ports intact.
create table invites (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  role       user_role not null,
  full_name  text not null default '',
  email      text,
  note       text,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by    uuid references profiles on delete set null,
  used_at    timestamptz,
  revoked_at timestamptz
);

create table guardian_links (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references profiles on delete cascade,
  student_id   uuid not null references profiles on delete cascade,
  status       text not null default 'accepted' check (status in ('pending', 'accepted', 'rejected')),
  requested_by uuid not null references profiles on delete cascade,
  created_at   timestamptz not null default now(),
  unique (parent_id, student_id)
);

-- ---------------------------------------------------------------------------
-- The fleet, and where it goes
-- ---------------------------------------------------------------------------

create table buses (
  id     uuid primary key default gen_random_uuid(),
  label  text not null,
  plate  text,
  active boolean not null default true
);

-- The tracker's credential, in its OWN table.
--
-- RLS is row-level, not column-level: every signed-in student can read the bus
-- list, so a `device_key` column on `buses` would be readable by all of them.
-- The full app learned this and split it the same way.
create table bus_devices (
  bus_id     uuid primary key references buses on delete cascade,
  device_key text unique not null default encode(gen_random_bytes(24), 'hex'),
  rotated_at timestamptz not null default now()
);

-- Give every bus a key automatically, so one can never exist without one.
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

-- The ordered run. This is what replaces the full app's route templates, route
-- stops, daily trip generation and cron: a bus, and the stops it passes in order.
create table bus_stops (
  id       uuid primary key default gen_random_uuid(),
  bus_id   uuid not null references buses on delete cascade,
  stop_id  uuid not null references stops on delete cascade,
  position int not null,
  unique (bus_id, stop_id),
  unique (bus_id, position) deferrable initially deferred
);
create index bus_stops_order_idx on bus_stops (bus_id, position);

-- Which bus a student rides, and from which stop.
--
-- `uses_it` is the opt-out — a student can be on a bus but marked as not using
-- one of its stops. It is the only thing a family's setup expresses, and it is
-- still an ADMIN who sets it. Families are passive in this app.
create table student_stops (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles on delete cascade,
  bus_id     uuid not null references buses on delete cascade,
  stop_id    uuid not null references stops on delete cascade,
  uses_it    boolean not null default true,
  unique (student_id, bus_id, stop_id)
);
create index student_stops_student_idx on student_stops (student_id);

-- ---------------------------------------------------------------------------
-- Where the bus actually is
-- ---------------------------------------------------------------------------

-- Written ONLY by the ingest-location Edge Function, authenticated on the
-- tracker's device_key. No app writes here, and no phone reports a position.
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

-- Which notifications have already gone out (phase 6).
--
-- Keyed on the STOP, not the student: two children at one stop must produce one
-- notification naming both, not two identical ones a second apart. That is how
-- a family learns to swipe alerts away unread.
create table alerts_sent (
  id        uuid primary key default gen_random_uuid(),
  bus_id    uuid not null references buses on delete cascade,
  stop_id   uuid not null references stops on delete cascade,
  milestone text not null,
  sent_at   timestamptz not null default now(),
  unique (bus_id, stop_id, milestone)
);

-- ---------------------------------------------------------------------------
-- Helpers (security definer, so policies do not recurse into themselves)
-- ---------------------------------------------------------------------------

create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() = 'admin';
$$;

create or replace function is_guardian_of(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guardian_links
    where parent_id = auth.uid() and student_id = target and status = 'accepted'
  );
$$;

/** Every bus the caller is entitled to watch: their own, or their children's. */
create or replace function my_bus_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct ss.bus_id
  from student_stops ss
  where ss.uses_it
    and (ss.student_id = auth.uid() or is_guardian_of(ss.student_id));
$$;

-- ---------------------------------------------------------------------------
-- Admin configuration
--
-- Two jobs that cannot be done from the client, for two different reasons.
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
 * would promise a family a stop the bus never reaches. The caller is expected
 * to have said so before calling.
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

  -- Caught here so the message names the problem. The unique constraint would
  -- fire too, several steps later, saying something about an index.
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
 * Issue a bus's tracker a fresh key, invalidating the old one.
 *
 * Generated in the database rather than in the app because a device_key is a
 * password, and the client has no business choosing one. The upsert also
 * repairs a bus that somehow has no device row.
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
-- Signup: the ONLY way an account is created
-- ---------------------------------------------------------------------------

create or replace function new_invite_code() returns text
language sql volatile as $$
  select 'BUS-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4))
      || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4));
$$;

create or replace function set_invite_code() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := new_invite_code();
  end if;
  return new;
end;
$$;

create trigger on_invite_created before insert on invites
  for each row execute function set_invite_code();

/** Read an invite while signed out, so signup can show who you are first. */
create or replace function invite_details(invite_code text)
returns table (role user_role, full_name text, email text, valid boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  inv invites%rowtype;
begin
  select * into inv from invites where upper(code) = upper(btrim(invite_code));

  if not found then
    return query select null::user_role, ''::text, null::text, false,
                        'That invite code is not recognised.'::text;
  elsif inv.revoked_at is not null then
    return query select inv.role, inv.full_name, inv.email, false,
                        'That invite has been withdrawn.'::text;
  elsif inv.used_at is not null then
    return query select inv.role, inv.full_name, inv.email, false,
                        'That invite has already been used.'::text;
  elsif inv.expires_at < now() then
    return query select inv.role, inv.full_name, inv.email, false,
                        'That invite has expired. Ask the transport office for a new one.'::text;
  else
    return query select inv.role, inv.full_name, inv.email, true, null::text;
  end if;
end;
$$;

grant execute on function invite_details(text) to anon, authenticated;

/**
 * The role comes from the INVITE, never from what the client sent. A signup
 * with no code, a bad code, a used code or an expired one does not create a
 * half-account — it raises, and Supabase rolls the auth user back with it.
 */
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  supplied text := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  inv invites%rowtype;
begin
  if supplied = '' then
    raise exception 'An invite code is required. Ask the transport office to invite you.';
  end if;

  select * into inv from invites where upper(code) = supplied for update;

  if not found then raise exception 'That invite code is not recognised.'; end if;
  if inv.revoked_at is not null then raise exception 'That invite has been withdrawn.'; end if;
  if inv.used_at is not null then raise exception 'That invite has already been used.'; end if;
  if inv.expires_at < now() then raise exception 'That invite has expired.'; end if;
  if inv.email is not null and lower(inv.email) <> lower(new.email) then
    raise exception 'That invite was issued to a different email address.';
  end if;

  insert into profiles (id, role, full_name, email, phone, status)
  values (
    new.id,
    inv.role,                                   -- from the invite. Not negotiable.
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), inv.full_name, ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    'active'                                    -- the admin already vetted them
  );

  update invites set used_by = new.id, used_at = now() where id = inv.id;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Written with the first table rather than retrofitted. The rule throughout:
-- a family sees the bus their child rides and nothing else; an admin configures.
-- ---------------------------------------------------------------------------

alter table organization   enable row level security;
alter table profiles       enable row level security;
alter table invites        enable row level security;
alter table guardian_links enable row level security;
alter table buses          enable row level security;
alter table bus_devices    enable row level security;
alter table stops          enable row level security;
alter table bus_stops      enable row level security;
alter table student_stops  enable row level security;
alter table bus_locations  enable row level security;
alter table alerts_sent    enable row level security;

create policy "read org" on organization for select using (is_active());
create policy "admins write org" on organization for update
  using (is_admin()) with check (is_admin());

-- A blocked user still has to load the screen that tells them they are blocked,
-- so these two are deliberately not gated on is_active().
create policy "read own profile" on profiles for select using (id = auth.uid());
create policy "update own profile" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy "parents read children" on profiles for select using (is_guardian_of(id));
create policy "admins read all profiles" on profiles for select using (is_admin());
create policy "admins update profiles" on profiles for update
  using (is_admin()) with check (is_admin());

create policy "admins issue invites" on invites for all
  using (is_admin()) with check (is_admin());

create policy "read own links" on guardian_links for select
  using (parent_id = auth.uid() or student_id = auth.uid() or is_admin());
create policy "admins manage links" on guardian_links for all
  using (is_admin()) with check (is_admin());

-- Everyone signed in can see the fleet and the stops. Neither says anything
-- about a child, and the map needs them.
create policy "read buses" on buses for select using (is_active());
create policy "admins write buses" on buses for all
  using (is_admin()) with check (is_admin());

create policy "read stops" on stops for select using (is_active());
create policy "admins write stops" on stops for all
  using (is_admin()) with check (is_admin());

create policy "read bus stops" on bus_stops for select using (is_active());
create policy "admins write bus stops" on bus_stops for all
  using (is_admin()) with check (is_admin());

-- The device key is a password. ONLY an admin ever reads it, and the Edge
-- Function reads it with the service role, which bypasses RLS entirely.
create policy "admins read device keys" on bus_devices for select using (is_admin());
create policy "admins rotate device keys" on bus_devices for update
  using (is_admin()) with check (is_admin());

-- A student sees their own assignment; a parent sees their children's.
create policy "read own assignment" on student_stops for select using (
  is_active() and (student_id = auth.uid() or is_guardian_of(student_id))
);
create policy "admins write assignments" on student_stops for all
  using (is_admin()) with check (is_admin());

-- The heart of it: you may watch a bus you are connected to, and no other.
create policy "watch my bus" on bus_locations for select using (
  is_admin() or (is_active() and bus_id in (select my_bus_ids()))
);

create policy "admins read alerts sent" on alerts_sent for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Realtime: the map follows the table rather than polling.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table bus_locations;
