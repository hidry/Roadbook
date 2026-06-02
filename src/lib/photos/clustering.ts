/**
 * Photo clustering — the core of the "route from photo metadata" feature
 * (README §4, step 4). PURE module (no React Native) so it is unit-tested
 * headlessly. See docs/stop-detection-spec.md for the design rationale.
 *
 * Model: Place → Visit → Stop.
 *  - PLACE: photos within PLACE_RADIUS_M of each other (time-agnostic). "Where".
 *  - VISIT: one time-contiguous stay at a place. A place can be visited more than
 *    once (e.g. the same campsite at the start AND end of a round trip); each
 *    visit is a separate, chronological entry. Two visits of the same place are
 *    only split apart by a SIGNIFICANT stay elsewhere (an overnight / long stop)
 *    — a mere day excursion (hike, bike tour of any radius) does NOT split them.
 *  - STOP: a visit that is significant enough to deserve its own roadbook entry,
 *    i.e. an overnight stay OR a daytime dwell ≥ MIN_DAYTIME_DWELL_MS. Transient
 *    excursion visits are NOT stops; the caller attaches their photos to the
 *    surrounding stop (see suggestion.ts).
 */

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
  /** ISO 8601 timestamp (EXIF DateTimeOriginal). */
  takenAt: string;
}

/** One stay at a place. `isStop` distinguishes real stops from excursions. */
export interface PlaceVisit {
  /** Stable id of the underlying place; identical across re-visits. */
  placeId: string;
  /** 0-based index of this visit among the visits OF THIS PLACE (chronological). */
  visitIndex: number;
  photoIds: string[];
  /** Centroid of the place. */
  lat: number;
  lng: number;
  /** Earliest timestamp in the visit (ISO 8601) = arrival. */
  arrivalDate: string;
  /** Latest timestamp in the visit (ISO 8601) = departure. */
  departureDate: string;
  /** True = significant enough to be a stop; false = transient excursion. */
  isStop: boolean;
}

/** Two photos within this distance count as the SAME place. */
export const PLACE_RADIUS_M = 500;
/** A night window the dwell may cross: local-naive 00:00–06:00. */
const NIGHT_START_HOUR = 0;
const NIGHT_END_HOUR = 6;
/** A span this long that touches the night window counts as an overnight stay. */
const OVERNIGHT_MIN_SPAN_MS = 6 * 60 * 60 * 1000;
/** A daytime stay (no overnight) becomes a stop only from this dwell onwards. */
export const MIN_DAYTIME_DWELL_MS = 3 * 60 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two coordinates (Haversine). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface Place {
  id: string;
  lat: number;
  lng: number;
  count: number;
}

interface Run {
  placeId: string;
  points: GeoPoint[];
  startMs: number;
  endMs: number;
}

/**
 * Groups GPS-tagged photos into chronological place visits. Input order does not
 * matter; points are sorted chronologically first. Returns visits ordered by
 * arrival. Visits with `isStop === false` are excursions (attach their photos to
 * the surrounding stop). If NO visit qualifies as a stop (e.g. a short day trip),
 * every visit is promoted to a stop so a valid route is never empty.
 */
export function clusterPhotos(points: GeoPoint[]): PlaceVisit[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));

  const placeOf = assignPlaces(sorted);
  const runs = buildRuns(sorted, placeOf);
  const visits = buildVisits(runs, placeOf);

  // Fallback: if photos are present but nothing is significant (e.g. a short
  // day trip with only quick stops), don't return a stop-less route — promote
  // every visit so the user still gets editable start/…/end entries.
  if (visits.length > 0 && !visits.some((v) => v.isStop)) {
    for (const v of visits) v.isStop = true;
  }

  return visits;
}

/** Greedy spatial clustering (time-agnostic): nearest place within the radius. */
function assignPlaces(sorted: GeoPoint[]): Map<string, Place> {
  const places: Place[] = [];
  const placeOf = new Map<string, Place>(); // photoId → place (resolved later)

  for (const p of sorted) {
    let best: Place | null = null;
    let bestDist = Infinity;
    for (const place of places) {
      const d = haversineMeters(place.lat, place.lng, p.lat, p.lng);
      if (d < PLACE_RADIUS_M && d < bestDist) {
        best = place;
        bestDist = d;
      }
    }
    if (best) {
      // Update running centroid.
      best.lat = (best.lat * best.count + p.lat) / (best.count + 1);
      best.lng = (best.lng * best.count + p.lng) / (best.count + 1);
      best.count += 1;
      placeOf.set(p.id, best);
    } else {
      const place: Place = { id: `place-${places.length}`, lat: p.lat, lng: p.lng, count: 1 };
      places.push(place);
      placeOf.set(p.id, place);
    }
  }
  return placeOf;
}

