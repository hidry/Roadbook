/**
 * Root layout: installs the providers the whole app needs, initialises the local
 * SQLite database once (offline-first Source of Truth), and renders the route
 * groups. Auth gating lives in the (app)/(auth) group layouts.
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/error-boundary';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { appendLog } from '@/lib/debug-log';
import { initDatabase } from '@/lib/db/sqlite';

// ErrorUtils is a React Native global for uncaught JS exceptions (not exported
// from 'react-native', so we access it via the global object).
type ErrorUtilsType = { setGlobalHandler: (fn: (e: Error, fatal?: boolean) => void) => void };
const _globalErrorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsType }).ErrorUtils;

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDatabase()
      .then(() => setDbReady(true))
      .catch((e) => {
        console.error('[db] init failed', e);
        setDbReady(true); // don't hard-block the UI; surfaces errors on first query
      });
  }, []);

  useEffect(() => {
    _globalErrorUtils?.setGlobalHandler((error, isFatal) => {
      void appendLog(
        'JS:CRASH',
        `${isFatal ? '[FATAL] ' : ''}${error?.message ?? String(error)}`,
        { stack: error?.stack?.slice(0, 500) },
      );
    });
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AuthProvider>
              {dbReady ? (
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(app)" />
                </Stack>
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator />
                </View>
              )}
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
