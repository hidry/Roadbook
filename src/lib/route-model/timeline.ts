/**
 * Google Timeline adapter (README §8.1 "Google-Timeline-Import"). Converts the
 * on-device `Timeline.json` export into the neutral RouteModel. PURE module —
 * no React Native imports — so the whole parsing is Jest-testable.
 *
 * Format (new on-device export, 2024+): a top-level `semanticSegments[]`, each
 * segment a time window with ONE of:
 *   - `visit`     → a stayed-at place (topCandidate.placeLocation.latLng)
 *   - `timelinePath[]` → recorded movement points ({point, time})
 *   - `activity`  → a move with {start, end, topCandidate.type} (CYCLING, …)
 *   - `timelineMemory` → trip groupings (ignored)
 * Coordinates are strings "<lat>°, <lng>°" (LAT first, degree sign).
 *
 * ⛔ DSGVO (README §7/§8.1): the export is the user's COMPLETE movement profile
 * (plus `rawSignals` / `userLocationProfile`, which we never touch). This adapter
 * extracts ONLY the segments within the requested trip window; the raw dump is
 * never persisted. Callers MUST pass a date range — importing all-time is wrong.
 */
import { emptyRouteModel, type RouteModel, type RoutePoint, type TrackPoint } from './types';

export interface TimelineImportOptions {
  /** Inclusive trip window, YYYY-MM-DD. Segments outside are dropped. */
  from: string;
  to: string;
  /** Also emit Timeline `visit`s as stops. Default false: stops come from photos;
   *  Timeline's job is the real driven TRACK under those stops. */
  includeVisitsAsStops?: boolean;
}

/** Parses a Timeline coordinate string "<lat>°, <lng>°" → {lat,lng} or null. */
export function parseLatLng(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].replace(/°/g, '').trim());
  const lng = Number(parts[1].replace(/°/g, '').trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

type Segment = Record<string, unknown>;

/** A segment belongs to the window if its startTime's date is within [from,to]. */
function inWindow(seg: Segment, from: string, to: string): boolean {
  const start = typeof seg.startTime === 'string' ? seg.startTime.slice(0, 10) : '';
  if (!start) return false;
  return start >= from && start <= to;
}

/** First/last timestamp across all segments (for an import preview). */
export function timelineSpan(jsonText: string): { from: string; to: string; segments: number } | null {
  let doc: { semanticSegments?: Segment[] };
  try {
    doc = JSON.parse(jsonText) as { semanticSegments?: Segment[] };
  } catch {
    return null;
  }
  const segs = doc.semanticSegments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  let from = '9999-99-99';
  let to = '0000-00-00';
  for (const s of segs) {
    const d = typeof s.startTime === 'string' ? s.startTime.slice(0, 10) : '';
    if (!d) continue;
    if (d < from) from = d;
    if (d > to) to = d;
  }
  return { from, to, segments: segs.length };
}

/** True when the text looks like a Google Timeline export. */
export function isTimelineJson(content: string): boolean {
  return /"semanticSegments"\s*:/.test(content);
}

/**
 * Builds a RouteModel from a Timeline export, restricted to the trip window.
 * The track concatenates every in-window movement point (timelinePath points +
 * activity start/end), sorted by time, with exact consecutive duplicates
 * dropped. Throws (German message) on unparseable input.
 */
export function timelineToRouteModel(jsonText: string, opts: TimelineImportOptions): RouteModel {
  let doc: { semanticSegments?: Segment[] };
  try {
    doc = JSON.parse(jsonText) as { semanticSegments?: Segment[] };
  } catch {
    throw new Error('Datei ist kein gültiges JSON.');
  }
  const segs = doc.semanticSegments;
  if (!Array.isArray(segs)) throw new Error('Keine Google-Timeline-Datei (kein "semanticSegments").');

  const model = emptyRouteModel();
  const raw: { lat: number; lng: number; time: string | null }[] = [];

  for (const seg of segs) {
    if (!inWindow(seg, opts.from, opts.to)) continue;

    const path = seg.timelinePath;
    if (Array.isArray(path)) {
      for (const p of path as Segment[]) {
        const c = parseLatLng(p.point);
        if (c) raw.push({ ...c, time: typeof p.time === 'string' ? p.time : null });
      }
    }

    const activity = seg.activity as Segment | undefined;
    if (activity) {
      const start = parseLatLng((activity.start as Segment | undefined)?.latLng);
      const end = parseLatLng((activity.end as Segment | undefined)?.latLng);
      if (start) raw.push({ ...start, time: typeof seg.startTime === 'string' ? seg.startTime : null });
      if (end) raw.push({ ...end, time: typeof seg.endTime === 'string' ? seg.endTime : null });
    }

    if (opts.includeVisitsAsStops) {
      const visit = seg.visit as Segment | undefined;
      const loc = parseLatLng(((visit?.topCandidate as Segment | undefined)?.placeLocation as Segment | undefined)?.latLng);
      if (loc) {
        model.stops.push({
          name: null,
          lat: loc.lat,
          lng: loc.lng,
          time: typeof seg.startTime === 'string' ? seg.startTime : null,
          notes: null,
        } satisfies RoutePoint);
      }
    }
  }

  // Sort by time (points without a time keep their insertion order via a stable
  // key) and drop exact consecutive duplicates (long stationary stretches).
  raw.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const points: TrackPoint[] = [];
  for (const r of raw) {
    const prev = points[points.length - 1];
    if (prev && prev.lat === r.lat && prev.lng === r.lng) continue;
    points.push({ lat: r.lat, lng: r.lng, time: r.time, ele: null });
  }

  if (points.length >= 2) {
    model.tracks.push({ name: `Google Timeline ${opts.from}`, points });
  }
  return model;
}
