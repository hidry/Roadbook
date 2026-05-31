/**
 * Reverse-geocoding: cluster centroid → human place name (README §4 step 5).
 *
 * DEV uses the public Nominatim instance, which is limited to max 1 req/s and is
 * NOT allowed for commercial/production use (README §3, §11). Production MUST run
 * an own Photon/Nominatim or a paid geocoder — swap `GEOCODER_BASE_URL` for that.
 *
 * `pickPlaceName` is a PURE function (unit-tested); the network call is throttled
 * to honour the 1 req/s policy.
 */

const GEOCODER_BASE_URL = process.env.EXPO_PUBLIC_GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1100; // honour Nominatim's max 1 req/s

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

/** Picks the most specific sensible place name from a Nominatim response. */
export function pickPlaceName(data: NominatimResponse): string | null {
  const a = data.address ?? {};
  const locality = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.suburb ?? a.county;
  if (locality) return a.country && a.country !== locality ? `${locality}, ${a.country}` : locality;
  if (data.display_name) return data.display_name.split(',')[0]?.trim() || data.display_name;
  return null;
}

let lastCallAt = 0;
async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** Reverse-geocodes a coordinate to a place name, or null on failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    await throttle();
    const url = `${GEOCODER_BASE_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=de`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Roadbook/0.1 (https://github.com/hidry/roadbook)' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResponse;
    return pickPlaceName(data);
  } catch {
    return null; // never hard-fail the suggestion flow on a geocoding hiccup
  }
}
