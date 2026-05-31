/**
 * Turns photo metadata into an editable route proposal (README §4, steps 5–6).
 * PURE module — unit-tested headlessly.
 *
 * - Photos with GPS + timestamp are clustered into stops.
 * - First cluster = start, last = end, middle = intermediate stops.
 * - Photos WITHOUT GPS are NOT dropped (README §4 "Risiko & Fallback"): they are
 *   returned as `unassignedPhotoIds` so the UI can let the user assign them
 *   manually instead of failing hard.
 */
import type { StopRole, StopType } from '@/types/models';
import { clusterPhotos, type GeoPoint } from './clustering';

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
  photoIds: string[];
}

export interface RouteSuggestion {
  stops: SuggestedStop[];
  unassignedPhotoIds: string[];
}

function hasGeo(p: PhotoMeta): p is PhotoMeta & GeoPoint {
  return p.lat != null && p.lng != null && !!p.takenAt;
}

export function suggestRoute(photos: PhotoMeta[]): RouteSuggestion {
  const geo = photos.filter(hasGeo).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, takenAt: p.takenAt }));
  const unassignedPhotoIds = photos.filter((p) => !hasGeo(p)).map((p) => p.id);

  const clusters = clusterPhotos(geo);
  const last = clusters.length - 1;

  const stops: SuggestedStop[] = clusters.map((c, i) => {
    const role: StopRole = i === 0 ? 'start' : i === last ? 'end' : 'stop';
    return {
      role,
      position: i,
      lat: c.lat,
      lng: c.lng,
      arrivalDate: c.arrivalDate,
      name: defaultName(role, i),
      type: null,
      photoIds: c.photoIds,
    };
  });

  return { stops, unassignedPhotoIds };
}

function defaultName(role: StopRole, index: number): string {
  if (role === 'start') return 'Start';
  if (role === 'end') return 'Ziel';
  return `Stopp ${index}`;
}
