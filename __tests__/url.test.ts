import { normalizeHttpUrl } from '@/lib/util/url';

describe('normalizeHttpUrl', () => {
  it('keeps valid https URLs', () => {
    expect(normalizeHttpUrl('https://www.strava.com/activities/123')).toBe(
      'https://www.strava.com/activities/123',
    );
  });

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeHttpUrl('strava.app.link/abc123')).toBe('https://strava.app.link/abc123');
  });

  it('trims whitespace', () => {
    expect(normalizeHttpUrl('  https://strava.com/activities/1  ')).toBe('https://strava.com/activities/1');
  });

  it('returns null for empty input', () => {
    expect(normalizeHttpUrl('')).toBeNull();
    expect(normalizeHttpUrl('   ')).toBeNull();
  });

  it('rejects non-http(s) schemes (value goes into Linking.openURL)', () => {
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects free text / dotless hostnames', () => {
    expect(normalizeHttpUrl('meine strava tour')).toBeNull();
    expect(normalizeHttpUrl('strava')).toBeNull();
  });
});
