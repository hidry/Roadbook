/**
 * Slideshow screen (README §8.1 "Reise-Diashow"): loads the trip's data, builds
 * the slide sequence (pure logic in src/lib/slideshow) and hands it to the
 * platform player (SlideshowPlayer / its web stub).
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { SlideshowPlayer } from '@/components/SlideshowPlayer';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui';
import { photoRepo, stopRepo, trackRepo, tripRepo } from '@/lib/db/repositories';
import { buildSlideshow, type Slide } from '@/lib/slideshow';
import type { Photo } from '@/types/models';

export default function PlayScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const [slides, setSlides] = useState<Slide[] | null>(null);

  useEffect(() => {
    (async () => {
      const trip = await tripRepo.get(tripId);
      if (!trip) {
        setSlides([]);
        return;
      }
      const stops = await stopRepo.listByTrip(tripId);
      const tracks = await trackRepo.listByTrip(tripId);
      const photosByStop: Record<string, Photo[]> = {};
      for (const s of stops) {
        photosByStop[s.id] = await photoRepo.listByStop(s.id);
      }
      setSlides(buildSlideshow({ tripName: trip.name, stops, tracks, photosByStop }));
    })();
  }, [tripId]);

  if (!slides) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Diashow' }} />
        <ThemedText type="small">Lädt…</ThemedText>
      </Screen>
    );
  }

  if (slides.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Diashow' }} />
        <ThemedText type="small">
          Keine abspielbaren Stopps — die Diashow braucht Stopps mit Koordinaten.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SlideshowPlayer slides={slides} onClose={() => router.back()} />
    </>
  );
}
