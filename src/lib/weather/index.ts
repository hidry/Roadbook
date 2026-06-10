/**
 * Weather per stop (README §8.1 Tier 1) via Open-Meteo — free, no API key, no
 * account (https://open-meteo.com). Coordinates already exist on every stop.
 *
 * Date routing: Open-Meteo splits its data across two endpoints. The ERA5
 * archive lags a few days behind realtime, while the forecast endpoint serves
 * recent past days (`start_date` may lie up to ~3 months back) plus at most
 * 16 days of forecast:
 *   - older than NEAR_PAST_DAYS days  -> archive API
 *   - within [today-NEAR_PAST_DAYS, today+MAX_FORECAST_DAYS] -> forecast API
 *   - further in the future           -> no data (returns null)
 *
 * PURE module — no React Native imports. URL building, date routing, parsing
 * and the WMO-code mapping are unit-tested with a mocked fetch.
 */

const FORECAST_BASE = process.env.EXPO_PUBLIC_WEATHER_FORECAST_URL ?? 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = process.env.EXPO_PUBLIC_WEATHER_ARCHIVE_URL ?? 'https://archive-api.open-meteo.com/v1/archive';

const NEAR_PAST_DAYS = 7; // ERA5 archive lag: serve the last week from the forecast API
const MAX_FORECAST_DAYS = 16; // Open-Meteo forecast horizon
const TIMEOUT_MS = 8000;

/** One day of weather at a stop's coordinates. */
export interface DailyWeather {
  date: string; // YYYY-MM-DD
  tempMin: number; // °C
  tempMax: number; // °C
  precipitationMm: number;
  weatherCode: number; // WMO code (see describeWeatherCode)
}

/** Which endpoint serves a date, or null when no data can exist (far future). */
export function weatherSource(dateIso: string, todayIso: string): 'archive' | 'forecast' | null {
  const date = dateIso.slice(0, 10);
  const today = todayIso.slice(0, 10);
  const diffDays = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (Number.isNaN(diffDays)) return null;
  if (diffDays > MAX_FORECAST_DAYS) return null;
  return diffDays < -NEAR_PAST_DAYS ? 'archive' : 'forecast';
}

/** Builds the Open-Meteo request URL for one day, or null when out of range. */
export function buildWeatherUrl(lat: number, lng: number, dateIso: string, todayIso: string): string | null {
  const source = weatherSource(dateIso, todayIso);
  if (!source) return null;
  const date = dateIso.slice(0, 10);
  const base = source === 'archive' ? ARCHIVE_BASE : FORECAST_BASE;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  });
  return `${base}?${params.toString()}`;
}

/** Shape of the Open-Meteo `daily` block (only the fields we request). */
export interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

/** Extracts the requested day from an Open-Meteo response; null when absent. */
export function parseDailyWeather(json: OpenMeteoDaily, dateIso: string): DailyWeather | null {
  const d = json.daily;
  if (!d?.time) return null;
  const i = d.time.indexOf(dateIso.slice(0, 10));
  if (i < 0) return null;
  const tempMin = d.temperature_2m_min?.[i];
  const tempMax = d.temperature_2m_max?.[i];
  const code = d.weather_code?.[i];
  if (tempMin == null || tempMax == null || code == null) return null;
  return {
    date: d.time[i],
    tempMin,
    tempMax,
    precipitationMm: d.precipitation_sum?.[i] ?? 0,
    weatherCode: code,
  };
}

/** WMO weather code -> emoji + German label (Open-Meteo uses WMO 4677 codes). */
export function describeWeatherCode(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'klar' };
  if (code === 1 || code === 2) return { emoji: '🌤️', label: 'leicht bewölkt' };
  if (code === 3) return { emoji: '☁️', label: 'bedeckt' };
  if (code === 45 || code === 48) return { emoji: '🌫️', label: 'Nebel' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: 'Nieselregen' };
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: 'Regen' };
  if (code >= 71 && code <= 77) return { emoji: '🌨️', label: 'Schneefall' };
  if (code >= 80 && code <= 82) return { emoji: '🌦️', label: 'Regenschauer' };
  if (code === 85 || code === 86) return { emoji: '🌨️', label: 'Schneeschauer' };
  if (code === 95) return { emoji: '⛈️', label: 'Gewitter' };
  if (code === 96 || code === 99) return { emoji: '⛈️', label: 'Gewitter mit Hagel' };
  return { emoji: '🌡️', label: 'Wetter' };
}

/** Compact one-line summary for the UI, e.g. "🌤️ leicht bewölkt · 12–18 °C · 0,4 mm". */
export function formatDailyWeather(w: DailyWeather): string {
  const { emoji, label } = describeWeatherCode(w.weatherCode);
  const range = `${Math.round(w.tempMin)}–${Math.round(w.tempMax)} °C`;
  const rain = w.precipitationMm > 0 ? ` · ${w.precipitationMm.toLocaleString('de-DE')} mm` : '';
  return `${emoji} ${label} · ${range}${rain}`;
}

/**
 * Fetches one day of weather. Best-effort: returns null on ANY failure (out of
 * range, network, HTTP error, missing data) — weather is decoration, the UI
 * must never block or alert because of it.
 */
export async function fetchDailyWeather(
  lat: number,
  lng: number,
  dateIso: string,
  todayIso: string = new Date().toISOString(),
  timeoutMs: number = TIMEOUT_MS,
): Promise<DailyWeather | null> {
  const url = buildWeatherUrl(lat, lng, dateIso, todayIso);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return parseDailyWeather((await res.json()) as OpenMeteoDaily, dateIso);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
