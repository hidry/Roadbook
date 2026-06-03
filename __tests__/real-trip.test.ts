/**
 * Regression test for the May 2026 camper trip (20 photos, 14.–24. Mai).
 * Timestamps come from the user's real photo EXIF; GPS coordinates are
 * synthetic (each day at a different place ~50–150 km apart, simulating a
 * multi-day camper trip through the Alps).
 *
 * These tests document the expected behaviour and guard against regressions
 * in the clustering algorithm. Two scenarios are covered:
 *
 *  A. Photos from a moving trip (different GPS each day) → should yield
 *     multiple stops matching the distinct overnight locations.
 *  B. All photos at the same GPS location (fixed base camp, or GPS didn't
 *     move / wasn't tagged) → collapses to 1 stop; this documents the
 *     known limitation and is the likely cause of the "only 1 stop" bug
 *     seen in production when GPS coordinates are the same or too close.
 */
import { clusterPhotos, type GeoPoint } from '@/lib/photos/clustering';
import { suggestRoute, type PhotoMeta } from '@/lib/photos/suggestion';

// ── Real EXIF timestamps (local times treated as UTC, per exif-date.ts) ──────

/** The 20 photos from the May 2026 trip, sorted chronologically. */
const REAL_TIMESTAMPS: { id: string; takenAt: string }[] = [
  { id: 'p01', takenAt: '2026-05-14T15:20:44.000Z' }, // cddf098a
  { id: 'p02', takenAt: '2026-05-14T16:30:13.000Z' }, // 324d42aa
  { id: 'p03', takenAt: '2026-05-14T16:30:18.000Z' }, // 6bd31a41
  { id: 'p04', takenAt: '2026-05-14T16:30:34.000Z' }, // 5798365c
  { id: 'p05', takenAt: '2026-05-14T16:33:53.000Z' }, // 11bbeb48
  { id: 'p06', takenAt: '2026-05-15T15:57:46.000Z' }, // 6c01faf0
  { id: 'p07', takenAt: '2026-05-15T15:58:13.000Z' }, // 958d6f20
  { id: 'p08', takenAt: '2026-05-16T10:21:30.000Z' }, // dd4b09fc
  { id: 'p09', takenAt: '2026-05-17T15:11:06.000Z' }, // 1ef8e8a9
  { id: 'p10', takenAt: '2026-05-19T15:28:50.000Z' }, // 6e7e31f7
  { id: 'p11', takenAt: '2026-05-19T15:38:59.000Z' }, // 0730c529
  { id: 'p12', takenAt: '2026-05-20T14:59:28.000Z' }, // dcbd631e
  { id: 'p13', takenAt: '2026-05-20T20:40:16.000Z' }, // 727c18e0
  { id: 'p14', takenAt: '2026-05-21T10:38:31.000Z' }, // 75ea9650
  { id: 'p15', takenAt: '2026-05-22T16:12:10.000Z' }, // e5075348
  { id: 'p16', takenAt: '2026-05-23T14:26:49.000Z' }, // 62c0e6c4
  { id: 'p17', takenAt: '2026-05-23T14:51:25.000Z' }, // d8227342
  { id: 'p18', takenAt: '2026-05-23T14:53:05.000Z' }, // 375dc44d
  { id: 'p19', takenAt: '2026-05-23T20:43:12.000Z' }, // 7cdd9616
  { id: 'p20', takenAt: '2026-05-24T08:16:05.000Z' }, // 0155f3c5
];

// ── GPS coordinates ────────────────────────────────────────────────────────────
// PLACE_H (May 22) is confirmed from the device EXIF: Via alla Foce 14, 6933
// Muzzano, Schweiz (near Lugano/Ticino). The others are synthetic (~100 km
// apart) pending a full EXIF export from the device.

