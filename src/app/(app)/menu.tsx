import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { APP_VERSION, clearLog, readLog } from '@/lib/debug-log';
import { getPendingSyncCount } from '@/lib/sync/syncEngine';

export default function MenuScreen() {
  const [logText, setLogText] = useState('');
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    void readLog().then(setLogText);
    void getPendingSyncCount().then(setPendingCount);
  }, []);

  async function shareLog() {
    await Share.share({ message: logText });
  }

  async function deleteLog() {
    await clearLog();
    setLogText('(kein Log vorhanden)');
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Menü' }} />

      <Card>
        <ThemedText type="smallBold">App-Info</ThemedText>
        <ThemedText type="small">Roadbook v{APP_VERSION}</ThemedText>
        {pendingCount !== null ? (
          <ThemedText type="small" style={pendingCount > 0 ? styles.pending : styles.synced}>
            {pendingCount > 0
              ? `${pendingCount} Änderung(en) noch nicht mit Supabase synchronisiert`
              : 'Alle Änderungen synchronisiert'}
          </ThemedText>
        ) : null}
      </Card>

      <Card style={styles.logCard}>
        <View style={styles.logHead}>
          <ThemedText type="smallBold">Diagnose-Log</ThemedText>
          <View style={styles.logActions}>
            <Button title="Teilen" variant="secondary" onPress={shareLog} />
            <Button title="Löschen" variant="secondary" onPress={deleteLog} />
          </View>
        </View>
        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          <ThemedText style={styles.logText}>{logText || '(leer)'}</ThemedText>
        </ScrollView>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pending: { color: '#F5A623' },
  synced: { color: '#30A46C' },
  logCard: { flex: 1 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  logActions: { flexDirection: 'row', gap: Spacing.two },
  logScroll: { maxHeight: 420, marginTop: Spacing.two },
  logText: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
