import { Tabs } from 'expo-router';
import { colors } from '../../constants/theme';

// Employee-only app. RJCorp & vendor users work from the web console.
export default function AppLayout() {
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { borderTopColor: colors.border },
      headerShown: false,
    }}>
      <Tabs.Screen name="(tasks)" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="(profile)" options={{ title: 'Profile' }} />
      <Tabs.Screen name="(task-flows)/recee/[taskId]" options={{ href: null }} />
      <Tabs.Screen name="(task-flows)/install/[taskId]" options={{ href: null }} />
    </Tabs>
  );
}
