import { suggestRoute, type PhotoMeta } from '@/lib/photos/suggestion';

const A = { lat: 60.39299, lng: 5.32415 }; // Bergen
const B = { lat: 60.472, lng: 8.4689 }; // somewhere central
const C = { lat: 59.91387, lng: 10.75225 }; // Oslo

describe('suggestRoute', () => {
  it('assigns start / stop / end roles across clusters', () => {
    const photos: PhotoMeta[] = [
      { id: 'a', ...A, takenAt: '2026-07-01T09:00:00.000Z' },
      { id: 'b', ...B, takenAt: '2026-07-02T09:00:00.000Z' },
      { id: 'c', ...C, takenAt: '2026-07-03T09:00:00.000Z' },
    ];
    const { stops, unassigned } = { ...suggestRoute(photos), unassigned: suggestRoute(photos).unassignedPhotoIds };
    expect(stops.map((s) => s.role)).toEqual(['start', 'stop', 'end']);
    expect(stops.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(unassigned).toEqual([]);
  });

  it('a single cluster is start; with two clusters there is no middle stop', () => {
    const one = suggestRoute([{ id: 'a', ...A, takenAt: '2026-07-01T09:00:00.000Z' }]);
    expect(one.stops).toHaveLength(1);
    expect(one.stops[0].role).toBe('start');

    const two = suggestRoute([
      { id: 'a', ...A, takenAt: '2026-07-01T09:00:00.000Z' },
      { id: 'c', ...C, takenAt: '2026-07-02T09:00:00.000Z' },
    ]);
    expect(two.stops.map((s) => s.role)).toEqual(['start', 'end']);
  });

  it('does NOT drop photos without GPS — returns them as unassigned (README §4 fallback)', () => {
    const photos: PhotoMeta[] = [
      { id: 'a', ...A, takenAt: '2026-07-01T09:00:00.000Z' },
      { id: 'noGps', lat: null, lng: null, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'noTime', lat: 60.0, lng: 5.0, takenAt: null },
    ];
    const res = suggestRoute(photos);
    expect(res.unassignedPhotoIds.sort()).toEqual(['noGps', 'noTime']);
    expect(res.stops).toHaveLength(1);
    expect(res.stops[0].photoIds).toEqual(['a']);
  });

  it('returns an empty suggestion when no photo has usable geo data', () => {
    const res = suggestRoute([{ id: 'x', lat: null, lng: null, takenAt: null }]);
    expect(res.stops).toEqual([]);
    expect(res.unassignedPhotoIds).toEqual(['x']);
  });
});
