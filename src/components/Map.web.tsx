import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { theme } from './ui';
import type { MapMarker, MapProps } from './Map';

/**
 * The map, on WEB — a real one, drawn with Leaflet.
 *
 * `expo-maps` has no web implementation. The full app's answer was to draw the
 * run as a list of dots down a rail and tell the reader to open the phone app;
 * this is the same component contract with an actual slippy map behind it, so an
 * admin at a desk can see that a geocoded stop landed on the right corner rather
 * than in the next county. That check is the entire reason stops are found by
 * address instead of typed as coordinates — it deserves a map.
 *
 * ## Why the imports are safe here
 *
 * Metro resolves this `.web.tsx` ahead of `Map.tsx` when bundling for web, so
 * `expo-maps` is never referenced on web and `leaflet` is never referenced on
 * native. (Proven, not assumed: `expo export -p ios` contains no Leaflet.)
 * Leaflet touches `document` at module load, which is fine because `app.json`
 * sets `web.output: "single"` — a client-rendered SPA, no prerender. If that
 * ever becomes `"static"`, this import has to move behind a dynamic `import()`.
 *
 * `leaflet.css` is imported as a global stylesheet, which Metro supports on web
 * and silently ignores on native. Its `url()` references (the default marker
 * PNGs, the layers-control sprite) do not resolve through Metro — which costs
 * nothing here, because every pin is a `divIcon` and there is no layers control.
 * Do not switch to `L.marker`'s default icon expecting it to render.
 *
 * ## Where this deliberately differs from the native map
 *
 * The native map re-points its camera whenever `center` changes. Here `center`
 * only decides the *opening* view: a browser map is something the reader pans
 * and zooms with a mouse, and a camera driven from props snatches it back every
 * time a position arrives. Instead the view fits the stops once, then follows
 * the bus only when it leaves the visible area.
 */

/** CARTO's dark basemap, to sit on the app's own near-black rather than fight it.
 *  Free with attribution; swap the URL and the credit together if that changes. */
const TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CREDIT =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const PIN_STYLES = `
.btl-pin {
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; border-radius: 999px; position: relative;
  font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  border: 2px solid ${theme.bg};
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}
.btl-pin--stop   { width: 22px; height: 22px; background: ${theme.faint};  color: ${theme.bg}; }
.btl-pin--pickup { width: 28px; height: 28px; background: ${theme.accent}; color: ${theme.accentText};
                   border-color: ${theme.text}; }
.btl-pin--bus    { width: 30px; height: 30px; background: ${theme.bus};    color: ${theme.bg};
                   border-color: ${theme.text}; }
.btl-pin--bus::after {
  content: ''; position: absolute; inset: -7px; border-radius: 999px;
  border: 2px solid ${theme.bus}; opacity: 0.55;
  animation: btl-pulse 2s ease-out infinite;
}
@keyframes btl-pulse {
  0%   { transform: scale(0.7); opacity: 0.55; }
  100% { transform: scale(1.25); opacity: 0; }
}
.leaflet-container { background: ${theme.bg}; font-family: inherit; }
.leaflet-container .leaflet-control-attribution {
  background: rgba(11, 18, 32, 0.78); color: ${theme.faint}; font-size: 10px;
}
.leaflet-container .leaflet-control-attribution a { color: ${theme.muted}; }
.leaflet-bar a {
  background: ${theme.surface}; color: ${theme.text}; border-bottom-color: ${theme.border};
}
.leaflet-bar a:hover { background: ${theme.surfaceAlt}; color: ${theme.text}; }
`;

