import { Text } from 'react-native';
import { useAuth } from '../src/lib/auth';
import { Button, Card, Screen, Title, theme } from '../src/components/ui';

/**
 * An invited account is active immediately — the vetting happened before the
 * code was issued. This screen is for the accounts an admin has deliberately
 * parked or suspended.
 */
export default function Pending() {
  const { profile, signOut, refreshProfile } = useAuth();

  return (
    <Screen>
      <Title sub={profile?.full_name || undefined}>
        {profile?.status === 'suspended' ? 'Account paused' : 'Waiting for approval'}
      </Title>
      <Card>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          {profile?.status === 'suspended'
            ? 'An administrator has paused this account. Contact the transport office.'
            : 'An administrator has not activated this account yet.'}
        </Text>
      </Card>
      <Button label="Check again" variant="secondary" onPress={refreshProfile} />
      <Button label="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
