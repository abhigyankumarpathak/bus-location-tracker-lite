-- ===========================================================================
-- Does RLS actually hold? Tested with the app out of the loop.
--
-- The full app found a suspended account whose session still worked, because
-- the check lived in the UI. Everything below queries the database directly AS
-- each role, which is the only way to know.
--
-- DESTRUCTIVE — scratch database only.
-- ===========================================================================
\set ON_ERROR_STOP off
\pset pager off

create or replace function ok(label text, cond boolean) returns void
language plpgsql as $$
begin
  raise notice '%  %', case when cond then '[PASS]' else '[FAIL]' end, label;
end; $$;

create or replace function as_user(u uuid) returns void
language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end; $$;

alter table auth.users disable trigger on_auth_user_created;
truncate auth.users cascade;

-- The fleet hangs off nothing in auth, so the cascade above leaves it standing.
-- Without this, a second run of this file starts from the first run's leftovers
-- — duplicate bus ids, a run already reordered — and reports failures that are
-- really just yesterday's state.
truncate buses, stops cascade;

insert into auth.users (id) values
 ('00000000-0000-0000-0000-0000000000a0'),  -- Ada, admin
 ('00000000-0000-0000-0000-000000000011'),  -- Priya, student
 ('00000000-0000-0000-0000-000000000022'),  -- Noah, student (different bus)
 ('00000000-0000-0000-0000-0000000000b1'),  -- Mum, parent of Priya
 ('00000000-0000-0000-0000-0000000000c1');  -- Sus, suspended student

insert into profiles (id, role, full_name, status) values
 ('00000000-0000-0000-0000-0000000000a0','admin','Ada Admin','active'),
 ('00000000-0000-0000-0000-000000000011','student','Priya','active'),
 ('00000000-0000-0000-0000-000000000022','student','Noah','active'),
 ('00000000-0000-0000-0000-0000000000b1','parent','Mum','active'),
 ('00000000-0000-0000-0000-0000000000c1','student','Sus','suspended');

insert into guardian_links (parent_id, student_id, requested_by) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-0000000000b1');

insert into buses (id,label) values
 ('00000000-0000-0000-0000-0000000000e1','Bus 1'),
 ('00000000-0000-0000-0000-0000000000e2','Bus 2');
insert into stops (id,name,lat,lng) values
 ('00000000-0000-0000-0000-0000000000f1','Oak Road',40.0,-74.0),
 ('00000000-0000-0000-0000-0000000000f2','Elm Close',40.1,-74.1);
insert into bus_stops (bus_id,stop_id,position) values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000f1',1),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f2',1);
-- Priya rides Bus 1; Noah and Sus ride Bus 2.
insert into student_stops (student_id,bus_id,stop_id) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000f1'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f2'),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f2');
insert into bus_locations (bus_id,lat,lng) values
 ('00000000-0000-0000-0000-0000000000e1',40.0,-74.0),
 ('00000000-0000-0000-0000-0000000000e2',40.1,-74.1);

-- Everything below runs as a normal client would: RLS on, no bypass.
set role authenticated;

\echo ''
\echo '=== a STUDENT ==='
select as_user('00000000-0000-0000-0000-000000000011');
select ok('sees the bus they ride', count(*) = 1) from bus_locations where bus_id='00000000-0000-0000-0000-0000000000e1';
select ok('CANNOT see another bus''s position', count(*) = 0) from bus_locations where bus_id='00000000-0000-0000-0000-0000000000e2';
select ok('sees only their own assignment', count(*) = 1) from student_stops;
select ok('cannot read any device key', count(*) = 0) from bus_devices;
select ok('cannot read other people''s profiles', count(*) <= 1) from profiles;

\echo ''
\echo '=== a PARENT ==='
select as_user('00000000-0000-0000-0000-0000000000b1');
select ok('sees their child''s bus', count(*) = 1) from bus_locations where bus_id='00000000-0000-0000-0000-0000000000e1';
select ok('CANNOT see an unrelated bus', count(*) = 0) from bus_locations where bus_id='00000000-0000-0000-0000-0000000000e2';
select ok('sees their child''s assignment', count(*) = 1) from student_stops;
select ok('cannot read device keys', count(*) = 0) from bus_devices;

\echo ''
\echo '=== a SUSPENDED student — the one the full app got wrong ==='
select as_user('00000000-0000-0000-0000-0000000000c1');
select ok('sees NO bus positions at all', count(*) = 0) from bus_locations;
select ok('sees no assignments', count(*) = 0) from student_stops;
select ok('sees no stops', count(*) = 0) from stops;

\echo ''
\echo '=== an ADMIN ==='
select as_user('00000000-0000-0000-0000-0000000000a0');
select ok('sees every bus position', count(*) = 2) from bus_locations;
select ok('reads device keys', count(*) = 2) from bus_devices;
select ok('sees everyone', count(*) = 5) from profiles;
select ok('every bus got a device key automatically', count(*) = 2) from bus_devices;

