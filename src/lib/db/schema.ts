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
    start_date  TEXT
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
 * compares this against SQLite's `PRAGMA user_version` and, on a mismatch, drops
 * the legacy tables so the new CREATE statements take effect. Safe because the
 * local DB is a cache of Supabase — trips re-pull on the next sync.
 *
 * v2: collapse `routes` into `trips`; rename `roadbooks` -> `trips`;
 *     `stops.route_id` -> `stops.trip_id` (PROGRESS P8).
 */
export const SCHEMA_VERSION = 2;

/** Legacy tables to drop when migrating an existing on-device DB to v2. */
export const LEGACY_DROP_STATEMENTS: string[] = [
  `DROP TABLE IF EXISTS routes;`,
  `DROP TABLE IF EXISTS roadbooks;`,
  `DROP TABLE IF EXISTS stops;`,
  `DROP TABLE IF EXISTS photos;`,
];
