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
  `CREATE TABLE IF NOT EXISTS roadbooks (
    ${SYNC_COLS},
    owner_id    TEXT NOT NULL,
    shared_with TEXT NOT NULL DEFAULT '[]',
    name        TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS routes (
    ${SYNC_COLS},
    roadbook_id TEXT NOT NULL,
    title       TEXT NOT NULL,
    start_date  TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS stops (
    ${SYNC_COLS},
    route_id     TEXT NOT NULL,
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
  `CREATE INDEX IF NOT EXISTS idx_routes_roadbook ON routes(roadbook_id);`,
  `CREATE INDEX IF NOT EXISTS idx_stops_route ON stops(route_id, position);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_stop ON photos(stop_id);`,
  `CREATE INDEX IF NOT EXISTS idx_roadbooks_pending ON roadbooks(pending_sync);`,
  `CREATE INDEX IF NOT EXISTS idx_routes_pending ON routes(pending_sync);`,
  `CREATE INDEX IF NOT EXISTS idx_stops_pending ON stops(pending_sync);`,
  `CREATE INDEX IF NOT EXISTS idx_photos_pending ON photos(pending_sync);`,
];
