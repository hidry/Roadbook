/**
 * Slideshow player (README §8.1 "Reise-Diashow"): plays the slide sequence from
 * src/lib/slideshow — intro card, then per stop a camera flight (`flyTo`), a
 * progressively growing route line and the stop's photos. Auto-advance with
 * tap zones: left third = back, right third = forward, centre = pause/play.
 *
 * MapLibre is a native module → this file has a .web.tsx sibling stub.
 */
import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import type { Slide, StopSlide } from '@/lib/slideshow';

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe7ef' } }],
};
const styleUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL;
const mapStyle: string | StyleSpecification = styleUrl && styleUrl.length > 0 ? styleUrl : BLANK_STYLE;

export function SlideshowPlayer({ slides, onClose }: { slides: Slide[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Photo cycling state, reset during render when the slide changes (the
  // React-sanctioned "adjust state during render" pattern — no effect needed).
  const [photoState, setPhotoState] = useState({ slide: 0, i: 0 });
  if (photoState.slide !== index) setPhotoState({ slide: index, i: 0 });
  const photoIndex = photoState.i;

  const slide = slides[index];
  const stopSlides = useMemo(() => slides.filter((s): s is StopSlide => s.kind === 'stop'), [slides]);
  const durationMs = slide?.kind === 'stop' ? slide.durationMs : 4000;

  // Auto-advance to the next slide; stops at the end.
  useEffect(() => {
    if (!playing || !slide) return;
    const t = setTimeout(() => {
      setIndex((i) => Math.min(i + 1, slides.length - 1));
    }, durationMs);
    return () => clearTimeout(t);
  }, [playing, index, durationMs, slides.length, slide]);

  // Cycle through the slide's photos within its duration.
  useEffect(() => {
    if (!playing || slide?.kind !== 'stop' || slide.photoUris.length < 2) return;
    const per = durationMs / slide.photoUris.length;
    const t = setInterval(
      () => setPhotoState((s) => ({ slide: s.slide, i: (s.i + 1) % slide.photoUris.length })),
      per,
    );
    return () => clearInterval(t);
  }, [playing, index, slide, durationMs]);

  if (!slide) return null;

  // The line grows: all legs of stop slides up to (and including) the current.
  const grownLegs = stopSlides
    .slice(0, slide.kind === 'stop' ? stopSlides.indexOf(slide) + 1 : 0)
    .map((s) => s.leg)
    .filter((leg) => leg.length >= 2);

  const cameraCenter: [number, number] =
    slide.kind === 'stop' ? [slide.lng, slide.lat] : stopSlides.length > 0 ? [stopSlides[0].lng, stopSlides[0].lat] : [10, 51];

  function goto(delta: number) {
    setIndex((i) => Math.max(0, Math.min(i + delta, slides.length - 1)));
  }

  return (
    <View style={styles.root}>
      <Map style={StyleSheet.absoluteFill} mapStyle={mapStyle}>
        <Camera center={cameraCenter} zoom={slide.kind === 'intro' ? 5 : 9} duration={1800} easing="fly" />
        {grownLegs.length > 0 ? (
          <GeoJSONSource
            id="slideshow-line"
            data={{
              type: 'FeatureCollection',
              features: grownLegs.map((leg) => ({
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'LineString' as const, coordinates: leg },
              })),
            }}>
            <Layer id="slideshow-line-layer" type="line" paint={{ 'line-color': '#208AEF', 'line-width': 4 }} />
          </GeoJSONSource>
        ) : null}
        {stopSlides.map((s) => (
          <Marker key={s.stopId} lngLat={[s.lng, s.lat]}>
            <View style={styles.dot} />
          </Marker>
        ))}
      </Map>

      {/* Tap zones: back / pause / forward */}
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.tapRow}>
          <Pressable style={styles.tapZone} onPress={() => goto(-1)} />
          <Pressable style={styles.tapZone} onPress={() => setPlaying((p) => !p)} />
          <Pressable style={styles.tapZone} onPress={() => goto(1)} />
        </View>
      </View>

      {slide.kind === 'intro' ? (
        <View style={styles.introWrap} pointerEvents="none">
          <View style={styles.introCard}>
            <ThemedText type="title" style={styles.introTitle}>
              {slide.title}
            </ThemedText>
            {slide.stats.from && slide.stats.to ? (
              <ThemedText style={styles.introLine}>
                {slide.stats.from} – {slide.stats.to}
                {slide.stats.days ? ` · ${slide.stats.days} Tage` : ''}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.introLine}>
              {slide.stats.stopCount} Stopps · {slide.stats.km} km · {slide.stats.photoCount} Fotos
            </ThemedText>
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.header, { top: insets.top + 8 }]} pointerEvents="none">
            <ThemedText type="subtitle" style={styles.headerText}>
              {slide.name}
            </ThemedText>
            {slide.arrivalDate ? <ThemedText style={styles.headerSub}>{slide.arrivalDate}</ThemedText> : null}
          </View>
          {slide.photoUris.length > 0 ? (
            <View style={[styles.photoWrap, { bottom: insets.bottom + 64 }]} pointerEvents="none">
              <Image
                source={{ uri: slide.photoUris[photoIndex % slide.photoUris.length] }}
                style={styles.photo}
                contentFit="cover"
                transition={400}
              />
            </View>
          ) : null}
        </>
      )}

      <View style={[styles.footer, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <ThemedText style={styles.progress}>
          {playing ? '▶' : '⏸'} {index + 1}/{slides.length}
        </ThemedText>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
          <ThemedText style={styles.closeText}>✕ Schließen</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1620' },
  tapRow: { flex: 1, flexDirection: 'row' },
  tapZone: { flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#208AEF', borderWidth: 2, borderColor: '#fff' },
  introWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  introCard: {
    backgroundColor: 'rgba(11, 22, 32, 0.85)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    maxWidth: '85%',
  },
  introTitle: { color: '#fff', textAlign: 'center' },
  introLine: { color: '#dfe7ef' },
  header: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(11, 22, 32, 0.7)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  headerText: { color: '#fff' },
  headerSub: { color: '#dfe7ef', fontSize: 13 },
  photoWrap: { position: 'absolute', left: 16, right: 16, height: 220 },
  photo: { flex: 1, borderRadius: 16, backgroundColor: '#13212e' },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progress: { color: '#fff', backgroundColor: 'rgba(11,22,32,0.7)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  closeBtn: { backgroundColor: 'rgba(11,22,32,0.7)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  closeText: { color: '#fff' },
});
