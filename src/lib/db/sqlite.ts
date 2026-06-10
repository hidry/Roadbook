/**
 * Opens (once) and initialises the local SQLite database. All writes in the app
 * go here FIRST (offline-first write path, README §9.4); the sync engine pushes
 * to Supabase in the background.
 *
 * Native (iOS/Android) opens synchronously (fast native binding) and persists to
 * a file. Web — only an E2E target, never shipped — opens ASYNCHRONOUSLY: the
 * web build runs SQLite in a Worker, and the *synchronous* open bridge needs
 * SharedArrayBuffer / cross-origin isolation, which times out headless in CI
 * ("Sync operation timeout"). The async API uses postMessage and avoids that.
 * Web uses an in-memory DB (no OPFS needed).
 */
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  ADDITIVE_MIGRATIONS,
  CREATE_STATEMENTS,
  FIRST_ADDITIVE_VERSION,
  LEGACY_DROP_STATEMENTS,
  SCHEMA_VERSION,
} from './schema';

const IS_WEB = Platform.OS === 'web';
const DB_NAME = IS_WEB ? ':memory:' : 'roadbook.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Returns the singleton DB handle. `initDatabase()` must have completed first
 * (the app is gated on it at startup). On native it also lazily opens as a
 * fallback; on web the open is async-only, so it must go through initDatabase().
 */
export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    if (IS_WEB) throw new Error('DB not initialised — call initDatabase() first');
    dbInstance = SQLite.openDatabaseSync(DB_NAME);
  }
  return dbInstance;
}

/** Creates tables/indexes if missing. Idempotent — safe to call on every launch. */
export async function initDatabase(): Promise<void> {
  if (!dbInstance) {
    dbInstance = IS_WEB ? await SQLite.openDatabaseAsync(DB_NAME) : SQLite.openDatabaseSync(DB_NAME);
  }
  if (!IS_WEB) {
    await dbInstance.execAsync('PRAGMA journal_mode = WAL;');
  }
  await dbInstance.execAsync('PRAGMA foreign_keys = ON;');

  // Local schema migration. From before v2 (or fresh) the tables are dropped
  // and recreated (the v2 reshape had no in-place path). From v2 onwards we
  // migrate IN PLACE via additive steps — never drop: photos.local_uri and
  // not-yet-pushed rows are device-local and a re-pull would not restore them.
  const row = await dbInstance.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current < FIRST_ADDITIVE_VERSION) {
    for (const stmt of LEGACY_DROP_STATEMENTS) {
      await dbInstance.execAsync(stmt);
    }
  } else {
    for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
      for (const stmt of ADDITIVE_MIGRATIONS[v] ?? []) {
        await dbInstance.execAsync(stmt);
      }
    }
  }
  if (current !== SCHEMA_VERSION) {
    await dbInstance.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  // After drop-and-recreate the CREATE statements already produce the newest
  // shape, so no additive steps are needed on that path.
  for (const stmt of CREATE_STATEMENTS) {
    await dbInstance.execAsync(stmt);
  }
}
