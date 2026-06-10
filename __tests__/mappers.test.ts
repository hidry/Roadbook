import { photoToRow, rowToPhoto, rowToStop, rowToTrip, stopToRow, tripToRow } from '@/lib/db/mappers';
import type { Photo, Stop, Trip } from '@/types/models';

const base = { id: 'id-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null };

describe('trip mapping', () => {
  it('round-trips and serialises sharedWith as JSON text', () => {
    const t: Trip = {
      ...base,
      ownerId: 'user-1',
      sharedWith: ['user-2'],
      name: 'Norwegen',
      startDate: '2026-07-01',
      stravaUrl: 'https://www.strava.com/activities/123',
    };
    const row = tripToRow(t);
    expect(row.shared_with).toBe('["user-2"]');
    expect(row.owner_id).toBe('user-1');
    expect(row.start_date).toBe('2026-07-01');
    expect(row.strava_url).toBe('https://www.strava.com/activities/123');
    expect(rowToTrip(row)).toEqual(t);
  });

  it('maps a missing strava_url to null (pre-0009 rows)', () => {
    expect(rowToTrip({ ...rowBase(), owner_id: 'u', name: 'n', shared_with: '[]' }).stravaUrl).toBeNull();
  });

  it('tolerates missing/invalid shared_with on read', () => {
    expect(rowToTrip({ ...rowBase(), owner_id: 'u', name: 'n', shared_with: null }).sharedWith).toEqual([]);
    expect(rowToTrip({ ...rowBase(), owner_id: 'u', name: 'n', shared_with: 'not-json' }).sharedWith).toEqual([]);
  });
});

describe('stop mapping', () => {
  it('round-trips including numeric coordinates and nullable type', () => {
    const s: Stop = {
      ...base,
      tripId: 't-1',
      position: 2,
      role: 'stop',
      type: 'campingplatz',
      name: 'Bergen',
      lat: 60.39,
      lng: 5.32,
      arrivalDate: '2026-07-02',
      notes: null,
    };
    const back = rowToStop(stopToRow(s));
    expect(back).toEqual(s);
    expect(typeof back.lat).toBe('number');
  });

  it('round-trips the verentsorgung stop type (migration 0008)', () => {
    const s: Stop = {
      ...base,
      tripId: 't-1',
      position: 3,
      role: 'stop',
      type: 'verentsorgung',
      name: 'V+E Station',
      lat: 60.1,
      lng: 5.1,
      arrivalDate: null,
      notes: null,
    };
    expect(rowToStop(stopToRow(s)).type).toBe('verentsorgung');
  });
});

describe('photo mapping', () => {
  it('round-trips upload status and nullable coordinates', () => {
    const p: Photo = {
      ...base,
      stopId: 's-1',
      localUri: 'file://x.jpg',
      storageUrl: null,
      uploadStatus: 'pending',
      takenAt: '2026-07-02T10:00:00.000Z',
      lat: null,
      lng: null,
    };
    expect(rowToPhoto(photoToRow(p))).toEqual(p);
  });
});

function rowBase() {
  return { id: 'id-1', created_at: base.createdAt, updated_at: base.updatedAt, deleted_at: null };
}
