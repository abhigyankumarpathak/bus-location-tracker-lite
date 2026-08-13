# Changelog

Every change to Bus Tracker (lite), newest first.

This is the lite app's own history. The full Student Transportation Platform is
a separate project with a separate changelog — nothing from here appears there,
and nothing from there appears here.

---

## 13 August 2026

### A map component, and a real one on the web

The map arrives ahead of phase 5, because two admin screens needed it before
anything is reporting a position. `Map.tsx` and `Map.web.tsx` came across from
the full app as one component with two implementations — `expo-maps` behind an
`AppleMaps.View` / `GoogleMaps.View` split on the phone, and Metro resolving
`Map.web.tsx` first in the browser. That resolution is the mechanism, not a
convenience: `expo-maps` has no web build at all and throws at module load, and
a runtime `Platform.OS` check cannot save you because Metro resolves imports
when it bundles.

**The web half is Leaflet, and an actual map.** The full app spends its web
implementation drawing the route as dots down a rail and telling the reader to
open the phone app. This one draws tiles. That matters here more than it does
there: stops in this app are *found by address* rather than typed as
coordinates, and the geocoder's own description of what it matched catches "Oak
Road, wrong county" but not "Oak Road, right county, wrong side of the river".
So the stop form now shows the pin as soon as there is one, and the run shows
the whole ordered sequence with the line drawn through it — in **draft** order,
so reordering with ↑ and ↓ redraws the line and a run that doubles back on
itself is visible before it becomes an ETA that does too.

Leaflet came in as a plain dependency driven from one effect rather than
`react-leaflet`; the component was already the seam that isolates the map, and a
wrapper around a wrapper buys nothing. Details worth not rediscovering:

- **The default marker icon does not render.** `leaflet.css` reaches for
  `images/marker-icon.png` through `url()`, which does not resolve through
  Metro. Every pin is an `L.divIcon` with inline HTML — which is what the run's
  position numbers ride on anyway, via a new optional `badge` on `MapMarker`.
- **The map is built in a ref callback, not a mount effect.** The container is
  not always rendered — with nothing to show, the component renders a panel
  instead — so "on mount" is the wrong moment: a `[]` effect runs once against a
  container that does not exist yet and never runs again when the first marker
  arrives. That is a permanently blank map on exactly the screen phase 5 adds.
  Teardown then arrives as a `null` node and has to call `map.remove()`, because
  Leaflet stamps the element and throws *"Map container is already initialized"*
  on the next attach. React 19's ref-cleanup return does not help:
  `react-native-web` merges refs through a function that discards return values.
- **The camera is not driven from props on web**, which is the one deliberate
  divergence from the native map. A browser map is panned with a mouse, and
  re-centring on every incoming fix snatches it back from whoever is reading it.
  The view fits the stops once, then follows the bus only when it leaves the
  visible area — which is the behaviour phase 5 wants when positions start
  arriving.
- **The wheel does not zoom until the map is clicked.** Both maps sit inside a
  long `ScrollView`; one that grabs the wheel traps the page.
- CARTO's dark basemap, so the map sits on the app's near-black rather than
  fighting it. Free, with attribution, and the URL and the credit line move
  together.

The seam is proven rather than assumed: `expo export -p ios` produces a bundle
with no Leaflet in it, and the web export emits `leaflet.css` as its own bundle.
Neither map has yet been drawn on a screen from this project — the native half
is the full app's implementation ported across and has not been on a device, and
nothing has been clicked through in a browser.

Also added: [`docs/prompts/add-leaflet-to-full-app.md`](docs/prompts/add-leaflet-to-full-app.md)
— the same change written up as a prompt to run **in the full app**, carrying
every gotcha above. The full app is read-only from here, so it is a prompt and
not a patch.

### Phase 3 — an admin can now describe the operation

Everything a bus tracker needs to know before it can track anything: the
vehicles, the places they stop, the order they stop in, and who is watching
which one. All of it is admin-only. Families remain passive — there is still
nothing in this app a parent or student can change.

**Buses, and the key that is the whole security model.** Admin → Buses creates
vehicles and shows each one's `device_key` — the credential the GPS unit in the
van reports with. It stays hidden until asked for, and rotating it is a database
function rather than a client update, because a device key is a password and the
client has no business choosing one. Deleting a bus is offered but pausing is
the default: a paused bus keeps its history and stops being offered when
building runs or assigning students, and the delete confirmation counts out
exactly what goes with it.

