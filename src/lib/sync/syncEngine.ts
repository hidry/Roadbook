/**
 * MVP sync engine (README §5.3/§5.4). Offline-first: local SQLite is the Source
 * of Truth; this pushes locally-changed rows up and pulls remote changes down.
 * Conflict resolution is last-write-wins via `updated_at`. The full managed sync
 * engine (PowerSync/WatermelonDB) is Post-MVP — the schema is already prepared
 * for it, so this can be swapped without a data migration.
 *
 * Push includes soft-deleted rows (tombstones) so deletions propagate. Pull
 * relies on Supabase RLS to only ever return rows the user may see. Because the
 * SELECT policies filter `deleted_at IS NULL`, pullChanges never sees remote
 * tombstones — pullTombstones covers that via the `pull_tombstones` RPC
 * (migration 0006), so deletions also reach devices that already have the row.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EntityType } from '@/types/models';
import { getDb } from '@/lib/db/sqlite';
import type { Row } from '@/lib/db/mappers';
import { photoRepo } from '@/lib/db/repositories';
import { supabase } from '@/lib/supabase';
import { flushLog, logLine } from '@/lib/debug-log';
import { compressPhoto } from '@/lib/photos/compress';
import { uploadPhotoToR2 } from '@/lib/photos/r2upload';
import { groupTombstones, nextTombstoneWatermark, type TombstoneRow } from '@/lib/sync/tombstones';
import { nowIso } from '@/lib/util/id';

// Push/pull order respects the FK chain: parents before children.
const TABLES: EntityType[] = ['trips', 'stops', 'photos', 'tracks'];
const LAST_PULL_KEY = (t: EntityType) => `sync:lastPull:${t}`;
const LAST_TOMBSTONE_PULL_KEY = 'sync:lastTombstonePull';

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
/** Local-only columns that must never be sent to the backend. `local_uri` is a
 *  path on THIS device — meaningless (and misleading) on another, so a second
 *  device falls back to `storage_url` for display. */
/** Trip columns stored locally as JSON text but as real arrays in Postgres. */
const TRIP_ARRAY_COLS = ['shared_with', 'tags'] as const;

function toRemote(table: EntityType, row: Row): Record<string, unknown> {
  const { pending_sync: _pending, local_uri: _localUri, ...rest } = row;
  if (table === 'trips') {
    const out: Record<string, unknown> = { ...rest };
    for (const col of TRIP_ARRAY_COLS) {
      if (typeof out[col] !== 'string') continue;
      try {
        out[col] = JSON.parse(out[col] as string) as string[];
      } catch {
        out[col] = [];
      }
    }
    return out;
  }
  return rest;
}

