# Bus Tracker — lite

The minimal alternative to [`../bus-tracking-app`](../bus-tracking-app), the full
Student Transportation Platform.

The full app is a custody-of-children system — nine rider statuses, driver-
confirmed boarding, an end-of-trip checklist the database refuses to skip, a
watchdog on the clock. It answers *"where is my child, and who has them."*

**This one answers one question: where is the bus, and when does it reach my
stop.** It never claims to know where a child is.

> **Status: phase 3 of 6.** Accounts work, and an admin can describe the whole
> operation — buses and their tracker keys, stops, the order a bus passes them,
> and who watches which one. Nothing is on a map yet, because nothing reports a
> position until phase 4. The parent and student screens are still placeholders.
> See [CHANGELOG](CHANGELOG.md) and [docs/FEATURES.md](docs/FEATURES.md).

## The product

1. Parents, students and admins sign in.
2. An admin creates buses and stops, and puts the stops in order on a bus.
3. An admin assigns each student a bus and a stop — and marks the stops they
   don't use.
4. A GPS tracker in the vehicle reports its position; families watch it move,
   with minutes-away to *their* stop.
5. Alerts at **15 minutes away** and **5 minutes away**.
6. A notification when **the bus is at the stop**.

No driver role, no boarding record, no trips, no schedule. Three roles against
six; eleven tables against twenty-five, four of them shared.

## Running it

```sh
npm install
cp .env.example .env      # fill in from your Supabase project
npm start -- --clear      # http://localhost:8082
```

The `--clear` is not optional: Expo bakes `EXPO_PUBLIC_*` into the bundle, so a
warm cache keeps serving the old values.

Without a `.env` the app shows a "Connect Supabase" screen rather than crashing.

**Port 8082, not Expo's default 8081.** A favicon cache is per-origin, so two
Expo apps taking turns on `localhost:8081` show each other's tab icon. Pinning
the port means this app is always this app.

### The database — two ways

| | Share the full app's project | Its own project |
| --- | --- | --- |
| For | Development — its accounts and data are already there | Publishing |
| Run | `supabase/schema-shared.sql`, then `import-from-full.sql` | `supabase/schema.sql` |

Sharing works because four tables are common to both apps — `organization`,
`profiles`, `invites`, `guardian_links` — so the same logins work in both. Lite's
own seven tables sit alongside under names the full app does not use, and
**installing lite alters or drops nothing that belongs to the full app.**
Verified: with lite in the same database and without it, the full app's own
end-to-end test gives identical results.

One shared table *is* written to: linking a family on Admin → People inserts into
`guardian_links`, and the full app honours that link. Correct — a guardian is a
guardian in both — but worth knowing before you experiment.

Details and the caveats in [supabase/SETUP.md](supabase/SETUP.md).

## How it differs from the full app

| | Full | Lite |
| --- | --- | --- |
| Answers | Where is my child, and who has them? | Where is the bus? |
| Roles | 5 | 3 — student, parent, admin |
| Driver app | Yes | **None** |
| Rider statuses | 9, enforced | **None** |
| Position from | The driver's phone | **A tracker in the vehicle** |
| Families can | Check in, report absences, see a timeline | **Watch. Nothing else.** |
| Alerts | 15 / 5 min, boarding, drop-off, delay, exceptions | 15 / 5 min, **and at the stop** |

## Why a separate project

Not a branch of the full app, and not a feature flag on it. Nothing over there is
deleted or switched off, so nothing over there can break. The cost is that the
two share no code at runtime — a fix in one does not reach the other.

**The full app is read-only while working here**: open it to read and port from,
never to edit.

## The spec

Scope boundary, data sketch, alerting rules, the six-phase build order and the
questions still open:

**[`.claude/skills/barebone/SKILL.md`](.claude/skills/barebone/SKILL.md)**

That path is a symlink — the file lives in the full app's repo, because its
`docs/FEATURES.md` links to it so a reader there learns this exists. Editing it
from either side edits the same file. The link assumes the two directories stay
siblings.
