import { Tabs } from 'expo-router';
import { tabScreenOptions } from '../../src/components/ui';

export default function AdminLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Buses' }} />
      <Tabs.Screen name="stops" options={{ title: 'Stops' }} />
      <Tabs.Screen name="students" options={{ title: 'Students' }} />
      <Tabs.Screen name="invites" options={{ title: 'Invites' }} />
    </Tabs>
  );
}
