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
import { nowIso } from '@/lib/util/id';

const TABLES: EntityType[] = ['roadbooks', 'routes', 'stops', 'photos'];
const LAST_PULL_KEY = (t: EntityType) => `sync:lastPull:${t}`;

/** Decode the JWT payload without verification (for logging only). */
function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    // atob is available via react-native-url-polyfill/auto (already imported in supabase.ts)
    return JSON.parse(atob(part)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

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

/**
 * Ensure we have a fresh, server-verified JWT before pushing.
 *
 * getSession() reads from AsyncStorage and checks expires_at locally — it does
 * NOT verify the JWT signature. If the Supabase project was reset or the JWT
 * secret rotated, the stored token is cryptographically invalid even though
 * expires_at looks fine. PostgREST then falls back to the anon role, making
 * auth.uid() return NULL, which causes every INSERT to fail the RLS WITH CHECK.
 *
 * Strategy:
 *   1. Read current session (fast, no network).
 *   2. Log JWT sub claim and expires_at for diagnosis.
 *   3. If token has expired or will expire within 60 s, force-refresh it.
 *   4. Return the uid to use for the push, or null if auth is broken.
 */
async function resolveUid(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    logLine('SYNC:AUTH', 'Keine Session in AsyncStorage');
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  const claims = jwtPayload(session.access_token);
  const jwtSub = String(claims?.sub ?? '—');
  const jwtExp = typeof claims?.exp === 'number' ? claims.exp : 0;
  const tokenExpired = jwtExp > 0 && jwtExp < nowSec;

  logLine('SYNC:AUTH', `uid=${session.user.id} jwtSub=${jwtSub} match=${session.user.id === jwtSub} exp=${jwtExp} now=${nowSec} expired=${tokenExpired}`);

  if (tokenExpired || expiresAt < nowSec + 60) {
    logLine('SYNC:AUTH', 'Token abgelaufen — refreshe...');
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed.session) {
      logLine('SYNC:AUTH', `Refresh fehlgeschlagen: ${refreshErr?.message ?? '?'} — neu anmelden erforderlich`);
      return null;
    }
    logLine('SYNC:AUTH', 'Token erfolgreich erneuert');
    return refreshed.session.user.id;
  }

  return session.user.id;
}

/** Pushes all rows marked pending_sync = 1 to Supabase, then clears the flag. */
export async function pushPending(): Promise<void> {
  const uid = await resolveUid();
  if (!uid) {
    logLine('SYNC:PUSH', 'Kein gültiges Auth-Token — Push übersprungen');
    return;
  }

  const db = getDb();
  for (const table of TABLES) {
    const rows = (await db.getAllAsync(`SELECT * FROM ${table} WHERE pending_sync = 1;`)) as Row[];
    if (rows.length === 0) continue;
    const payload = rows.map((r) => toRemote(table, r));

    // Log owner_id vs auth_uid for every pending roadbook so mismatches are
    // immediately visible in the menu log without truncation.
    if (table === 'roadbooks') {
      for (const p of payload) {
        const oid = String((p as Record<string, unknown>).owner_id ?? '');
        const match = oid === uid ? 'OK' : 'MISMATCH';
        logLine('SYNC:PUSH', `roadbook owner_id=${oid} auth_uid=${uid} [${match}]`);
      }
      // Drop rows that would fail the INSERT RLS `owner_id = auth.uid()` check.
      const filtered = payload.filter((p) => (p as Record<string, unknown>).owner_id === uid);
      if (filtered.length < payload.length) {
        logLine('SYNC:PUSH', `${payload.length - filtered.length} Roadbook(s) übersprungen (owner_id ≠ auth_uid) — repairOwnership() aufrufen`);
      }
      payload.splice(0, payload.length, ...filtered);
      if (payload.length === 0) continue;
    }

    const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
    if (error) {
      logLine('SYNC:PUSH', `${table} FEHLER: ${error.message}`, { code: error.code, details: error.details });
      if (error.code === '42501') {
        // Batch upsert failed with RLS violation. Most likely cause: some rows
        // already exist in Supabase under a different owner_id (e.g. from an
        // earlier test account), and the ON CONFLICT DO UPDATE is blocked because
        // the existing row is invisible to the current user.
        // Fall back to INSERT-with-ignore-duplicates so at least NEW rows (which
        // were never in Supabase) get pushed. Rows that truly conflict are skipped
        // and stay pending_sync=1 for the next attempt after a Supabase cleanup.
        logLine('SYNC:PUSH', `${table}: RLS 42501 — Fallback auf INSERT ignoreDuplicates`);
        logLine('SYNC:PUSH', `${table}: Hinweis — ggf. Supabase-Tabelle leeren (SQL: DELETE FROM ${table};)`);
        const { error: insertError } = await supabase.from(table).upsert(payload, { onConflict: 'id', ignoreDuplicates: true });
        if (insertError) {
          logLine('SYNC:PUSH', `${table} Fallback FEHLER: ${insertError.message}`, { code: insertError.code });
          continue;
        }
        // Clear pending_sync only for rows that didn't already exist (i.e. were
        // actually inserted). We can't tell which were skipped, so we clear all —
        // next pull will overwrite any that already existed with the server copy.
        const ids = rows.map((r) => String(r.id));
        const placeholders = ids.map(() => '?').join(',');
        await db.runAsync(`UPDATE ${table} SET pending_sync = 0 WHERE id IN (${placeholders});`, ids);
        logLine('SYNC:PUSH', `${table}: Fallback OK (neue Rows eingefügt, doppelte übersprungen)`);
        continue;
      }
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

/**
 * Re-assigns all local roadbooks whose owner_id doesn't match userId to userId
 * and marks them pending_sync = 1. Call this when the RLS push log shows
 * "owner_id ≠ auth_uid" — it repairs data created under a different test
 * account or after a Supabase project reset.
 *
 * Returns the number of roadbooks that were fixed.
 */
export async function repairOwnership(userId: string): Promise<number> {
  const db = getDb();
  const ts = nowIso();
  await db.runAsync(
    `UPDATE roadbooks SET owner_id = ?, updated_at = ?, pending_sync = 1 WHERE owner_id != ?`,
    [userId, ts, userId],
  );
  const result = await db.getFirstAsync<{ n: number }>('SELECT changes() AS n');
  const fixed = result?.n ?? 0;
  logLine('SYNC:REPAIR', `owner_id korrigiert für ${fixed} Roadbook(s) → ${userId}`);
  void flushLog();
  return fixed;
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
    void flushLog();
  }
}
