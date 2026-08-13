import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../src/lib/supabase';
import type { Bus } from '../../src/lib/types';
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
  notify,
  theme,
} from '../../src/components/ui';

/**
 * The fleet, and the tracker in each vehicle.
 *
 * There is no driver here and no trip to start. A bus is a label, a plate, and
 * a **device key** — the credential the GPS unit in the van POSTs with. That key
 * is the entire authorisation model for incoming positions, which is why it
 * lives in its own table (`bus_devices`) and is revealed only when asked for.
 * RLS is row-level, not column-level: a `device_key` column on `buses` would be
 * readable by every signed-in student, since everyone can see the bus list.
 *
 * Deactivating rather than deleting is the default on purpose. An inactive bus
 * keeps its history and stops being offered when building runs or assigning
 * students; a deleted one takes its positions and assignments with it.
 */
interface BusRow extends Bus {
  /** How many stops are on its run, and how many students ride it. */
  stops: number;
  riders: number;
}

interface RevealedKey {
  device_key: string;
  rotated_at: string;
}

export default function AdminBuses() {
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState('');
  const [plate, setPlate] = useState('');

  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editPlate, setEditPlate] = useState('');

  /** Keys are fetched one at a time, on demand, and never on screen load. */
  const [keys, setKeys] = useState<Record<string, RevealedKey>>({});

  const load = useCallback(async () => {
    const [busRes, stopRes, riderRes] = await Promise.all([
      supabase.from('buses').select('*').order('label'),
      supabase.from('bus_stops').select('bus_id'),
      supabase.from('student_stops').select('bus_id'),
    ]);

    const firstError = busRes.error ?? stopRes.error ?? riderRes.error;
    if (firstError) setError(firstError.message);

    const count = (rows: { bus_id: string }[] | null) =>
      (rows ?? []).reduce<Record<string, number>>((acc, r) => {
        acc[r.bus_id] = (acc[r.bus_id] ?? 0) + 1;
        return acc;
      }, {});

    const stops = count(stopRes.data as { bus_id: string }[] | null);
    const riders = count(riderRes.data as { bus_id: string }[] | null);

    setBuses(
      ((busRes.data as Bus[]) ?? []).map((b) => ({
        ...b,
        stops: stops[b.id] ?? 0,
        riders: riders[b.id] ?? 0,
      })),
    );
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    if (!label.trim()) {
      setError('A bus needs a label — it is what families will see on the map.');
      return;
    }
    setError('');
    setBusy(true);

    // The `on_bus_created` trigger issues the device key, so a bus can never
    // exist without one.
    const { error: e } = await supabase
      .from('buses')
      .insert({ label: label.trim(), plate: plate.trim() || null });

    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setLabel('');
    setPlate('');
    await load();
  }

  async function saveEdit(bus: BusRow) {
    if (!editLabel.trim()) {
      setError('A bus needs a label.');
      return;
    }
    setError('');
    const { error: e } = await supabase
      .from('buses')
      .update({ label: editLabel.trim(), plate: editPlate.trim() || null })
      .eq('id', bus.id);
    if (e) {
      setError(e.message);
      return;
    }
    setEditing(null);
    await load();
  }

  async function setActive(bus: BusRow, active: boolean) {
    setError('');
    const { error: e } = await supabase.from('buses').update({ active }).eq('id', bus.id);
    if (e) setError(e.message);
    await load();
  }

  async function remove(bus: BusRow) {
    const consequences = [
      bus.stops ? `${bus.stops} stop${bus.stops === 1 ? '' : 's'} on its run` : null,
      bus.riders ? `${bus.riders} student assignment${bus.riders === 1 ? '' : 's'}` : null,
      'every position it has ever reported',
      'its tracker key',
    ].filter(Boolean);

    const agreed = await confirmAction(
      `Delete ${bus.label}?`,
      `This also deletes ${consequences.join(', ')}. It cannot be undone — pause the bus instead if you only want it out of the way.`,
      'Delete',
    );
    if (!agreed) return;

    setError('');
    const { error: e } = await supabase.from('buses').delete().eq('id', bus.id);
    if (e) setError(e.message);
    await load();
  }

  async function revealKey(bus: BusRow) {
    setError('');
    const { data, error: e } = await supabase
      .from('bus_devices')
      .select('device_key, rotated_at')
      .eq('bus_id', bus.id)
      .maybeSingle();

    if (e) {
      setError(e.message);
      return;
    }
    if (!data) {
      setError(`${bus.label} has no tracker key. Rotate to issue one.`);
      return;
    }
    setKeys((k) => ({ ...k, [bus.id]: data as RevealedKey }));
  }

  async function rotateKey(bus: BusRow) {
    const agreed = await confirmAction(
      `Issue ${bus.label} a new key?`,
      'The current key stops working immediately. The tracker in the vehicle has to be reconfigured with the new one, or it goes quiet.',
      'Rotate',
    );
    if (!agreed) return;

    setError('');
    // Generated in the database: a device key is a password, and the client has
    // no business choosing one.
    const { data, error: e } = await supabase.rpc('rotate_device_key', { target_bus: bus.id });
    if (e) {
      setError(e.message);
      return;
    }
    setKeys((k) => ({
      ...k,
      [bus.id]: { device_key: data as string, rotated_at: new Date().toISOString() },
    }));
    notify('New key issued', 'Configure the tracker with it. The old key is dead.');
  }

  if (loading) return <Loading />;

  const active = buses.filter((b) => b.active);
  const paused = buses.filter((b) => !b.active);

  return (
    <Screen>
      <Title sub="The vehicles, and the tracker in each one.">Buses</Title>

      <ErrorText>{error}</ErrorText>

      <SectionLabel>Add a bus</SectionLabel>
      <Card>
        <Field
          label="Label"
          value={label}
          onChangeText={setLabel}
          placeholder="Bus 4 — North route"
          autoCapitalize="words"
        />
        <Field
          label="Plate (optional)"
          value={plate}
          onChangeText={setPlate}
          placeholder="AB12 CDE"
          autoCapitalize="characters"
        />
        <Text style={styles.fine}>
          The label is what families see on the map, so make it the thing they would say out loud.
        </Text>
        <Button label="Add bus" onPress={create} loading={busy} />
      </Card>

      <SectionLabel>In service ({active.length})</SectionLabel>
      {active.length === 0 ? (
        <Empty>No buses yet. Add one above, then give it a run on the Stops tab.</Empty>
      ) : (
        active.map((bus) => (
          <BusCard
            key={bus.id}
            bus={bus}
            editing={editing === bus.id}
            editLabel={editLabel}
            editPlate={editPlate}
            revealed={keys[bus.id]}
            onEditLabel={setEditLabel}
            onEditPlate={setEditPlate}
            onStartEdit={() => {
              setEditing(bus.id);
              setEditLabel(bus.label);
              setEditPlate(bus.plate ?? '');
            }}
            onCancelEdit={() => setEditing(null)}
            onSave={() => saveEdit(bus)}
            onPause={() => setActive(bus, false)}
            onDelete={() => remove(bus)}
            onReveal={() => revealKey(bus)}
            onHide={() =>
              setKeys((k) => {
                const next = { ...k };
                delete next[bus.id];
                return next;
              })
            }
            onRotate={() => rotateKey(bus)}
          />
        ))
      )}

      {paused.length > 0 ? (
        <>
          <SectionLabel>Paused ({paused.length})</SectionLabel>
          {paused.map((bus) => (
            <Card key={bus.id} style={styles.dim}>
              <Row style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{bus.label}</Text>
                  <Text style={styles.fine}>
                    {bus.stops} stop{bus.stops === 1 ? '' : 's'} · {bus.riders} student
                    {bus.riders === 1 ? '' : 's'} · history kept
                  </Text>
                </View>
                <Badge label="Paused" tone="warn" />
              </Row>
              <Text style={styles.fine}>
                Not offered when building a run or assigning a student. Nothing has been deleted.
              </Text>
              <Row style={styles.wrap}>
                <Button
                  label="Put back in service"
                  variant="secondary"
                  onPress={() => setActive(bus, true)}
                />
                <Button label="Delete" variant="danger" onPress={() => remove(bus)} />
              </Row>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function BusCard({
  bus,
  editing,
  editLabel,
  editPlate,
  revealed,
  onEditLabel,
  onEditPlate,
  onStartEdit,
  onCancelEdit,
  onSave,
  onPause,
  onDelete,
  onReveal,
  onHide,
  onRotate,
}: {
  bus: BusRow;
  editing: boolean;
  editLabel: string;
  editPlate: string;
  revealed?: RevealedKey;
  onEditLabel: (v: string) => void;
  onEditPlate: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onPause: () => void;
  onDelete: () => void;
  onReveal: () => void;
  onHide: () => void;
  onRotate: () => void;
}) {
  return (
    <Card>
      {editing ? (
        <>
          <Field label="Label" value={editLabel} onChangeText={onEditLabel} autoCapitalize="words" />
          <Field
            label="Plate"
            value={editPlate}
            onChangeText={onEditPlate}
            placeholder="AB12 CDE"
            autoCapitalize="characters"
          />
          <Row style={styles.wrap}>
            <Button label="Save" onPress={onSave} />
            <Button label="Cancel" variant="ghost" onPress={onCancelEdit} />
          </Row>
        </>
      ) : (
        <>
          <Row style={styles.between}>
            <View style={styles.grow}>
              <Text style={styles.name}>{bus.label}</Text>
              <Text style={styles.fine}>{bus.plate ?? 'No plate on file'}</Text>
            </View>
            <Badge
              label={bus.stops === 0 ? 'No run yet' : `${bus.stops} stops`}
              tone={bus.stops === 0 ? 'warn' : 'accent'}
            />
          </Row>

          <Text style={styles.fine}>
            {bus.riders} student{bus.riders === 1 ? '' : 's'} assigned
            {bus.stops === 0 ? ' · give it a run on the Stops tab before assigning anyone' : ''}
          </Text>

          <Row style={styles.wrap}>
            <Button label="Edit" variant="secondary" onPress={onStartEdit} />
            <Button label="Pause" variant="ghost" onPress={onPause} />
            <Button label="Delete" variant="danger" onPress={onDelete} />
          </Row>
        </>
      )}

      <View style={styles.keyBlock}>
        <Text style={styles.label}>Tracker key</Text>
        {revealed ? (
          <>
            <Text selectable style={styles.key}>
              {revealed.device_key}
            </Text>
            <Text style={styles.fine}>
              Issued {new Date(revealed.rotated_at).toLocaleDateString()}. This is a password —
              it goes in the GPS unit and nowhere else. Never in a shared document, never in the
              app's own configuration.
            </Text>
            <Row style={styles.wrap}>
              <Button
                label={Platform.OS === 'web' ? 'Copy key' : 'Copy'}
                variant="secondary"
                onPress={() => Clipboard.setStringAsync(revealed.device_key)}
              />
              <Button label="Hide" variant="ghost" onPress={onHide} />
              <Button label="Rotate" variant="danger" onPress={onRotate} />
            </Row>
          </>
        ) : (
          <>
            <Text style={styles.fine}>
              The credential the GPS unit in this vehicle reports with. Hidden until you ask for it.
            </Text>
            <Row style={styles.wrap}>
              <Button label="Show key" variant="secondary" onPress={onReveal} />
              <Button label="Rotate" variant="ghost" onPress={onRotate} />
            </Row>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  dim: { opacity: 0.7 },
  name: { fontSize: 16, fontWeight: '700', color: theme.text },
  label: { fontSize: 13, fontWeight: '600', color: theme.muted },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  key: {
    fontSize: 13,
    color: theme.warn,
    letterSpacing: 0.5,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  keyBlock: {
    gap: 8,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
});
