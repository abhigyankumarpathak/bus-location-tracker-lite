import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { theme } from './ui';

/**
 * The map, on a PHONE.
 *
 * `expo-maps` is alpha in SDK 57 and deliberately does not ship a cross-platform
 * view: you get `AppleMaps.View` on iOS and `GoogleMaps.View` on Android, with
 * different prop shapes. Every screen talks to this wrapper instead, so that
 * split stays contained to one file.
 *
 * The web build never reaches this file — Metro resolves `Map.web.tsx` first,
 * which draws a real Leaflet map. `expo-maps` has no web implementation at all,
 * and importing it on web throws at module load, which renders as a blank white
 * page rather than a fallback. A runtime `Platform.OS` check does NOT save you:
 * Metro resolves imports at build time. Same reason `session-storage.web.ts`
 * exists.
 */

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  /** Buses render distinctly from stops; `pickup` is the viewer's own stop. */
  kind?: 'bus' | 'stop' | 'pickup';
  /**
   * A short overlay on the pin — in practice the stop's position in the run.
   *
   * Not in the full app's version of this interface. It is here because a run in
   * this app is *only* an order (there are no route templates and no timetable),
   * so the number is the one thing a map of it has to carry.
   */
  badge?: string;
}

export interface MapProps {
  markers: MapMarker[];
  /** Draws the route line through these points, in order. */
  path?: { lat: number; lng: number }[];
  /** Where to point the camera. Defaults to the first marker. */
  center?: { lat: number; lng: number } | null;
  zoom?: number;
  style?: object;
}

const COLORS = {
  bus: theme.bus,
  stop: theme.faint,
  pickup: theme.accent,
};

const SF_SYMBOLS = {
  bus: 'bus.fill',
  stop: 'circle.fill',
  pickup: 'figure.wave',
};

/** Neither native map draws a badge, so it goes in front of the pin's title. */
function labelFor(marker: MapMarker) {
  return marker.badge ? `${marker.badge} · ${marker.title}` : marker.title;
}

/** A stable empty default — a fresh `[]` per render would defeat the memo below. */
const NO_PATH: { lat: number; lng: number }[] = [];

export function Map({ markers, path = NO_PATH, center, zoom = 13, style }: MapProps) {
  const focus = center ?? (markers.length ? { lat: markers[0].lat, lng: markers[0].lng } : null);

  const cameraPosition = useMemo(
    () => (focus ? { coordinates: { latitude: focus.lat, longitude: focus.lng }, zoom } : undefined),
    [focus?.lat, focus?.lng, zoom],
  );

  const coordinates = useMemo(
    () => path.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [path],
  );

  if (!focus) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.placeholderText}>Nothing to show on the map yet.</Text>
      </View>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <AppleMaps.View
        style={[styles.map, style]}
        cameraPosition={cameraPosition}
        markers={markers.map((m) => ({
          id: m.id,
          coordinates: { latitude: m.lat, longitude: m.lng },
          title: labelFor(m),
          tintColor: COLORS[m.kind ?? 'stop'],
          systemImage: SF_SYMBOLS[m.kind ?? 'stop'],
        }))}
        polylines={coordinates.length > 1 ? [{ coordinates, color: theme.accent, width: 4 }] : []}
        uiSettings={{ myLocationButtonEnabled: false }}
      />
    );
  }

  if (Platform.OS === 'android') {
    return (
      <GoogleMaps.View
        style={[styles.map, style]}
        cameraPosition={cameraPosition}
        markers={markers.map((m) => ({
          id: m.id,
          coordinates: { latitude: m.lat, longitude: m.lng },
          title: labelFor(m),
          snippet: m.kind === 'bus' ? 'Live position' : undefined,
        }))}
        polylines={coordinates.length > 1 ? [{ coordinates, color: theme.accent, width: 4 }] : []}
      />
    );
  }

  // Unreachable on web (Map.web.tsx wins) and there is no fourth platform, but a
  // map that renders nothing is worse than one that says why.
  return (
    <View style={[styles.placeholder, style]}>
      <Text style={styles.placeholderText}>Maps are not available on this platform.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1, minHeight: 220, borderRadius: 16 },
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
