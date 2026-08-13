# What lite does, and what it deliberately does not

The companion to [CHANGELOG](../CHANGELOG.md). This document exists mostly for
the second half: the failure mode for this project is quietly rebuilding the full
app one reasonable-sounding feature at a time.

**Status: phase 3 of 6 complete.** An admin can describe the whole operation —
buses, stops, the order a bus passes them, and who watches which one. Nothing is
on a map yet, because nothing is reporting a position yet.

---

## The whole product

1. Parents, students and admins sign in.
2. An admin creates buses and stops, and puts the stops in order on a bus.
3. An admin assigns each student a bus and a stop — and can mark the stops they
   do not use.
4. A GPS tracker in the vehicle reports its position; families watch it move,
   with minutes-away to *their* stop.
5. Notifications at **15 minutes away** and **5 minutes away**.
6. A notification when **the bus is at the stop**.

If a proposed feature is not on that list, it does not go in without being asked
for by name.

## The one sentence that decides everything

> **This app knows where a BUS is. It never claims to know where a CHILD is.**

No screen, notification or column may imply boarding, presence or custody. *"The
bus is at your stop"* is a fact about a vehicle. *"Your child is on the bus"* is
one this app cannot know, and must never appear.

## What is deliberately absent

| The full app has | Here | Why |
| --- | --- | --- |
| Driver role and driver screens | ✗ | The premise. There is no driver in this app. |
| Nine rider statuses, a transition table | ✗ | Nothing tracks children. There is no rider row to have a status. |
| Boarding confirmation, QR scanning | ✗ | Follows from the above. |
| End-of-trip checklist | ✗ | No trips, and no custody claim to close out. |
| The watchdog | ✗ | It watches a schedule. There is no schedule. |
| Route templates, daily trip generation, cron | ✗ | Replaced by an ordered stop list on the bus. |
| Change requests, cutoffs, absence reporting | ✗ | Families are passive. |
| Coordinator role, exception queue | ✗ | Two staff roles collapse to one admin. |
| Incidents, audit viewer, weekly purge | ✗ | Nothing generates the volume that justified them. |
| **Invite-code signup, role on the invite** | **Kept** | The one piece of the full app's auth model worth every line. Nobody picks their own role. |
| **Row Level Security on every table** | **Kept** | Non-negotiable, and written with the first table rather than retrofitted. |
| **Live GPS** | **Kept, always on** | It is the product here, not a flag. |

Five roles become three: `student`, `parent`, `admin`. Around twenty-five tables
become eleven — and four of those eleven are the shared auth ones.

## Built so far

### Phase 1 — scaffold ✅

| | |
| --- | --- |
| Expo 57 + expo-router, three route groups | ✅ |
| Role guard — `Stack.Protected`, so an unauthorised route is never registered | ✅ |
| Supabase client, session storage split web/native | ✅ |
| Sign in / sign up with invite codes | ✅ Ported; the RPC behind it is in the schema |
| `schema.sql` — standalone, eleven tables, full RLS | ✅ |
| `schema-shared.sql` — lite's seven tables alongside the full app's | ✅ |
| `import-from-full.sql` — brings the full app's test data across | ✅ |
| Every screen behind the guards | ⬜ Placeholders naming the phase that fills them in |

### Phase 2 — accounts ✅

| | |
| --- | --- |
| Admin issues invite codes; the code carries the role | ✅ |
| Codes single-use, 14-day expiry, revocable, lockable to one email | ✅ |
| Admin sees every account and can pause / restore access | ✅ |
| Signup refuses a `driver` or `coordinator` invite from the shared database | ✅ |
| RLS verified as each role, with the app out of the loop | ✅ 19 assertions — `supabase/rls-test.sql` |

What RLS is proven to do: a student sees only the bus they ride; a parent only
their children's; a **suspended** account sees nothing at all; no non-admin can
read a `device_key`; and a student cannot create a bus, move themselves to
another, or fake a position.

### Phase 3 — admin config ✅

| | |
| --- | --- |
| Buses: create, rename, pause, delete | ✅ Pausing is the default; deleting counts out what goes with it |
| The tracker `device_key`: reveal, copy, rotate | ✅ Hidden until asked for; rotated in the database, never by the client |
| Stops: found by address, not typed as coordinates | ✅ Nominatim, with the geocoder's own match shown before saving |
| Stops: edit, pause, delete | ✅ |
| The ordered run — a bus and the stops it passes | ✅ `set_bus_run()`, batched behind a Save button |
| Student → bus → stop, with the `uses_it` opt-out | ✅ |
| Parent ↔ child links | ✅ Not on the phase's list; added because a parent account is empty without one |
| RLS re-tested, with the app out of the loop | ✅ 32 assertions — and now runnable locally, see below |

Two things here are database functions rather than client updates, and for
different reasons:

- **`set_bus_run(bus, ordered_stops)`** — `unique (bus_id, position)` is
  deferrable, and deferral reaches only to the end of a *transaction*, while
  every PostgREST call is its own. Reordering from the client is two updates in
  two transactions, and the first collides on a position the second was about to
  vacate. It also drops the assignments to any stop leaving the run, and reports
  how many: a stop the bus no longer reaches cannot have anyone waiting at it.
- **`rotate_device_key(bus)`** — a device key is a password. The client has no
  business choosing one.

**`uses_it` is a database fact, not a UI preference.** `my_bus_ids()` filters on
it, and every watch policy leans on that function — so pausing a student's stop
stops Postgres serving that bus to that family at all. Proven from both sides in
the test.

**Running the RLS test.** Phase 2's assertions needed a throwaway Supabase
project. [`supabase/local-shim.sql`](../supabase/local-shim.sql) fakes just
enough of Supabase — the three PostgREST roles, `auth.users`, `auth.uid()`, and
the default privileges that make `set role authenticated` behave like a real
client — to run it against a plain local PostgreSQL instead.

### Phases 4–6 — not built

| Phase | What it adds |
| --- | --- |
| 4 · Location in | `ingest-location` deployed, plus a simulator so 5 and 6 need no hardware |
| 5 · The map | Live bus over its stops, minutes-away, and *last seen* when the tracker goes quiet |
| 6 · Notifications | The three milestones, geofence entry, de-dup, Expo push |

## Decisions carried over from the full app

Things it learned expensively, taken as given here rather than rediscovered.

- **`device_key` lives in its own table**, never on `buses`. RLS is row-level,
  not column-level, and every signed-in student can read the bus list.
- **Alerts are keyed on the stop, not the student.** Two children at one stop
  produce one notification naming both. Two identical alerts a second apart is
  how a family learns to swipe them away unread.
- **The timezone is stored from the first schema.** Nothing compares a wall clock
  yet, but the full app shipped without it, was silently four hours out on
  everything, and retrofitting touched five functions.
- **Push needs an EAS `projectId`** or no token is ever issued and the failure is
  completely silent. Phase 6 starts there.
- **Distinguish *parked* from *signal lost*.** A tracker that has gone quiet must
  read as "last seen 6 minutes ago", never as a bus sitting still.

## Still open

Answered when the phase that needs them arrives, not before.

1. **What ends a "run"** and resets the sent-alerts ledger? A quiet-period
   timeout is the provisional answer.
2. **Do stops have times at all?** Currently no — so the app can say "12 minutes
   away" but never "the bus is late".
3. **GPS breadcrumb retention.** Highest-volume table by far, and the full app's
   purge is not coming across.
4. **Which tracker hardware**, and does it POST to an endpoint directly or go
   through a vendor platform that needs polling?
5. **Web build?** It exports today. Whether it is a target worth supporting is a
   separate question.