/** Remote row -> values writable into local SQLite (array -> JSON text). */
function toLocal(table: EntityType, row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    // Never let a remote `local_uri` overwrite this device's own value: it is a
    // path on the *uploading* device. Pulled rows keep local_uri = NULL so the
    // UI falls back to storage_url (the R2 URL); expo-image caches that.
    if (k === 'local_uri') continue;
    if (k === 'shared_with' || k === 'tags') {
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

    // Log owner_id vs auth_uid for every pending trip so mismatches are
    // immediately visible in the menu log without truncation.
    if (table === 'trips') {
      for (const p of payload) {
        const oid = String((p as Record<string, unknown>).owner_id ?? '');
        const match = oid === uid ? 'OK' : 'MISMATCH';
        logLine('SYNC:PUSH', `trip owner_id=${oid} auth_uid=${uid} [${match}]`);
      }
      // Drop rows that would fail the INSERT RLS `owner_id = auth.uid()` check.
      const filtered = payload.filter((p) => (p as Record<string, unknown>).owner_id === uid);
      if (filtered.length < payload.length) {
        logLine('SYNC:PUSH', `${payload.length - filtered.length} Trip(s) übersprungen (owner_id ≠ auth_uid) — repairOwnership() aufrufen`);
      }
      payload.splice(0, payload.length, ...filtered);
      if (payload.length === 0) continue;
    }

    // Strategy: INSERT first (never uses ON CONFLICT DO UPDATE, so the UPDATE
    // USING policy is not evaluated for new rows — avoids a PostgreSQL 15+
    // behaviour where even new-row inserts fail if the UPDATE USING check would
    // evaluate to false). For existing rows fall back to individual UPDATEs.
    const { error: insertErr } = await supabase.from(table).insert(payload);

    if (!insertErr) {
      const ids = rows.map((r) => String(r.id));
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(`UPDATE ${table} SET pending_sync = 0 WHERE id IN (${placeholders});`, ids);
      logLine('SYNC:PUSH', `${table}: ${rows.length} Zeile(n) eingefügt`);
      continue;
    }

    logLine('SYNC:PUSH', `${table} INSERT FEHLER: ${insertErr.message}`, { code: insertErr.code });

    if (insertErr.code === '42501' || insertErr.code === '23505') {
      // Batch failed: either an RLS violation (one row blocks the whole batch,
      // e.g. a tombstone route whose parent roadbook is soft-deleted) or a
      // unique-key conflict. Fall back to per-row so good rows still get through.
      const reason = insertErr.code === '42501' ? 'RLS' : 'Duplikat';
      logLine('SYNC:PUSH', `${table}: Batch-${reason} — Fallback auf row-by-row`);
      let pushed = 0;
      for (const row of payload) {
        const rowId = String((row as Record<string, unknown>).id ?? '');
        const { error: rowErr } = await supabase.from(table).insert([row]);
        if (!rowErr) { pushed++; continue; }
        if (rowErr.code === '23505') {
          // Row exists → UPDATE
          const { error: updErr } = await supabase.from(table).update(row).eq('id', rowId);
          if (!updErr) { pushed++; continue; }
          logLine('SYNC:PUSH', `${table}[${rowId.slice(0, 8)}…] UPDATE FEHLER: ${updErr.message}`, { code: updErr.code });
          continue;
        }
        logLine('SYNC:PUSH', `${table}[${rowId.slice(0, 8)}…] INSERT FEHLER: ${rowErr.message}`, { code: rowErr.code });
      }
      const ids = rows.map((r) => String(r.id));
      const placeholders = ids.map(() => '?').join(',');
      await db.runAsync(`UPDATE ${table} SET pending_sync = 0 WHERE id IN (${placeholders});`, ids);
      logLine('SYNC:PUSH', `${table}: ${pushed}/${rows.length} row-by-row OK`);
      continue;
    }

    throw new Error(`push ${table}: ${insertErr.message}`);
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
    // Log successful pulls too (not just errors): a fresh device pulling from the
    // 1970 watermark shows e.g. "trips: 2" here, which immediately reveals a
    // duplicate row in the cloud — otherwise the pull is silent and undiagnosable.
    logLine('SYNC:PULL', `${table}: ${data.length} Zeile(n) gezogen (since ${since})`);
  }
}

/**
 * Pulls remote soft-deletes and applies them locally. The regular pullChanges
 * cannot see tombstones (the SELECT RLS filters `deleted_at IS NULL`), so this
 * uses the `pull_tombstones` RPC, which returns only id + timestamps of deleted
 * rows the user may see. Rows unknown locally are skipped (UPDATE is a no-op);
 * last-write-wins still holds: a local edit NEWER than the deletion survives
 * and re-creates the row remotely on the next push.
 */
