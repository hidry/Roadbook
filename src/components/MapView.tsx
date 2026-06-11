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
import type { Stop, Track } from '@/types/models';

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe7ef' } }],
};

const styleUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL;
const mapStyle: string | StyleSpecification = styleUrl && styleUrl.length > 0 ? styleUrl : BLANK_STYLE;

const MAP_PADDING = { top: 50, right: 50, bottom: 50, left: 50 };

/** [west, south, east, north] bounding box over [lng, lat] coordinates. */
function boundsOf(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export function RouteMap({ stops, tracks = [], style }: { stops: Stop[]; tracks?: Track[]; style?: object }) {
  // Web has no MapLibre native view; show a neutral placeholder instead.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.placeholder, style]}>
        <ThemedText type="small">Karte ist auf dem Gerät (iOS/Android) verfügbar.</ThemedText>
      </View>
    );
  }

  const ordered = [...stops].sort((a, b) => a.position - b.position);
  const lineCoords = ordered.map((s) => [s.lng, s.lat] as [number, number]);
  // Tracks are the REAL driven path (README §8.1): when present they replace
  // the straight stop-connector line; the air line stays as the fallback.
  const trackLines = tracks
    .map((t) => t.points.map((p) => [p.lng, p.lat] as [number, number]))
    .filter((coords) => coords.length >= 2);
  const allCoords = [...lineCoords, ...trackLines.flat()];

  return (
    <View style={[styles.container, style]}>
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle}>
        {allCoords.length >= 2 ? (
          <Camera bounds={boundsOf(allCoords)} padding={MAP_PADDING} />
        ) : allCoords.length === 1 ? (
          <Camera zoom={10} center={allCoords[0]} />
        ) : (
          <Camera zoom={3} center={[10.0, 51.0]} />
        )}

        {trackLines.length > 0 ? (
          <GeoJSONSource
            id="track-lines"
            data={{
              type: 'FeatureCollection',
              features: trackLines.map((coords) => ({
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'LineString' as const, coordinates: coords },
              })),
            }}>
            <Layer id="track-lines-layer" type="line" paint={{ 'line-color': '#208AEF', 'line-width': 3 }} />
          </GeoJSONSource>
        ) : lineCoords.length >= 2 ? (
          <GeoJSONSource
            id="route-line"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: lineCoords },
            }}>
            <Layer
              id="route-line-layer"
              type="line"
              paint={{ 'line-color': '#208AEF', 'line-width': 3, 'line-dasharray': [2, 2] }}
            />
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

export function StopMap({ stop, style }: { stop: Stop; style?: object }) {
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.placeholder, styles.stopMapSize, style]}>
        <ThemedText type="small">Karte auf Gerät verfügbar.</ThemedText>
      </View>
    );
  }

  if (stop.lat === 0 && stop.lng === 0) {
    return (
      <View style={[styles.placeholder, styles.stopMapSize, style]}>
        <ThemedText type="small">Keine Koordinaten gesetzt.</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.stopMapSize, style]}>
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle}>
        <Camera zoom={12} center={[stop.lng, stop.lat]} />
        <Marker lngLat={[stop.lng, stop.lat]}>
          <View style={[styles.dot, stop.role === 'start' && styles.start, stop.role === 'end' && styles.end]} />
        </Marker>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 240, borderRadius: 16, overflow: 'hidden', backgroundColor: '#dfe7ef' },
  stopMapSize: { height: 180 },
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
