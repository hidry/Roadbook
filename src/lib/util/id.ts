import * as Crypto from 'expo-crypto';

/** Client-generated UUID — the PK strategy required by README §5.4/§9 so that
 *  offline-created records have a stable id before ever reaching the backend. */
export function newId(): string {
  return Crypto.randomUUID();
}

/** Current time as ISO 8601, the format stored in createdAt/updatedAt. */
export function nowIso(): string {
  return new Date().toISOString();
}
