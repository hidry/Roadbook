import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';
import { tripRepo } from '@/lib/db/repositories';
import type { Trip } from '@/types/models';

export default function TripsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [name, setName] = useState('');

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

      {trips.length === 0 ? (
        <ThemedText type="small" style={styles.empty}>
          Noch keine Reisen. Lege oben deine erste an.
        </ThemedText>
      ) : (
        trips.map((trip) => (
          <Pressable
            key={trip.id}
            onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}
            onLongPress={() => confirmDelete(trip)}>
            <Card>
              <ThemedText type="subtitle" style={styles.rowTitle}>
                {trip.name}
              </ThemedText>
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
  signOut: { marginTop: Spacing.four },
  menuBtn: { paddingHorizontal: Spacing.two },
  menuBtnText: { fontSize: 22, letterSpacing: 2 },
});
