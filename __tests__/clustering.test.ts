import { clusterPhotos, haversineMeters, DISTANCE_THRESHOLD_M, type GeoPoint } from '@/lib/photos/clustering';

const BERGEN = { lat: 60.39299, lng: 5.32415 };
const OSLO = { lat: 59.91387, lng: 10.75225 };

describe('haversineMeters', () => {
  it('is ~0 for identical points', () => {
    expect(haversineMeters(BERGEN.lat, BERGEN.lng, BERGEN.lat, BERGEN.lng)).toBeCloseTo(0, 5);
  });

  it('matches the known Bergen–Oslo great-circle distance (~306 km)', () => {
    const d = haversineMeters(BERGEN.lat, BERGEN.lng, OSLO.lat, OSLO.lng);
    expect(d).toBeGreaterThan(300_000);
    expect(d).toBeLessThan(312_000);
  });
});

describe('clusterPhotos', () => {
  it('returns no clusters for empty input', () => {
    expect(clusterPhotos([])).toEqual([]);
  });

  it('groups photos that are close in space AND time into one stop', () => {
    const points: GeoPoint[] = [
      { id: 'a', ...BERGEN, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'b', lat: BERGEN.lat + 0.001, lng: BERGEN.lng, takenAt: '2026-07-01T10:30:00.000Z' }, // ~111 m, 30 min
    ];
    const clusters = clusterPhotos(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoIds).toEqual(['a', 'b']);
  });

  it('splits when the distance threshold is exceeded (even if time is close)', () => {
    const points: GeoPoint[] = [
      { id: 'a', ...BERGEN, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'b', ...OSLO, takenAt: '2026-07-01T10:30:00.000Z' }, // far apart, < 2h
    ];
    expect(clusterPhotos(points)).toHaveLength(2);
  });

  it('keeps the same place in ONE stop across a long time gap (overnight stay)', () => {
    const points: GeoPoint[] = [
      { id: 'evening', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'morning', ...BERGEN, takenAt: '2026-07-02T08:00:00.000Z' }, // same site, 13h later
    ];
    const clusters = clusterPhotos(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].photoIds).toEqual(['evening', 'morning']);
  });

  it('separates a there-and-back trip by movement, not time', () => {
    const points: GeoPoint[] = [
      { id: 'camp1', ...BERGEN, takenAt: '2026-07-01T18:00:00.000Z' },
      { id: 'trip', ...OSLO, takenAt: '2026-07-02T12:00:00.000Z' }, // drove away
      { id: 'camp2', ...BERGEN, takenAt: '2026-07-02T20:00:00.000Z' }, // back at the site
    ];
    // Moving away and back = three distinct stops in sequence.
    expect(clusterPhotos(points)).toHaveLength(3);
  });

  it('sorts chronologically regardless of input order and sets arrival to earliest', () => {
    const points: GeoPoint[] = [
      { id: 'late', ...BERGEN, takenAt: '2026-07-01T10:30:00.000Z' },
      { id: 'early', lat: BERGEN.lat, lng: BERGEN.lng, takenAt: '2026-07-01T10:00:00.000Z' },
    ];
    const [cluster] = clusterPhotos(points);
    expect(cluster.photoIds).toEqual(['early', 'late']);
    expect(cluster.arrivalDate).toBe('2026-07-01T10:00:00.000Z');
  });

  it('honours the documented distance threshold (sanity check on constant)', () => {
    expect(DISTANCE_THRESHOLD_M).toBe(500);
  });
});
