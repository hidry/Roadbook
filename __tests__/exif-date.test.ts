import { exifDateToIso } from '@/lib/photos/exif-date';

describe('exifDateToIso', () => {
  it('parses the standard EXIF "YYYY:MM:DD HH:MM:SS" format (timezone-stable)', () => {
    expect(exifDateToIso('2026:07:14 09:30:00')).toBe('2026-07-14T09:30:00.000Z');
  });

  it('accepts a "T" separator too', () => {
    expect(exifDateToIso('2026:07:14T09:30:00')).toBe('2026-07-14T09:30:00.000Z');
  });

  it('returns null for empty / unparseable input', () => {
    expect(exifDateToIso(null)).toBeNull();
    expect(exifDateToIso(undefined)).toBeNull();
    expect(exifDateToIso('not a date')).toBeNull();
  });

  it('falls back to Date.parse for already-ISO input', () => {
    expect(exifDateToIso('2026-07-14T09:30:00.000Z')).toBe('2026-07-14T09:30:00.000Z');
  });
});
