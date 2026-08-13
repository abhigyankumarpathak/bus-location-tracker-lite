import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { ROLE_LABEL } from '../../src/lib/types';
import type { Bus, GuardianLink, Profile, Role, Stop, StudentStop } from '../../src/lib/types';
import { FamilyLinks } from '../../src/components/FamilyLinks';
import { StudentAssignment } from '../../src/components/StudentAssignment';
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
  Title,
  theme,
} from '../../src/components/ui';

/**
 * Everyone with an account, and the two things an admin does to them: control
 * access, and configure what they can watch.
 *
 * Suspension has to bite at the DATABASE or it is theatre — a suspended user's
 * session keeps working, `auth.uid()` is still their id, and a policy that says
 * `student_id = auth.uid()` happily keeps serving them. Every policy in this app
 * is gated on `is_active()`, which checks the status set here.
 *
 * The configuration differs by role and is deliberately one-way: an admin puts a
 * **student** on a bus and a stop, and links a **parent** to a child. Neither
 * family member can change any of it. That is the whole of what a family's setup
 * can express in this app.
 */
const FILTERS: { value: Role | 'all'; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'student', label: 'Students' },
  { value: 'parent', label: 'Parents' },
  { value: 'admin', label: 'Admins' },
];

interface RunRow {
  bus_id: string;
  stop_id: string;
  position: number;
}

