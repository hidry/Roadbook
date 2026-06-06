import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/MapView';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { stopRepo, tripRepo } from '@/lib/db/repositories';
import { syncNow } from '@/lib/sync/syncEngine';
import type { Stop, StopType, Trip } from '@/types/models';

const TYPE_LABEL: Record<StopType, string> = {
  campingplatz: 'Campingplatz',
  stellplatz: 'Stellplatz',
  freistehend: 'Freistehend',
};

function syncAfterWrite() {
  syncNow().catch((e) => console.warn('[sync] post-write:', e instanceof Error ? e.message : e));
}

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [name, setName] = useState('');
  const [tripName, setTripName] = useState('');

  const load = useCallback(async () => {
    const t = await tripRepo.get(id);
    setTrip(t);
    if (t) setTripName(t.name);
    setStops(await stopRepo.listByTrip(id));
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
    await stopRepo.create({ tripId: id, position, role, name: trimmed, lat: 0, lng: 0 });
    setName('');
    await load();
    syncAfterWrite();
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
          syncAfterWrite();
        },
      },
    ]);
  }

  async function saveName() {
    const trimmed = tripName.trim();
    if (!trimmed || trimmed === trip?.name) return;
    await tripRepo.rename(id, trimmed);
    setTrip((t) => (t ? { ...t, name: trimmed } : t));
    syncAfterWrite();
  }

  async function handleDragEnd({ data }: { data: Stop[] }) {
    const reordered = data.map((s, i) => ({ ...s, position: i }));
    setStops(reordered);
    for (const s of reordered) {
      await stopRepo.update(s.id, { position: s.position });
    }
    syncAfterWrite();
  }

  const located = stops.filter((s) => s.lat !== 0 || s.lng !== 0);

  const renderItem = ({ item: s, drag, isActive, getIndex }: RenderItemParams<Stop>) => {
    const index = getIndex() ?? 0;
    return (
      <ScaleDecorator>
        <Pressable
          onPress={() => !isActive && router.push({ pathname: '/stop/[id]', params: { id: s.id } })}
          onLongPress={() => !isActive && confirmDelete(s)}>
          <Card style={[styles.stopCard, isActive && styles.activeCard]}>
            <View style={styles.row}>
              <Pressable onLongPress={drag} hitSlop={8} style={styles.handle}>
                <ThemedText style={styles.handleIcon}>☰</ThemedText>
              </Pressable>
              <ThemedText type="smallBold">{index + 1}.</ThemedText>
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
      </ScaleDecorator>
    );
  };

  const ListHeader = (
    <>
      <Stack.Screen options={{ title: trip?.name ?? 'Reise' }} />
      <RouteMap stops={located} />
      <Card style={styles.headerCard}>
        <TextField
          label="Reisetitel"
          value={tripName}
          onChangeText={setTripName}
          onBlur={saveName}
          placeholder="Titel der Reise"
        />
        {trip?.startDate ? <ThemedText type="small">Start: {trip.startDate}</ThemedText> : null}
      </Card>
      <Card style={styles.headerCard}>
        <ThemedText type="smallBold">Stopp hinzufügen</ThemedText>
        <TextField placeholder="Name des Stopps" value={name} onChangeText={setName} onSubmitEditing={addStop} />
        <Button title="Hinzufügen" onPress={addStop} disabled={!name.trim()} />
        <Button
          title="📷 Stopps aus Fotos vorschlagen"
          variant="secondary"
          onPress={() => router.push({ pathname: '/import', params: { tripId: id } })}
        />
      </Card>
    </>
  );

  return (
    <Screen scroll={false}>
      <DraggableFlatList
        data={stops}
        keyExtractor={(s) => s.id}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <ThemedText type="small" style={styles.empty}>
            Noch keine Stopps. Füge oben welche hinzu – oder importiere Fotos.
          </ThemedText>
        }
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
      />
    </Screen>
  );
}

function roleLabel(s: Stop): string {
  if (s.role === 'start') return 'Start';
  if (s.role === 'end') return 'Ende';
  return 'Stopp';
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.three },
  headerCard: { marginBottom: Spacing.three },
  stopCard: { marginBottom: Spacing.two },
  activeCard: { opacity: 0.85, elevation: 6 },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stopName: { flex: 1 },
  handle: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  handleIcon: { fontSize: 18, opacity: 0.5 },
  noGps: { color: '#E5484D' },
});
