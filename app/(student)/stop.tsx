import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="Which bus you ride, and from where.">My stop</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 3 fills this in.
        </Text>
      </Card>
    </Screen>
  );
}
