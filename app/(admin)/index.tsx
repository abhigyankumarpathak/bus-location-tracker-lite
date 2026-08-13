import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="The vehicles, and the tracker in each one.">Buses</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 3 fills this in: create buses, and issue each one a device key for its tracker.
        </Text>
      </Card>
    </Screen>
  );
}
