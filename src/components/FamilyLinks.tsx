import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import type { GuardianLink, Profile } from '../lib/types';
import { Button, Card, Empty, ErrorText, Field, Row, SectionLabel, theme } from './ui';

/**
 * Parent ↔ student links, set by an admin.
 *
 * Deliberately NOT the full app's component of the same name. There a link is a
 * consent flow — one party proposes, the other accepts, and RLS refuses an
 * accept from the proposer — because there the link grants sight of a *child's*
 * movements and nobody should be able to assert that unilaterally.
 *
 * Here it grants sight of a *bus*, which is a vehicle on a public road, and
 * families are passive by design: they have no screen to accept anything on. So
 * the office sets it, exactly as the office decides which bus a child rides.
 *
 * The link is what makes a parent account work at all — `my_bus_ids()` reaches a
 * parent's buses through `is_guardian_of()`. A parent with no links sees an
 * empty app.
 */
export function FamilyLinks({
  parent,
  students,
  links,
  adminId,
  onChanged,
}: {
  parent: Profile;
  /** Every student account, for the search. */
  students: Profile[];
  /** This parent's links only. */
  links: (GuardianLink & { student: Profile | null })[];
  adminId: string;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const term = search.trim().toLowerCase();
  const linked = new Set(links.map((l) => l.student_id));
  const matches = term
    ? students.filter(
        (s) =>
          !linked.has(s.id) &&
          (s.full_name.toLowerCase().includes(term) ||
            (s.email ?? '').toLowerCase().includes(term)),
      )
    : [];

  async function link(student: Profile) {
    setError('');
    setBusy(true);
    const { error: e } = await supabase.from('guardian_links').insert({
      parent_id: parent.id,
      student_id: student.id,
      // Written explicitly, never left to the default. In a shared project this
      // is the full app's table, where the default is 'pending' — and
      // `is_guardian_of()` only counts 'accepted', so a defaulted row is a
      // parent who silently sees nothing.
      status: 'accepted',
      requested_by: adminId,
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    setSearch('');
    onChanged();
  }

  async function unlink(row: GuardianLink) {
    setError('');
    const { error: e } = await supabase.from('guardian_links').delete().eq('id', row.id);
    if (e) setError(e.message);
    onChanged();
  }

  return (
    <View style={styles.block}>
      <SectionLabel>Children</SectionLabel>

      <ErrorText>{error}</ErrorText>

      {links.length === 0 ? (
        <Empty>
          Not linked to anyone, so this parent opens the app to nothing. Search for their child
          below.
        </Empty>
      ) : (
        links.map((l) => (
          <Row key={l.id} style={styles.between}>
            <View style={styles.grow}>
              <Text style={styles.name}>{l.student?.full_name || 'Unnamed student'}</Text>
              <Text style={styles.fine}>
                {l.student?.email ?? 'No email on file'}
                {l.status === 'accepted' ? '' : ` · link is ${l.status}, so they see nothing yet`}
              </Text>
            </View>
            <Button label="Unlink" variant="danger" onPress={() => unlink(l)} />
          </Row>
        ))
      )}

      <Card>
        <Field
          label="Link a child"
          value={search}
          onChangeText={setSearch}
          placeholder="Priya"
          autoCapitalize="none"
        />
        {term && matches.length === 0 ? (
          <Text style={styles.fine}>
            No unlinked student matches “{search}”. They need an account first — invite them from
            the Invites tab.
          </Text>
        ) : null}
        {matches.slice(0, 8).map((s) => (
          <Row key={s.id} style={styles.between}>
            <View style={styles.grow}>
              <Text style={styles.name}>{s.full_name || 'Unnamed'}</Text>
              <Text style={styles.fine}>{s.email ?? 'No email on file'}</Text>
            </View>
            <Button
              label="Link"
              variant="secondary"
              disabled={busy}
              onPress={() => link(s)}
            />
          </Row>
        ))}
        <Text style={styles.fine}>
          A link lets this parent watch the buses their child rides. It says nothing about the child
          — this app has no idea whether anyone boarded.
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10, marginTop: 4 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: theme.text },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
});
