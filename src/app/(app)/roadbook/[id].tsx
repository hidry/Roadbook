import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { roadbookRepo, routeRepo } from '@/lib/db/repositories';
import { syncNow } from '@/lib/sync/syncEngine';
import type { Roadbook, Route } from '@/types/models';

function syncAfterWrite() {
  syncNow().catch((e) => console.warn('[sync] post-write:', e instanceof Error ? e.message : e));
}

export default function RoadbookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [roadbook, setRoadbook] = useState<Roadbook | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [title, setTitle] = useState('');

  const load = useCallback(async () => {
    setRoadbook(await roadbookRepo.get(id));
    setRoutes(await routeRepo.listByRoadbook(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    await routeRepo.create({ roadbookId: id, title: trimmed });
    setTitle('');
    await load();
    syncAfterWrite();
  }

  function confirmDelete(route: Route) {
    Alert.alert('Route löschen?', `„${route.title}" wird entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await routeRepo.remove(route.id);
          await load();
          syncAfterWrite();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: roadbook?.name ?? 'Roadbook' }} />

      <Card>
        <ThemedText type="smallBold">Neue Route</ThemedText>
        <TextField placeholder="z. B. Westküste" value={title} onChangeText={setTitle} onSubmitEditing={create} />
        <Button title="Route anlegen" onPress={create} disabled={!title.trim()} />
      </Card>

      {routes.length === 0 ? (
        <ThemedText type="small" style={styles.empty}>
          Noch keine Routen. Lege oben eine an – oder importiere Fotos.
        </ThemedText>
      ) : (
        routes.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => router.push({ pathname: '/route/[id]', params: { id: r.id } })}
            onLongPress={() => confirmDelete(r)}>
            <Card>
              <ThemedText type="subtitle" style={styles.rowTitle}>
                {r.title}
              </ThemedText>
              {r.startDate ? <ThemedText type="small">Start: {r.startDate}</ThemedText> : null}
            </Card>
          </Pressable>
        ))
      )}

      <View style={styles.importBtn}>
        <Button
          title="📷 Route aus Fotos vorschlagen"
          onPress={() => router.push({ pathname: '/import', params: { roadbookId: id } })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  rowTitle: { fontSize: 22, lineHeight: 28 },
  importBtn: { marginTop: Spacing.four },
});
