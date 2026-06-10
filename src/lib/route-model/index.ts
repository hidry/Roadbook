/**
 * Public surface of the internal route model (README §8.1 architecture anchor)
 * and its format adapters. PURE — no React Native imports.
 */
import { parseGpx } from './gpx';
import { parseKml } from './kml';
import type { RouteModel } from './types';

export * from './types';
export { toGpx } from './gpx';
export { parseKmlCoordinates, toKml } from './kml';
export { parseGpx, parseKml };

export type RouteFileFormat = 'gpx' | 'kml';

/** Detects the route file format from the file name, falling back to content sniffing. */
export function detectRouteFormat(fileName: string, content: string): RouteFileFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  if (/<gpx[\s>]/i.test(content)) return 'gpx';
  if (/<kml[\s>]/i.test(content)) return 'kml';
  return null;
}

/**
 * Parses a route file of either supported format into the neutral model.
 * Throws (with a German message) when the format is unknown or the file is
 * not parseable — the import UI shows that message verbatim.
 */
export function parseRouteFile(fileName: string, content: string): RouteModel {
  const format = detectRouteFormat(fileName, content);
  if (!format) throw new Error('Unbekanntes Format — unterstützt sind GPX und KML.');
  return format === 'gpx' ? parseGpx(content) : parseKml(content);
}