**Stops are found, not typed.** `geocode.ts` came across from the full app
carrying the thing it learned the hard way — that "Corner of Stevens Creek Blvd
and Wolfe Road" returns nothing from Nominatim, "Stevens Creek Blvd & Wolfe Road"
returns the junction, and an admin writing the sentence they would naturally
write would otherwise be told their stop does not exist. The geocoder's own
description of what it matched is shown before anything is saved, because a pin
in the wrong county is caught here or by a parent watching a bus that never
arrives.

**The ordered run, which is what replaced route templates.** A bus and a
sequence of stops — no direction, no timetable, no daily trip generation, no
cron. Reordering is batched behind a Save button for a reason that is a hard
constraint rather than a preference: `unique (bus_id, position)` is deferrable,
and deferral reaches only to the end of a *transaction*, while every PostgREST
call is its own. "Move this stop up" from the client is two updates in two
transactions, and the first collides on a position the second was about to
vacate. So the whole order goes to **`set_bus_run()`** and is renumbered there.

That function also deletes the assignments to any stop leaving the run, and
returns how many — a stop the bus no longer reaches cannot have anyone waiting
at it, and a row that says otherwise promises a family a bus that never comes.
The admin is told the cost once, before it happens.

**Assignment, and what `uses_it` actually does.** A student goes on a bus and a
stop; the opt-out pauses that stop without deleting it. It is not a
notification preference implemented in the UI — `my_bus_ids()`, which every
watch policy in this app leans on, filters on the flag, so pausing stops the
*database* serving that bus to that family. Tested from both sides: a paused
student sees no positions, and neither does their parent.

**Parent ↔ child links, which are not on phase 3's list.** Added anyway, because
without them a parent account cannot see anything at all and no later phase
claims the job. Deliberately *not* the full app's component of the same name:
over there a link is a consent flow, one side proposing and the other accepting,
because it grants sight of a child's movements. Here it grants sight of a
vehicle on a public road, and families have no screen to accept anything on — so
the office sets it, exactly as the office decides which bus a child rides.

**One correction to a claim made in phase 1.** *Installing* lite's schema
alongside the full app still alters nothing over there. But linking a family is
the first time lite **writes to a shared table**: `guardian_links` is the full
app's, and a link made here is a link the full app will honour. That is the
right answer — a guardian is a guardian in both — but it is no longer true to
say lite never writes to the full app's tables, and `supabase/SETUP.md` now says
so plainly. Lite writes `status` explicitly rather than taking the default,
because over there the default is `pending` and `is_guardian_of()` counts only
`accepted` — a defaulted row is a parent who silently sees nothing.

**The RLS test can now actually be run, and grew to 32 assertions.** Phase 2's
19 needed a throwaway Supabase project. `supabase/local-shim.sql` fakes just
enough of Supabase — the three PostgREST roles, `auth.users`, `auth.uid()`
reading the JWT claim out of a GUC, and the default privileges that make
`set role authenticated` behave like a real client — for the file to run against
a plain local PostgreSQL. It also truncates the fleet on the way in, so a second
run no longer reports yesterday's state as a failure. **32 pass, 0 fail, three
runs in a row.** The 13 new ones cover: reordering and dense renumbering; a key
that really changes when rotated; a student refused by `set_bus_run()` and
`rotate_device_key()` — which matters more than it looks, since both are
`security definer` and bypass RLS by design, making the `is_admin()` gate inside
them the only thing standing there; a student refused when adding a stop, when
putting a stop on a run, and when inventing a guardian link; the opt-out
silencing the database for both student and parent, and restoring it; and
`set_bus_run()` reporting and really deleting the assignments it drops.

Re-checked while there: with lite installed in the same database and without it,
the full app's own end-to-end test gives **identical results**. One assertion
about a push notification fails in both, on the shim — it needs Supabase
machinery the shim does not fake — so lite's presence changes nothing, which was
the claim.

**The app has its own icon at last.** `assets/` was empty and `app.json` named no
`icon`, so on `localhost:8081` the browser served whatever favicon it had cached
for that origin — which was the *Focus* app from the neighbouring directory, on
the same port. There is now a proper set drawn in the app's own palette (icon,
web favicon, Android adaptive foreground/background/monochrome, and a
notification silhouette for phase 6), all wired up in `app.json`. The dev server
also moved to **port 8082**, so the two apps stop sharing a browser origin
altogether — a favicon cache is per-origin, and that collision is the thing that
caused this.

**A no-op fixed on the way past.** `react-native-web`'s `Alert.alert` is
literally `static alert() {}`. Every confirmation on the web build — the one an
admin at a desk is most likely to use — silently did nothing, and creating an
invite showed a code the admin never got to see. `confirmAction()` and
`notify()` in `ui.tsx` use the browser's own dialogs on web, and phase 2's
invite screen now uses them.

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
