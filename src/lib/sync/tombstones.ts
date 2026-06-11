/**
 * Tombstone-pull helpers — PURE (no React Native imports) so Jest can test them
 * headlessly, like clustering/suggestion/mappers.
 *
 * The `pull_tombstones` RPC (migration 0006) returns soft-deleted row ids the
 * caller may see. These helpers validate/group that payload before the sync
 * engine applies it to local SQLite; the table name is interpolated into SQL,
 * so ONLY whitelisted table names may ever pass through here.
 */
import type { EntityType } from '@/types/models';

/** One row of the `pull_tombstones` RPC result (snake_case, like the wire). */
export interface TombstoneRow {
  tbl: string;
  id: string;
  deleted_at: string;
  updated_at: string;
}

const KNOWN_TABLES: ReadonlySet<string> = new Set<EntityType>(['trips', 'stops', 'photos', 'tracks']);

/**
 * Groups RPC rows by table, dropping anything malformed or for an unknown
 * table (defense in depth — `tbl` ends up in a SQL statement).
 */
export function groupTombstones(rows: TombstoneRow[]): Map<EntityType, TombstoneRow[]> {
  const out = new Map<EntityType, TombstoneRow[]>();
  for (const row of rows) {
    if (!KNOWN_TABLES.has(row.tbl)) continue;
    if (!row.id || !row.deleted_at || !row.updated_at) continue;
    const table = row.tbl as EntityType;
    const list = out.get(table) ?? [];
    list.push(row);
    out.set(table, list);
  }
  return out;
}

/**
 * The watermark for the next pull: the max `updated_at` seen, never moving
 * backwards past `since`. ISO-8601 UTC strings compare lexicographically.
 */
export function nextTombstoneWatermark(rows: TombstoneRow[], since: string): string {
  let max = since;
  for (const row of rows) {
    if (row.updated_at > max) max = row.updated_at;
  }
  return max;
}
