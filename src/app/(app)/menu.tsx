import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Share, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';
import { APP_VERSION, clearLog, flushLog, logLine, readLog } from '@/lib/debug-log';
import { supabase } from '@/lib/supabase';
import { getPendingSyncCount, repairOwnership, syncNow } from '@/lib/sync/syncEngine';

export default function MenuScreen() {
  const { user } = useAuth();
  const [logText, setLogText] = useState('');
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);

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

  async function refreshSession() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        Alert.alert(
          'Session-Refresh fehlgeschlagen',
          `${error?.message ?? 'Kein Token erhalten'}.\n\nBitte melde dich ab und neu an.`,
        );
      } else {
        await syncNow();
        const newCount = await getPendingSyncCount();
        setPendingCount(newCount);
        const newLog = await readLog();
        setLogText(newLog);
        Alert.alert('Session erneuert', 'Token wurde aktualisiert. Sync ausgeführt.');
      }
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function diagAuth() {
    setDiagnosing(true);
    try {
      // Requires debug_auth() function from migration 0003_debug_auth.sql.
      // Apply via Supabase SQL Editor if not yet deployed.
      const { data, error } = await supabase.rpc('debug_auth');
      const result = error ? { rpc_error: error.message } : data;
      logLine('AUTH:DIAG', JSON.stringify(result));
      await flushLog();
      setLogText(await readLog());
      Alert.alert(
        'Auth-Diagnose',
        `uid: ${(result as Record<string,unknown>)?.uid ?? 'NULL'}\nrole: ${(result as Record<string,unknown>)?.role ?? '?'}\nhas_claims: ${String((result as Record<string,unknown>)?.has_claims ?? '?')}`,
      );
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
    }
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
          Bei RLS-42501-Fehler: erst Token erneuern, dann ggf. owner_id reparieren.
        </ThemedText>
        <View style={styles.repairRow}>
          <Button
            title={diagnosing ? 'Läuft…' : 'Auth-Diagnose'}
            variant="secondary"
            onPress={diagAuth}
            disabled={diagnosing || refreshing || repairing}
          />
          <Button
            title={refreshing ? 'Läuft…' : 'Token erneuern'}
            variant="secondary"
            onPress={refreshSession}
            disabled={refreshing || repairing || diagnosing}
          />
          <Button
            title={repairing ? 'Läuft…' : 'owner_id reparieren'}
            variant="secondary"
            onPress={runRepair}
            disabled={repairing || refreshing || diagnosing || !user}
          />
        </View>
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
  repairRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  logCard: { flex: 1 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  logActions: { flexDirection: 'row', gap: Spacing.two },
  logScroll: { maxHeight: 420, marginTop: Spacing.two },
  logText: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
