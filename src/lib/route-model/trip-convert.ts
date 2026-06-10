/**
 * RouteModel <-> trip entities (PURE). The adapters (gpx/kml) know nothing
 * about trips; THIS is where neutral model points become stop/track inputs for
 * the repositories, and where a trip becomes a model for export.
 */
import type { Stop, StopRole, Track, TrackGeoPoint } from '@/types/models';

import type { RouteModel, RoutePoint } from './types';

/** What stopRepo.create needs (minus tripId), derived from an imported point. */
export interface ImportedStopInput {
  name: string;
  position: number;
  role: StopRole;
  lat: number;
  lng: number;
  arrivalDate: string | null;
  notes: string | null;
}

/**
 * Converts model stops to repo inputs, appended AFTER the trip's existing
 * stops. Only an import into an EMPTY trip makes the first point the start —
 * otherwise the existing route keeps its start/end roles.
 */
export function stopsFromModel(model: RouteModel, existingStopCount: number): ImportedStopInput[] {
  return model.stops.map((p: RoutePoint, i: number) => ({
    name: p.name ?? `Import ${i + 1}`,
    position: existingStopCount + i,
    role: existingStopCount === 0 && i === 0 ? 'start' : 'stop',
    lat: p.lat,
    lng: p.lng,
    arrivalDate: p.time ? p.time.slice(0, 10) : null,
    notes: p.notes,
  }));
}

/** Converts model tracks to repo inputs (same point shape by design). */
export function tracksFromModel(model: RouteModel): { name: string | null; points: TrackGeoPoint[] }[] {
  return model.tracks
    .filter((t) => t.points.length >= 2)
    .map((t) => ({ name: t.name, points: t.points }));
}

/**
 * Builds the neutral model from a trip for export. Stops without coordinates
 * (lat/lng both 0 = "not located yet") are skipped — a 0/0 waypoint in the
 * Atlantic helps nobody.
 */
export function modelFromTrip(tripName: string, stops: Stop[], tracks: Track[]): RouteModel {
  const ordered = [...stops].sort((a, b) => a.position - b.position);
  return {
    name: tripName || null,
    stops: ordered
      .filter((s) => s.lat !== 0 || s.lng !== 0)
      .map((s) => ({
        name: s.name || null,
        lat: s.lat,
        lng: s.lng,
        time: s.arrivalDate,
        notes: s.notes,
      })),
    tracks: tracks.map((t) => ({ name: t.name, points: t.points })),
  };
}
