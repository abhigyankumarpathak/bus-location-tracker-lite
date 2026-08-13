# What lite does, and what it deliberately does not

The companion to [CHANGELOG](../CHANGELOG.md). This document exists mostly for
the second half: the failure mode for this project is quietly rebuilding the full
app one reasonable-sounding feature at a time.

**Status: phase 1 of 6 complete.** The scaffold runs, the schema exists, nothing
is wired to it yet.

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

### Phases 2–6 — not built

| Phase | What it adds |
| --- | --- |
| 2 · Auth | Invite management in the admin app; the three roles exercised end to end |
| 3 · Admin config | CRUD for buses, stops, the ordered run, and student→bus→stop assignment |
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
