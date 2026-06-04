/**
 * MVP sync engine (README §5.3/§5.4). Offline-first: local SQLite is the Source
 * of Truth; this pushes locally-changed rows up and pulls remote changes down.
 * Conflict resolution is last-write-wins via `updated_at`. The full managed sync
 * engine (PowerSync/WatermelonDB) is Post-MVP — the schema is already prepared
 * for it, so this can be swapped without a data migration.
 *
 * Push includes soft-deleted rows (tombstones) so deletions propagate. Pull
 * relies on Supabase RLS to only ever return rows the user may see.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EntityType } from '@/types/models';
import { getDb } from '@/lib/db/sqlite';
import type { Row } from '@/lib/db/mappers';
import { supabase } from '@/lib/supabase';
import { flushLog, logLine } from '@/lib/debug-log';

const TABLES: EntityType[] = ['roadbooks', 'routes', 'stops', 'photos'];
const LAST_PULL_KEY = (t: EntityType) => `sync:lastPull:${t}`;

/** Local-only columns that must never be sent to the backend. */
function toRemote(table: EntityType, row: Row): Record<string, unknown> {
  const { pending_sync: _pending, ...rest } = row;
  if (table === 'roadbooks' && typeof rest.shared_with === 'string') {
    // Local stores shared_with as JSON text; Postgres column is an array.
    try {
      return { ...rest, shared_with: JSON.parse(rest.shared_with) as string[] };
    } catch {
      return { ...rest, shared_with: [] };
    }
  }
  return rest;
}

/** Remote row -> values writable into local SQLite (array -> JSON text). */
function toLocal(table: EntityType, row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'shared_with') {
      out[k] = JSON.stringify(Array.isArray(v) ? v : []);
    } else if (v === null || typeof v === 'string' || typeof v === 'number') {
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v ? 1 : 0;
    } else {
      out[k] = v == null ? null : String(v);
    }
  }
  return out;
}

/** Pushes all rows marked pending_sync = 1 to Supabase, then clears the flag. */
export async function pushPending(): Promise<void> {
  const db = getDb();
  for (const table of TABLES) {
    const rows = (await db.getAllAsync(`SELECT * FROM ${table} WHERE pending_sync = 1;`)) as Row[];
    if (rows.length === 0) continue;
    const payload = rows.map((r) => toRemote(table, r));
    const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
    if (error) {
      logLine('SYNC:PUSH', `${table} FEHLER: ${error.message}`, { code: error.code, details: error.details });
      throw new Error(`push ${table}: ${error.message}`);
    }
    const ids = rows.map((r) => String(r.id));
    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(`UPDATE ${table} SET pending_sync = 0 WHERE id IN (${placeholders});`, ids);
    logLine('SYNC:PUSH', `${table}: ${rows.length} Zeile(n) übertragen`);
  }
}

/** Pulls remote rows changed since the last pull and merges them locally. */
export async function pullChanges(): Promise<void> {
  const db = getDb();
  for (const table of TABLES) {
    const since = (await AsyncStorage.getItem(LAST_PULL_KEY(table))) ?? '1970-01-01T00:00:00.000Z';
    const { data, error } = await supabase.from(table).select('*').gt('updated_at', since).order('updated_at');
    if (error) {
      logLine('SYNC:PULL', `${table} FEHLER: ${error.message}`, { code: error.code });
      throw new Error(`pull ${table}: ${error.message}`);
    }
    if (!data || data.length === 0) continue;

    let maxUpdated = since;
    for (const remote of data as Record<string, unknown>[]) {
      const local = toLocal(table, remote);
      const cols = Object.keys(local);
      const placeholders = cols.map(() => '?').join(', ');
      const updates = cols.map((c) => `${c} = excluded.${c}`).join(', ');
      // Last-write-wins: only overwrite when the remote row is newer.
      await db.runAsync(
        `INSERT INTO ${table} (${cols.join(', ')}, pending_sync) VALUES (${placeholders}, 0)
         ON CONFLICT(id) DO UPDATE SET ${updates}, pending_sync = 0
         WHERE excluded.updated_at > ${table}.updated_at;`,
        cols.map((c) => local[c]),
      );
      const u = String(remote.updated_at ?? '');
      if (u > maxUpdated) maxUpdated = u;
    }
    await AsyncStorage.setItem(LAST_PULL_KEY(table), maxUpdated);
  }
}

/** Returns the total number of rows still waiting to be pushed. */
export async function getPendingSyncCount(): Promise<number> {
  const db = getDb();
  let total = 0;
  for (const table of TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE pending_sync = 1;`);
    total += row?.n ?? 0;
  }
  return total;
}

/** One full sync cycle. Best-effort: callers swallow errors when offline. */
export async function syncNow(): Promise<void> {
  try {
    await pushPending();
    await pullChanges();
  } catch (e) {
    logLine('SYNC', `Zyklus abgebrochen: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    // Flush buffered log lines from this cycle to disk (best-effort).
    void flushLog();
  }
}
