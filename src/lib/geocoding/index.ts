/**
 * Reverse-geocoding: cluster centroid → human place name (README §4 step 5).
 *
 * DEV uses the public Nominatim instance, which is limited to max 1 req/s and is
 * NOT allowed for commercial/production use (README §3, §11). Production MUST run
 * an own Photon/Nominatim or a paid geocoder — swap `GEOCODER_BASE_URL` for that.
 *
 * `pickPlaceName` is a PURE function (unit-tested). `reverseGeocode` adds a
 * timeout, a small retry for transient failures (rate-limit / network / 5xx /
 * timeout) and returns a STATUS so the UI can say WHY a lookup failed instead of
 * a generic "not reachable" — the most common cause is Nominatim throttling the
 * public instance, which a retry (or trying again later) often fixes.
 */

const GEOCODER_BASE_URL = process.env.EXPO_PUBLIC_GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1100; // honour Nominatim's max 1 req/s
const TIMEOUT_MS = 8000; // give up on a single request after this
const MAX_ATTEMPTS = 3; // total tries per coordinate on transient failures
const RETRY_BACKOFF_MS = 1500; // base backoff between attempts (grows linearly)

export interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  suburb?: string;
  county?: string;
  state?: string;
  country?: string;
}
export interface NominatimResponse {
  display_name?: string;
  address?: NominatimAddress;
}

/** Why a reverse-geocode ended the way it did (for diagnostics in the UI). */
export type GeocodeStatus = 'ok' | 'empty' | 'rate-limited' | 'http-error' | 'timeout' | 'network';

export interface GeocodeResult {
  /** Resolved place name, or null on any failure / empty result. */
  name: string | null;
  status: GeocodeStatus;
  /** HTTP status code when the server answered (for 'http-error' / 'rate-limited'). */
  httpStatus?: number;
}

/** Tunable timings — defaults are the module constants; tests override them. */
export interface GeocodeOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  minIntervalMs?: number;
}

/** Picks the most specific sensible place name from a Nominatim response. */
export function pickPlaceName(data: NominatimResponse): string | null {
  const a = data.address ?? {};
  const locality = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county;
  if (locality) return a.country && a.country !== locality ? `${locality}, ${a.country}` : locality;
  if (data.display_name) return data.display_name.split(',')[0]?.trim() || data.display_name;
  return null;
}

/** Short human-readable reason, for a non-blocking diagnostic alert. */
export function describeGeocodeStatus(status: GeocodeStatus, httpStatus?: number): string {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'empty':
      return 'kein Ortsname gefunden';
    case 'rate-limited':
      return 'Dienst gedrosselt (HTTP 429, max. 1 Anfrage/s) – später erneut versuchen';
    case 'timeout':
      return 'Zeitüberschreitung';
    case 'network':
      return 'keine Netzwerkverbindung';
    case 'http-error':
      return `Server-Fehler (HTTP ${httpStatus ?? '?'})`;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let lastCallAt = 0;
async function throttle(minIntervalMs: number): Promise<void> {
  const wait = lastCallAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

interface Attempt {
  status: GeocodeStatus;
  httpStatus?: number;
  data?: NominatimResponse;
}

/** One network attempt with a timeout; never throws. */
async function fetchReverse(lat: number, lng: number, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${GEOCODER_BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=de`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Roadbook/0.1 (https://github.com/hidry/roadbook)' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { status: res.status === 429 ? 'rate-limited' : 'http-error', httpStatus: res.status };
    }
    try {
      const data = (await res.json()) as NominatimResponse;
      return { status: 'ok', httpStatus: res.status, data };
    } catch {
      return { status: 'http-error', httpStatus: res.status }; // unparseable body
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { status: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function isTransient(a: Attempt): boolean {
  return (
    a.status === 'timeout' ||
    a.status === 'network' ||
    a.status === 'rate-limited' ||
    (a.status === 'http-error' && (a.httpStatus ?? 0) >= 500)
  );
}

/**
 * Reverse-geocodes a coordinate to a place name. Retries transient failures and
 * never hard-fails the suggestion flow. Returns a {@link GeocodeResult} carrying
 * the outcome so the caller can show a precise reason on failure.
 */
export async function reverseGeocode(lat: number, lng: number, opts: GeocodeOptions = {}): Promise<GeocodeResult> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const retryBackoffMs = opts.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;

  let last: Attempt = { status: 'network' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle(minIntervalMs);
    last = await fetchReverse(lat, lng, timeoutMs);

    if (last.status === 'ok') {
      const name = pickPlaceName(last.data ?? {});
      return { name, status: name ? 'ok' : 'empty', httpStatus: last.httpStatus };
    }
    if (!isTransient(last) || attempt === maxAttempts) break;
    await sleep(retryBackoffMs * attempt); // linear backoff: 1×, 2×, …
  }

  return { name: null, status: last.status, httpStatus: last.httpStatus };
}
