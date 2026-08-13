import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { ROLE_LABEL } from '../../src/lib/types';
import type { Invite, Role } from '../../src/lib/types';
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
 * Invites — the only way an account comes into existence.
 *
 * Nobody signs up without a code, and **the code carries the role**. The signup
 * trigger reads the role off the invite row and ignores anything the client
 * sends, so a hostile signup cannot make itself an admin. That is the one piece
 * of the full app's auth model worth every line, and it ports intact.
 *
 * Codes are single-use, expire in 14 days, and can be revoked. Optionally
 * locked to one email address, so a forwarded code is useless.
 */
const ROLES: Role[] = ['student', 'parent', 'admin'];

const ROLE_BLURB: Record<Role, string> = {
  student: 'Sees where their bus is and minutes to their own stop.',
  parent: 'Sees the buses their linked children ride.',
  admin: 'Sets up buses, stops and assignments — and invites everyone else.',
};

export default function AdminInvites() {
  const { profile } = useAuth();

  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [role, setRole] = useState<Role>('parent');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('invites')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (e) setError(e.message);
    setInvites((data as Invite[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    if (!fullName.trim()) {
      setError('Give the invite a name, so you can tell your codes apart.');
      return;
    }
    setError('');
    setBusy(true);

    const { data, error: e } = await supabase
      .from('invites')
      .insert({
        role,
        full_name: fullName.trim(),
        // Locking to an email makes a forwarded code useless. Optional, because
        // the office does not always know the address in advance.
        email: email.trim() || null,
        created_by: profile?.id,
      })
      .select()
      .single();

    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }

    setFullName('');
    setEmail('');
    await load();

    const code = (data as Invite).code;
    await copy(code);
    Alert.alert(
      'Invite created',
      `${code}\n\nCopied. It works once, expires in 14 days, and makes a ${ROLE_LABEL[role].toLowerCase()} account.`,
    );
  }

  async function copy(code: string) {
    await Clipboard.setStringAsync(code);
  }

  async function revoke(invite: Invite) {
    setError('');
    const { error: e } = await supabase
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invite.id);
    if (e) setError(e.message);
    await load();
  }

  if (loading) return <Loading />;

  const open = invites.filter((i) => !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  const spent = invites.filter((i) => !open.includes(i));

  return (
    <Screen>
      <Title sub="The only way an account is created.">Invites</Title>

      <Card>
        <Text style={styles.body}>
          Nobody can sign up without a code, and the code decides the role — the person redeeming it
          has no say. A stolen code makes the account it was issued for and nothing more.
        </Text>
      </Card>

      <ErrorText>{error}</ErrorText>

      <SectionLabel>New invite</SectionLabel>
      <Card>
        <Text style={styles.label}>What are they?</Text>
        <Row style={styles.wrap}>
          {ROLES.map((r) => (
            <Button
              key={r}
              label={ROLE_LABEL[r]}
              variant={role === r ? 'primary' : 'secondary'}
              onPress={() => setRole(r)}
            />
          ))}
        </Row>
        <Text style={styles.fine}>{ROLE_BLURB[role]}</Text>

        <Field
          label="Their name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Priya Sharma"
          autoCapitalize="words"
        />
        <Field
          label="Lock to an email address (optional)"
          value={email}
          onChangeText={setEmail}
          placeholder="parent@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.fine}>
          With an address set, only that address can redeem the code — so forwarding it achieves
          nothing.
        </Text>

        <Button label="Create invite" onPress={create} loading={busy} />
      </Card>

      <SectionLabel>Open codes ({open.length})</SectionLabel>
      {open.length === 0 ? (
        <Empty>No unused codes. Create one above.</Empty>
      ) : (
        open.map((i) => (
          <Card key={i.id}>
            <Row style={styles.between}>
              <View style={styles.grow}>
                <Pressable onPress={() => copy(i.code)}>
                  <Text style={styles.code}>{i.code}</Text>
                </Pressable>
                <Text style={styles.fine}>
                  {i.full_name || 'Unnamed'} · expires{' '}
                  {new Date(i.expires_at).toLocaleDateString()}
                  {i.email ? ` · locked to ${i.email}` : ''}
                </Text>
              </View>
              <Badge label={ROLE_LABEL[i.role]} tone="accent" />
            </Row>
            <Row style={styles.wrap}>
              <Button
                label={Platform.OS === 'web' ? 'Copy code' : 'Copy'}
                variant="secondary"
                onPress={() => copy(i.code)}
              />
              <Button label="Revoke" variant="danger" onPress={() => revoke(i)} />
            </Row>
          </Card>
        ))
      )}

      {spent.length > 0 ? (
        <>
          <SectionLabel>Used, revoked or expired</SectionLabel>
          {spent.slice(0, 20).map((i) => (
            <Card key={i.id} style={styles.spent}>
              <Row style={styles.between}>
                <View style={styles.grow}>
                  <Text style={styles.codeSpent}>{i.code}</Text>
                  <Text style={styles.fine}>
                    {i.full_name || 'Unnamed'} ·{' '}
                    {i.used_at
                      ? `used ${new Date(i.used_at).toLocaleDateString()}`
                      : i.revoked_at
                        ? 'revoked'
                        : 'expired'}
                  </Text>
                </View>
                <Badge label={ROLE_LABEL[i.role]} tone="neutral" />
              </Row>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  body: { fontSize: 14, color: theme.muted, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: theme.muted },
  fine: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  code: { fontSize: 20, fontWeight: '700', color: theme.accent, letterSpacing: 1 },
  codeSpent: { fontSize: 16, fontWeight: '600', color: theme.faint, letterSpacing: 1 },
  spent: { opacity: 0.6 },
});
