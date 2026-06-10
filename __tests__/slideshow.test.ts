import {
  buildSlideshow,
  haversineKm,
  legsForStops,
  nearestIndex,
  pathDistanceKm,
  slideDurationMs,
  type StopSlide,
} from '@/lib/slideshow';
import type { Photo, Stop, Track } from '@/types/models';

const base = { createdAt: 'c', updatedAt: 'u', deletedAt: null };

function stop(id: string, position: number, lat: number, lng: number, arrivalDate: string | null = null): Stop {
  return { ...base, id, tripId: 't', position, role: 'stop', type: null, name: id, lat, lng, arrivalDate, notes: null };
}

function photo(id: string, stopId: string, localUri: string | null, storageUrl: string | null = null): Photo {
  return { ...base, id, stopId, localUri, storageUrl, uploadStatus: 'pending', takenAt: null, lat: null, lng: null };
}

describe('haversineKm / pathDistanceKm', () => {
  it('computes plausible distances (Bergen -> Oslo ~ 305 km)', () => {
    const km = haversineKm(60.39, 5.32, 59.91, 10.75);
    expect(km).toBeGreaterThan(290);
    expect(km).toBeLessThan(320);
  });

  it('sums a path', () => {
    expect(pathDistanceKm([[5, 60], [5, 61], [5, 62]])).toBeCloseTo(2 * haversineKm(60, 5, 61, 5), 5);
    expect(pathDistanceKm([])).toBe(0);
  });
});

describe('nearestIndex / legsForStops', () => {
  const track: [number, number][] = [
    [5.0, 60.0],
    [5.5, 60.2],
    [6.0, 60.5],
    [6.5, 60.8],
    [7.0, 61.0],
  ];

  it('finds the nearest track point at/after fromIndex', () => {
    expect(nearestIndex(track, 60.5, 6.0)).toBe(2);
    expect(nearestIndex(track, 60.0, 5.0, 1)).toBe(1); // search starts later
  });

  it('slices track legs between stops (non-decreasing)', () => {
    const stops = [
      { lat: 60.0, lng: 5.0 },
      { lat: 60.5, lng: 6.0 },
      { lat: 61.0, lng: 7.0 },
    ];
    const legs = legsForStops(stops, track);
    expect(legs[0]).toEqual([]);
    expect(legs[1]).toEqual(track.slice(0, 3));
    expect(legs[2]).toEqual(track.slice(2, 5));
  });

  it('falls back to straight lines without a track', () => {
    const stops = [
      { lat: 60, lng: 5 },
      { lat: 61, lng: 6 },
    ];
    expect(legsForStops(stops, [])[1]).toEqual([
      [5, 60],
      [6, 61],
    ]);
  });
});

describe('slideDurationMs', () => {
  it('grows with photos but is bounded', () => {
    expect(slideDurationMs(0)).toBe(3000);
    expect(slideDurationMs(2)).toBe(3000 + 2 * 1800);
    expect(slideDurationMs(50)).toBe(3000 + 5 * 1800);
  });
});

describe('buildSlideshow', () => {
  const stops = [stop('a', 0, 60.0, 5.0, '2025-08-01'), stop('b', 1, 60.5, 6.0, '2025-08-03'), stop('unlocated', 2, 0, 0)];
  const photosByStop = {
    a: [photo('p1', 'a', 'file://1.jpg'), photo('p2', 'a', null, 'https://r2/2.jpg'), photo('p3', 'a', null, null)],
  };

  it('builds intro + one slide per located stop', () => {
    const slides = buildSlideshow({ tripName: 'Norwegen', stops, tracks: [], photosByStop });
    expect(slides).toHaveLength(3); // intro + 2 located stops
    expect(slides[0]).toMatchObject({
      kind: 'intro',
      title: 'Norwegen',
      stats: { stopCount: 2, photoCount: 3, days: 3, from: '2025-08-01', to: '2025-08-03' },
    });
    const second = slides[2] as StopSlide;
    expect(second.leg.length).toBeGreaterThanOrEqual(2);
  });

  it('uses localUri first and storageUrl as fallback, skips uri-less photos', () => {
    const slides = buildSlideshow({ tripName: 'N', stops, tracks: [], photosByStop });
    const first = slides[1] as StopSlide;
    expect(first.photoUris).toEqual(['file://1.jpg', 'https://r2/2.jpg']);
  });

  it('measures km along the track when one exists', () => {
    const track: Track = {
      ...base,
      id: 'tr',
      tripId: 't',
      name: null,
      points: [
        { lat: 60.0, lng: 5.0, time: null, ele: null },
        { lat: 60.25, lng: 5.5, time: null, ele: null },
        { lat: 60.5, lng: 6.0, time: null, ele: null },
      ],
    };
    const withTrack = buildSlideshow({ tripName: 'N', stops, tracks: [track], photosByStop: {} });
    const without = buildSlideshow({ tripName: 'N', stops, tracks: [], photosByStop: {} });
    const kmWith = (withTrack[0] as { stats: { km: number } }).stats.km;
    const kmWithout = (without[0] as { stats: { km: number } }).stats.km;
    expect(kmWith).toBeGreaterThanOrEqual(kmWithout); // road is never shorter than air line
  });

  it('returns [] when no stop is located', () => {
    expect(buildSlideshow({ tripName: 'N', stops: [stop('x', 0, 0, 0)], tracks: [], photosByStop: {} })).toEqual([]);
  });
});
