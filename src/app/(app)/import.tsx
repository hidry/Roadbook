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
import { reverseGeocode, describeGeocodeStatus, type GeocodeStatus } from '@/lib/geocoding';
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
      const { photos, diagnostics } = await pickAndReadPhotos();
      if (photos.length === 0) {
        setPhase('idle');
        return;
      }
      // No GPS at all → the route can't be built. Surface WHY so the user can
      // fix it (usually Android's "limited" photo access stripping location).
      if (diagnostics.withGps === 0) {
        setPhase('idle');
        const zeroHint =
          diagnostics.gpsZero > 0
            ? `\n• GPS-Nullkoordinaten (0°/0°) herausgefiltert: ${diagnostics.gpsZero}/${diagnostics.total} – Android schreibt dies, wenn der Medienstandort-Zugriff fehlt oder der GPS-Empfang beim Aufnehmen nicht aktiv war.`
            : '';
        Alert.alert(
          'Keine GPS-Daten gefunden',
          `Aus ${diagnostics.total} Foto(s) konnte kein Standort gelesen werden.\n\n` +
            `• Foto-Standortzugriff: ${diagnostics.mediaLibraryGranted ? 'erlaubt' : 'NICHT erlaubt'}\n` +
            `• Fotos ohne Medien-ID: ${diagnostics.assetIdMissing}/${diagnostics.total}\n` +
            `• Mit Aufnahmezeit: ${diagnostics.withTime}/${diagnostics.total}` +
            zeroHint +
            `\n\nTipp: Einstellungen → Apps → Roadbook → Berechtigungen → „Fotos und Medien" auf „Alle zulassen" ` +
            `stellen (nicht „Auswählen"), damit der eingebettete Standort lesbar ist.`,
        );
        return;
      }
      const map: Record<string, PickedPhoto> = {};
      photos.forEach((p) => (map[p.id] = p));
      setMetaById(map);

      const suggestion = suggestRoute(photos);
      setUnassigned(suggestion.unassignedPhotoIds);

      // Reverse-geocode each stop centroid (throttled + retried inside the geocoder).
      setPhase('geocoding');
      const named: SuggestedStop[] = [];
      let geocoded = 0;
      let lastFail: { status: GeocodeStatus; httpStatus?: number } | null = null;
      for (const s of suggestion.stops) {
        const r = await reverseGeocode(s.lat, s.lng);
        if (r.name) geocoded++;
        else lastFail = { status: r.status, httpStatus: r.httpStatus };
        named.push({ ...s, name: r.name ?? s.name });
      }
      setStops(named);
      if (!title) setTitle(named[0]?.name ? `Reise: ${named[0].name}` : 'Neue Reise');
      setPhase('review');

      // GPS worked but no name resolved → the geocoder, not the photos, is the
      // problem. Say WHY (non-blocking) so names can be set manually.
      if (suggestion.stops.length > 0 && geocoded === 0 && lastFail) {
        Alert.alert(
          'Ortsnamen nicht ermittelbar',
          `Die Koordinaten wurden erkannt, aber der Ortsname-Dienst (Nominatim) lieferte keinen Namen.\n\n` +
            `Grund: ${describeGeocodeStatus(lastFail.status, lastFail.httpStatus)}.\n\n` +
            `Die Stopps sind angelegt – du kannst die Namen manuell setzen oder den Import später erneut versuchen.`,
        );
      }
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
        // Photos taken AT the stop plus excursion photos attached to its day.
        for (const pid of [...s.photoIds, ...s.attachedPhotoIds]) {
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
