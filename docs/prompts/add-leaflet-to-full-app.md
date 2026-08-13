# Prompt — give the full app a real web map

The lite app replaced its web map fallback with Leaflet (see
[CHANGELOG](../../CHANGELOG.md)). The full app,
`../bus-tracking-app`, still ships the diagram version of `Map.web.tsx`.

**This file is a prompt, not a change.** The full app is read-only from this
project — nothing here edits it. To do the work, start a Claude Code session
**in `bus-tracking-app/`** and paste everything below the line.

Every gotcha listed is one the lite implementation actually hit; the version of
this that already works is `src/components/Map.web.tsx` in this project, and it
is worth opening alongside.

---

Replace `src/components/Map.web.tsx` with a real Leaflet map.

## What is there now, and why

`expo-maps` has no web implementation at all. `Map.tsx` imports it at the top of
the file, and on web that import throws the moment the screen mounts — a blank
white page, because the component never gets far enough to render its own
fallback. Metro resolves `Map.web.tsx` first when bundling for web, which is what
keeps `expo-maps` out of the web bundle. That resolution is the mechanism; keep
it. A runtime `Platform.OS` check does **not** work, because Metro resolves
imports at build time.

Today `Map.web.tsx` uses that seam to draw the route as an ordered list of dots
down a rail. It is honest but it is not a map, and the office runs on the web
build. Swap the contents for Leaflet, keeping the seam exactly as it is.

## The contract that must not change

`Map.tsx` and `Map.web.tsx` are two implementations of one component. Keep
`MapMarker` and the props identical between them, and do not touch `Map.tsx`'s
native behaviour. The two callers are:

- `app/(parent)/map.tsx` — every stop on the route plus the van, `path` for the
  route line. Titles already arrive numbered (`` `${stop.seq}. ${name}` ``), and
  a stale van fix is deliberately left out of `markers` entirely.
- `src/components/VanEta.tsx` — passes `center` and `zoom: 14`, pointed at the
  van's own position.

Recommended addition: an optional `badge?: string` on `MapMarker`, set to
`String(stop.seq)` in `app/(parent)/map.tsx`, so the pin itself carries the stop
number instead of hiding it in a popup. Optional and additive, so nothing else
changes. Lite does exactly this.

## Setup

```bash
npm install leaflet@^1.9.4
npm install --save-dev @types/leaflet@^1.9.20
```

In `Map.web.tsx`:

```tsx
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
```

