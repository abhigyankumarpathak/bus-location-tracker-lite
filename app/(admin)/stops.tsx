import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { geocode } from '../../src/lib/geocode';
import type { Bus, Stop } from '../../src/lib/types';
import { BusRun } from '../../src/components/BusRun';
import { Map } from '../../src/components/Map';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Loading,
  Row,
  Screen,
  SectionLabel,
  Title,
  confirmAction,
  theme,
} from '../../src/components/ui';

/**
 * Two jobs that belong together: the places a bus can stop, and the order it
 * passes them on each bus.
 *
 * A stop is a name and a point. Nobody should have to *type* the point — an
 * admin knows "the corner of Oak Road and Example Way", not 40.7128 / −74.0060,
 * and asking for coordinates is how you get a pin in the ocean. So the address
 * goes through a geocoder and the coordinates are shown for confirmation before
 * anything is saved.
 */
interface BusStopRow {
  bus_id: string;
  stop_id: string;
  position: number;
}

export default function AdminStops() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [busStops, setBusStops] = useState<BusStopRow[]>([]);
  const [assignments, setAssignments] = useState<{ bus_id: string; stop_id: string }[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busId, setBusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [stopRes, busRes, runRes, assignRes] = await Promise.all([
      supabase.from('stops').select('*').order('name'),
      supabase.from('buses').select('*').eq('active', true).order('label'),
      supabase.from('bus_stops').select('bus_id, stop_id, position').order('position'),
      supabase.from('student_stops').select('bus_id, stop_id'),
    ]);

    const firstError = stopRes.error ?? busRes.error ?? runRes.error ?? assignRes.error;
    if (firstError) setError(firstError.message);

    setStops((stopRes.data as Stop[]) ?? []);
    setBuses((busRes.data as Bus[]) ?? []);
    setBusStops((runRes.data as BusStopRow[]) ?? []);
    setAssignments((assignRes.data as { bus_id: string; stop_id: string }[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const selected = buses.find((b) => b.id === busId) ?? buses[0] ?? null;

  /** The saved order for the selected bus, as stop ids. */
  const savedRun = useMemo(
    () =>
      busStops
        .filter((r) => r.bus_id === selected?.id)
        .sort((a, b) => a.position - b.position)
        .map((r) => r.stop_id),
    [busStops, selected?.id],
  );

  /** How many students are assigned to each stop on the selected bus. */
  const ridersOnRun = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assignments) {
      if (a.bus_id !== selected?.id) continue;
      counts[a.stop_id] = (counts[a.stop_id] ?? 0) + 1;
    }
    return counts;
  }, [assignments, selected?.id]);

  /** Across the whole fleet, for the library below. */
  const runsPerStop = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of busStops) counts[r.stop_id] = (counts[r.stop_id] ?? 0) + 1;
    return counts;
  }, [busStops]);

  const ridersPerStop = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assignments) counts[a.stop_id] = (counts[a.stop_id] ?? 0) + 1;
    return counts;
  }, [assignments]);

  async function saveStop(values: StopValues, id?: string) {
    setError('');
    const payload = {
      name: values.name.trim(),
      address: values.address.trim() || null,
      lat: Number(values.lat),
      lng: Number(values.lng),
    };

    const { error: e } = id
      ? await supabase.from('stops').update(payload).eq('id', id)
      : await supabase.from('stops').insert(payload);

    if (e) {
      setError(e.message);
      return false;
    }
    setEditing(null);
    await load();
    return true;
  }

  async function setActive(stop: Stop, active: boolean) {
    setError('');
    const { error: e } = await supabase.from('stops').update({ active }).eq('id', stop.id);
    if (e) setError(e.message);
    await load();
  }

  async function remove(stop: Stop) {
    const runs = runsPerStop[stop.id] ?? 0;
    const riders = ridersPerStop[stop.id] ?? 0;

    const agreed = await confirmAction(
      `Delete ${stop.name}?`,
      runs || riders
        ? `It is on ${runs} run${runs === 1 ? '' : 's'} and ${riders} student${riders === 1 ? '' : 's'} are assigned to it. All of that goes too, and it cannot be undone. Pause the stop instead if you only want it out of the way.`
        : 'It is not on any run and nobody is assigned to it, so nothing else changes.',
      'Delete',
    );
    if (!agreed) return;

    setError('');
    const { error: e } = await supabase.from('stops').delete().eq('id', stop.id);
    if (e) setError(e.message);
    await load();
  }

  if (loading) return <Loading />;

  return (
    <Screen>
      <Title sub="Every stop, and the order they come in on each bus.">Stops</Title>

      <ErrorText>{error}</ErrorText>

      {buses.length === 0 ? (
        <Empty>No buses in service. Add one on the Buses tab before building a run.</Empty>
      ) : (
        <>
          <Row style={styles.wrap}>
            {buses.map((b) => (
              <Button
                key={b.id}
                label={b.label}
                variant={selected?.id === b.id ? 'primary' : 'secondary'}
                onPress={() => setBusId(b.id)}
              />
            ))}
          </Row>

          {selected ? (
            <BusRun
              key={selected.id}
              bus={selected}
              stops={stops}
              saved={savedRun}
              riders={ridersOnRun}
              onSaved={load}
            />
          ) : null}
        </>
      )}

      <SectionLabel>Add a stop</SectionLabel>
      <StopForm submitLabel="Add stop" onSubmit={(v) => saveStop(v)} />

      <SectionLabel>Every stop ({stops.length})</SectionLabel>
      {stops.length === 0 ? (
        <Empty>No stops yet. Add one above — a name and an address is enough.</Empty>
      ) : (
        stops.map((stop) =>
          editing === stop.id ? (
            <StopForm
              key={stop.id}
              initial={{
                name: stop.name,
                address: stop.address ?? '',
                lat: String(stop.lat),
                lng: String(stop.lng),
              }}
              submitLabel="Save stop"
              onSubmit={(v) => saveStop(v, stop.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Card key={stop.id} style={stop.active ? undefined : styles.dim}>
              <Row style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{stop.name}</Text>
                  <Text style={styles.fine}>{stop.address ?? 'No address on file'}</Text>
                  <Text style={styles.coords}>
                    {stop.lat.toFixed(5)}, {stop.lng.toFixed(5)}
                  </Text>
                </View>
                <Badge
                  label={
                    !stop.active
                      ? 'Paused'
                      : runsPerStop[stop.id]
                        ? `On ${runsPerStop[stop.id]} run${runsPerStop[stop.id] === 1 ? '' : 's'}`
                        : 'Unused'
                  }
                  tone={!stop.active ? 'warn' : runsPerStop[stop.id] ? 'accent' : 'neutral'}
                />
              </Row>

              {ridersPerStop[stop.id] ? (
                <Text style={styles.fine}>
                  {ridersPerStop[stop.id]} student
                  {ridersPerStop[stop.id] === 1 ? '' : 's'} assigned here.
                </Text>
              ) : null}

              <Row style={styles.wrap}>
                <Button
                  label="Edit"
                  variant="secondary"
                  onPress={() => setEditing(stop.id)}
                />
                {stop.active ? (
                  <Button label="Pause" variant="ghost" onPress={() => setActive(stop, false)} />
                ) : (
                  <Button label="Reinstate" variant="ghost" onPress={() => setActive(stop, true)} />
                )}
                <Button label="Delete" variant="danger" onPress={() => remove(stop)} />
              </Row>
            </Card>
          ),
        )
      )}
    </Screen>
  );
}

interface StopValues {
  name: string;
  address: string;
  lat: string;
  lng: string;
}

const BLANK: StopValues = { name: '', address: '', lat: '', lng: '' };

/**
 * One form for adding and for editing, because they are the same thing.
 *
 * The address is looked up rather than trusted: the geocoder's own description
 * of what it matched is shown before saving, so "Oak Rd" landing in the wrong
 * county is caught here rather than by a parent watching a bus that never
 * arrives. Coordinates stay editable for the cases where no geocoder will help.
 */
function StopForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: StopValues;
  submitLabel: string;
  onSubmit: (values: StopValues) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<StopValues>(initial ?? BLANK);
  const [matched, setMatched] = useState('');
  const [error, setError] = useState('');
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof StopValues) => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  /**
   * The pin, once there is one worth drawing.
   *
   * The geocoder's own description of what it matched catches "Oak Rd, wrong
   * county"; it does not catch "Oak Rd, right county, wrong side of the river".
   * Seeing the point on a map does, and it costs nothing to look.
   */
  const lat = Number(values.lat);
  const lng = Number(values.lng);
  const pinned =
    values.lat.trim() !== '' &&
    values.lng.trim() !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const pin = useMemo(
    () => [{ id: 'pin', lat, lng, title: values.name.trim() || 'This stop', kind: 'pickup' as const }],
    [lat, lng, values.name],
  );

  async function lookUp() {
    setError('');
    setMatched('');
    setLooking(true);
    try {
      const hit = await geocode(values.address);
      if (!hit) {
        setError(
          'No match. Try the junction as "Oak Road & Example Way, Town", or type the coordinates below.',
        );
        return;
      }
      setValues((prev) => ({ ...prev, lat: hit.lat.toFixed(6), lng: hit.lng.toFixed(6) }));
      setMatched(hit.label);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Address lookup failed.');
    } finally {
      setLooking(false);
    }
  }

  async function submit() {
    const lat = Number(values.lat);
    const lng = Number(values.lng);

    if (!values.name.trim()) {
      setError('Give the stop a name families would recognise.');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setError('This stop has no position yet. Look up the address, or type the coordinates.');
      return;
    }

    setError('');
    setBusy(true);
    const saved = await onSubmit({ ...values, lat: String(lat), lng: String(lng) });
    setBusy(false);
    if (saved && !initial) {
      setValues(BLANK);
      setMatched('');
    }
  }

  return (
    <Card>
      <Field
        label="Name"
        value={values.name}
        onChangeText={set('name')}
        placeholder="Oak Road corner"
        autoCapitalize="words"
      />
      <Field
        label="Address or junction"
        value={values.address}
        onChangeText={set('address')}
        placeholder="Corner of Oak Road and Example Way, Springfield"
        autoCapitalize="words"
      />
      <Button
        label={looking ? 'Looking…' : 'Look up address'}
        variant="secondary"
        loading={looking}
        onPress={lookUp}
      />

      {matched ? <Text style={styles.matched}>Found: {matched}</Text> : null}

      <Row style={styles.pair}>
        <View style={styles.grow}>
          <Field
            label="Latitude"
            value={values.lat}
            onChangeText={set('lat')}
            placeholder="40.71280"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.grow}>
          <Field
            label="Longitude"
            value={values.lng}
            onChangeText={set('lng')}
            placeholder="-74.00600"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </Row>

      {pinned ? <Map markers={pin} zoom={16} style={styles.map} /> : null}

      <ErrorText>{error}</ErrorText>

      <Row style={styles.wrap}>
        <Button label={submitLabel} onPress={submit} loading={busy} />
        {onCancel ? <Button label="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  pair: { alignItems: 'flex-start' },
  dim: { opacity: 0.7 },
  // Fixed height: inside a ScrollView `flex: 1` has nothing to fill.
  map: { height: 220 },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  coords: { fontSize: 11, color: theme.faint, letterSpacing: 0.3 },
  matched: { fontSize: 12, color: theme.success, lineHeight: 17 },
});
