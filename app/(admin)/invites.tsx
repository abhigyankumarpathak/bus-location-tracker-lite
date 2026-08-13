import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="Create an account by issuing a code that carries its role.">Invites</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 2 fills this in. Nobody picks their own role — it comes off the invite.
        </Text>
      </Card>
    </Screen>
  );
}
