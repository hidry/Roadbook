/**
 * In-memory debug log — lines accumulate during an import session and are
 * flushed to disk once (at the end). The file is viewable from the import
 * screen and kept across app restarts for sharing / diagnosis.
 *
 * Usage:
 *   logLine('GPS', 'found via MediaLibrary', { lat, lng });  // collect
 *   await flushLog();                                         // write to disk
 *   const text = await readLog();                            // display / share
 */
import Constants from 'expo-constants';
import { deleteAsync, documentDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';

const LOG_FILE = (documentDirectory ?? '') + 'import-debug.txt';
const MAX_BYTES = 100_000;

export const APP_VERSION = Constants.expoConfig?.version ?? '?';

const _lines: string[] = [];

/** Add one timestamped line to the in-memory buffer (zero I/O). */
export function logLine(tag: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
  _lines.push(`${ts} [${tag}] ${message}${dataStr}`);
}

/** Write the in-memory buffer to disk, prepending to the existing log. */
export async function flushLog(): Promise<void> {
  if (_lines.length === 0) return;
  try {
    let existing = '';
    try {
      existing = await readAsStringAsync(LOG_FILE, { encoding: EncodingType.UTF8 });
    } catch {
      // file doesn't exist yet — start fresh
    }
    const session = _lines.join('\n') + '\n';
    _lines.length = 0;

    // Prepend new session and cap total size
    let combined = session + '---\n' + existing;
    if (combined.length > MAX_BYTES) combined = combined.slice(0, MAX_BYTES);

    await writeAsStringAsync(LOG_FILE, combined, { encoding: EncodingType.UTF8 });
  } catch {
    _lines.length = 0;
  }
}

/** Read the persisted log (most recent session first). */
export async function readLog(): Promise<string> {
  try {
    return await readAsStringAsync(LOG_FILE, { encoding: EncodingType.UTF8 });
  } catch {
    return '(kein Log vorhanden)';
  }
}

/** Delete the log file. */
export async function clearLog(): Promise<void> {
  try {
    await deleteAsync(LOG_FILE, { idempotent: true });
  } catch {
    // ignore
  }
}
