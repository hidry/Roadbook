/**
 * Pure GPS EXIF parsing — extracted from exif.ts so it can be unit-tested
 * headlessly without native modules. See __tests__/exif-gps.test.ts.
 *
 * GPS values in EXIF come in many representations depending on the vendor:
 *   - decimal number  (e.g. 45.969)
 *   - rational string (e.g. "45/1", "5804/100")
 *   - DMS array       (e.g. [45, 58, 8.4] = degrees/minutes/seconds)
 * All three are normalised to a signed decimal here.
 */

/** Parse one EXIF coordinate component into a decimal number. */
export function rationalToNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.includes('/')) {
      const [a, b] = v.split('/').map(Number);
      return b ? a / b : null;
    }
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coordinate may arrive as a decimal, a string, or a [deg, min, sec] array. */
export function toDecimal(value: unknown): number | null {
  if (Array.isArray(value)) {
    const [d = 0, m = 0, s = 0] = value.map(rationalToNumber).map((n) => n ?? 0);
    const dec = d + m / 60 + s / 3600;
    return Number.isFinite(dec) ? dec : null;
  }
  // expo-media-library getExifFullInfo stores GPS as a comma-separated rational
  // DMS string: "45/1,58/1,840/100" — split and treat as [deg, min, sec].
  if (typeof value === 'string' && value.includes(',') && value.includes('/')) {
    return toDecimal(value.split(','));
  }
  return rationalToNumber(value);
}

export function signedCoord(value: unknown, ref: unknown): number | null {
  const dec = toDecimal(value);
  if (dec == null) return null;
  const r = typeof ref === 'string' ? ref.toUpperCase() : '';
  // Explicit ref: force the hemisphere regardless of the decimal's sign.
  if (r === 'S' || r === 'W') return -Math.abs(dec);
  if (r === 'N' || r === 'E') return Math.abs(dec);
  // No ref (e.g. signed decimal from Android ExifInterface.latLong): trust the sign.
  return dec;
}

/** Pull GPS lat/lng out of an EXIF-like record, if both are present. */
export function gpsFromExif(exif: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = signedCoord(exif.GPSLatitude, exif.GPSLatitudeRef);
  const lng = signedCoord(exif.GPSLongitude, exif.GPSLongitudeRef);
  return lat != null && lng != null ? { lat, lng } : null;
}
