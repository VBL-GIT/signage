import { Stack } from 'expo-router';
import { colors } from '../../../constants/theme';

export default function TasksLayout() {
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.textPrimary,
      headerTitleStyle: { fontWeight: '700' },
    }}>
      <Stack.Screen name="index" options={{ title: 'My Tasks' }} />
      <Stack.Screen name="[id]" options={{ title: 'Task Detail' }} />
    </Stack>
  );
}
