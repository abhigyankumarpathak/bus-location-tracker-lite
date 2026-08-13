import { Text } from 'react-native';
import { Card, Screen, Title, theme } from '../../src/components/ui';

export default function Placeholder() {
  return (
    <Screen>
      <Title sub="Who rides which bus, from which stop.">Students</Title>
      <Card>
        <Text style={{ color: theme.faint, fontSize: 13, lineHeight: 19 }}>
          Phase 3 fills this in, including marking the stops a student does not use.
        </Text>
      </Card>
    </Screen>
  );
}
