import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';
import { roadbookRepo } from '@/lib/db/repositories';
import type { Roadbook } from '@/types/models';

export default function RoadbooksScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [roadbooks, setRoadbooks] = useState<Roadbook[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setRoadbooks(await roadbookRepo.list());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || !user) return;
    await roadbookRepo.create({ name: trimmed, ownerId: user.id });
    setName('');
    await load();
  }

  function confirmDelete(rb: Roadbook) {
    Alert.alert('Roadbook löschen?', `„${rb.name}" wird entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await roadbookRepo.remove(rb.id);
          await load();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Roadbooks',
          headerRight: () => (
            <Pressable onPress={() => router.push('/menu')} hitSlop={12} style={styles.menuBtn}>
              <ThemedText style={styles.menuBtnText}>···</ThemedText>
            </Pressable>
          ),
        }}
      />
      <Card>
        <ThemedText type="smallBold">Neues Roadbook</ThemedText>
        <TextField placeholder="z. B. Norwegen 2026" value={name} onChangeText={setName} onSubmitEditing={create} />
        <Button title="Anlegen" onPress={create} disabled={!name.trim()} />
      </Card>

      {roadbooks.length === 0 ? (
        <ThemedText type="small" style={styles.empty}>
          Noch keine Roadbooks. Lege oben dein erstes an.
        </ThemedText>
      ) : (
        roadbooks.map((rb) => (
          <Pressable
            key={rb.id}
            onPress={() => router.push({ pathname: '/roadbook/[id]', params: { id: rb.id } })}
            onLongPress={() => confirmDelete(rb)}>
            <Card>
              <ThemedText type="subtitle" style={styles.rowTitle}>
                {rb.name}
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
