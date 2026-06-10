/**
 * Local SQLite schema — the on-device Source of Truth (README §5.4, §9).
 * Columns are snake_case to mirror the Postgres/Supabase schema 1:1, so the
 * same row maps cleanly in both directions (see mappers.ts).
 *
 * `pending_sync` (1 = needs push) is a LOCAL-ONLY column the sync engine uses to
 * find rows to upload; it never travels to the backend.
 */

const SYNC_COLS = `
  id          TEXT PRIMARY KEY NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 1
`;

export const CREATE_STATEMENTS: string[] = [
// Model: User -> Trips (= Reise) -> Stops -> Photos. "Roadbook" is the app name,
// not a table. Stops reference their trip directly (no intermediate `routes`).
  `CREATE TABLE IF NOT EXISTS trips (
    ${SYNC_COLS},
    owner_id    TEXT NOT NULL,
    shared_with TEXT NOT NULL DEFAULT '[]',
    name        TEXT NOT NULL,
    start_date  TEXT,
    strava_url  TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS stops (
    ${SYNC_COLS},
    trip_id      TEXT NOT NULL,
    position     INTEGER NOT NULL,
    role         TEXT NOT NULL,
    type         TEXT,
    name         TEXT NOT NULL,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    arrival_date TEXT,
    notes        TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS photos (
    ${SYNC_COLS},
    stop_id       TEXT NOT NULL,
    local_uri     TEXT,
    storage_url   TEXT,
    upload_status TEXT NOT NULL DEFAULT 'pending',
    taken_at      TEXT,
    lat           REAL,
    lng           REAL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_stops_trip ON stops(trip_id, position);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_stop ON photos(stop_id);`,
  `CREATE INDEX IF NOT EXISTS idx_trips_pending ON trips(pending_sync);`,
  `CREATE INDEX IF NOT EXISTS idx_stops_pending ON stops(pending_sync);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_pending ON photos(pending_sync);`,
];

/**
 * On-device schema version. Bump when the local table shapes change. The DB init
 * compares this against SQLite's `PRAGMA user_version`:
 * - coming from BEFORE v2 (or a fresh install): drop the legacy tables and
 *   recreate — the v2 reshape (routes->trips) had no in-place path.
 * - from v2 onwards: apply the ADDITIVE_MIGRATIONS steps in order. NEVER drop
 *   tables here — `photos.local_uri` and not-yet-pushed rows are device-local
 *   and would be lost (a re-pull does not restore them).
 *
 * v2: collapse `routes` into `trips`; rename `roadbooks` -> `trips`;
 *     `stops.route_id` -> `stops.trip_id` (PROGRESS P8).
 * v3: `trips.strava_url` (Strava as a link, migration 0009).
 */
export const SCHEMA_VERSION = 3;

/** First version that can be migrated in place (additively). */
export const FIRST_ADDITIVE_VERSION = 2;

/**
 * In-place migration steps, keyed by TARGET version: upgrading from v(n-1) to
 * v(n) runs ADDITIVE_MIGRATIONS[n]. Keep every step additive (ALTER TABLE ...
 * ADD COLUMN / CREATE TABLE/INDEX IF NOT EXISTS) and mirror it in a Supabase
 * migration + CREATE_STATEMENTS above.
 */
export const ADDITIVE_MIGRATIONS: Record<number, string[]> = {
  3: [`ALTER TABLE trips ADD COLUMN strava_url TEXT;`],
};

/** Legacy tables to drop when migrating an on-device DB from before v2. */
export const LEGACY_DROP_STATEMENTS: string[] = [
  `DROP TABLE IF EXISTS routes;`,
  `DROP TABLE IF EXISTS roadbooks;`,
  `DROP TABLE IF EXISTS stops;`,
  `DROP TABLE IF EXISTS photos;`,
];
