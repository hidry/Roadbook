import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { RouteMap } from '@/components/MapView';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { routeRepo, stopRepo } from '@/lib/db/repositories';
import type { Route, Stop, StopType } from '@/types/models';

const TYPE_LABEL: Record<StopType, string> = {
  campingplatz: 'Campingplatz',
  stellplatz: 'Stellplatz',
  freistehend: 'Freistehend',
};

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setRoute(await routeRepo.get(id));
    setStops(await stopRepo.listByRoute(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function addStop() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const position = stops.length;
    const role = position === 0 ? 'start' : 'stop';
    // Manual stops start without coordinates (0,0); edit on the stop screen.
    await stopRepo.create({ routeId: id, position, role, name: trimmed, lat: 0, lng: 0 });
    setName('');
    await load();
  }

  function confirmDelete(stop: Stop) {
    Alert.alert('Stopp löschen?', `„${stop.name}" wird entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await stopRepo.remove(stop.id);
          await load();
        },
      },
    ]);
  }

  const located = stops.filter((s) => s.lat !== 0 || s.lng !== 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: route?.title ?? 'Route' }} />

      <RouteMap stops={located} />

      <Card>
        <ThemedText type="smallBold">Stopp hinzufügen</ThemedText>
        <TextField placeholder="Name des Stopps" value={name} onChangeText={setName} onSubmitEditing={addStop} />
        <Button title="Hinzufügen" onPress={addStop} disabled={!name.trim()} />
      </Card>

      {stops.length === 0 ? (
        <ThemedText type="small" style={styles.empty}>
          Noch keine Stopps.
        </ThemedText>
      ) : (
        stops.map((s, i) => (
          <Pressable
            key={s.id}
            onPress={() => router.push({ pathname: '/stop/[id]', params: { id: s.id } })}
            onLongPress={() => confirmDelete(s)}>
            <Card>
              <View style={styles.row}>
                <ThemedText type="smallBold">{i + 1}.</ThemedText>
                <ThemedText type="default" style={styles.stopName}>
                  {s.name}
                </ThemedText>
                <ThemedText type="small">{roleLabel(s)}</ThemedText>
              </View>
              {s.type ? <ThemedText type="small">{TYPE_LABEL[s.type]}</ThemedText> : null}
              {s.lat === 0 && s.lng === 0 ? (
                <ThemedText type="small" style={styles.noGps}>
                  Keine Koordinaten – zum Setzen antippen
                </ThemedText>
              ) : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function roleLabel(s: Stop): string {
  if (s.role === 'start') return 'Start';
  if (s.role === 'end') return 'Ende';
  return 'Stopp';
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stopName: { flex: 1 },
  noGps: { color: '#E5484D' },
});
