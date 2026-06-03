import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { photoRepo, stopRepo } from '@/lib/db/repositories';
import { syncNow } from '@/lib/sync/syncEngine';
import type { Photo, Stop, StopRole, StopType } from '@/types/models';

const TYPES: { value: StopType; label: string }[] = [
  { value: 'campingplatz', label: 'Campingplatz' },
  { value: 'stellplatz', label: 'Stellplatz' },
  { value: 'freistehend', label: 'Freistehend' },
];
const ROLES: { value: StopRole; label: string }[] = [
  { value: 'start', label: 'Start' },
  { value: 'stop', label: 'Stopp' },
  { value: 'end', label: 'Ende' },
];

export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [stop, setStop] = useState<Stop | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [name, setName] = useState('');
  const [role, setRole] = useState<StopRole>('stop');
  const [type, setType] = useState<StopType | null>(null);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [arrival, setArrival] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await stopRepo.get(id);
      if (!s) return;
      setStop(s);
      setName(s.name);
      setRole(s.role);
      setType(s.type);
      setLat(s.lat ? String(s.lat) : '');
      setLng(s.lng ? String(s.lng) : '');
      setArrival(s.arrivalDate ?? '');
      setNotes(s.notes ?? '');
      setPhotos(await photoRepo.listByStop(id));
    })();
  }, [id]);

  async function save() {
    setError(null);
    const latNum = lat.trim() ? Number(lat.replace(',', '.')) : 0;
    const lngNum = lng.trim() ? Number(lng.replace(',', '.')) : 0;
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      setError('Breite/Länge müssen Zahlen sein (z. B. 60.39, 5.32).');
      return;
    }
    setSaving(true);
    await stopRepo.update(id, {
      name: name.trim() || 'Unbenannt',
      role,
      // type only meaningful for intermediate stops (README §5.1)
      type: role === 'stop' ? type : null,
      lat: latNum,
      lng: lngNum,
      arrivalDate: arrival.trim() || null,
      notes: notes.trim() || null,
    });
    syncNow().catch((e) => console.warn('[sync] post-write:', e instanceof Error ? e.message : e));
    setSaving(false);
    router.back();
  }

  if (!stop) {
    return (
      <Screen>
        <ThemedText type="small">Lädt…</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: stop.name || 'Stopp' }} />

      <Card>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="Name des Stopps" />

        <ThemedText type="smallBold">Rolle</ThemedText>
        <Segmented options={ROLES} value={role} onChange={setRole} />

        {role === 'stop' ? (
          <>
            <ThemedText type="smallBold">Typ</ThemedText>
            <Segmented
              options={[{ value: null as StopType | null, label: '–' }, ...TYPES]}
              value={type}
              onChange={setType}
            />
          </>
        ) : null}
      </Card>

      <Card>
        <View style={styles.coords}>
          <View style={styles.coordField}>
            <TextField label="Breite (lat)" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.coordField}>
            <TextField label="Länge (lng)" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" />
          </View>
        </View>
        <TextField label="Ankunft (YYYY-MM-DD)" value={arrival} onChangeText={setArrival} placeholder="2026-07-14" />
        <TextField label="Notizen" value={notes} onChangeText={setNotes} multiline style={styles.notes} />
      </Card>

      {photos.length > 0 ? (
        <Card>
          <ThemedText type="smallBold">Fotos: {photos.length}</ThemedText>
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Speichern" onPress={save} loading={saving} />
    </Screen>
  );
}

function Segmented<T extends string | null>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              { backgroundColor: active ? '#208AEF' : theme.backgroundSelected },
            ]}>
            <ThemedText type="small" style={{ color: active ? '#fff' : theme.text }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  coords: { flexDirection: 'row', gap: Spacing.two },
  coordField: { flex: 1 },
  notes: { minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.two },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  segment: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
});
