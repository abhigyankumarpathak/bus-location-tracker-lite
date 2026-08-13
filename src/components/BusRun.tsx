import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Bus, Stop } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Row,
  SectionLabel,
  confirmAction,
  theme,
} from './ui';

/**
 * The ordered run: a bus, and the stops it passes, in order.
 *
 * This is the whole of what replaced the full app's route templates, route
 * stops, daily trip generation and cron. There is no direction and no timetable
 * — just a sequence. Everything downstream reads it: the ETA walks the
 * remaining stops in this order rather than measuring a straight line, and the
 * notifications only ever fire for stops still ahead of the bus.
 *
 * ## Why edits are batched behind a Save button
 *
 * Two reasons, and the first is a hard constraint. `unique (bus_id, position)`
 * is deferrable, but deferral only reaches to the end of a TRANSACTION — and
 * every PostgREST call is its own. "Move this stop up" done from here as two
 * updates would collide on a position the second was about to vacate. So the
 * whole order goes to `set_bus_run()` at once and is renumbered there.
 *
 * The second is that taking a stop off a run **drops the assignments to it** —
 * a stop the bus no longer reaches cannot have anyone waiting at it. Batching
 * means the admin is told the full cost once, before anything happens, rather
 * than being asked mid-drag.
 */
export function BusRun({
  bus,
  stops,
  saved,
  riders,
  onSaved,
}: {
  bus: Bus;
  /** The stop library. Inactive stops already on the run still render. */
  stops: Stop[];
  /** The persisted order, as stop ids. */
  saved: string[];
  /** How many students are assigned to each stop **on this bus**. */
  riders: Record<string, number>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(saved);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const savedKey = saved.join(',');

  // Re-sync when the bus changes or the server order moves under us. Keyed on
  // the joined ids rather than the array, which is a fresh object every render.
  useEffect(() => {
    setDraft(savedKey ? savedKey.split(',') : []);
    setError('');
  }, [bus.id, savedKey]);

  const byId = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const dirty = draft.join(',') !== savedKey;

  const term = search.trim().toLowerCase();
  const available = stops.filter(
    (s) =>
      s.active &&
      !draft.includes(s.id) &&
      (!term ||
        s.name.toLowerCase().includes(term) ||
        (s.address ?? '').toLowerCase().includes(term)),
  );

  function move(index: number, by: number) {
    const next = [...draft];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  async function save() {
    const removed = saved.filter((id) => !draft.includes(id));
    const losing = removed.reduce((n, id) => n + (riders[id] ?? 0), 0);

    if (losing > 0) {
      const names = removed
        .filter((id) => riders[id])
        .map((id) => byId.get(id)?.name ?? 'a stop')
        .join(', ');
      const agreed = await confirmAction(
        'This removes student assignments',
        `${losing} assignment${losing === 1 ? '' : 's'} at ${names} will be removed, because ${bus.label} will no longer reach ${removed.length === 1 ? 'that stop' : 'those stops'}. Put the students on another stop afterwards.`,
        'Save anyway',
      );
      if (!agreed) return;
    }

    setError('');
    setBusy(true);
    const { error: e } = await supabase.rpc('set_bus_run', {
      target_bus: bus.id,
      ordered_stops: draft,
    });
    setBusy(false);

    if (e) {
      setError(e.message);
      return;
    }
    onSaved();
  }

  return (
    <>
      <SectionLabel>The run — {bus.label}</SectionLabel>

      <ErrorText>{error}</ErrorText>

      {draft.length === 0 ? (
        <Empty>
          {bus.label} has no stops yet. Add them below in the order the bus passes them.
        </Empty>
      ) : (
        draft.map((stopId, i) => {
          const stop = byId.get(stopId);
          const waiting = riders[stopId] ?? 0;
          return (
            <Card key={stopId}>
              <Row style={styles.between}>
                <Row style={styles.grow}>
                  <View style={styles.position}>
                    <Text style={styles.positionText}>{i + 1}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.name}>{stop?.name ?? 'Unknown stop'}</Text>
                    <Text style={styles.fine}>
                      {stop?.address ?? `${stop?.lat.toFixed(4)}, ${stop?.lng.toFixed(4)}`}
                      {waiting ? ` · ${waiting} student${waiting === 1 ? '' : 's'}` : ''}
                    </Text>
                  </View>
                </Row>
                {stop && !stop.active ? <Badge label="Paused" tone="warn" /> : null}
              </Row>
              <Row style={styles.wrap}>
                <Button
                  label="↑"
                  variant="secondary"
                  disabled={i === 0}
                  onPress={() => move(i, -1)}
                />
                <Button
                  label="↓"
                  variant="secondary"
                  disabled={i === draft.length - 1}
                  onPress={() => move(i, 1)}
                />
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() => setDraft(draft.filter((id) => id !== stopId))}
                />
              </Row>
            </Card>
          );
        })
      )}

      {dirty ? (
        <Card style={styles.dirty}>
          <Text style={styles.warn}>Unsaved order.</Text>
          <Row style={styles.wrap}>
            <Button label="Save run" onPress={save} loading={busy} />
            <Button
              label="Discard"
              variant="ghost"
              onPress={() => setDraft(savedKey ? savedKey.split(',') : [])}
            />
          </Row>
        </Card>
      ) : null}

      <SectionLabel>Add a stop to this run</SectionLabel>
      {stops.some((s) => s.active && !draft.includes(s.id)) ? (
        <Card>
          <Field
            label="Find a stop"
            value={search}
            onChangeText={setSearch}
            placeholder="Oak Road"
            autoCapitalize="none"
          />
          {available.length === 0 ? (
            <Text style={styles.fine}>Nothing matches “{search}”.</Text>
          ) : (
            available.slice(0, 12).map((s) => (
              <Row key={s.id} style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{s.name}</Text>
                  <Text style={styles.fine}>{s.address ?? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</Text>
                </View>
                <Button
                  label="Add"
                  variant="secondary"
                  onPress={() => setDraft([...draft, s.id])}
                />
              </Row>
            ))
          )}
          <Text style={styles.fine}>
            Stops go on the end. Use ↑ and ↓ to put them in the order the bus passes them — the ETA
            follows this order, not the straight line to a stop.
          </Text>
        </Card>
      ) : (
        <Empty>
          {stops.some((s) => s.active)
            ? 'Every stop is already on this run. Create more below.'
            : 'No stops exist yet. Create one below, then add it here.'}
        </Empty>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  warn: { fontSize: 13, color: theme.warn, fontWeight: '600' },
  dirty: { borderColor: theme.warn },
  position: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionText: { fontSize: 13, fontWeight: '700', color: theme.accent },
});
