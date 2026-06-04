import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Share, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';
import { APP_VERSION, clearLog, readLog } from '@/lib/debug-log';
import { getPendingSyncCount, repairOwnership, syncNow } from '@/lib/sync/syncEngine';

export default function MenuScreen() {
  const { user } = useAuth();
  const [logText, setLogText] = useState('');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [repairing, setRepairing] = useState(false);

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

  async function runRepair() {
    if (!user) return;
    setRepairing(true);
    try {
      const fixed = await repairOwnership(user.id);
      await syncNow();
      const newCount = await getPendingSyncCount();
      setPendingCount(newCount);
      const newLog = await readLog();
      setLogText(newLog);
      Alert.alert(
        'Reparatur abgeschlossen',
        fixed > 0
          ? `${fixed} Roadbook(s) korrigiert und synchronisiert.`
          : 'Kein Datensatz musste korrigiert werden.',
      );
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
    } finally {
      setRepairing(false);
    }
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

      <Card>
        <ThemedText type="smallBold">Sync-Reparatur</ThemedText>
        <ThemedText type="small" style={styles.repairHint}>
          Falls Roadbooks wegen RLS-Fehler nicht hochgeladen werden, korrigiert diese Funktion die
          Eigentümer-ID aller lokalen Einträge und synchronisiert danach.
        </ThemedText>
        <Button
          title={repairing ? 'Läuft…' : 'owner_id reparieren & sync'}
          variant="secondary"
          onPress={runRepair}
          disabled={repairing || !user}
        />
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
  repairHint: { color: '#888', marginBottom: Spacing.two },
  logCard: { flex: 1 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  logActions: { flexDirection: 'row', gap: Spacing.two },
  logScroll: { maxHeight: 420, marginTop: Spacing.two },
  logText: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
