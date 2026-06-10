import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth/AuthProvider';
import { tripRepo } from '@/lib/db/repositories';
import { collectTags, hasTag } from '@/lib/util/tags';
import type { Trip } from '@/types/models';

export default function TripsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [name, setName] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTrips(await tripRepo.list());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || !user) return;
    await tripRepo.create({ name: trimmed, ownerId: user.id });
    setName('');
    await load();
  }

  const allTags = collectTags(trips);
  const visible = trips.filter((t) => hasTag(t, tagFilter));

  function confirmDelete(trip: Trip) {
    Alert.alert('Reise löschen?', `„${trip.name}" wird entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await tripRepo.remove(trip.id);
          await load();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Reisen',
          headerRight: () => (
            <Pressable onPress={() => router.push('/menu')} hitSlop={12} style={styles.menuBtn}>
              <ThemedText style={styles.menuBtnText}>···</ThemedText>
            </Pressable>
          ),
        }}
      />
      <Card>
        <ThemedText type="smallBold">Neue Reise</ThemedText>
        <TextField placeholder="z. B. Norwegen 2026" value={name} onChangeText={setName} onSubmitEditing={create} />
        <Button title="Anlegen" onPress={create} disabled={!name.trim()} />
      </Card>

      {allTags.length > 0 ? (
        <View style={styles.tagRow}>
          {allTags.map((tag) => {
            const active = tagFilter?.toLowerCase() === tag.toLowerCase();
            return (
              <Pressable
                key={tag}
                onPress={() => setTagFilter(active ? null : tag)}
                style={[styles.tagChip, { backgroundColor: active ? '#208AEF' : theme.backgroundSelected }]}>
                <ThemedText type="small" style={{ color: active ? '#fff' : theme.text }}>
                  {tag}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {trips.length === 0 ? (
        <ThemedText type="small" style={styles.empty}>
          Noch keine Reisen. Lege oben deine erste an.
        </ThemedText>
      ) : (
        visible.map((trip) => (
          <Pressable
            key={trip.id}
            onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
            onLongPress={() => confirmDelete(trip)}>
            <Card>
              <ThemedText type="subtitle" style={styles.rowTitle}>
                {trip.name}
              </ThemedText>
              {trip.tags.length > 0 ? <ThemedText type="small">{trip.tags.join(' · ')}</ThemedText> : null}
              <ThemedText type="small">Lang drücken zum Löschen</ThemedText>
            </Card>
          </Pressable>
        ))
      )}

      <View style={styles.signOut}>
        <Button title="Abmelden" variant="secondary" onPress={signOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  rowTitle: { fontSize: 22, lineHeight: 28 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  tagChip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: Spacing.three },
  signOut: { marginTop: Spacing.four },
  menuBtn: { paddingHorizontal: Spacing.two },
  menuBtnText: { fontSize: 22, letterSpacing: 2 },
});
