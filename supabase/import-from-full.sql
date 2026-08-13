-- Bring the full app's test data across into lite's tables.
--
-- Run AFTER `schema-shared.sql`, in the same project as the full app. Safe to
-- re-run: everything is `on conflict do nothing` or keyed, so it tops up rather
-- than duplicating.
--
-- READ-ONLY against the full app. It only ever SELECTs from its tables.
--
-- ===========================================================================
-- The mapping, and where it is lossy
-- ===========================================================================
--
--   full app            lite            note
--   ---------------------------------------------------------------------
--   vehicles         →  buses           straight across
--   hubs             →  stops           straight across (schools are skipped —
--                                       see below)
--   route_stops      →  bus_stops       a route's ordered stops become the
--                                       BUS's ordered stops, via the route's
--                                       default vehicle
--   route_assignments→  student_stops   the student's HUB stop, not the school
--   vehicle_locations→  bus_locations   last 24h only; the rest is noise here
--
-- **Schools are deliberately not imported as stops.** In the full app a route
-- runs hub → school (or the reverse) and the school is one end of it. Lite has
-- no direction and no trips: a bus has an ordered list of stops it passes. A
-- school is just another stop — but importing it automatically would put it in
-- the middle of every bus's run with no way to tell which end it belongs at.
-- Add the school as a stop by hand if you want it, and place it in the order.
--
-- **A full-app route with no default vehicle is skipped**, because lite has no
-- concept of a route that no bus drives. Those routes' stops simply do not
-- arrive; set a default vehicle on them first if you want them.
-- ===========================================================================

do $$
begin
  if to_regclass('public.vehicles') is null then
    raise exception 'The full app''s tables are not in this project — nothing to import from.';
  end if;
end
$$;

-- Buses ← vehicles. Same ids, so re-running is idempotent and the two stay
-- recognisably the same vehicle when you look at both apps.
insert into buses (id, label, plate, active)
select v.id, v.label, v.plate, v.active
from vehicles v
on conflict (id) do nothing;

-- Stops ← hubs.
insert into stops (id, name, address, lat, lng, active)
select h.id, h.name, h.address, h.lat, h.lng, h.active
from hubs h
on conflict (id) do nothing;

-- The ordered run ← route_stops, resolved through the route's default vehicle.
--
-- `distinct on` because two full-app routes (morning and afternoon) can share a
-- vehicle and pass the same hub; lite has one ordered list per bus, so the
-- lowest sequence wins and the rest are dropped.
insert into bus_stops (bus_id, stop_id, position)
select distinct on (rt.default_vehicle_id, rs.hub_id)
       rt.default_vehicle_id,
       rs.hub_id,
       rs.seq
from route_stops rs
join route_templates rt on rt.id = rs.route_id
where rs.hub_id is not null
  and rt.default_vehicle_id is not null
  and rt.active
order by rt.default_vehicle_id, rs.hub_id, rs.seq
on conflict (bus_id, stop_id) do nothing;

-- Positions must be unique per bus; the seq values above came from different
-- routes and can collide. Renumber densely, keeping the order.
with ordered as (
  select id, row_number() over (partition by bus_id order by position, id) as n
  from bus_stops
)
update bus_stops bs set position = ordered.n
from ordered where ordered.id = bs.id;

-- Who rides what ← route_assignments.
--
-- The full app gives a rider a pickup stop and a dropoff stop; one of them is
-- the school and the other is their hub. Lite wants the HUB, because that is
-- the stop a family stands at.
insert into student_stops (student_id, bus_id, stop_id, uses_it)
select distinct
       ra.student_id,
       rt.default_vehicle_id,
       coalesce(pick.hub_id, drop_.hub_id),
       true
from route_assignments ra
join route_templates rt on rt.id = ra.route_id
left join route_stops pick  on pick.id  = ra.pickup_stop_id
left join route_stops drop_ on drop_.id = ra.dropoff_stop_id
where rt.default_vehicle_id is not null
  and coalesce(pick.hub_id, drop_.hub_id) is not null
  and exists (select 1 from profiles p where p.id = ra.student_id)
on conflict (student_id, bus_id, stop_id) do nothing;

-- A day of recent positions, so the map has something to draw immediately.
insert into bus_locations (bus_id, lat, lng, heading, speed, recorded_at)
select vl.vehicle_id, vl.lat, vl.lng, vl.heading, vl.speed, vl.recorded_at
from vehicle_locations vl
where vl.recorded_at > now() - interval '24 hours'
  and exists (select 1 from buses b where b.id = vl.vehicle_id);

-- What arrived.
select 'buses'         as table, count(*)::text as rows from buses
union all select 'stops',         count(*)::text from stops
union all select 'bus_stops',     count(*)::text from bus_stops
union all select 'student_stops', count(*)::text from student_stops
union all select 'bus_locations', count(*)::text from bus_locations
union all select 'buses with no stops (add them by hand)',
                 count(*)::text from buses b
                 where not exists (select 1 from bus_stops bs where bs.bus_id = b.id);
