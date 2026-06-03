/**
 * Turns photo metadata into an editable route proposal (README §4, steps 5–6).
 * PURE module — unit-tested headlessly. See docs/stop-detection-spec.md.
 *
 * - Photos with GPS + timestamp are clustered into place visits.
 * - Significant visits become stops (first = start, last = end, middle = stop).
 * - Excursion photos (hikes, bike tours, short halts) are NOT their own stop:
 *   they are attached to the surrounding stop's day (`attachedPhotoIds`), the
 *   stop that temporally encloses them, else the preceding stop, else the first.
 * - Photos WITHOUT GPS are NOT dropped (README §4 "Risiko & Fallback"): they are
 *   returned as `unassignedPhotoIds` so the UI can let the user assign them
 *   manually instead of failing hard.
 */
import type { StopRole, StopType } from '@/types/models';
import { clusterPhotos, type GeoPoint, type PlaceVisit } from './clustering';

/** Raw metadata read from a picked photo (some fields may be missing). */
export interface PhotoMeta {
  id: string;
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
}

export interface SuggestedStop {
  role: StopRole;
  position: number;
  lat: number;
  lng: number;
  arrivalDate: string;
  /** Placeholder name; filled by reverse-geocoding later (README §4 step 5). */
  name: string;
  /** Stop type — set by the user while editing (README §4 step 7). */
  type: StopType | null;
  /** Photos taken AT this stop. */
  photoIds: string[];
  /** Excursion photos (hike/bike/halt) belonging to this stop's day. */
  attachedPhotoIds: string[];
  /** Stable place id; identical when the same place is visited again. */
  placeId: string;
  /** 0-based visit index for this place (>0 = a re-visit, e.g. round trip). */
  visitIndex: number;
}

export interface RouteSuggestion {
  stops: SuggestedStop[];
  unassignedPhotoIds: string[];
}

function hasGeo(p: PhotoMeta): p is PhotoMeta & GeoPoint {
  return p.lat != null && p.lng != null && !!p.takenAt && (p.lat !== 0 || p.lng !== 0);
}

export function suggestRoute(photos: PhotoMeta[]): RouteSuggestion {
  const geo = photos.filter(hasGeo).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, takenAt: p.takenAt }));
  const unassignedPhotoIds = photos.filter((p) => !hasGeo(p)).map((p) => p.id);

  const visits = clusterPhotos(geo);
  const stopVisits = visits.filter((v) => v.isStop);
  const last = stopVisits.length - 1;

  const stops: SuggestedStop[] = stopVisits.map((v, i) => {
    const role: StopRole = i === 0 ? 'start' : i === last ? 'end' : 'stop';
    return {
      role,
      position: i,
      lat: v.lat,
      lng: v.lng,
      arrivalDate: v.arrivalDate,
      name: defaultName(role, i),
      type: null,
      photoIds: v.photoIds,
      attachedPhotoIds: [],
      placeId: v.placeId,
      visitIndex: v.visitIndex,
    };
  });

  // Attach each excursion visit's photos to the surrounding stop's day.
  for (const exc of visits.filter((v) => !v.isStop)) {
    const target = surroundingStop(stops, exc);
    if (target) target.attachedPhotoIds.push(...exc.photoIds);
    else unassignedPhotoIds.push(...exc.photoIds);
  }

  return { stops, unassignedPhotoIds };
}

/**
 * The stop an excursion belongs to: the latest stop that started at/before the
 * excursion (= the day it falls on, which also covers the enclosing case), else
 * the first stop (excursion before the first stop → following first stop, per
 * spec). `null` only when there are no stops at all (clusterPhotos guards that).
 */
function surroundingStop(stops: SuggestedStop[], exc: PlaceVisit): SuggestedStop | null {
  if (stops.length === 0) return null;
  const t = Date.parse(exc.arrivalDate);

  let preceding: SuggestedStop | null = null;
  for (const s of stops) {
    if (Date.parse(s.arrivalDate) <= t) preceding = s;
  }
  return preceding ?? stops[0];
}

function defaultName(role: StopRole, index: number): string {
  if (role === 'start') return 'Start';
  if (role === 'end') return 'Ziel';
  return `Stopp ${index}`;
}
