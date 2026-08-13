import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { lookupInvite, useAuth } from '../src/lib/auth';
import type { InviteDetails } from '../src/lib/auth';
import { Badge, Button, Card, ErrorText, Field, Screen, Title, theme } from '../src/components/ui';

/**
 * Signing up (blueprint §6.1).
 *
 *   Admin creates the user → hands them a code → they sign up → role is assigned
 *
 * There is no role picker, because the person does not get a say. The invite
 * carries the role, and the signup trigger reads it off the invite row and
 * ignores anything this screen sends. A code is checked BEFORE the password
 * form appears, so a wrong one fails immediately rather than after they have
 * typed everything.
 */
/**
 * What each role actually gets. Worded carefully: this app shows where a BUS is
 * and never claims to know where a child is, so none of these may promise
 * boarding, presence or a safe arrival.
 *
 * `driver` and `coordinator` exist only when sharing a database with the full
 * app. They are not roles here, and an invite carrying one is refused below
 * rather than silently creating an account that can see nothing.
 */
const ROLE_BLURB: Record<string, string> = {
  student: 'See where your bus is, and how many minutes until it reaches your stop.',
  parent: 'See where your children’s buses are, and get told when one is nearly at their stop.',
  admin: 'Set up buses, stops and who rides what — and invite everyone else.',
};

/** Roles this app can actually serve. */
const LITE_ROLES = ['student', 'parent', 'admin'];

export default function SignUp() {
  const { signUp } = useAuth();

  const [code, setCode] = useState('');
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [checking, setChecking] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function check() {
    setError('');
    setChecking(true);
    try {
      const details = await lookupInvite(code);
      if (!details.valid) {
        setError(details.reason ?? 'That invite code is not valid.');
        setInvite(null);
        return;
      }

      // When this app shares a database with the full Student Transportation
      // Platform, that app's admins can issue `driver` and `coordinator`
      // invites. Redeeming one here would create a real account that then sees
      // nothing at all, because neither role has a route group in this app.
      // Refuse it up front and say where it belongs.
      if (!LITE_ROLES.includes(details.role ?? '')) {
        setError(
          `That code is for a ${details.role} account, which this app does not have. It belongs to the full transport app — use that one instead.`,
        );
        setInvite(null);
        return;
      }

      setInvite(details);
      // The office already knows who they are — prefill it.
      if (details.full_name) setFullName(details.full_name);
      if (details.email) setEmail(details.email);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check that code.');
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit() {
    setError('');
    setBusy(true);
    try {
      await signUp({ email, password, fullName, phone, inviteCode: code });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title sub="You can sign in straight away — there is nothing to wait for.">
          Account created
        </Title>
        <Card>
          <Text style={styles.hint}>
            The transport office invited you, so your account is already approved and your role is
            set. Sign in and you will land on the right screens.
          </Text>
        </Card>
        <Button label="Go to sign in" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  // An email-locked invite must be redeemed by that address, so don't let them edit it.
  const emailLocked = Boolean(invite?.email);
  const canSubmit =
    !!invite && fullName.trim().length > 1 && email.includes('@') && password.length >= 6;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Title sub="The transport office gives you a code. It decides who you are in the app.">
          Join with an invite
        </Title>

        <Card>
          <Field
            label="Invite code"
            value={code}
            onChangeText={(v) => {
              setCode(v.toUpperCase());
              // A changed code invalidates whatever the last one said.
              if (invite) setInvite(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!invite}
            placeholder="BUS-XXXX-XXXX"
            style={styles.code}
          />

          {!invite ? (
            <>
              <ErrorText>{error}</ErrorText>
              <Button
                label="Check code"
                onPress={check}
                loading={checking}
                disabled={code.trim().length < 6}
              />
              <Text style={styles.hint}>
                No code? You cannot sign up without one — ask the school transport office to invite
                you.
              </Text>
            </>
          ) : (
            <View style={styles.confirmed}>
              <View style={styles.grow}>
                <Text style={styles.confirmedName}>{invite.full_name || 'Invited user'}</Text>
                <Text style={styles.hint}>
                  {ROLE_BLURB[invite.role ?? ''] ?? 'Invited to the app.'}
                </Text>
              </View>
              <Badge label={invite.role ?? ''} tone="success" />
            </View>
          )}
        </Card>

        {invite ? (
          <Card>
            <Field
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              autoComplete="name"
              placeholder="Alex Rivera"
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!emailLocked}
              placeholder="you@school.edu"
            />
            {emailLocked ? (
              <Text style={styles.hint}>
                This invite was issued to {invite.email} and can only be used with that address.
              </Text>
            ) : null}
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="(555) 010-0100"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              passwordRules=""
              placeholder="At least 6 characters"
            />

            <ErrorText>{error}</ErrorText>

            <Button
              label={`Create ${invite.role} account`}
              onPress={onSubmit}
              loading={busy}
              disabled={!canSubmit}
            />
          </Card>
        ) : null}

        <Button label="I already have an account" variant="ghost" onPress={() => router.back()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 20, letterSpacing: 2, fontWeight: '700' },
  hint: { fontSize: 12, color: theme.faint, lineHeight: 17 },
  confirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.success,
    borderRadius: 12,
    padding: 14,
  },
  confirmedName: { fontSize: 16, fontWeight: '700', color: theme.text },
  grow: { flex: 1 },
});
