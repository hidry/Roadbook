/**
 * Parses an EXIF DateTimeOriginal ("YYYY:MM:DD HH:MM:SS") into an ISO 8601
 * string. PURE + unit-tested. EXIF carries no timezone; we treat the wall-clock
 * time as UTC so the result is deterministic regardless of the device/CI
 * timezone — only relative gaps matter for clustering (README §4).
 */
const EXIF_RE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

export function exifDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = EXIF_RE.exec(value.trim());
  if (!m) {
    // Some sources already provide ISO / parseable dates — fall back to Date.
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}
