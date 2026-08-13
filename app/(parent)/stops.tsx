import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="Which bus each of your children rides, and from where.">Stops</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 3 fills this in, once an admin can assign a student to a bus and a stop.
        </Text>
      </Card>
    </Screen>
  );
}
