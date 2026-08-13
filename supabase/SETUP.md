# Supabase setup — lite

Two ways to run this. Pick one.

| | **Share the full app's project** | **Its own project** |
| --- | --- | --- |
| For | Development. Your existing test accounts and data are already there. | Publishing. |
| Run | `schema-shared.sql`, then `import-from-full.sql` | `schema.sql` |
| Sign in with | The same accounts as the full app | Its own, from its own invites |
| Risk | A schema change in one app can surprise the other | None — they are unrelated |

---

## A. Sharing the full app's project (development)

The two apps can live in one Supabase project. Four tables are **shared** —
`organization`, `profiles`, `invites`, `guardian_links` — which is what makes the
same logins work in both. Everything else lite needs is created alongside under
names the full app does not use: `buses`, `bus_devices`, `stops`, `bus_stops`,
`student_stops`, `bus_locations`, `alerts_sent`.

**Nothing in this path alters, drops or writes to a full-app table.** That is
verified: after installing lite's schema into the same database, the full app's
own 36-assertion end-to-end test still passes.

1. **SQL Editor → New query →** paste all of [`schema-shared.sql`](./schema-shared.sql) → Run.
   It refuses to run if the full app's tables are not there, rather than
   half-creating things.
2. Then [`import-from-full.sql`](./import-from-full.sql) → Run. This copies the
   full app's vehicles, hubs, route stops and rider assignments into lite's
   tables so there is something to look at immediately. It only ever *reads*
   from the full app. Safe to re-run.
3. Point `.env` at the same project as the full app — same URL, same publishable
   key.

### What the import does not bring across

- **Schools are not imported as stops.** In the full app a route runs hub →
  school; the school is one end of it. Lite has no direction, just an ordered
  list of stops a bus passes — so importing the school automatically would drop
  it in the middle of every run with no way to know which end it belongs at. Add
  it by hand and place it in the order if you want it.
- **Routes with no default vehicle are skipped.** Lite has no concept of a route
  no bus drives. Set a default vehicle on those routes first if you want them.
- **Two full-app routes sharing a vehicle collapse into one run.** Morning and
  afternoon are separate routes over there and one ordered stop list here, so
  the lowest sequence wins. Check the order afterwards on Admin → Stops.

### Roles when sharing

Lite understands `student`, `parent` and `admin`. The full app's `driver` and
`coordinator` accounts can sign in but land on nothing — correct, since those
people have the full app. A full-app **admin is an admin here too**; a
coordinator is not, and can only watch.

---

## B. Its own project (publishing)

1. Create a Supabase project.
2. **SQL Editor →** paste all of [`schema.sql`](./schema.sql) → Run. It is
   standalone: all eleven tables, RLS, and the invite-based signup trigger.
   It **drops** its tables at the top, so it is safe to re-run while setting up
   and destructive afterwards.
3. **Authentication → Sign In / Providers → Email** → turn off *Confirm email*
   for development. Turn it back on before real families use it.
4. Copy `.env.example` to `.env`, fill in the project URL and publishable key,
   then `npx expo start --clear`. The `--clear` is not optional — Expo bakes
   `EXPO_PUBLIC_*` into the bundle and a warm cache serves the old values.

### The first admin

Nobody can sign up without an invite, and the invite carries the role — so the
first admin has nobody to invite them. Break the loop by hand, once:

```sql
insert into invites (role, full_name, note)
values ('admin', 'Administrator', 'bootstrap');

select code from invites where role = 'admin' and used_at is null;
```

Open the app → **I have an invite code** → enter it. Every other account is
invited from Admin → Invites after that.

---

## The tracker (phase 4)

Each bus gets a `device_key` automatically when it is created, in the
`bus_devices` table — **not** on `buses`, because RLS is row-level and every
signed-in student can read the bus list.

The key is a password: it never goes in an `EXPO_PUBLIC_*` variable, and only an
admin can read it. The `ingest-location` Edge Function authenticates on the key
alone — a tracker cannot hold a session — so it runs with the service role and
the key lookup *is* the authorization.

Not deployed yet. Phase 4.

## Push notifications (phase 6)

Needs an EAS project id in `app.json` (`extra.eas.projectId`) — without one the
Expo push service issues no token and every alert stays in-app, which for "your
bus is 5 minutes away" is the same as not sending it. Also needs a Database
Webhook on the notifications table, and a development build on a real phone;
push has not worked in Expo Go since SDK 53.

Not built yet. Phase 6.
