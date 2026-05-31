/**
 * Thin MapLibre wrapper (README §3: MapLibre GL engine). Renders the route's
 * stops as markers and connects them with a line. The basemap style comes from
 * EXPO_PUBLIC_MAP_STYLE_URL (production: self-hosted Protomaps/PMTiles on R2 —
 * NEVER tile.openstreetmap.org, README §3). With no style URL configured it
 * falls back to a plain background so markers/line still render in dev.
 *
 * NOTE: MapLibre is a native module — it needs a custom dev client / prebuild
 * (it does NOT run in Expo Go). On web it is not rendered.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Stop } from '@/types/models';

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe7ef' } }],
};

const styleUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL;
const mapStyle: string | StyleSpecification = styleUrl && styleUrl.length > 0 ? styleUrl : BLANK_STYLE;

function center(stops: Stop[]): [number, number] {
  if (stops.length === 0) return [10.0, 51.0]; // central Europe fallback
  const lng = stops.reduce((s, p) => s + p.lng, 0) / stops.length;
  const lat = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
  return [lng, lat];
}

export function RouteMap({ stops, style }: { stops: Stop[]; style?: object }) {
  // Web has no MapLibre native view; show a neutral placeholder instead.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.placeholder, style]}>
        <ThemedText type="small">Karte ist auf dem Gerät (iOS/Android) verfügbar.</ThemedText>
      </View>
    );
  }

  const ordered = [...stops].sort((a, b) => a.position - b.position);
  const lineCoords = ordered.map((s) => [s.lng, s.lat]);

  return (
    <View style={[styles.container, style]}>
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle}>
        <Camera zoom={stops.length ? 6 : 3} center={center(stops)} />

        {lineCoords.length >= 2 ? (
          <GeoJSONSource
            id="route-line"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: lineCoords },
            }}>
            <Layer id="route-line-layer" type="line" paint={{ 'line-color': '#208AEF', 'line-width': 3 }} />
          </GeoJSONSource>
        ) : null}

        {ordered.map((s) => (
          <Marker key={s.id} lngLat={[s.lng, s.lat]}>
            <View style={[styles.dot, s.role === 'start' && styles.start, s.role === 'end' && styles.end]} />
          </Marker>
        ))}
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: '#dfe7ef' },
  placeholder: {
    height: 240,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dfe7ef',
  },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#208AEF', borderWidth: 2, borderColor: '#fff' },
  start: { backgroundColor: '#30A46C' },
  end: { backgroundColor: '#E5484D' },
});
