import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Bus, Profile, Stop, StudentStop } from '../lib/types';
import { Badge, Button, Card, Empty, ErrorText, Row, SectionLabel, theme } from './ui';

/**
 * Which bus a student rides, and from which stop.
 *
 * Written fresh rather than ported: the full app's version of this screen
 * assigns a rider to a route, a hub and a session, and carries the machinery for
 * nine statuses behind it. Here there are three columns and one flag.
 *
 * ## What `uses_it` actually does
 *
 * It is the opt-out, and it is not cosmetic. `my_bus_ids()` — the function every
 * read policy in this app leans on — filters on it. Pausing a student's stop
 * therefore stops the *database* handing that family the bus's positions at all;
 * it is not a notification preference implemented in the UI. A student whose
 * every assignment is paused sees no bus, which is the correct answer for a
 * child who has stopped riding but may start again in September.
 *
 * ## What this screen must never say
 *
 * Nothing here records that a child boarded, is aboard, or was dropped off. An
 * assignment says *this family may watch this bus, and this is the stop the
 * minutes-away is measured to.* That is all it can honestly mean.
 */
export function StudentAssignment({
  student,
  buses,
  stops,
  runs,
  assignments,
  onChanged,
}: {
  student: Profile;
  /** In-service buses only. A paused bus is not somewhere to put a child. */
  buses: Bus[];
  stops: Stop[];
  /** Every `bus_stops` row, so a bus's run can be listed in order. */
  runs: { bus_id: string; stop_id: string; position: number }[];
  /** This student's rows only. */
  assignments: StudentStop[];
  onChanged: () => void;
}) {
  const [busId, setBusId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const busById = useMemo(() => new Map(buses.map((b) => [b.id, b])), [buses]);

  /** The chosen bus's run, in order, minus stops this student already has. */
  const offered = useMemo(() => {
    if (!busId) return [];
    const taken = new Set(assignments.filter((a) => a.bus_id === busId).map((a) => a.stop_id));
    return runs
      .filter((r) => r.bus_id === busId && !taken.has(r.stop_id))
      .sort((a, b) => a.position - b.position);
  }, [assignments, busId, runs]);

  async function assign(stopId: string) {
    setError('');
    setBusy(true);
    // Upsert rather than insert: re-adding a stop the admin paused earlier
    // should resume it, not collide with the unique constraint.
    const { error: e } = await supabase.from('student_stops').upsert(
      { student_id: student.id, bus_id: busId, stop_id: stopId, uses_it: true },
      { onConflict: 'student_id,bus_id,stop_id' },
    );
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setBusId(null);
    onChanged();
  }

  async function setUsesIt(row: StudentStop, uses_it: boolean) {
    setError('');
    const { error: e } = await supabase
      .from('student_stops')
      .update({ uses_it })
      .eq('id', row.id);
    if (e) setError(e.message);
    onChanged();
  }

  async function remove(row: StudentStop) {
    setError('');
    const { error: e } = await supabase.from('student_stops').delete().eq('id', row.id);
    if (e) setError(e.message);
    onChanged();
  }

  const watching = assignments.some((a) => a.uses_it);

  return (
    <View style={styles.block}>
      <SectionLabel>Bus and stop</SectionLabel>

      <ErrorText>{error}</ErrorText>

      {assignments.length === 0 ? (
        <Empty>
          {student.full_name || 'This student'} is not on a bus. Until they are, they and their
          parents see nothing at all.
        </Empty>
      ) : (
        assignments.map((row) => {
          const bus = busById.get(row.bus_id);
          const stop = stopById.get(row.stop_id);
          const position = runs.find(
            (r) => r.bus_id === row.bus_id && r.stop_id === row.stop_id,
          )?.position;

          return (
            <Card key={row.id} style={row.uses_it ? undefined : styles.dim}>
              <Row style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{bus?.label ?? 'A paused bus'}</Text>
                  <Text style={styles.fine}>
                    {stop?.name ?? 'Unknown stop'}
                    {position ? ` · stop ${position} on the run` : ' · not on this run any more'}
                  </Text>
                </View>
                <Badge
                  label={row.uses_it ? 'Watching' : 'Paused'}
                  tone={row.uses_it ? 'success' : 'warn'}
                />
              </Row>

              {row.uses_it ? null : (
                <Text style={styles.fine}>
                  Kept on file, but the database stops serving this bus to them — no map, no
                  minutes-away, no alerts.
                </Text>
              )}

              <Row style={styles.wrap}>
                {row.uses_it ? (
                  <Button
                    label="Pause this stop"
                    variant="secondary"
                    onPress={() => setUsesIt(row, false)}
                  />
                ) : (
                  <Button label="Resume" variant="secondary" onPress={() => setUsesIt(row, true)} />
                )}
                <Button label="Remove" variant="danger" onPress={() => remove(row)} />
              </Row>
            </Card>
          );
        })
      )}

      {assignments.length > 0 && !watching ? (
        <Text style={styles.warn}>
          Every stop is paused, so this student and their parents currently see no bus.
        </Text>
      ) : null}

      <Card>
        <Text style={styles.label}>Put them on a bus</Text>
        {buses.length === 0 ? (
          <Text style={styles.fine}>No buses in service. Add one on the Buses tab.</Text>
        ) : (
          <Row style={styles.wrap}>
            {buses.map((b) => (
              <Button
                key={b.id}
                label={b.label}
                variant={busId === b.id ? 'primary' : 'secondary'}
                onPress={() => setBusId(busId === b.id ? null : b.id)}
              />
            ))}
          </Row>
        )}

        {busId ? (
          offered.length === 0 ? (
            <Text style={styles.fine}>
              Every stop on this run is already assigned to them — or the run is empty. Build it on
              the Stops tab.
            </Text>
          ) : (
            <>
              <Text style={styles.fine}>Which stop do they use?</Text>
              {offered.map((r) => (
                <Row key={r.stop_id} style={styles.between}>
                  <View style={styles.grow}>
                    <Text style={styles.name}>{stopById.get(r.stop_id)?.name ?? 'Stop'}</Text>
                    <Text style={styles.fine}>Stop {r.position} on the run</Text>
                  </View>
                  <Button
                    label="Assign"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => assign(r.stop_id)}
                  />
                </Row>
              ))}
            </>
          )
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10, marginTop: 4 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  dim: { opacity: 0.75 },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  label: { fontSize: 13, fontWeight: '600', color: theme.muted },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  warn: { fontSize: 13, color: theme.warn, lineHeight: 19 },
});
