import { Tabs } from 'expo-router';
import { tabScreenOptions } from '../../src/components/ui';

export default function ParentLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Map' }} />
      <Tabs.Screen name="stops" options={{ title: 'Stops' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
    </Tabs>
  );
}
