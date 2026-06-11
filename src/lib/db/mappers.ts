/**
 * Row <-> domain mapping (README §5 convention: DB snake_case, TS camelCase).
 * PURE module — no React Native imports — so it is unit-tested headlessly.
 *
 * The same shape is used for both SQLite rows and Supabase rows, since the
 * column names are identical by design.
 */
import type { Photo, Stop, StopRole, StopType, Track, TrackGeoPoint, Trip, UploadStatus } from '@/types/models';

/** A raw DB row: string keys, primitive values (SQLite gives numbers/strings/null). */
export type Row = Record<string, string | number | null>;

const str = (v: string | number | null): string => (v == null ? '' : String(v));
const strOrNull = (v: string | number | null): string | null => (v == null ? null : String(v));
const num = (v: string | number | null): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: string | number | null): number | null =>
  v == null || v === '' ? null : typeof v === 'number' ? v : Number(v);

function baseRow(m: { id: string; createdAt: string; updatedAt: string; deletedAt: string | null }): Row {
  return {
    id: m.id,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    deleted_at: m.deletedAt,
  };
}

function baseFields(r: Row) {
  return {
    id: str(r.id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    deletedAt: strOrNull(r.deleted_at),
  };
}

// ── Trip ──────────────────────────────────────────────────────────────────────
/** Parses a JSON-text string-array column; anything broken becomes []. */
function stringArray(v: string | number | null): string[] {
  try {
    const parsed: unknown = v ? JSON.parse(String(v)) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function rowToTrip(r: Row): Trip {
  return {
    ...baseFields(r),
    ownerId: str(r.owner_id),
    sharedWith: stringArray(r.shared_with),
    name: str(r.name),
    startDate: strOrNull(r.start_date),
    stravaUrl: strOrNull(r.strava_url),
    tags: stringArray(r.tags),
  };
}

export function tripToRow(m: Trip): Row {
  return {
    ...baseRow(m),
    owner_id: m.ownerId,
    shared_with: JSON.stringify(m.sharedWith ?? []),
    name: m.name,
    start_date: m.startDate,
    strava_url: m.stravaUrl,
    tags: JSON.stringify(m.tags ?? []),
  };
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function rowToStop(r: Row): Stop {
  return {
    ...baseFields(r),
    tripId: str(r.trip_id),
    position: num(r.position),
    role: str(r.role) as StopRole,
    type: (strOrNull(r.type) as StopType | null) ?? null,
    name: str(r.name),
    lat: num(r.lat),
    lng: num(r.lng),
    arrivalDate: strOrNull(r.arrival_date),
    notes: strOrNull(r.notes),
  };
}

export function stopToRow(m: Stop): Row {
  return {
    ...baseRow(m),
    trip_id: m.tripId,
    position: m.position,
    role: m.role,
    type: m.type,
    name: m.name,
    lat: m.lat,
    lng: m.lng,
    arrival_date: m.arrivalDate,
    notes: m.notes,
  };
}

// ── Photo ─────────────────────────────────────────────────────────────────────
export function rowToPhoto(r: Row): Photo {
  return {
    ...baseFields(r),
    stopId: str(r.stop_id),
    localUri: strOrNull(r.local_uri),
    storageUrl: strOrNull(r.storage_url),
    uploadStatus: (str(r.upload_status) as UploadStatus) || 'pending',
    takenAt: strOrNull(r.taken_at),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
  };
}

export function photoToRow(m: Photo): Row {
  return {
    ...baseRow(m),
    stop_id: m.stopId,
    local_uri: m.localUri,
    storage_url: m.storageUrl,
    upload_status: m.uploadStatus,
    taken_at: m.takenAt,
    lat: m.lat,
    lng: m.lng,
  };
}

// ── Track ─────────────────────────────────────────────────────────────────────
export function rowToTrack(r: Row): Track {
  let points: TrackGeoPoint[] = [];
  try {
    const parsed: unknown = r.points ? JSON.parse(String(r.points)) : [];
    if (Array.isArray(parsed)) points = parsed as TrackGeoPoint[];
  } catch {
    points = [];
  }
  return {
    ...baseFields(r),
    tripId: str(r.trip_id),
    name: strOrNull(r.name),
    points,
  };
}

export function trackToRow(m: Track): Row {
  return {
    ...baseRow(m),
    trip_id: m.tripId,
    name: m.name,
    points: JSON.stringify(m.points ?? []),
  };
}
