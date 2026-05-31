/**
 * Photo-import flow (README §4): pick photos → read EXIF GPS/time → cluster into
 * stops → reverse-geocode names → user edits → save route + stops + photos.
 * Photos are then compressed and uploaded to R2 in the background; a failed
 * upload is marked, never fatal (offline-first, README §5.4 upload queue).
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { photoRepo, routeRepo, stopRepo } from '@/lib/db/repositories';
import { reverseGeocode } from '@/lib/geocoding';
import { compressPhoto } from '@/lib/photos/compress';
import { pickAndReadPhotos, type PickedPhoto } from '@/lib/photos/exif';
import { uploadPhotoToR2 } from '@/lib/photos/r2upload';
import { suggestRoute, type SuggestedStop } from '@/lib/photos/suggestion';
import type { StopType } from '@/types/models';

type Phase = 'idle' | 'reading' | 'geocoding' | 'review' | 'saving';

const TYPE_CYCLE: (StopType | null)[] = [null, 'campingplatz', 'stellplatz', 'freistehend'];
const TYPE_LABEL: Record<string, string> = {
  null: 'Typ wählen',
  campingplatz: 'Campingplatz',
  stellplatz: 'Stellplatz',
  freistehend: 'Freistehend',
};

export default function ImportScreen() {
  const { roadbookId } = useLocalSearchParams<{ roadbookId: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('idle');
  const [title, setTitle] = useState('');
  const [stops, setStops] = useState<SuggestedStop[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [metaById, setMetaById] = useState<Record<string, PickedPhoto>>({});

  async function pick() {
    try {
      setPhase('reading');
      const photos = await pickAndReadPhotos();
      if (photos.length === 0) {
        setPhase('idle');
        return;
      }
      const map: Record<string, PickedPhoto> = {};
      photos.forEach((p) => (map[p.id] = p));
      setMetaById(map);

      const suggestion = suggestRoute(photos);
      setUnassigned(suggestion.unassignedPhotoIds);

      // Reverse-geocode each stop centroid (throttled inside the geocoder).
      setPhase('geocoding');
      const named: SuggestedStop[] = [];
      for (const s of suggestion.stops) {
        const place = await reverseGeocode(s.lat, s.lng);
        named.push({ ...s, name: place ?? s.name });
      }
      setStops(named);
      if (!title) setTitle(named[0]?.name ? `Reise: ${named[0].name}` : 'Neue Reise');
      setPhase('review');
    } catch (e) {
      setPhase('idle');
      Alert.alert('Import fehlgeschlagen', e instanceof Error ? e.message : 'Unbekannter Fehler');
    }
  }

  function updateStop(index: number, patch: Partial<SuggestedStop>) {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStop(index: number) {
    setStops((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i })));
  }

  async function save() {
    if (!roadbookId || stops.length === 0) return;
    setPhase('saving');
    try {
      const route = await routeRepo.create({
        roadbookId,
        title: title.trim() || 'Neue Reise',
        startDate: stops[0]?.arrivalDate ?? null,
      });

      const last = stops.length - 1;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const role = i === 0 ? 'start' : i === last ? 'end' : 'stop';
        const created = await stopRepo.create({
          routeId: route.id,
          position: i,
          role,
          type: role === 'stop' ? s.type ?? null : null,
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          arrivalDate: s.arrivalDate,
        });
        for (const pid of s.photoIds) {
          const meta = metaById[pid];
          if (!meta) continue;
          const photo = await photoRepo.create({
            stopId: created.id,
            localUri: meta.uri,
            takenAt: meta.takenAt,
            lat: meta.lat,
            lng: meta.lng,
          });
          void uploadInBackground(photo.id, meta.uri);
        }
      }
      router.replace({ pathname: '/route/[id]', params: { id: route.id } });
    } catch (e) {
      setPhase('review');
      Alert.alert('Speichern fehlgeschlagen', e instanceof Error ? e.message : 'Unbekannter Fehler');
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Foto-Import' }} />

      {phase === 'idle' ? (
        <Card>
          <ThemedText type="smallBold">Route aus Fotos vorschlagen</ThemedText>
          <ThemedText type="small">
            Wähle Fotos einer Reise. Aus GPS + Aufnahmezeit schlägt Roadbook Stopps vor – alles bleibt editierbar.
          </ThemedText>
          <Button title="📷 Fotos auswählen" onPress={pick} />
        </Card>
      ) : null}

      {phase === 'reading' || phase === 'geocoding' || phase === 'saving' ? (
        <Card style={styles.center}>
          <ActivityIndicator />
          <ThemedText type="small">
            {phase === 'reading' ? 'Lese Foto-Metadaten…' : phase === 'geocoding' ? 'Bestimme Orte…' : 'Speichere…'}
          </ThemedText>
        </Card>
      ) : null}

      {phase === 'review' ? (
        <>
          <Card>
            <TextField label="Titel der Route" value={title} onChangeText={setTitle} />
          </Card>

          {stops.map((s, i) => (
            <Card key={i}>
              <View style={styles.row}>
                <ThemedText type="smallBold">{i + 1}.</ThemedText>
                <ThemedText type="small">
                  {i === 0 ? 'Start' : i === stops.length - 1 ? 'Ende' : 'Stopp'} · {s.arrivalDate.slice(0, 10)}
                </ThemedText>
              </View>
              <TextField value={s.name} onChangeText={(name) => updateStop(i, { name })} />
              {i !== 0 && i !== stops.length - 1 ? (
                <Pressable
                  onPress={() => {
                    const next = TYPE_CYCLE[(TYPE_CYCLE.indexOf(s.type ?? null) + 1) % TYPE_CYCLE.length];
                    updateStop(i, { type: next });
                  }}
                  style={styles.typeBtn}>
                  <ThemedText type="small">{TYPE_LABEL[String(s.type ?? null)]}</ThemedText>
                </Pressable>
              ) : null}
              <ThemedText type="small">{s.photoIds.length} Foto(s)</ThemedText>
              <Button title="Stopp entfernen" variant="secondary" onPress={() => removeStop(i)} />
            </Card>
          ))}

          {unassigned.length > 0 ? (
            <Card>
              <ThemedText type="small">
                {unassigned.length} Foto(s) ohne GPS konnten keinem Stopp zugeordnet werden. Du kannst sie später manuell
                ergänzen.
              </ThemedText>
            </Card>
          ) : null}

          <Button title="Route speichern" onPress={save} disabled={stops.length === 0} />
        </>
      ) : null}
    </Screen>
  );
}

/** Compress + upload one photo; mark the row uploaded/failed. Best-effort. */
async function uploadInBackground(photoId: string, localUri: string): Promise<void> {
  try {
    const compressed = await compressPhoto(localUri);
    const url = await uploadPhotoToR2(compressed.uri, photoId);
    await photoRepo.setUploaded(photoId, url);
  } catch {
    await photoRepo.setUploadStatus(photoId, 'failed');
  }
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  typeBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, alignSelf: 'flex-start' },
});
