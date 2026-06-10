/**
 * GPX adapter (README §8.1 — covers Komoot, Garmin, OsmAnd, Strava-GPX, …).
 * GPX 1.0/1.1: <wpt> -> stops, <trk>/<trkseg>/<trkpt> -> tracks (segments of a
 * trk are concatenated — pauses don't split the line), <rte>/<rtept> -> stops
 * (a GPX "route" is an ordered list of named waypoints, which IS our stop list).
 * PURE module.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { emptyRouteModel, type RouteModel, type RoutePoint, type TrackPoint } from './types';

const ALWAYS_ARRAYS = new Set(['wpt', 'rte', 'rtept', 'trk', 'trkseg', 'trkpt']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep every text value a string: numeric-looking names/times must not
  // become numbers; coordinates are parsed explicitly below.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) => ALWAYS_ARRAYS.has(tagName),
});

type XmlNode = Record<string, unknown>;

const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number') return String(v);
  // <name>x</name> with attributes parses to { '#text': 'x', ... }
  if (typeof v === 'object' && '#text' in (v as XmlNode)) return text((v as XmlNode)['#text']);
  return null;
};
const coord = (v: unknown): number => Number(text(v) ?? NaN);

function pointFromWpt(node: XmlNode): RoutePoint | null {
  const lat = coord(node['@_lat']);
  const lng = coord(node['@_lon']);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    name: text(node.name),
    lat,
    lng,
    time: text(node.time),
    notes: text(node.desc) ?? text(node.cmt),
  };
}

function trackPointFromTrkpt(node: XmlNode): TrackPoint | null {
  const lat = coord(node['@_lat']);
  const lng = coord(node['@_lon']);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const ele = coord(node.ele);
  return { lat, lng, time: text(node.time), ele: Number.isFinite(ele) ? ele : null };
}

/** Parses a GPX document. Throws on input that is not GPX at all. */
export function parseGpx(xml: string): RouteModel {
  const doc = parser.parse(xml) as XmlNode;
  const gpx = doc.gpx as XmlNode | undefined;
  if (!gpx) throw new Error('Keine GPX-Datei (kein <gpx>-Element)');

  const model = emptyRouteModel();
  const metadata = gpx.metadata as XmlNode | undefined;
  model.name = text(metadata?.name) ?? text(gpx.name);

  for (const wpt of (gpx.wpt as XmlNode[] | undefined) ?? []) {
    const p = pointFromWpt(wpt);
    if (p) model.stops.push(p);
  }

  for (const rte of (gpx.rte as XmlNode[] | undefined) ?? []) {
    model.name ??= text(rte.name);
    for (const rtept of (rte.rtept as XmlNode[] | undefined) ?? []) {
      const p = pointFromWpt(rtept);
      if (p) model.stops.push(p);
    }
  }

  for (const trk of (gpx.trk as XmlNode[] | undefined) ?? []) {
    const points: TrackPoint[] = [];
    for (const seg of (trk.trkseg as XmlNode[] | undefined) ?? []) {
      for (const trkpt of (seg.trkpt as XmlNode[] | undefined) ?? []) {
        const p = trackPointFromTrkpt(trkpt);
        if (p) points.push(p);
      }
    }
    if (points.length > 0) model.tracks.push({ name: text(trk.name), points });
  }

  return model;
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

/** Serializes the model as GPX 1.1 (stops -> wpt, tracks -> trk/trkseg). */
export function toGpx(model: RouteModel): string {
  const gpx: XmlNode = {
    '@_version': '1.1',
    '@_creator': 'Roadbook',
    '@_xmlns': 'http://www.topografix.com/GPX/1/1',
  };
  if (model.name) gpx.metadata = { name: model.name };
  if (model.stops.length > 0) {
    gpx.wpt = model.stops.map((s) => ({
      '@_lat': s.lat,
      '@_lon': s.lng,
      ...(s.name ? { name: s.name } : {}),
      ...(s.time ? { time: s.time } : {}),
      ...(s.notes ? { desc: s.notes } : {}),
    }));
  }
  if (model.tracks.length > 0) {
    gpx.trk = model.tracks.map((t) => ({
      ...(t.name ? { name: t.name } : {}),
      trkseg: {
        trkpt: t.points.map((p) => ({
          '@_lat': p.lat,
          '@_lon': p.lng,
          ...(p.ele != null ? { ele: p.ele } : {}),
          ...(p.time ? { time: p.time } : {}),
        })),
      },
    }));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ gpx }) as string}`;
}
