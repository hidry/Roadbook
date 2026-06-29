/**
 * Public surface of the internal route model (README §8.1 architecture anchor)
 * and its format adapters. PURE — no React Native imports.
 */
import { parseGpx } from './gpx';
import { parseKml } from './kml';
import { isTimelineJson } from './timeline';
import type { RouteModel } from './types';

export * from './types';
export * from './trip-convert';
export { toGpx } from './gpx';
export { parseKmlCoordinates, toKml } from './kml';
export { parseGpx, parseKml };
export {
  isTimelineJson,
  parseLatLng,
  timelineSpan,
  timelineToRouteModel,
  tripDateWindow,
  type TimelineImportOptions,
} from './timeline';

export type RouteFileFormat = 'gpx' | 'kml' | 'timeline';

/** Detects the route file format from the file name, falling back to content sniffing. */
export function detectRouteFormat(fileName: string, content: string): RouteFileFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  if (/<gpx[\s>]/i.test(content)) return 'gpx';
  if (/<kml[\s>]/i.test(content)) return 'kml';
  // Timeline is JSON, so check content (the export is named freely, e.g. Zeitachse.json).
  if (isTimelineJson(content)) return 'timeline';
  return null;
}

/**
 * Parses a route file of either supported format into the neutral model.
 * Throws (with a German message) when the format is unknown or the file is
 * not parseable — the import UI shows that message verbatim.
 */
export function parseRouteFile(fileName: string, content: string): RouteModel {
  const format = detectRouteFormat(fileName, content);
  if (format === 'gpx') return parseGpx(content);
  if (format === 'kml') return parseKml(content);
  // Timeline needs a trip date range → its own flow (timelineToRouteModel).
  if (format === 'timeline') {
    throw new Error('Google-Timeline-Datei erkannt — bitte über „Google Timeline importieren" laden.');
  }
  throw new Error('Unbekanntes Format — unterstützt sind GPX und KML.');
}
