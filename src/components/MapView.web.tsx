/**
 * Web stub for the route map. MapLibre (`@maplibre/maplibre-react-native`) is a
 * native module with NO web support, so on web we must not even import it —
 * Metro picks this `.web.tsx` over MapView.tsx for the web bundle. Markers/line
 * are a device feature; here we render a neutral placeholder so the rest of the
 * app (and the web E2E suite) runs.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Stop, Track } from '@/types/models';

export function RouteMap({ stops, tracks = [], style }: { stops: Stop[]; tracks?: Track[]; style?: object }) {
  return (
    <View style={[styles.placeholder, style]} testID="route-map-web">
      <ThemedText type="small">Karte ist auf dem Gerät (iOS/Android) verfügbar.</ThemedText>
      <ThemedText type="small">
        {stops.length} Stopp(s) mit Koordinaten{tracks.length > 0 ? ` · ${tracks.length} Track(s)` : ''}
      </ThemedText>
    </View>
  );
}

export function StopMap({ stop, style }: { stop: Stop; style?: object }) {
  return (
    <View style={[styles.placeholder, styles.stopMapSize, style]} testID="stop-map-web">
      <ThemedText type="small">Karte auf Gerät verfügbar.</ThemedText>
      <ThemedText type="small">{stop.name}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 240,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#dfe7ef',
  },
  stopMapSize: { height: 180 },
});
