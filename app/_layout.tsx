import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { isConfigured } from '../src/lib/supabase';
import { Button, Card, Loading, Screen, Title, theme } from '../src/components/ui';

/**
 * Role-based navigation — three roles, not six.
 *
 * `Stack.Protected` does not merely hide a section: a route whose guard is false
 * is never registered, so a student cannot deep-link into the admin screens.
 * That is the client half. RLS in Postgres is the half that matters and holds
 * even against a raw API call.
 *
 * What is NOT here, deliberately: the driver group, and the staff portal
 * password gate. There is no driver in this app, and the admin's powers are
 * configuration rather than a live custody record, so a second lock on them
 * would be theatre.
 */
function RootNavigator() {
  const { session, profile, loading, profileMissing, signOut } = useAuth();

  // A stored session whose account no longer exists — deleted by an admin, or
  // left behind by a schema rebuild. Without this the app sits on a spinner for
  // ever with no way out but reinstalling.
  if (!loading && session && profileMissing) {
    return <OrphanedSession onSignOut={signOut} />;
  }

  if (loading || (session && !profile)) return <Loading />;

  const role = profile?.role;
  const active = profile?.status === 'active';

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      </Stack.Protected>

      <Stack.Protected guard={!!session && !active}>
        <Stack.Screen name="pending" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={active && role === 'student'}>
        <Stack.Screen name="(student)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={active && role === 'parent'}>
        <Stack.Screen name="(parent)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={active && role === 'admin'}>
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function OrphanedSession({ onSignOut }: { onSignOut: () => void }) {
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
        <Text style={{ fontSize: 52 }}>🔑</Text>
        <Title sub="You are signed in, but the account behind this session no longer exists.">
          Session out of date
        </Title>
      </View>
      <Card>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          This usually means an administrator removed the account, or the database was rebuilt
          while you were signed in. Sign out and in again — you will need an invite code if the
          account is really gone.
        </Text>
      </Card>
      <Button label="Sign out" onPress={onSignOut} />
    </Screen>
  );
}

export default function RootLayout() {
  if (!isConfigured) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SetupNeeded />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** A missing .env is the normal state of a fresh clone, not a crash. */
function SetupNeeded() {
  return (
    <Screen>
      <Title sub="Point this app at a Supabase project before it can do anything.">
        Connect Supabase
      </Title>
      <Card>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          Copy <Text style={{ color: theme.text }}>.env.example</Text> to{' '}
          <Text style={{ color: theme.text }}>.env</Text>, fill in your project URL and publishable
          key, then restart the bundler with{' '}
          <Text style={{ color: theme.text }}>npx expo start --clear</Text>.
        </Text>
        <Text style={{ color: theme.faint, fontSize: 12, lineHeight: 18 }}>
          The --clear is not optional: Expo bakes EXPO_PUBLIC_* into the bundle, so a warm cache
          keeps serving the old values.
        </Text>
      </Card>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 12, lineHeight: 18 }}>
          See supabase/SETUP.md. You can point this at the same project as the full app — see
          “Running against the full app's database”.
        </Text>
      </Card>
    </Screen>
  );
}
