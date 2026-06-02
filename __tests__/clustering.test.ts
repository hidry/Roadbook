import { clusterPhotos, haversineMeters, PLACE_RADIUS_M, type GeoPoint } from '@/lib/photos/clustering';

const BERGEN = { lat: 60.39299, lng: 5.32415 };
const OSLO = { lat: 59.91387, lng: 10.75225 };
const VOSS = { lat: 60.6296, lng: 6.4253 };
const FLAM = { lat: 60.8633, lng: 7.1133 };

const stops = (pts: GeoPoint[]) => clusterPhotos(pts).filter((v) => v.isStop);

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

describe('clusterPhotos — places, visits, stops', () => {
  it('returns no visits for empty input', () => {
    expect(clusterPhotos([])).toEqual([]);
  });

  it('groups photos at the same place into one visit', () => {
    const points: GeoPoint[] = [
      { id: 'a', ...BERGEN, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'b', lat: BERGEN.lat + 0.001, lng: BERGEN.lng, takenAt: '2026-07-01T10:30:00.000Z' }, // ~111 m
    ];
    const visits = clusterPhotos(points);
    expect(visits).toHaveLength(1);
    expect(visits[0].photoIds).toEqual(['a', 'b']);
  });

  it('keeps the same place in ONE visit across an overnight gap', () => {
    const points: GeoPoint[] = [
      { id: 'evening', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'morning', ...BERGEN, takenAt: '2026-07-02T08:00:00.000Z' }, // same site, 13h later
    ];
    const visits = clusterPhotos(points);
    expect(visits).toHaveLength(1);
    expect(visits[0].isStop).toBe(true); // overnight ⇒ stop
    expect(visits[0].photoIds).toEqual(['evening', 'morning']);
  });

  it('does NOT create a stop for a day excursion — it stays a non-stop visit', () => {
    // Camp (evening + next evening) with a far hike summit in between midday.
    const points: GeoPoint[] = [
      { id: 'camp1', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'summit', ...OSLO, takenAt: '2026-07-02T12:00:00.000Z' }, // 300 km away, transient
      { id: 'camp2', ...BERGEN, takenAt: '2026-07-02T20:00:00.000Z' }, // back at camp
    ];
    const visits = clusterPhotos(points);
    const camp = visits.find((v) => v.photoIds.includes('camp1'))!;
    const summit = visits.find((v) => v.photoIds.includes('summit'))!;
    expect(camp.photoIds).toEqual(['camp1', 'camp2']); // hike did not split the camp
    expect(camp.isStop).toBe(true);
    expect(summit.isStop).toBe(false); // excursion ⇒ no stop
    expect(stops(points)).toHaveLength(1);
  });

  it('the excursion radius is irrelevant (40 km bike tour ⇒ still one stop)', () => {
    const points: GeoPoint[] = [
      { id: 'camp1', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'bike', ...VOSS, takenAt: '2026-07-02T13:00:00.000Z' }, // far daytime point, brief
      { id: 'camp2', ...BERGEN, takenAt: '2026-07-02T19:30:00.000Z' },
    ];
    expect(stops(points)).toHaveLength(1);
  });

  it('a relocation A→B→C with overnight stays is three stops', () => {
    const points: GeoPoint[] = [
      { id: 'a1', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'a2', ...BERGEN, takenAt: '2026-07-02T08:00:00.000Z' },
      { id: 'b1', ...VOSS, takenAt: '2026-07-02T19:00:00.000Z' },
      { id: 'b2', ...VOSS, takenAt: '2026-07-03T08:00:00.000Z' },
      { id: 'c1', ...FLAM, takenAt: '2026-07-03T19:00:00.000Z' },
      { id: 'c2', ...FLAM, takenAt: '2026-07-04T08:00:00.000Z' },
    ];
    expect(stops(points)).toHaveLength(3);
  });

  it('a round trip revisiting the same place yields two visits of that place', () => {
    const overnight = (id: string, place: typeof BERGEN, day: number): GeoPoint[] => [
      { id: `${id}-eve`, ...place, takenAt: `2026-07-0${day}T19:00:00.000Z` },
      { id: `${id}-morn`, ...place, takenAt: `2026-07-0${day + 1}T08:00:00.000Z` },
    ];
    const points: GeoPoint[] = [
      ...overnight('x1', BERGEN, 1), // X night 1
      ...overnight('a', VOSS, 2),
      ...overnight('b', FLAM, 3),
      ...overnight('x2', BERGEN, 4), // back at X
    ];
    const st = stops(points);
    expect(st).toHaveLength(4);
    const xVisits = st.filter((v) => v.placeId === st[0].placeId);
    expect(xVisits).toHaveLength(2);
    expect(xVisits.map((v) => v.visitIndex)).toEqual([0, 1]);
  });

  it('a long daytime visit (>=3h) without an overnight is still a stop', () => {
    const points: GeoPoint[] = [
      { id: 'city-in', ...OSLO, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'city-out', ...OSLO, takenAt: '2026-07-01T14:00:00.000Z' }, // 4h in town
      { id: 'camp1', ...VOSS, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'camp2', ...VOSS, takenAt: '2026-07-02T08:00:00.000Z' }, // overnight 30km away
    ];
    const st = stops(points);
    expect(st).toHaveLength(2);
    expect(st[0].photoIds).toEqual(['city-in', 'city-out']);
  });

  it('a short halt (<3h) between two camps is not its own stop', () => {
    const points: GeoPoint[] = [
      { id: 'c1-eve', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'c1-morn', ...BERGEN, takenAt: '2026-07-02T08:00:00.000Z' },
      { id: 'lunch', ...VOSS, takenAt: '2026-07-02T12:00:00.000Z' }, // brief halt
      { id: 'c2-eve', ...FLAM, takenAt: '2026-07-02T19:00:00.000Z' },
      { id: 'c2-morn', ...FLAM, takenAt: '2026-07-03T08:00:00.000Z' },
    ];
    expect(stops(points)).toHaveLength(2);
    const lunch = clusterPhotos(points).find((v) => v.photoIds.includes('lunch'))!;
    expect(lunch.isStop).toBe(false);
  });

  it('detects overnight camps from the night GAP even when shot only once', () => {
    // Real-world "mixed" pattern: only ONE camp is shot evening + next morning;
    // the others get a single evening photo. Plus a midday hike on day 3.
    // Regression: the dwell-only model collapsed this to a single stop because
    // only the evening+morning camp cleared the bar — the rest were absorbed.
    const TRAIL = { lat: 61.5, lng: 9.0 }; // far from every camp
    const points: GeoPoint[] = [
      { id: 'a', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' }, // camp A, evening only
      { id: 'b-eve', ...VOSS, takenAt: '2026-07-02T19:00:00.000Z' }, // camp B, evening +
      { id: 'b-morn', ...VOSS, takenAt: '2026-07-03T08:00:00.000Z' }, //         morning
      { id: 'hike', ...TRAIL, takenAt: '2026-07-03T13:00:00.000Z' }, // day-3 excursion
      { id: 'c', ...FLAM, takenAt: '2026-07-03T19:00:00.000Z' }, // camp C, evening only
      { id: 'd', ...OSLO, takenAt: '2026-07-04T19:00:00.000Z' }, // camp D, evening only
    ];
    expect(stops(points)).toHaveLength(4); // A, B, C, D — not 1
    const hike = clusterPhotos(points).find((v) => v.photoIds.includes('hike'))!;
    expect(hike.isStop).toBe(false); // the hike stays an excursion
  });

  it('promotes every visit to a stop when nothing is significant (short day trip)', () => {
    const points: GeoPoint[] = [
      { id: 'a', ...BERGEN, takenAt: '2026-07-01T10:00:00.000Z' },
      { id: 'b', ...OSLO, takenAt: '2026-07-01T10:30:00.000Z' },
    ];
    expect(stops(points)).toHaveLength(2); // fallback so the route is not empty
  });

  it('sorts chronologically and sets arrival to earliest / departure to latest', () => {
    const points: GeoPoint[] = [
      { id: 'late', ...BERGEN, takenAt: '2026-07-01T19:00:00.000Z' },
      { id: 'early', ...BERGEN, takenAt: '2026-07-01T10:00:00.000Z' },
    ];
    const [v] = clusterPhotos(points);
    expect(v.photoIds).toEqual(['early', 'late']);
    expect(v.arrivalDate).toBe('2026-07-01T10:00:00.000Z');
    expect(v.departureDate).toBe('2026-07-01T19:00:00.000Z');
  });

  it('honours the documented place radius (sanity check on constant)', () => {
    expect(PLACE_RADIUS_M).toBe(500);
  });
});
