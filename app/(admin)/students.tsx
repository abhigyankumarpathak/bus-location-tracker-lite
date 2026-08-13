import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { ROLE_LABEL } from '../../src/lib/types';
import type { Profile, Role } from '../../src/lib/types';
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
  theme,
} from '../../src/components/ui';

/**
 * Everyone with an account, and the one thing an admin can do to them:
 * pause or restore access.
 *
 * Suspension has to bite at the DATABASE or it is theatre — a suspended user's
 * session keeps working, `auth.uid()` is still their id, and a policy that says
 * `student_id = auth.uid()` happily keeps serving them. Every policy in this
 * app is gated on `is_active()`, which checks the status set here.
 *
 * Assigning a student to a bus and a stop is phase 3, and lands on this screen.
 */
const FILTERS: { value: Role | 'all'; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'student', label: 'Students' },
  { value: 'parent', label: 'Parents' },
  { value: 'admin', label: 'Admins' },
];

export default function AdminPeople() {
  const { profile } = useAuth();

  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Role | 'all'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    if (e) setError(e.message);
    setPeople((data as Profile[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function setStatus(person: Profile, status: 'active' | 'suspended') {
    setError('');
    const { error: e } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', person.id);
    if (e) {
      setError(e.message);
      return;
    }
    await load();
  }

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
      p.full_name.toLowerCase().includes(term) ||
      (p.email ?? '').toLowerCase().includes(term)
    );
  });

  return (
    <Screen>
      <Title sub="Everyone with an account.">People</Title>

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

              {p.status !== 'active' ? (
                <Text style={styles.warn}>
                  {p.status === 'suspended'
                    ? 'Paused — they can sign in, but every query is refused by the database.'
                    : 'Not activated yet.'}
                </Text>
              ) : null}

              {/* An admin who suspends themselves cannot undo it, so don't offer. */}
              {isMe ? (
                <Text style={styles.fine}>You cannot pause your own account.</Text>
              ) : p.status === 'active' ? (
                <Button label="Pause access" variant="danger" onPress={() => setStatus(p, 'suspended')} />
              ) : (
                <Button label="Restore access" variant="secondary" onPress={() => setStatus(p, 'active')} />
              )}
            </Card>
          );
        })
      )}

      <SectionLabel>Next</SectionLabel>
      <Card>
        <Text style={styles.fine}>
          Phase 3 adds the rest of this screen: putting a student on a bus and a stop, and marking
          the stops they do not use.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  warn: { fontSize: 13, color: theme.warn, lineHeight: 19 },
  dim: { opacity: 0.7 },
});