/** Collapse chronologically consecutive same-place photos into runs. */
function buildRuns(sorted: GeoPoint[], placeOf: Map<string, Place>): Run[] {
  const runs: Run[] = [];
  for (const p of sorted) {
    const placeId = placeOf.get(p.id)!.id;
    const ms = Date.parse(p.takenAt);
    const last = runs[runs.length - 1];
    if (last && last.placeId === placeId) {
      last.points.push(p);
      last.endMs = ms;
    } else {
      runs.push({ placeId, points: [p], startMs: ms, endMs: ms });
    }
  }
  return runs;
}

/** Does an interval (ms) of sufficient length touch a 00:00–06:00 night window? */
function isOvernightSpan(startMs: number, endMs: number): boolean {
  if (endMs - startMs < OVERNIGHT_MIN_SPAN_MS) return false;
  // Walk each calendar day's night window from the start day to the end day.
  const day = new Date(startMs);
  day.setUTCHours(0, 0, 0, 0);
  for (let t = day.getTime(); t <= endMs; t += 24 * 60 * 60 * 1000) {
    const nightStart = t + NIGHT_START_HOUR * 60 * 60 * 1000;
    const nightEnd = t + NIGHT_END_HOUR * 60 * 60 * 1000;
    if (nightStart <= endMs && nightEnd >= startMs) return true;
  }
  return false;
}

/** A run/visit is significant if it spans a night or dwells long enough. */
function isSignificant(startMs: number, endMs: number): boolean {
  return isOvernightSpan(startMs, endMs) || endMs - startMs >= MIN_DAYTIME_DWELL_MS;
}

/**
 * Merge same-place runs into visits, splitting only when a SIGNIFICANT stay at
 * another place lies between them. Uses union-find over run indices.
 */
function buildVisits(runs: Run[], placeOf: Map<string, Place>): PlaceVisit[] {
  if (runs.length === 0) return [];

  const parent = runs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const sigRun = runs.map((r) => isSignificant(r.startMs, r.endMs));

  // For each place, merge its consecutive runs when nothing significant separates
  // them (= a mere excursion was in between).
  const byPlace = new Map<string, number[]>();
  runs.forEach((r, i) => {
    const list = byPlace.get(r.placeId) ?? [];
    list.push(i);
    byPlace.set(r.placeId, list);
  });
  for (const idxs of byPlace.values()) {
    for (let k = 1; k < idxs.length; k++) {
      const a = idxs[k - 1];
      const b = idxs[k];
      let separated = false;
      for (let m = a + 1; m < b; m++) {
        if (sigRun[m]) {
          separated = true;
          break;
        }
      }
      if (!separated) union(a, b);
    }
  }

  // Aggregate runs per visit root, preserving chronological photo order.
  const groups = new Map<number, Run[]>();
  runs.forEach((r, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(r);
    groups.set(root, list);
  });

  const visits: PlaceVisit[] = [];
  for (const group of groups.values()) {
    const photos = group.flatMap((r) => r.points);
    const startMs = Math.min(...group.map((r) => r.startMs));
    const endMs = Math.max(...group.map((r) => r.endMs));
    const place = placeOf.get(photos[0].id)!;
    visits.push({
      placeId: place.id,
      visitIndex: 0, // assigned below
      photoIds: photos.map((p) => p.id),
      lat: place.lat,
      lng: place.lng,
      arrivalDate: new Date(startMs).toISOString(),
      departureDate: new Date(endMs).toISOString(),
      isStop: isSignificant(startMs, endMs),
    });
  }

  visits.sort((a, b) => Date.parse(a.arrivalDate) - Date.parse(b.arrivalDate));

  // visitIndex = chronological order among the visits of the same place.
  const seen = new Map<string, number>();
  for (const v of visits) {
    const n = seen.get(v.placeId) ?? 0;
    v.visitIndex = n;
    seen.set(v.placeId, n + 1);
  }

  return visits;
}