Metro enables CSS imports on web by default in SDK 57 and ignores global
stylesheets on native, so the `.css` import is safe — but `tsc` still needs a
declaration for it. Add `globals.d.ts` at the project root with
`declare module '*.css';` (the root is already in `tsconfig.json`'s `include`).

`app.json` has `web.output: "single"`, a client-rendered SPA, so Leaflet touching
`document` at module load is fine. **If that is ever changed to `"static"`, the
top-level `import L from 'leaflet'` has to move behind a dynamic `import()`
inside the mount effect**, or the prerender crashes.

## The seven things that will bite

1. **Leaflet's default marker icon will not render.** `leaflet.css` references
   `images/marker-icon.png` and the layers-control sprite through `url()`, and
   those do not resolve through Metro. Build every pin with `L.divIcon` and
   inline HTML instead, and skip the layers control. Pass `className: ''` to
   `divIcon` — leaving it unset gives Leaflet's own `leaflet-div-icon`, a white
   box behind every pin.
2. **The container must be a DOM node.** `react-native-web`'s `View` forwards its
   ref to the underlying `div` (`useMergeRefs(hostRef, platformMethodsRef,
   forwardedRef)`), so `node as unknown as HTMLElement` is correct — just not
   something TypeScript will tell you.
3. **The container needs an explicit height.** Both call sites render inside a
   `ScrollView`, where `flex: 1` has nothing to fill and collapses to zero.
   `style={{ height: 280 }}` from the caller, as now.
4. **Build the map in a ref callback, not a `[]` effect** — and this one is worth
   reading twice, because the effect version looks right and is not. The
   component does not always render the container: with no markers it renders a
   panel instead, and `app/(parent)/map.tsx` renders exactly that on first paint,
   before the route and the van have loaded. A mount effect runs once against a
   container that does not exist yet, returns early, and never runs again when
   the data arrives — a permanently blank map, on the one screen that matters.
   A ref callback fires when the node actually attaches, which is the real event.

   Teardown then arrives as a `null` node rather than an effect cleanup, and it
   **must** call `map.remove()`: Leaflet stamps the element with `_leaflet_id`
   and throws *"Map container is already initialized"* on the next attach. Note
   that React 19's ref-cleanup return value does **not** help here —
   `react-native-web` merges refs through a plain function that discards return
   values (`dist/modules/mergeRefs/index.js`), so React falls back to calling
   with `null`. Handle the `null` branch explicitly.
5. **`ResizeObserver` → `map.invalidateSize()`.** A flex layout can size the
   container after Leaflet measured it, leaving tiles laid out against a
   zero-width box.
6. **`scrollWheelZoom: false`.** The map sits inside a long scrolling page; a map
   that grabs the wheel traps the reader. Enable it on `map.on('click')` and
   disable again on `map.on('mouseout')`.
7. **Do not drive the camera from props on web.** This is the one deliberate
   divergence from `Map.tsx`. A browser map is panned and zoomed with a mouse,
   and re-centring every time a van fix arrives snatches it back from whoever is
   reading it. Use `center`/`zoom` for the **opening** view only, then:
   - fit the bounds of the *stop* markers, keyed on the stops alone so a moving
     van never re-frames the map (`fitBounds(..., { padding: [30, 30], maxZoom: 16 })`);
   - pan to the van only when it has left the visible area
     (`if (!map.getBounds().pad(-0.15).contains(at)) map.panTo(at)`).

   `VanEta` passes `center` expecting the van to be in shot. Fitting the stop
   bounds normally covers it, and the pan-when-outside rule covers the rest —
   but check that screen specifically, because it is the one that notices.

## Style

Match the app's own dark theme rather than dropping a bright OSM raster into it.
Lite uses CARTO's dark basemap — free, with attribution:

```
https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
subdomains: 'abcd', maxZoom: 20, detectRetina: true
attribution: © OpenStreetMap contributors © CARTO
```

Swap the URL and the credit line together if you change provider. Pull pin and
control colours from `theme` in `src/components/ui.tsx`; inject the pin CSS once
as a single `<style>` element keyed by id, rather than per-marker inline styles.

Popup content is rendered as HTML by Leaflet, and stop names are staff-entered.
Pass an `HTMLElement` with `textContent` set, not a string.

## Do not

- Do not edit `Map.tsx`, or change either component's props.
- Do not add `react-leaflet` — one imperative effect is smaller than the
  dependency, and this component is already the seam that isolates the map.
- Do not delete the "no markers yet" empty state; both callers can render before
  data arrives.
- Do not touch the stop list rendered beneath the map on `app/(parent)/map.tsx`.
  The map replaces the rail diagram, not the addresses.

## Done when

- `npm run typecheck` is clean.
- `npx expo export -p web` succeeds and emits a `_expo/static/css/leaflet-*.css`
  bundle that `index.html` links.
- The web bundle contains the tile URL; the **native** bundle contains no
  Leaflet — `npx expo export -p ios` then grep for `leaflet` to confirm the
  `.web.tsx` seam is doing its job.
- On `npm run web`: the parent map screen shows tiles, numbered stop pins, the
  route line, and a distinct van pin; reordering nothing and simply reloading
  does not throw "Map container is already initialized".
- `CHANGELOG.md` and `docs/FEATURES.md` **in the full app** updated. Do not
  mention the lite app in either.
