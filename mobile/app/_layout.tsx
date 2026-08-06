import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../store/auth.store';
import { AppGate } from '../components/system/AppGate';
import { LightboxProvider } from '../components/ui/Lightbox';
import { colors } from '../constants/theme';

export default function RootLayout() {
  const { user, isLoading, hydrate } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/(auth)/login');
    else if (user && inAuth) router.replace('/(app)/(tasks)');
  }, [user, isLoading, segments]);

  // Block ALL screens from rendering until auth state is resolved.
  // Without this, the previously-visited screen (e.g. tasks) mounts and fires
  // API calls before hydration completes, causing spurious 401s.
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <LightboxProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <AppGate />
    </LightboxProvider>
  );
}
