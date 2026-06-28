import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import * as DocumentPicker from 'expo-document-picker';
import { cacheDirectory, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/MapView';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { stopRepo, trackRepo, tripRepo } from '@/lib/db/repositories';
import {
  modelFromTrip,
  parseRouteFile,
  routeModelStats,
  stopsFromModel,
  timelineSpan,
  timelineToRouteModel,
  toGpx,
  tracksFromModel,
} from '@/lib/route-model';
import { syncNow } from '@/lib/sync/syncEngine';
import { formatTags, parseTagInput } from '@/lib/util/tags';
import { normalizeHttpUrl } from '@/lib/util/url';
import type { Stop, StopType, Track, Trip } from '@/types/models';

const TYPE_LABEL: Record<StopType, string> = {
  campingplatz: 'Campingplatz',
  stellplatz: 'Stellplatz',
  freistehend: 'Freistehend',
  verentsorgung: 'Ver-/Entsorgung',
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState('');
  const [tripName, setTripName] = useState('');
  const [stravaInput, setStravaInput] = useState('');
  const [stravaError, setStravaError] = useState<string | null>(null);
  const [tagsInput, setTagsInput] = useState('');

  const load = useCallback(async () => {
    const t = await tripRepo.get(id);
    setTrip(t);
    if (t) {
      setTripName(t.name);
      setStravaInput(t.stravaUrl ?? '');
      setTagsInput(formatTags(t.tags));
    }
    setStops(await stopRepo.listByTrip(id));
    setTracks(await trackRepo.listByTrip(id));
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

  async function saveTags() {
    const tags = parseTagInput(tagsInput);
    if (JSON.stringify(tags) === JSON.stringify(trip?.tags ?? [])) return;
    await tripRepo.update(id, { tags });
    setTrip((t) => (t ? { ...t, tags } : t));
    setTagsInput(formatTags(tags));
    syncAfterWrite();
  }

  async function saveStravaUrl() {
    setStravaError(null);
    const normalized = normalizeHttpUrl(stravaInput);
    if (stravaInput.trim() && !normalized) {
      setStravaError('Kein gültiger Link (z. B. https://strava.com/activities/…).');
      return;
    }
    if (normalized === (trip?.stravaUrl ?? null)) return;
    await tripRepo.update(id, { stravaUrl: normalized });
    setTrip((t) => (t ? { ...t, stravaUrl: normalized } : t));
    setStravaInput(normalized ?? '');
    syncAfterWrite();
  }

  async function importRouteFile() {
    const res = await DocumentPicker.getDocumentAsync({
      // GPX/KML have no reliable registered MIME type across pickers — accept
      // everything and let parseRouteFile decide (extension + content sniff).
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    try {
      const content = await readAsStringAsync(asset.uri);
      const model = parseRouteFile(asset.name ?? 'datei.xml', content);
      const stats = routeModelStats(model);
      if (stats.stops === 0 && stats.trackPoints === 0) {
        Alert.alert('Import', 'Die Datei enthält keine Stopps oder Tracks.');
        return;
      }
      Alert.alert(
        'Route importieren?',
        `${asset.name}\n${stats.stops} Stopp(s), ${stats.tracks} Track(s) mit ${stats.trackPoints} Punkten`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Importieren',
            onPress: async () => {
              for (const s of stopsFromModel(model, stops.length)) {
                await stopRepo.create({ tripId: id, ...s });
              }
              for (const t of tracksFromModel(model)) {
                await trackRepo.create({ tripId: id, ...t });
              }
              await load();
              syncAfterWrite();
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Import fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
  }

  // Google Timeline import: the export is the user's WHOLE movement history, so
  // we extract ONLY this trip's window (derived from its dated stops) and keep
  // only the resulting track — never the raw dump (README §7/§8.1). Timeline
  // supplies the real driven route UNDER the photo stops.
  async function importTimeline() {
    const dated = stops
      .map((s) => s.arrivalDate)
      .filter((d): d is string => !!d)
      .sort();
    let from = dated[0] ?? trip?.startDate ?? null;
    let to = dated[dated.length - 1] ?? trip?.startDate ?? null;
    if (!from || !to) {
      Alert.alert(
        'Google Timeline',
        'Für den Timeline-Import braucht die Reise einen Zeitraum. Importiere zuerst Fotos (das erzeugt Stopps mit Datum) oder setze ein Startdatum.',
      );
      return;
    }
    // Pad a day on each side so arrival/return-day movement is included.
    const shift = (d: string, days: number) =>
      new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    from = shift(from, -1);
    to = shift(to, 1);

    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return;
    try {
      const content = await readAsStringAsync(res.assets[0].uri);
      const model = timelineToRouteModel(content, { from, to });
      const stats = routeModelStats(model);
      if (stats.trackPoints === 0) {
        const span = timelineSpan(content);
        Alert.alert(
          'Google Timeline',
          span
            ? `Kein Streckenverlauf im Reisezeitraum (${from} – ${to}) gefunden.\nDie Datei deckt ${span.from} – ${span.to} ab.`
            : 'Keine gültige Google-Timeline-Datei.',
        );
        return;
      }
      Alert.alert(
        'Timeline-Track importieren?',
        `Zeitraum ${from} – ${to}\n${stats.trackPoints} Streckenpunkte (${stats.tracks} Track).\n\nNur die Strecke dieser Reise wird übernommen — der restliche Verlauf wird verworfen.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Importieren',
            onPress: async () => {
              for (const t of tracksFromModel(model)) {
                await trackRepo.create({ tripId: id, ...t });
              }
              await load();
              syncAfterWrite();
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Import fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
  }

  async function exportGpx() {
    if (!trip) return;
    try {
      const gpx = toGpx(modelFromTrip(trip.name, stops, tracks));
      const fileName = `${trip.name.replace(/[^\wäöüÄÖÜß-]+/g, '_') || 'reise'}.gpx`;
      const uri = `${cacheDirectory}${fileName}`;
      await writeAsStringAsync(uri, gpx);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/gpx+xml', dialogTitle: 'Reise als GPX teilen' });
      } else {
        Alert.alert('Export', `GPX gespeichert unter:\n${uri}`);
      }
    } catch (e) {
      Alert.alert('Export fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
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
      <RouteMap stops={located} tracks={tracks} />
      <Card style={styles.headerCard}>
        <TextField
          label="Reisetitel"
          value={tripName}
          onChangeText={setTripName}
          onBlur={saveName}
          placeholder="Titel der Reise"
        />
        {trip?.startDate ? <ThemedText type="small">Start: {trip.startDate}</ThemedText> : null}
        <TextField
          label="Tags (Komma-getrennt, z. B. Dethleffs, Sommer)"
          value={tagsInput}
          onChangeText={setTagsInput}
          onBlur={saveTags}
          placeholder="Dethleffs, Sommer"
          autoCapitalize="none"
        />
        <TextField
          label="Strava-Link (optional)"
          value={stravaInput}
          onChangeText={setStravaInput}
          onBlur={saveStravaUrl}
          placeholder="https://strava.com/activities/…"
          autoCapitalize="none"
          keyboardType="url"
        />
        <ErrorText>{stravaError}</ErrorText>
        {trip?.stravaUrl ? (
          <Button
            title="In Strava öffnen"
            variant="secondary"
            onPress={() => Linking.openURL(trip.stravaUrl!).catch(() => {})}
          />
        ) : null}
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
      <Card style={styles.headerCard}>
        <Button
          title="▶️ Reise abspielen"
          variant="secondary"
          onPress={() => router.push({ pathname: '/play', params: { tripId: id } })}
          disabled={located.length === 0}
        />
        <ThemedText type="smallBold">Import & Export</ThemedText>
        <Button title="🗺 GPX/KML importieren" variant="secondary" onPress={importRouteFile} />
        <Button title="📍 Google Timeline importieren" variant="secondary" onPress={importTimeline} />
        <Button
          title="📤 Als GPX exportieren"
          variant="secondary"
          onPress={exportGpx}
          disabled={stops.every((s) => s.lat === 0 && s.lng === 0) && tracks.length === 0}
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
