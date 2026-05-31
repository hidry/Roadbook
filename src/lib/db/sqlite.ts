/**
 * Opens (once) and initialises the local SQLite database. All writes in the app
 * go here FIRST (offline-first write path, README §9.4); the sync engine pushes
 * to Supabase in the background.
 */
import * as SQLite from 'expo-sqlite';

import { CREATE_STATEMENTS } from './schema';

const DB_NAME = 'roadbook.db';

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
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  for (const stmt of CREATE_STATEMENTS) {
    await db.execAsync(stmt);
  }
}
