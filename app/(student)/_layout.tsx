import { Tabs } from 'expo-router';
import { tabScreenOptions } from '../../src/components/ui';

export default function StudentLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Map' }} />
      <Tabs.Screen name="stop" options={{ title: 'My stop' }} />
    </Tabs>
  );
}
