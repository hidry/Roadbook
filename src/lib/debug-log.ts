/**
 * App-wide debug log. Lines are buffered in memory and flushed to disk
 * together (zero I/O per line). Kept across restarts; viewable from the
 * app menu.
 *
 * Quick usage:
 *   logLine('TAG', 'message', optionalData);   // buffer (zero I/O)
 *   await flushLog();                           // write buffer to disk
 *
 * For one-shot writes (e.g. background tasks) use appendLog() which
 * calls both in one go.
 */
import Constants from 'expo-constants';
import { deleteAsync, documentDirectory, EncodingType, readAsStringAsync, writeAsStringAsync } from 'expo-file-system/legacy';

const LOG_FILE = (documentDirectory ?? '') + 'app-debug.txt';
const MAX_BYTES = 200_000;

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

    let combined = session + '---\n' + existing;
    if (combined.length > MAX_BYTES) combined = combined.slice(0, MAX_BYTES);

    await writeAsStringAsync(LOG_FILE, combined, { encoding: EncodingType.UTF8 });
  } catch {
    _lines.length = 0;
  }
}

/** Log one line and flush to disk immediately. Use from background tasks. */
export async function appendLog(tag: string, message: string, data?: unknown): Promise<void> {
  logLine(tag, message, data);
  await flushLog();
}

/** Read the persisted log (most recent entries first). */
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
