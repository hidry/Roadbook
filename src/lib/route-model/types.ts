/**
 * Internal, neutral route model — the architecture anchor of README §8.1:
 * every import source (GPX, KML/KMZ, Strava-GPX, Google Timeline, EXIF photos)
 * converts INTO this model via an adapter, every export is generated FROM it.
 * That keeps the data model clean and decouples the features from each other:
 *
 *   EXIF photos ──┐
 *   GPX file ─────┼─> [adapter] ─> RouteModel ─> [adapter] ─> export (GPX/KML)
 *   KML/KMZ ──────┘
 *
 * Deliberately NOT the DB shape: stops here have no role/position/trip yet —
 * the import flow decides how model points become trip stops. PURE module.
 */

/** A named place on the route (GPX waypoint / KML Point placemark). */
export interface RoutePoint {
  name: string | null;
  lat: number;
  lng: number;
  /** ISO 8601 when the source carries a timestamp. */
  time: string | null;
  notes: string | null;
}

/** One recorded/drawn path vertex (GPX trackpoint / KML LineString tuple). */
export interface TrackPoint {
  lat: number;
  lng: number;
  /** ISO 8601 when the source carries one (GPX <time>). */
  time: string | null;
  /** Elevation in metres when present. */
  ele: number | null;
}

/** A continuous path (GPX <trk> with its segments concatenated / KML LineString). */
export interface RouteTrack {
  name: string | null;
  points: TrackPoint[];
}

/** The neutral in-between: what every adapter reads and writes. */
export interface RouteModel {
  name: string | null;
  stops: RoutePoint[];
  tracks: RouteTrack[];
}

export function emptyRouteModel(): RouteModel {
  return { name: null, stops: [], tracks: [] };
}

/** Quick counts for import previews ("3 Stopps, 1 Track mit 1.204 Punkten"). */
export function routeModelStats(model: RouteModel): { stops: number; tracks: number; trackPoints: number } {
  return {
    stops: model.stops.length,
    tracks: model.tracks.length,
    trackPoints: model.tracks.reduce((n, t) => n + t.points.length, 0),
  };
}
