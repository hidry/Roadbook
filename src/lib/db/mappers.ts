/**
 * Row <-> domain mapping (README §5 convention: DB snake_case, TS camelCase).
 * PURE module — no React Native imports — so it is unit-tested headlessly.
 *
 * The same shape is used for both SQLite rows and Supabase rows, since the
 * column names are identical by design.
 */
import type { Photo, Roadbook, Route, Stop, StopRole, StopType, UploadStatus } from '@/types/models';

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

// ── Roadbook ──────────────────────────────────────────────────────────────────
export function rowToRoadbook(r: Row): Roadbook {
  let sharedWith: string[] = [];
  try {
    sharedWith = r.shared_with ? (JSON.parse(String(r.shared_with)) as string[]) : [];
  } catch {
    sharedWith = [];
  }
  return { ...baseFields(r), ownerId: str(r.owner_id), sharedWith, name: str(r.name) };
}

export function roadbookToRow(m: Roadbook): Row {
  return { ...baseRow(m), owner_id: m.ownerId, shared_with: JSON.stringify(m.sharedWith ?? []), name: m.name };
}

// ── Route ─────────────────────────────────────────────────────────────────────
export function rowToRoute(r: Row): Route {
  return { ...baseFields(r), roadbookId: str(r.roadbook_id), title: str(r.title), startDate: strOrNull(r.start_date) };
}

export function routeToRow(m: Route): Row {
  return { ...baseRow(m), roadbook_id: m.roadbookId, title: m.title, start_date: m.startDate };
}

// ── Stop ──────────────────────────────────────────────────────────────────────
export function rowToStop(r: Row): Stop {
  return {
    ...baseFields(r),
    routeId: str(r.route_id),
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
    route_id: m.routeId,
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