export async function pullTombstones(): Promise<void> {
  const db = getDb();
  const since = (await AsyncStorage.getItem(LAST_TOMBSTONE_PULL_KEY)) ?? '1970-01-01T00:00:00.000Z';
  const { data, error } = await supabase.rpc('pull_tombstones', { since });
  if (error) {
    logLine('SYNC:TOMBSTONE', `FEHLER: ${error.message}`, { code: error.code });
    throw new Error(`pull tombstones: ${error.message}`);
  }
  const rows = (data ?? []) as TombstoneRow[];
  if (rows.length === 0) return;

  for (const [table, list] of groupTombstones(rows)) {
    let applied = 0;
    for (const t of list) {
      await db.runAsync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ?, pending_sync = 0
         WHERE id = ? AND updated_at < ?;`,
        [t.deleted_at, t.updated_at, t.id, t.updated_at],
      );
      const r = await db.getFirstAsync<{ n: number }>('SELECT changes() AS n');
      applied += r?.n ?? 0;
    }
    logLine('SYNC:TOMBSTONE', `${table}: ${applied}/${list.length} Löschung(en) übernommen (since ${since})`);
  }
  await AsyncStorage.setItem(LAST_TOMBSTONE_PULL_KEY, nextTombstoneWatermark(rows, since));
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
 * Re-assigns all local trips whose owner_id doesn't match userId to userId and
 * marks them pending_sync = 1. Call this when the RLS push log shows
 * "owner_id ≠ auth_uid" — it repairs data created under a different test
 * account or after a Supabase project reset.
 *
 * Returns the number of trips that were fixed.
 */
export async function repairOwnership(userId: string): Promise<number> {
  const db = getDb();
  const ts = nowIso();
  await db.runAsync(
    `UPDATE trips SET owner_id = ?, updated_at = ?, pending_sync = 1 WHERE owner_id != ?`,
    [userId, ts, userId],
  );
  const result = await db.getFirstAsync<{ n: number }>('SELECT changes() AS n');
  const fixed = result?.n ?? 0;
  logLine('SYNC:REPAIR', `owner_id korrigiert für ${fixed} Trip(s) → ${userId}`);
  void flushLog();
  return fixed;
}

/**
 * Uploads photo binaries to R2 for every row not yet uploaded that still has a
 * local file. Runs AFTER the Supabase metadata sync (metadata first, binaries
 * second). Best-effort per photo; failures are marked 'failed' and retried on
 * the next sync. `setUploaded`/`setUploadStatus` re-mark the row pending_sync=1
 * so the new storage_url (or status) is pushed up afterwards.
 *
 * Returns the number of photos successfully uploaded this pass.
 */
export async function pushPhotoUploads(): Promise<number> {
  const db = getDb();
  const rows = (await db.getAllAsync(
    `SELECT id, local_uri FROM photos
     WHERE upload_status != 'uploaded' AND local_uri IS NOT NULL AND local_uri != '' AND deleted_at IS NULL;`,
  )) as { id: string; local_uri: string }[];
  if (rows.length === 0) return 0;

  logLine('R2:UPLOAD', `${rows.length} Foto(s) noch zu laden`);
  let ok = 0;
  for (const r of rows) {
    const short = r.id.slice(0, 8);
    try {
      const compressed = await compressPhoto(r.local_uri);
      const url = await uploadPhotoToR2(compressed.uri, r.id);
      await photoRepo.setUploaded(r.id, url);
      ok++;
      logLine('R2:UPLOAD', `OK ${short}…`);
    } catch (e) {
      await photoRepo.setUploadStatus(r.id, 'failed');
      logLine('R2:UPLOAD', `FEHLER ${short}…: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  logLine('R2:UPLOAD', `${ok}/${rows.length} hochgeladen`);
  return ok;
}

/** Guards against overlapping sync cycles. The background hook, manual "Sync
 *  jetzt" and post-write triggers can all fire syncNow at once; running the
 *  heavy photo-upload loop twice in parallel made expo-image-manipulator jobs
 *  cancel each other ("renderAsync … cancelled"). */
let syncInFlight = false;

/** One full sync cycle. Best-effort: callers swallow errors when offline. */
export async function syncNow(): Promise<void> {
  if (syncInFlight) {
    logLine('SYNC', 'Zyklus läuft bereits — übersprungen');
    return;
  }
  syncInFlight = true;
  try {
    // 1) Supabase first: push local metadata changes up, then pull remote down
    //    (tombstones travel on their own channel — RLS hides them from SELECT).
    await pushPending();
    await pullChanges();
    await pullTombstones();
    // 2) R2 second: upload any photo binaries still pending/failed.
    const uploaded = await pushPhotoUploads();
    // 3) Push the resulting storage_url / status changes back up to Supabase.
    if (uploaded > 0) await pushPending();
  } catch (e) {
    logLine('SYNC', `Zyklus abgebrochen: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    syncInFlight = false;
    void flushLog();
  }
}
