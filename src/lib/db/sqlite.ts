/**
 * Opens (once) and initialises the local SQLite database. All writes in the app
 * go here FIRST (offline-first write path, README §9.4); the sync engine pushes
 * to Supabase in the background.
 */
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { CREATE_STATEMENTS } from './schema';

// On native (iOS/Android) we persist to a file. On web — only used as an E2E
// target, never shipped — we use an in-memory DB so the data layer works without
// expo-sqlite's OPFS/SharedArrayBuffer backend (which needs cross-origin
// isolation and is brittle in headless CI). WAL is not applicable in-memory.
const DB_NAME = Platform.OS === 'web' ? ':memory:' : 'roadbook.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/** Returns the singleton DB handle. Call `initDatabase()` once at startup first. */
export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync(DB_NAME);
  }
  return dbInstance;
}

/** Creates tables/indexes if missing. Idempotent — safe to call on every launch. */
export async function initDatabase(): Promise<void> {
  const db = getDb();
  if (Platform.OS !== 'web') {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }
  await db.execAsync('PRAGMA foreign_keys = ON;');
  for (const stmt of CREATE_STATEMENTS) {
    await db.execAsync(stmt);
  }
}
