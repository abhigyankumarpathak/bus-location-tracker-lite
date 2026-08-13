import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="15 minutes away, 5 minutes away, and at the stop.">Alerts</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 6 fills this in. Three notifications, each firing once per stop per run.
        </Text>
      </Card>
    </Screen>
  );
}
