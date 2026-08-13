# Changelog

Every change to Bus Tracker (lite), newest first.

This is the lite app's own history. The full Student Transportation Platform is
a separate project with a separate changelog — nothing from here appears there,
and nothing from there appears here.

---

## 13 August 2026

### Phase 2 — accounts, and proving RLS holds

**Invites, which are the only way an account exists.** Admin → Invites issues a
code, and *the code carries the role*: the signup trigger reads the role off the
invite row and ignores anything the client sends, so a hostile signup cannot
make itself an admin. Codes are single-use, expire in 14 days, revocable, and
can be locked to one email address so a forwarded code achieves nothing.
Creating one copies it to the clipboard, because the next thing anyone does is
paste it into a message.

**People.** Admin → People lists every account and lets an admin pause or
restore access. Suspension has to bite at the database or it is theatre — a
suspended user's session keeps working and `auth.uid()` is still their id — so
every policy is gated on `is_active()`, which reads the status set here. An
admin cannot pause themselves, because they could not undo it.

**Signup refuses roles this app cannot serve.** When sharing a database with the
full transport app, that app's admins can issue `driver` and `coordinator`
invites. Redeeming one here would have created a real account that then saw
nothing at all. It is now refused up front, naming which app the code belongs
to. The People list filters those roles out for the same reason.

The signup screen's role descriptions were rewritten. The ported ones promised
"check in at your hub" and "follow your child from pickup to safe drop-off" —
both describing the full app, and the second one exactly the claim this app must
never make.

**RLS tested with the app out of the loop.** `supabase/rls-test.sql` queries the
database directly as each role — the only way to know, since the full app once
found a suspended account whose session still worked because the check lived in
the UI. **19 assertions, all passing:**

- a student sees the bus they ride and **not** another one;
- a parent sees their child's bus and no others;
- a **suspended** student sees nothing at all — no positions, no assignments, not
  even the stop list;
- no non-admin can read a `device_key`;
- a student cannot create a bus, move themselves to another one, or fake a
  position.

### Phase 1 — the scaffold, and two ways to hold the data

The project exists and runs. Nothing is wired to the database yet; every screen
behind the role guard is a placeholder naming the phase that fills it in, so an
empty screen reads as *not yet* rather than *broken*.

**What runs**

- Expo 57 + expo-router, three route groups: `(parent)`, `(student)`, `(admin)`.
- A role guard built on `Stack.Protected`, so a route the account may not see is
  **never registered** — a student cannot deep-link into admin. That is the
  client half; RLS is the half that holds against a raw API call.
- Supabase client with the web/native session-storage split ported intact. That
  split is load-bearing, not cosmetic: a runtime `Platform.OS` check does not
  keep `expo-sqlite` out of the web bundle, because Metro resolves `require()`
  at build time.
- Sign in and sign up, ported and cut. The account-removal notice went with
  them — that belongs to the full app's admin-delete flow, which lite has no
  equivalent of.
- Typechecks clean; the web bundle exports.

**Two schemas, because "same database" and "publishable" are different jobs**

The ask was to develop against the full app's existing project so its test data
and logins are already there, but ship with something clean.

- `supabase/schema.sql` — **standalone.** Eleven tables, full RLS, the
  invite-based signup trigger. For publishing.
- `supabase/schema-shared.sql` — **alongside the full app.** Creates only the
  seven tables lite owns and *reuses* the four it shares: `organization`,
  `profiles`, `invites`, `guardian_links`. That reuse is the whole trick — a
  profile is a profile, so the same accounts sign in to both apps.
- `supabase/import-from-full.sql` — copies the full app's vehicles, hubs, route
  stops and rider assignments into lite's tables, so there is something to look
  at immediately. It only ever *reads* from the full app.

**The claim that mattered, and how it was checked.** The shared path must not
disturb the full app. After installing lite's schema into the same database and
running the import, the full app's own 36-assertion end-to-end day was run
again: **36 pass, 0 fail.** Lite's tables are additive, its one new function
(`my_bus_ids()`) has a name the full app does not use, and it deliberately does
*not* recreate the shared helpers — replacing `is_admin()` would have been
editing the full app's behaviour from over here.

**Where the import is lossy, on purpose**

- **Schools are not imported as stops.** Over there a route runs hub → school and
  the school is one end of it. Here there is no direction, just an ordered list a
  bus passes — so importing the school automatically would drop it into the
  middle of every run with no way to know which end it belongs at.
- **Routes with no default vehicle are skipped.** Lite has no concept of a route
  no bus drives.
- **Two routes sharing a vehicle collapse into one run**, lowest sequence first,
  then renumbered densely. Morning and afternoon are separate routes over there
  and one ordered stop list here.

**Carried over rather than rediscovered**

`device_key` in its own table (RLS is row-level, so a column on `buses` would be
readable by every student). Alerts keyed on the stop, not the student. The
operation's timezone stored from the first schema even though nothing compares a
clock yet — the full app shipped without it, was four hours out on everything,
and retrofitting touched five functions.
