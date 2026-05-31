/**
 * Tiny generic CRUD over SQLite, shared by all repositories. Every write marks
 * the row `pending_sync = 1` so the sync engine can find and push it later
 * (offline-first write path, README §9.4).
 */
import type { Row } from './mappers';
import { getDb } from './sqlite';

/** INSERT a domain row (mapper output). Forces pending_sync = 1. */
export async function insertRow(table: string, row: Row): Promise<void> {
  const full: Row = { ...row, pending_sync: 1 };
  const cols = Object.keys(full);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((c) => full[c]);
  await getDb().runAsync(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders});`, values);
}

/** UPDATE selected columns of a row by id. Forces pending_sync = 1. */
export async function updateRow(table: string, id: string, patch: Row): Promise<void> {
  const full: Row = { ...patch, pending_sync: 1 };
  const cols = Object.keys(full);
  const assignments = cols.map((c) => `${c} = ?`).join(', ');
  const values = [...cols.map((c) => full[c]), id];
  await getDb().runAsync(`UPDATE ${table} SET ${assignments} WHERE id = ?;`, values);
}

/** Fetch all live (not soft-deleted) rows matching an optional WHERE clause. */
export async function selectRows(
  table: string,
  where?: string,
  params: (string | number | null)[] = [],
  orderBy = 'updated_at DESC',
): Promise<Row[]> {
  const clause = where ? `AND (${where})` : '';
  const sql = `SELECT * FROM ${table} WHERE deleted_at IS NULL ${clause} ORDER BY ${orderBy};`;
  return (await getDb().getAllAsync(sql, params)) as Row[];
}

/** Fetch a single live row by id (or null). */
export async function selectRowById(table: string, id: string): Promise<Row | null> {
  const sql = `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL;`;
  return ((await getDb().getFirstAsync(sql, [id])) as Row | null) ?? null;
}
