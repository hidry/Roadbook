/**
 * Slideshow sequence engine (README §8.1 Tier 2 "Reise-Diashow") — PURE, no
 * React Native imports, so the whole sequencing is Jest-testable (like
 * clustering/suggestion). The player UI + camera animation sit on top.
 *
 * Sequence: one intro slide (period, days, stops, km) followed by one slide per
 * LOCATED stop. Each stop slide carries the leg geometry from the previous stop:
 * sliced from the trip's TRACKS when available (the real driven path), straight
 * line as the fallback — exactly like the map (PROGRESS P16). The export
 * feature ("Reise-Story") will reuse this same sequence later.
 */
import type { Photo, Stop, Track } from '@/types/models';

export interface SlideshowStats {
  stopCount: number;
  photoCount: number;
  km: number; // rounded
  days: number | null; // null when no dates are known
  from: string | null; // YYYY-MM-DD
  to: string | null;
}

export interface IntroSlide {
  kind: 'intro';
  title: string;
  stats: SlideshowStats;
}

export interface StopSlide {
  kind: 'stop';
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  arrivalDate: string | null;
  /** Display URIs of this stop's photos (local first, R2 fallback). */
  photoUris: string[];
  /** [lng, lat] path from the previous stop to this one ([] for the first). */
  leg: [number, number][];
  durationMs: number;
}

export type Slide = IntroSlide | StopSlide;

const EARTH_RADIUS_KM = 6371;
const BASE_SLIDE_MS = 3000;
const PER_PHOTO_MS = 1800;
const MAX_PAID_PHOTOS = 5; // slide duration grows with photos, but bounded

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Total length of a [lng, lat] path in km. */
export function pathDistanceKm(path: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) {
    km += haversineKm(path[i - 1][1], path[i - 1][0], path[i][1], path[i][0]);
  }
  return km;
}

/** Index of the track point closest to (lat, lng), searching from `fromIndex`. */
export function nearestIndex(points: [number, number][], lat: number, lng: number, fromIndex = 0): number {
  let best = fromIndex;
  let bestDist = Infinity;
  for (let i = fromIndex; i < points.length; i++) {
    const d = haversineKm(lat, lng, points[i][1], points[i][0]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Splits a full track path into per-stop legs: legs[i] = path from stop i-1 to
 * stop i (legs[0] = []). Stop positions are snapped to their nearest track
 * point, with indices forced to be non-decreasing so legs never run backwards.
 * Returns straight lines when the track is missing/too short.
 */
export function legsForStops(stops: { lat: number; lng: number }[], trackPath: [number, number][]): [number, number][][] {
  const legs: [number, number][][] = stops.map(() => []);
  if (stops.length === 0) return legs;

  if (trackPath.length >= 2) {
    let prevIdx = nearestIndex(trackPath, stops[0].lat, stops[0].lng);
    for (let i = 1; i < stops.length; i++) {
      const idx = nearestIndex(trackPath, stops[i].lat, stops[i].lng, prevIdx);
      legs[i] = trackPath.slice(prevIdx, idx + 1);
      // A leg needs at least a line; degenerate slices fall back to straight.
      if (legs[i].length < 2) legs[i] = [[stops[i - 1].lng, stops[i - 1].lat], [stops[i].lng, stops[i].lat]];
      prevIdx = idx;
    }
    return legs;
  }

  for (let i = 1; i < stops.length; i++) {
    legs[i] = [
      [stops[i - 1].lng, stops[i - 1].lat],
      [stops[i].lng, stops[i].lat],
    ];
  }
  return legs;
}

/** Photo display URI: local file first, R2 URL as the cross-device fallback. */
const photoUri = (p: Photo): string | null => p.localUri ?? p.storageUrl;

export function slideDurationMs(photoCount: number): number {
  return BASE_SLIDE_MS + PER_PHOTO_MS * Math.min(photoCount, MAX_PAID_PHOTOS);
}

/**
 * Builds the full slide sequence for a trip. Only stops WITH coordinates take
 * part (0/0 = not located). Returns [] when nothing is playable.
 */
export function buildSlideshow(input: {
  tripName: string;
  stops: Stop[];
  tracks: Track[];
  photosByStop: Record<string, Photo[]>;
}): Slide[] {
  const located = [...input.stops]
    .filter((s) => s.lat !== 0 || s.lng !== 0)
    .sort((a, b) => a.position - b.position);
  if (located.length === 0) return [];

  // One continuous path from all tracks (import order = created order).
  const trackPath: [number, number][] = input.tracks.flatMap((t) =>
    t.points.map((p) => [p.lng, p.lat] as [number, number]),
  );
  const legs = legsForStops(located, trackPath);

  const dates = located
    .map((s) => s.arrivalDate)
    .filter((d): d is string => !!d)
    .sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const days =
    from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : null;

  const km =
    trackPath.length >= 2
      ? pathDistanceKm(trackPath)
      : pathDistanceKm(located.map((s) => [s.lng, s.lat] as [number, number]));

  const photoCount = located.reduce((n, s) => n + (input.photosByStop[s.id]?.length ?? 0), 0);

  const intro: IntroSlide = {
    kind: 'intro',
    title: input.tripName,
    stats: { stopCount: located.length, photoCount, km: Math.round(km), days, from, to },
  };

  const stopSlides: StopSlide[] = located.map((s, i) => {
    const uris = (input.photosByStop[s.id] ?? [])
      .map(photoUri)
      .filter((u): u is string => !!u);
    return {
      kind: 'stop',
      stopId: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      arrivalDate: s.arrivalDate,
      photoUris: uris,
      leg: legs[i],
      durationMs: slideDurationMs(uris.length),
    };
  });

  return [intro, ...stopSlides];
}