export default function AdminPeople() {
  const { profile } = useAuth();

  const [people, setPeople] = useState<Profile[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [assignments, setAssignments] = useState<StudentStop[]>([]);
  const [links, setLinks] = useState<GuardianLink[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [search, setSearch] = useState('');
  /** One person's configuration open at a time; the editors are tall. */
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [peopleRes, busRes, stopRes, runRes, assignRes, linkRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('buses').select('*').eq('active', true).order('label'),
      supabase.from('stops').select('*').order('name'),
      supabase.from('bus_stops').select('bus_id, stop_id, position').order('position'),
      supabase.from('student_stops').select('*'),
      supabase.from('guardian_links').select('*'),
    ]);

    const firstError =
      peopleRes.error ?? busRes.error ?? stopRes.error ?? runRes.error ?? assignRes.error ?? linkRes.error;
    if (firstError) setError(firstError.message);

    setPeople((peopleRes.data as Profile[]) ?? []);
    setBuses((busRes.data as Bus[]) ?? []);
    setStops((stopRes.data as Stop[]) ?? []);
    setRuns((runRes.data as RunRow[]) ?? []);
    setAssignments((assignRes.data as StudentStop[]) ?? []);
    setLinks((linkRes.data as GuardianLink[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function setStatus(person: Profile, status: 'active' | 'suspended') {
    setError('');
    const { error: e } = await supabase.from('profiles').update({ status }).eq('id', person.id);
    if (e) {
      setError(e.message);
      return;
    }
    await load();
  }

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const busById = useMemo(() => new Map(buses.map((b) => [b.id, b])), [buses]);
  const students = useMemo(() => people.filter((p) => p.role === 'student'), [people]);

  if (loading) return <Loading />;

  const term = search.trim().toLowerCase();
  const shown = people.filter((p) => {
    // When this app shares a database with the full transport app, that app's
    // drivers and coordinators are in `profiles` too. They are not roles here,
    // so listing them would invite an admin to manage accounts this app cannot
    // serve.
    if (!['student', 'parent', 'admin'].includes(p.role)) return false;
    if (filter !== 'all' && p.role !== filter) return false;
    if (!term) return true;
    return (
      p.full_name.toLowerCase().includes(term) || (p.email ?? '').toLowerCase().includes(term)
    );
  });

  /** One line describing what this person is set up to watch. */
  function summarise(person: Profile): string {
    if (person.role === 'student') {
      const mine = assignments.filter((a) => a.student_id === person.id);
      if (mine.length === 0) return 'Not on a bus — sees nothing.';
      return mine
        .map((a) => {
          const where = `${busById.get(a.bus_id)?.label ?? 'A paused bus'} · ${
            stopById.get(a.stop_id)?.name ?? 'unknown stop'
          }`;
          return a.uses_it ? where : `${where} (paused)`;
        })
        .join(' · ');
    }
    if (person.role === 'parent') {
      const mine = links.filter((l) => l.parent_id === person.id);
      if (mine.length === 0) return 'No children linked — sees nothing.';
      return mine
        .map((l) => byId.get(l.student_id)?.full_name || 'Unnamed student')
        .join(', ');
    }
    return 'Configures buses, stops and everybody else.';
  }

  return (
    <Screen>
      <Title sub="Everyone with an account, and what they can watch.">People</Title>

      <ErrorText>{error}</ErrorText>

      <Row style={styles.wrap}>
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            label={f.label}
            variant={filter === f.value ? 'primary' : 'secondary'}
            onPress={() => setFilter(f.value)}
          />
        ))}
      </Row>

      <Field
        label="Search by name or email"
        value={search}
        onChangeText={setSearch}
        placeholder="Priya"
        autoCapitalize="none"
      />

      {shown.length === 0 ? (
        <Empty>
          Nobody yet. Accounts appear here once someone redeems an invite from the Invites tab.
        </Empty>
      ) : (
        shown.map((p) => {
          const isMe = p.id === profile?.id;
          const expanded = open === p.id;
          const configurable = p.role === 'student' || p.role === 'parent';

          return (
            <Card key={p.id} style={p.status !== 'active' ? styles.dim : undefined}>
              <Row style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.name}>
                    {p.full_name || 'Unnamed'}
                    {isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.fine}>{p.email ?? 'No email on file'}</Text>
                </View>
                <Badge
                  label={ROLE_LABEL[p.role]}
                  tone={p.role === 'admin' ? 'accent' : 'neutral'}
                />
              </Row>

              <Text style={styles.summary}>{summarise(p)}</Text>

              {p.status !== 'active' ? (
                <Text style={styles.warn}>
                  {p.status === 'suspended'
                    ? 'Paused — they can sign in, but every query is refused by the database.'
                    : 'Not activated yet.'}
                </Text>
              ) : null}

              <Row style={styles.wrap}>
                {configurable ? (
                  <Button
                    label={expanded ? 'Done' : p.role === 'student' ? 'Bus and stop' : 'Children'}
                    variant={expanded ? 'primary' : 'secondary'}
                    onPress={() => setOpen(expanded ? null : p.id)}
                  />
                ) : null}

                {/* An admin who suspends themselves cannot undo it, so don't offer. */}
                {isMe ? null : p.status === 'active' ? (
                  <Button
                    label="Pause access"
                    variant="danger"
                    onPress={() => setStatus(p, 'suspended')}
                  />
                ) : (
                  <Button
                    label="Restore access"
                    variant="secondary"
                    onPress={() => setStatus(p, 'active')}
                  />
                )}
              </Row>

              {isMe ? <Text style={styles.fine}>You cannot pause your own account.</Text> : null}

              {expanded && p.role === 'student' ? (
                <StudentAssignment
                  student={p}
                  buses={buses}
                  stops={stops}
                  runs={runs}
                  assignments={assignments.filter((a) => a.student_id === p.id)}
                  onChanged={load}
                />
              ) : null}

              {expanded && p.role === 'parent' && profile ? (
                <FamilyLinks
                  parent={p}
                  students={students}
                  links={links
                    .filter((l) => l.parent_id === p.id)
                    .map((l) => ({ ...l, student: byId.get(l.student_id) ?? null }))}
                  adminId={profile.id}
                  onChanged={load}
                />
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  summary: { fontSize: 13, color: theme.muted, lineHeight: 19 },
  warn: { fontSize: 13, color: theme.warn, lineHeight: 19 },
  dim: { opacity: 0.7 },
});
