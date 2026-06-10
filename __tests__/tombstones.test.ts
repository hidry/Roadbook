import { groupTombstones, nextTombstoneWatermark, type TombstoneRow } from '@/lib/sync/tombstones';

const row = (tbl: string, id: string, ts: string): TombstoneRow => ({
  tbl,
  id,
  deleted_at: ts,
  updated_at: ts,
});

describe('groupTombstones', () => {
  it('groups rows by table', () => {
    const groups = groupTombstones([
      row('trips', 't1', '2026-06-01T10:00:00.000Z'),
      row('stops', 's1', '2026-06-01T10:01:00.000Z'),
      row('stops', 's2', '2026-06-01T10:02:00.000Z'),
      row('photos', 'p1', '2026-06-01T10:03:00.000Z'),
    ]);
    expect(groups.get('trips')).toHaveLength(1);
    expect(groups.get('stops')?.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(groups.get('photos')).toHaveLength(1);
  });

  it('drops unknown table names (tbl is interpolated into SQL)', () => {
    const groups = groupTombstones([
      row('trips; DROP TABLE trips;--', 'x', '2026-06-01T10:00:00.000Z'),
      row('routes', 'legacy', '2026-06-01T10:00:00.000Z'),
      row('trips', 't1', '2026-06-01T10:00:00.000Z'),
    ]);
    expect([...groups.keys()]).toEqual(['trips']);
    expect(groups.get('trips')).toHaveLength(1);
  });

  it('drops malformed rows (missing id or timestamps)', () => {
    const groups = groupTombstones([
      { tbl: 'trips', id: '', deleted_at: 'x', updated_at: 'x' },
      { tbl: 'stops', id: 's1', deleted_at: '', updated_at: 'x' },
      { tbl: 'photos', id: 'p1', deleted_at: 'x', updated_at: '' },
    ]);
    expect(groups.size).toBe(0);
  });

  it('returns an empty map for no rows', () => {
    expect(groupTombstones([]).size).toBe(0);
  });
});

describe('nextTombstoneWatermark', () => {
  it('returns the max updated_at across rows', () => {
    const rows = [
      row('trips', 't1', '2026-06-01T10:00:00.000Z'),
      row('stops', 's1', '2026-06-03T08:00:00.000Z'),
      row('photos', 'p1', '2026-06-02T12:00:00.000Z'),
    ];
    expect(nextTombstoneWatermark(rows, '1970-01-01T00:00:00.000Z')).toBe('2026-06-03T08:00:00.000Z');
  });

  it('never moves backwards past since', () => {
    const rows = [row('trips', 't1', '2026-06-01T10:00:00.000Z')];
    expect(nextTombstoneWatermark(rows, '2026-06-05T00:00:00.000Z')).toBe('2026-06-05T00:00:00.000Z');
  });

  it('returns since for an empty result', () => {
    expect(nextTombstoneWatermark([], '2026-06-05T00:00:00.000Z')).toBe('2026-06-05T00:00:00.000Z');
  });
});
