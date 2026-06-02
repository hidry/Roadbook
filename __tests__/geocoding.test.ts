import { pickPlaceName, reverseGeocode, describeGeocodeStatus } from '@/lib/geocoding';

// No throttle / backoff waits in tests.
const FAST = { minIntervalMs: 0, retryBackoffMs: 0, maxAttempts: 3, timeoutMs: 1000 };

const g = globalThis as unknown as { fetch: typeof fetch };

function mockFetchOnce(responses: Array<() => Promise<Response> | Response>) {
  let i = 0;
  g.fetch = jest.fn(() => {
    const make = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;
}

const json = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const httpFail = (status: number): Response => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

afterEach(() => jest.restoreAllMocks());

describe('pickPlaceName', () => {
  it('prefers the most specific locality and appends the country', () => {
    expect(pickPlaceName({ address: { city: 'Bergen', country: 'Norwegen' } })).toBe('Bergen, Norwegen');
    expect(pickPlaceName({ address: { village: 'Geiranger', country: 'Norwegen' } })).toBe('Geiranger, Norwegen');
  });

  it('falls back through town/municipality/hamlet', () => {
    expect(pickPlaceName({ address: { town: 'Flåm' } })).toBe('Flåm');
    expect(pickPlaceName({ address: { municipality: 'Aurland' } })).toBe('Aurland');
  });

  it('uses the first part of display_name when no structured locality exists', () => {
    expect(pickPlaceName({ display_name: 'Rastplatz, E16, Norwegen' })).toBe('Rastplatz');
  });

  it('returns null when nothing usable is present', () => {
    expect(pickPlaceName({})).toBeNull();
  });
});

describe('reverseGeocode', () => {
  it('returns the resolved name on success', async () => {
    mockFetchOnce([() => json({ address: { city: 'Bergen', country: 'Norwegen' } })]);
    const r = await reverseGeocode(60.39, 5.32, FAST);
    expect(r).toEqual({ name: 'Bergen, Norwegen', status: 'ok', httpStatus: 200 });
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports an empty result distinctly from a failure', async () => {
    mockFetchOnce([() => json({})]);
    const r = await reverseGeocode(0, 0, FAST);
    expect(r.name).toBeNull();
    expect(r.status).toBe('empty');
  });

  it('retries a 429 rate-limit and succeeds on a later attempt', async () => {
    mockFetchOnce([() => httpFail(429), () => json({ address: { town: 'Flåm' } })]);
    const r = await reverseGeocode(60.86, 7.11, FAST);
    expect(r).toMatchObject({ name: 'Flåm', status: 'ok' });
    expect(g.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a network error then succeeds', async () => {
    mockFetchOnce([
      () => {
        throw new Error('Network request failed');
      },
      () => json({ address: { village: 'Geiranger' } }),
    ]);
    const r = await reverseGeocode(62.1, 7.2, FAST);
    expect(r.status).toBe('ok');
    expect(g.fetch).toHaveBeenCalledTimes(2);
  });

  it('maps an aborted request to a timeout status', async () => {
    mockFetchOnce([
      () => {
        const e = new Error('Aborted');
        e.name = 'AbortError';
        throw e;
      },
    ]);
    const r = await reverseGeocode(1, 1, { ...FAST, maxAttempts: 1 });
    expect(r).toEqual({ name: null, status: 'timeout', httpStatus: undefined });
  });

  it('does NOT retry a non-transient 403 and reports it', async () => {
    mockFetchOnce([() => httpFail(403)]);
    const r = await reverseGeocode(1, 1, FAST);
    expect(r).toEqual({ name: null, status: 'http-error', httpStatus: 403 });
    expect(g.fetch).toHaveBeenCalledTimes(1); // gave up immediately
  });

  it('gives up after maxAttempts on persistent failure', async () => {
    mockFetchOnce([() => httpFail(429)]);
    const r = await reverseGeocode(1, 1, FAST);
    expect(r.status).toBe('rate-limited');
    expect(g.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('describeGeocodeStatus', () => {
  it('gives a human reason including the HTTP code', () => {
    expect(describeGeocodeStatus('http-error', 503)).toContain('503');
    expect(describeGeocodeStatus('rate-limited')).toMatch(/429|gedrosselt/);
    expect(describeGeocodeStatus('timeout')).toBe('Zeitüberschreitung');
  });
});
