/**
 * Domain model — mirrors README §5 (Datenmodell, Multi-Tenant ab Tag 1).
 *
 * Conventions:
 * - TS fields are camelCase; DB columns are snake_case. Mapping lives in
 *   src/lib/db/mappers.ts.
 * - Every table extends `SyncBase` so the schema is offline-ready from day one
 *   (README §5.4 / §9): client-generated UUID PKs, soft-delete, updatedAt for
 *   last-write-wins. The full sync engine is Post-MVP, but the schema must not
 *   change later (that would be an expensive data migration).
 */

export type StopType = 'campingplatz' | 'stellplatz' | 'freistehend';
export type StopRole = 'start' | 'stop' | 'end';
export type UploadStatus = 'pending' | 'uploaded' | 'failed';

/** Common base of ALL tables (README §5.4). */
export interface SyncBase {
  /** CLIENT-generated UUID — never serial/auto-increment. Offline records need
   *  an id before they ever reach the backend. */
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601 — basis for last-write-wins conflict resolution
  deletedAt: string | null; // soft-delete tombstone; NO hard delete in normal flow
}

/** Top-level object (UI: "Reise"). "Roadbook" is the app name, not an entity. */
export interface Trip extends SyncBase {
  ownerId: string; // = auth.uid()
  sharedWith: string[]; // additional user ids (RLS-checked); Sharing-UI is Post-MVP
  name: string;
  startDate: string | null;
}

export interface Stop extends SyncBase {
  tripId: string;
  /** order within the route; [0]=start, [last]=end. NOT "order" (SQL keyword). */
  position: number;
  role: StopRole;
  type: StopType | null; // only relevant when role === 'stop'
  name: string;
  lat: number;
  lng: number;
  arrivalDate: string | null;
  notes: string | null;
}

export interface Photo extends SyncBase {
  stopId: string;
  localUri: string | null; // local path until uploaded
  storageUrl: string | null; // R2 URL — null until uploaded
  uploadStatus: UploadStatus;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
}

/** The synced entity kinds, used by the generic sync engine. */
export type EntityType = 'trips' | 'stops' | 'photos';
