import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/AuthProvider';
import { useBackgroundSync } from '@/hooks/use-background-sync';

/** App group: only reachable when logged IN. Otherwise bounce to /login. */
export default function AppLayout() {
  const { session, initializing } = useAuth();
  useBackgroundSync(!!session);

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Roadbooks' }} />
      <Stack.Screen name="roadbook/[id]" options={{ title: 'Roadbook' }} />
      <Stack.Screen name="route/[id]" options={{ title: 'Route' }} />
      <Stack.Screen name="stop/[id]" options={{ title: 'Stopp' }} />
      <Stack.Screen name="import" options={{ title: 'Foto-Import', presentation: 'modal' }} />
    </Stack>
  );
}