/** One `<style>` for the whole app, added the first time a map mounts. */
function ensurePinStyles() {
  const id = 'btl-map-styles';
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = PIN_STYLES;
  document.head.appendChild(el);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const BUS_GLYPH =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M6 2h12a3 3 0 0 1 3 3v9a3 3 0 0 1-1.5 2.6V19a1.5 1.5 0 0 1-3 0v-1H7.5v1a1.5 1.5 0 0 1-3 0v-2.4A3 3 0 0 1 3 14V5a3 3 0 0 1 3-3Zm-.5 4v5h13V6h-13ZM7 13.5a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Zm10 0a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z"/>' +
  '</svg>';

function iconFor(marker: MapMarker) {
  const kind = marker.kind ?? 'stop';
  const size = kind === 'bus' ? 30 : kind === 'pickup' ? 28 : 22;
  const inner = kind === 'bus' ? BUS_GLYPH : escapeHtml(marker.badge ?? '');

  return L.divIcon({
    // An empty className replaces Leaflet's own `leaflet-div-icon`, which would
    // otherwise paint a white box behind every pin.
    className: '',
    html: `<div class="btl-pin btl-pin--${kind}">${inner}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Leaflet renders popup content as HTML; a text node cannot inject anything. */
function textNode(value: string) {
  const el = document.createElement('div');
  el.textContent = value;
  el.style.color = '#0B1220';
  el.style.fontWeight = '600';
  return el;
}

const labelFor = (m: MapMarker) => (m.badge ? `${m.badge} · ${m.title}` : m.title);

/** A stable empty default — a fresh `[]` per render would rebuild every layer. */
const NO_PATH: { lat: number; lng: number }[] = [];

export function Map({ markers, path = NO_PATH, center, zoom = 13, style }: MapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const sizeRef = useRef<ResizeObserver | null>(null);
  const framedBus = useRef(false);

  /** The *opening* view, captured once. Later changes must not re-frame the map. */
  const opening = useRef({ center, zoom }).current;

  const stops = useMemo(() => markers.filter((m) => m.kind !== 'bus'), [markers]);
  const bus = markers.find((m) => m.kind === 'bus') ?? null;

  /** Refit only when the *stops* change. A bus moving must not re-frame the map. */
  const fitKey = stops.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|');

  /**
   * Built and torn down by a ref callback rather than a mount effect.
   *
   * The container is not always rendered — with nothing to show this component
   * renders a panel instead — so "on mount" is the wrong moment. A `[]` effect
   * would run once against a container that did not exist yet and never run
   * again when the first marker arrived, leaving a permanently blank map. The
   * ref fires whenever the node actually attaches, which is the real event.
   *
   * `react-native-web` merges refs with a plain function that ignores return
   * values, so React 19's ref-cleanup protocol does not apply here: teardown
   * arrives as a `null` node, and it has to call `map.remove()`. Leaflet stamps
   * the element with `_leaflet_id` and throws "Map container is already
   * initialized" on the next attach otherwise — which React's dev-mode double
   * invocation surfaces immediately, and that is a feature.
   */
  const attach = useCallback((node: View | null) => {
    const el = node as unknown as HTMLElement | null;

    if (!el) {
      sizeRef.current?.disconnect();
      mapRef.current?.remove();
      sizeRef.current = null;
      mapRef.current = null;
      layersRef.current = null;
      framedBus.current = false;
      return;
    }
    if (mapRef.current) return;

    ensurePinStyles();

    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      // The admin screens are one long ScrollView. A map that grabs the wheel
      // traps the page, so the wheel only zooms once the map has been clicked.
      scrollWheelZoom: false,
    });
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    L.tileLayer(TILES, {
      attribution: CREDIT,
      subdomains: 'abcd',
      maxZoom: 20,
      detectRetina: true,
    }).addTo(map);

    map.setView(
      [opening.center?.lat ?? 0, opening.center?.lng ?? 0],
      opening.center ? opening.zoom : 2,
    );

    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // A flex layout can size the container after Leaflet has measured it, which
    // leaves the tiles laid out against a zero-width box.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    sizeRef.current = observer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins and the run line.
  useEffect(() => {
    const group = layersRef.current;
    if (!group) return;
    group.clearLayers();

    for (const marker of markers) {
      L.marker([marker.lat, marker.lng], {
        icon: iconFor(marker),
        title: labelFor(marker),
        zIndexOffset: marker.kind === 'bus' ? 1000 : 0,
      })
        .bindPopup(textNode(labelFor(marker)))
        .addTo(group);
    }

    if (path.length > 1) {
      L.polyline(
        path.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: theme.accent, weight: 4, opacity: 0.85 },
      ).addTo(group);
    }
  }, [markers, path]);

  // Frame the stops. With no stops at all there is nothing to frame but the bus,
  // and that happens once — after which the follow-effect below keeps it in shot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (stops.length > 0) {
      map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng] as L.LatLngTuple)), {
        padding: [30, 30],
        maxZoom: 16,
      });
    } else if (bus && !framedBus.current) {
      framedBus.current = true;
      map.setView([bus.lat, bus.lng], zoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, bus !== null]);

  // Follow the bus, but only once it has left the view — otherwise every fix
  // yanks the map out from under whoever is reading it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bus) return;
    const at = L.latLng(bus.lat, bus.lng);
    if (!map.getBounds().pad(-0.15).contains(at)) map.panTo(at);
  }, [bus?.lat, bus?.lng]);

  if (markers.length === 0) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.placeholderText}>Nothing to show on the map yet.</Text>
      </View>
    );
  }

  return <View ref={attach} style={[styles.map, style]} />;
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
    minHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    // Keeps the tiles inside the rounded corners.
    overflow: 'hidden',
    backgroundColor: theme.bg,
  },
  placeholder: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
  },
  placeholderText: { color: theme.faint, fontSize: 14 },
});