const PLACE_A = { lat: 47.0, lng:  9.8 }; // May 14 campsite (synthetic)
const PLACE_B = { lat: 47.5, lng: 10.9 }; // May 15 campsite (synthetic, ~100 km)
const PLACE_C = { lat: 46.8, lng: 11.9 }; // May 16 campsite (synthetic)
const PLACE_D = { lat: 46.2, lng: 12.8 }; // May 17 campsite (synthetic)
const PLACE_E = { lat: 45.7, lng: 12.2 }; // May 19 campsite (synthetic)
const PLACE_F = { lat: 45.9, lng: 11.1 }; // May 20 campsite (synthetic)
const PLACE_G = { lat: 46.4, lng: 10.3 }; // May 21 campsite (synthetic)
const PLACE_H = { lat: 45.969, lng: 8.918 }; // May 22 – confirmed: Muzzano (Lugano)
const PLACE_I = { lat: 46.2, lng:  9.0 }; // May 23–24 campsite (synthetic)

/** Assign each photo to a place based on its date. */
function placeFor(id: string, takenAt: string): { lat: number; lng: number } {
  const day = takenAt.slice(5, 10); // "MM-DD"
  if (day === '05-14') return PLACE_A;
  if (day === '05-15') return PLACE_B;
  if (day === '05-16') return PLACE_C;
  if (day === '05-17') return PLACE_D;
  if (day === '05-19') return PLACE_E;
  if (day === '05-20') return PLACE_F;
  if (day === '05-21') return PLACE_G;
  if (day === '05-22') return PLACE_H;
  return PLACE_I; // May 23–24
}

function movingTripPoints(): GeoPoint[] {
  return REAL_TIMESTAMPS.map(({ id, takenAt }) => ({ id, takenAt, ...placeFor(id, takenAt) }));
}

function fixedCampPoints(): GeoPoint[] {
  return REAL_TIMESTAMPS.map(({ id, takenAt }) => ({ id, takenAt, ...PLACE_A }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('real May-2026 trip — moving (different GPS each day)', () => {
  const points = movingTripPoints();
  const visits = clusterPhotos(points);
  const stops = visits.filter((v) => v.isStop);

  it('finds 9 distinct places (one per overnight location)', () => {
    const places = new Set(visits.map((v) => v.placeId));
    expect(places.size).toBe(9);
  });

  it('detects at least 8 stops (one per overnight stay)', () => {
    // May 14–24 = 10 nights, minus May 18 (no photos) = 9 overnights.
    // The May 20 afternoon shot might be an excursion if at a different
    // location than the evening shot — so accept 8 or 9.
    expect(stops.length).toBeGreaterThanOrEqual(8);
  });

  it('first stop is May 14 (arrival day)', () => {
    expect(stops[0].arrivalDate.startsWith('2026-05-14')).toBe(true);
  });

  it('last stop is May 23–24 (last campsite)', () => {
    const last = stops[stops.length - 1];
    expect(last.arrivalDate.startsWith('2026-05-23')).toBe(true);
  });

  it('suggestRoute clusterDiagnostics matches visits/stops', () => {
    const photos: PhotoMeta[] = REAL_TIMESTAMPS.map(({ id, takenAt }) => ({
      id,
      takenAt,
      ...placeFor(id, takenAt),
    }));
    const { clusterDiagnostics } = suggestRoute(photos);
    expect(clusterDiagnostics.photosWithGeo).toBe(20);
    expect(clusterDiagnostics.placesFound).toBe(9);
    expect(clusterDiagnostics.stopsFound).toBeGreaterThanOrEqual(8);
  });
});

describe('real May-2026 trip — fixed GPS (all photos at same place)', () => {
  it('produces exactly 1 stop when all photos are within 500 m', () => {
    // This is the "GPS stripped / base camp" scenario. The algorithm correctly
    // collapses a 10-day span at one GPS coordinate to a single stop because
    // there is no spatial signal to distinguish days. The diagnostic line in
    // the import UI will show "1 Ort → 1 Stop" so the user knows why.
    const stops = clusterPhotos(fixedCampPoints()).filter((v) => v.isStop);
    expect(stops).toHaveLength(1);
  });
});
