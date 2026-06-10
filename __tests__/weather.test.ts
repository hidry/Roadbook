import {
  buildWeatherUrl,
  describeWeatherCode,
  fetchDailyWeather,
  formatDailyWeather,
  parseDailyWeather,
  weatherSource,
  type OpenMeteoDaily,
} from '@/lib/weather';

const TODAY = '2026-06-10T12:00:00.000Z';

describe('weatherSource', () => {
  it('routes far past dates to the archive API', () => {
    expect(weatherSource('2025-08-01', TODAY)).toBe('archive');
    expect(weatherSource('2026-06-01', TODAY)).toBe('archive');
  });

  it('routes the last week + near future to the forecast API (ERA5 lag)', () => {
    expect(weatherSource('2026-06-04', TODAY)).toBe('forecast');
    expect(weatherSource('2026-06-10', TODAY)).toBe('forecast');
    expect(weatherSource('2026-06-26', TODAY)).toBe('forecast');
  });

  it('returns null beyond the 16-day forecast horizon', () => {
    expect(weatherSource('2026-06-27', TODAY)).toBeNull();
    expect(weatherSource('2027-01-01', TODAY)).toBeNull();
  });

  it('returns null for unparsable dates', () => {
    expect(weatherSource('kein-datum', TODAY)).toBeNull();
  });
});

describe('buildWeatherUrl', () => {
  it('targets the archive endpoint with coordinates and a single-day range', () => {
    const url = buildWeatherUrl(60.39, 5.32, '2025-08-01', TODAY)!;
    expect(url).toContain('archive-api.open-meteo.com');
    expect(url).toContain('latitude=60.39');
    expect(url).toContain('longitude=5.32');
    expect(url).toContain('start_date=2025-08-01');
    expect(url).toContain('end_date=2025-08-01');
    expect(url).toContain('weather_code');
  });

  it('targets the forecast endpoint for near dates', () => {
    expect(buildWeatherUrl(60, 5, '2026-06-12', TODAY)).toContain('api.open-meteo.com/v1/forecast');
  });

  it('returns null when out of range', () => {
    expect(buildWeatherUrl(60, 5, '2027-01-01', TODAY)).toBeNull();
  });
});

const SAMPLE: OpenMeteoDaily = {
  daily: {
    time: ['2025-08-01'],
    temperature_2m_min: [11.4],
    temperature_2m_max: [18.2],
    precipitation_sum: [0.4],
    weather_code: [61],
  },
};

describe('parseDailyWeather', () => {
  it('extracts the requested day', () => {
    expect(parseDailyWeather(SAMPLE, '2025-08-01')).toEqual({
      date: '2025-08-01',
      tempMin: 11.4,
      tempMax: 18.2,
      precipitationMm: 0.4,
      weatherCode: 61,
    });
  });

  it('returns null when the day or fields are missing', () => {
    expect(parseDailyWeather(SAMPLE, '2025-08-02')).toBeNull();
    expect(parseDailyWeather({}, '2025-08-01')).toBeNull();
    expect(
      parseDailyWeather({ daily: { time: ['2025-08-01'], temperature_2m_min: [null] } }, '2025-08-01'),
    ).toBeNull();
  });
});

describe('describeWeatherCode / formatDailyWeather', () => {
  it('maps WMO codes to German labels', () => {
    expect(describeWeatherCode(0).label).toBe('klar');
    expect(describeWeatherCode(61).label).toBe('Regen');
    expect(describeWeatherCode(95).label).toBe('Gewitter');
    expect(describeWeatherCode(999).label).toBe('Wetter'); // unknown -> generic
  });

  it('formats a compact one-liner with rounded temperatures', () => {
    const s = formatDailyWeather({ date: '2025-08-01', tempMin: 11.4, tempMax: 18.2, precipitationMm: 0.4, weatherCode: 61 });
    expect(s).toContain('Regen');
    expect(s).toContain('11–18 °C');
    expect(s).toContain('0,4 mm');
  });

  it('omits precipitation when dry', () => {
    const s = formatDailyWeather({ date: '2025-08-01', tempMin: 5, tempMax: 9, precipitationMm: 0, weatherCode: 0 });
    expect(s).not.toContain('mm');
  });
});

describe('fetchDailyWeather', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches and parses a day', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    } as unknown as Response);
    const w = await fetchDailyWeather(60.39, 5.32, '2025-08-01', TODAY);
    expect(w?.tempMax).toBe(18.2);
  });

  it('returns null on HTTP errors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    expect(await fetchDailyWeather(60, 5, '2025-08-01', TODAY)).toBeNull();
  });

  it('returns null on network failure', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchDailyWeather(60, 5, '2025-08-01', TODAY)).toBeNull();
  });

  it('returns null without fetching when out of range', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    expect(await fetchDailyWeather(60, 5, '2027-01-01', TODAY)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
