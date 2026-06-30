import {
  detectRouteFormat,
  isTimelineJson,
  parseLatLng,
  parseRouteFile,
  timelineSpan,
  timelineToRouteModel,
  tripDateWindow,
} from '@/lib/route-model';

// Mirrors the real on-device Timeline.json schema (semanticSegments with
// timelinePath / visit / activity; "<lat>°, <lng>°" strings).
const TIMELINE = JSON.stringify({
  semanticSegments: [
    // Out of window (before) — must be ignored.
    {
      startTime: '2025-11-08T10:00:00.000+01:00',
      endTime: '2025-11-08T12:00:00.000+01:00',
      timelinePath: [{ point: '40.0°, 9.0°', time: '2025-11-08T10:57:00.000+01:00' }],
    },
    // In window: a visit (stop) ...
    {
      startTime: '2026-05-14T18:00:00.000+02:00',
      endTime: '2026-05-15T08:00:00.000+02:00',
      visit: {
        topCandidate: { placeId: 'abc', semanticType: 'UNKNOWN', placeLocation: { latLng: '47.5°, 13.6°' } },
      },
    },
    // ... a movement path ...
    {
      startTime: '2026-05-15T09:00:00.000+02:00',
      endTime: '2026-05-15T10:00:00.000+02:00',
      timelinePath: [
        { point: '47.50°, 13.60°', time: '2026-05-15T09:10:00.000+02:00' },
        { point: '47.60°, 13.70°', time: '2026-05-15T09:40:00.000+02:00' },
        { point: '47.60°, 13.70°', time: '2026-05-15T09:41:00.000+02:00' }, // dup → dropped
      ],
    },
    // ... and an activity (move with start/end).
    {
      startTime: '2026-05-15T10:00:00.000+02:00',
      endTime: '2026-05-15T11:00:00.000+02:00',
      activity: { start: { latLng: '47.60°, 13.70°' }, end: { latLng: '47.80°, 13.90°' }, topCandidate: { type: 'DRIVING' } },
    },
    // Out of window (after) — ignored.
    {
      startTime: '2026-06-19T10:00:00.000+02:00',
      endTime: '2026-06-19T12:00:00.000+02:00',
      timelinePath: [{ point: '49.0°, 11.0°', time: '2026-06-19T10:30:00.000+02:00' }],
    },
  ],
  rawSignals: [
    // In-window accurate GPS fix → merged into the track (between 09:10 and 09:40).
    { position: { LatLng: '47.55°, 13.65°', accuracyMeters: 20, source: 'GPS', timestamp: '2026-05-15T09:20:00.000+02:00' } },
    // In-window but too inaccurate → dropped.
    { position: { LatLng: '47.70°, 13.80°', accuracyMeters: 5000, source: 'CELL', timestamp: '2026-05-15T09:30:00.000+02:00' } },
    // Out of window → dropped.
    { position: { LatLng: '10.0°, 10.0°', accuracyMeters: 10, source: 'GPS', timestamp: '2025-11-08T11:00:00.000+01:00' } },
    // No position (wifiScan) → ignored.
    { wifiScan: { foo: 1 } },
  ],
  userLocationProfile: { home: 'never touched' },
});

const RANGE = { from: '2026-05-14', to: '2026-05-24' };

describe('parseLatLng', () => {
  it('parses "<lat>°, <lng>°" (lat first, degree sign)', () => {
    expect(parseLatLng('48.8908274°, 10.9239374°')).toEqual({ lat: 48.8908274, lng: 10.9239374 });
    expect(parseLatLng('47.5°, 13.6°')).toEqual({ lat: 47.5, lng: 13.6 });
  });
  it('rejects junk', () => {
    expect(parseLatLng('')).toBeNull();
    expect(parseLatLng('48.0°')).toBeNull();
    expect(parseLatLng(42 as unknown)).toBeNull();
  });
});

describe('timelineSpan / isTimelineJson / detect', () => {
  it('reports the full date span and segment count', () => {
    expect(timelineSpan(TIMELINE)).toEqual({ from: '2025-11-08', to: '2026-06-19', segments: 5 });
  });
  it('detects Timeline content (any filename)', () => {
    expect(isTimelineJson(TIMELINE)).toBe(true);
    expect(detectRouteFormat('Zeitachse.json', TIMELINE)).toBe('timeline');
  });
  it('parseRouteFile points Timeline at its dedicated flow', () => {
    expect(() => parseRouteFile('Zeitachse.json', TIMELINE)).toThrow('Google Timeline importieren');
  });
});

describe('tripDateWindow', () => {
  it('handles FULL ISO arrivalDates (photo import) — regression: no crash, date-only ±1d', () => {
    // clustering.ts stores arrivalDate as new Date(...).toISOString().
    const dates = ['2026-06-19T08:30:00.000Z', '2026-06-21T17:00:00.000Z'];
    expect(tripDateWindow(dates)).toEqual({ from: '2026-06-18', to: '2026-06-22' });
  });

  it('handles plain YYYY-MM-DD and ignores nulls', () => {
    expect(tripDateWindow([null, '2026-05-14', null, '2026-05-24'])).toEqual({ from: '2026-05-13', to: '2026-05-25' });
  });

  it('falls back to the trip start date when no stop is dated', () => {
    expect(tripDateWindow([null, null], '2026-04-30')).toEqual({ from: '2026-04-29', to: '2026-05-01' });
  });

  it('returns null when nothing is a valid date', () => {
    expect(tripDateWindow([null, 'kaputt', ''], null)).toBeNull();
    expect(tripDateWindow([])).toBeNull();
  });

  it('respects a custom pad', () => {
    expect(tripDateWindow(['2026-06-19'], null, 0)).toEqual({ from: '2026-06-19', to: '2026-06-19' });
  });
});

describe('timelineToRouteModel', () => {
  it('merges semantic path + activity + accurate rawSignals, sorted/deduped; drops noise', () => {
    const m = timelineToRouteModel(TIMELINE, RANGE);
    expect(m.stops).toHaveLength(0); // visits off by default
    expect(m.tracks).toHaveLength(1);
    const pts = m.tracks[0].points;
    // By time: 09:10 path → 09:20 rawSignal(GPS,20m) → 09:40 path (09:41 dup
    // dropped) → 10:00 activity start (dup) → 11:00 activity end.
    expect(pts.map((p) => [p.lat, p.lng])).toEqual([
      [47.5, 13.6],
      [47.55, 13.65], // denser GPS fix pulled in
      [47.6, 13.7],
      [47.8, 13.9],
    ]);
    // Out-of-window (40/9, 49/11, 10/10) and the inaccurate CELL fix (47.70/13.80,
    // 5000 m) are NOT present; rawSignals wifiScan/userLocationProfile untouched.
    expect(pts.some((p) => [40, 49, 10].includes(p.lat) || p.lng === 13.8)).toBe(false);
  });

  it('emits visits as stops when requested', () => {
    const m = timelineToRouteModel(TIMELINE, { ...RANGE, includeVisitsAsStops: true });
    expect(m.stops).toEqual([{ name: null, lat: 47.5, lng: 13.6, time: '2026-05-14T18:00:00.000+02:00', notes: null }]);
  });

  it('returns no track when the window has fewer than 2 points', () => {
    expect(timelineToRouteModel(TIMELINE, { from: '2026-06-19', to: '2026-06-19' }).tracks).toHaveLength(0);
  });

  it('throws on non-Timeline / invalid JSON', () => {
    expect(() => timelineToRouteModel('{}', RANGE)).toThrow('semanticSegments');
    expect(() => timelineToRouteModel('not json', RANGE)).toThrow('JSON');
  });
});
