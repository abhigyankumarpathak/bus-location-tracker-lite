import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/lib/auth';
import { Button, Card, ErrorText, Field, Screen, Title, theme } from '../src/components/ui';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError('');
    setBusy(true);
    try {
      await signIn(email, password);
      // Routing is handled by the guards in _layout.tsx once the session lands.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.emoji}>🚌</Text>
          <Title sub="See where the bus is, and when it reaches your stop.">Bus Tracker</Title>
        </View>

        <Card>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@school.edu"
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
            placeholder="••••••••"
          />

          <ErrorText>{error}</ErrorText>

          <Button
            label="Sign in"
            onPress={onSubmit}
            loading={busy}
            disabled={!email.trim() || !password}
          />
        </Card>

        <Button
          label="I have an invite code"
          variant="ghost"
          onPress={() => router.push('/sign-up')}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  emoji: { fontSize: 56 },
});
