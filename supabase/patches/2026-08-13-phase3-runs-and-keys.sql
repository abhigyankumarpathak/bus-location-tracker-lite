-- ===========================================================================
-- Phase 3 — the two functions admin configuration needs.
--
-- Only for a database that already had `schema.sql` or `schema-shared.sql` run
-- against it BEFORE 13 August 2026. Both files now contain everything below, so
-- a fresh install does not need this patch.
--
-- Safe to re-run, and it touches no table. Nothing here belongs to the full app.
-- ===========================================================================

do $$
begin
  if to_regclass('public.bus_stops') is null then
    raise exception 'Lite is not installed here. Run schema.sql or schema-shared.sql first.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Why these are functions and not client-side updates
--
-- set_bus_run: `unique (bus_id, position)` is DEFERRABLE INITIALLY DEFERRED,
-- and deferral only reaches to the end of a TRANSACTION — while every PostgREST
-- call is its own. Reordering from the client is two updates in two
-- transactions, and the first collides on a position the second was about to
-- vacate.
--
-- rotate_device_key: a device_key is a password. The client has no business
-- choosing one.
-- ---------------------------------------------------------------------------

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

  -- A stop no longer on the run cannot have anyone assigned to it on this bus.
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

do $$
begin
  raise notice 'Phase 3 functions installed: set_bus_run(), rotate_device_key().';
end
$$;