\echo ''
\echo '=== writes are refused for non-admins ==='
select as_user('00000000-0000-0000-0000-000000000011');
insert into buses (label) values ('Rogue bus');
select ok('a student cannot create a bus', count(*) = 2) from buses;
update student_stops set bus_id='00000000-0000-0000-0000-0000000000e2' where student_id='00000000-0000-0000-0000-000000000011';
select ok('a student cannot move themselves to another bus', count(*) = 0)
from student_stops where student_id='00000000-0000-0000-0000-000000000011' and bus_id='00000000-0000-0000-0000-0000000000e2';
insert into bus_locations (bus_id,lat,lng) values ('00000000-0000-0000-0000-0000000000e1',1,1);
select ok('a student cannot fake a bus position', count(*) = 1) from bus_locations where bus_id='00000000-0000-0000-0000-0000000000e1';

-- ===========================================================================
-- Phase 3 — admin configuration
-- ===========================================================================

\echo ''
\echo '=== the run, and the tracker key (as an ADMIN) ==='
select as_user('00000000-0000-0000-0000-0000000000a0');
select device_key as before from bus_devices where bus_id='00000000-0000-0000-0000-0000000000e1' \gset

-- The whole order goes in one call. Reordering from the client cannot work:
-- unique (bus_id, position) is deferrable, and deferral reaches only to the end
-- of a TRANSACTION, while every PostgREST call is its own.
select set_bus_run(
  '00000000-0000-0000-0000-0000000000e1',
  array['00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000f1']::uuid[]
);
select ok('an admin can reorder a run',
  (select stop_id from bus_stops where bus_id='00000000-0000-0000-0000-0000000000e1' and position=1)
  = '00000000-0000-0000-0000-0000000000f2');
select ok('the run renumbers densely from 1', count(*)=2 and min(position)=1 and max(position)=2)
from bus_stops where bus_id='00000000-0000-0000-0000-0000000000e1';

select rotate_device_key('00000000-0000-0000-0000-0000000000e1');
select ok('rotating issues a different key', device_key <> :'before')
from bus_devices where bus_id='00000000-0000-0000-0000-0000000000e1';
select device_key as rotated from bus_devices where bus_id='00000000-0000-0000-0000-0000000000e1' \gset

\echo ''
\echo '=== the same two functions, called by a STUDENT ==='
-- Both are SECURITY DEFINER, so they bypass RLS by design. The `is_admin()`
-- gate inside them is therefore the ONLY thing standing there — which is
-- exactly why it is tested rather than assumed.
select as_user('00000000-0000-0000-0000-000000000011');
select set_bus_run('00000000-0000-0000-0000-0000000000e1', array[]::uuid[]);
select ok('a student cannot wipe a run', count(*) = 2)
from bus_stops where bus_id='00000000-0000-0000-0000-0000000000e1';

select rotate_device_key('00000000-0000-0000-0000-0000000000e1');

insert into stops (name,lat,lng) values ('Rogue stop',1,1);
select ok('a student cannot add a stop', count(*) = 2) from stops;

insert into bus_stops (bus_id,stop_id,position)
values ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000f1',5);
select ok('a student cannot put a stop on a run', count(*) = 1)
from bus_stops where bus_id='00000000-0000-0000-0000-0000000000e2';

insert into guardian_links (parent_id, student_id, requested_by) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011');

select as_user('00000000-0000-0000-0000-0000000000a0');
select ok('a student cannot rotate a tracker key', device_key = :'rotated')
from bus_devices where bus_id='00000000-0000-0000-0000-0000000000e1';
select ok('a student cannot invent a guardian link', count(*) = 1) from guardian_links;

\echo ''
\echo '=== the opt-out is a DATABASE fact, not a UI preference ==='
-- `uses_it` is read by my_bus_ids(), which every watch policy leans on. Pausing
-- a stop must stop the database serving that bus — if it only hid a screen, a
-- raw API call would still stream the vehicle to a family who opted out.
select as_user('00000000-0000-0000-0000-0000000000a0');
update student_stops set uses_it = false where student_id='00000000-0000-0000-0000-000000000011';

select as_user('00000000-0000-0000-0000-000000000011');
select ok('a paused stop stops the student seeing the bus', count(*) = 0) from bus_locations;
select as_user('00000000-0000-0000-0000-0000000000b1');
select ok('and their parent stops seeing it too', count(*) = 0) from bus_locations;

select as_user('00000000-0000-0000-0000-0000000000a0');
update student_stops set uses_it = true where student_id='00000000-0000-0000-0000-000000000011';
select as_user('00000000-0000-0000-0000-000000000011');
select ok('resuming gives the bus back', count(*) = 1) from bus_locations;

\echo ''
\echo '=== taking a stop off a run takes its assignments with it ==='
-- Documented behaviour, not a side effect: a stop the bus no longer reaches
-- cannot have anyone waiting at it, and a row that says otherwise promises a
-- family a bus that never comes. Bus 2 carries Noah and Sus.
select as_user('00000000-0000-0000-0000-0000000000a0');
select ok('set_bus_run reports the assignments it dropped',
  set_bus_run('00000000-0000-0000-0000-0000000000e2', array[]::uuid[]) = 2);
select ok('and the rows are really gone', count(*) = 0)
from student_stops where bus_id='00000000-0000-0000-0000-0000000000e2';

reset role;
