import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="Live position and minutes to your child's stop.">Where the bus is</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 5 fills this in: the live bus over its stops, minutes away, and “last seen” when the tracker goes quiet.
        </Text>
      </Card>
    </Screen>
  );
}
