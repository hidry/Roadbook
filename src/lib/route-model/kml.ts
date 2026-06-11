/**
 * KML adapter (README §8.1 — covers Google MyMaps via its KML export, Google
 * Earth, many camper tools). Placemark/Point -> stop, Placemark/LineString ->
 * track; Folders/Documents are walked recursively; MultiGeometry contributes
 * both kinds. KMZ (zipped KML) is NOT handled here — unzip first (backlog).
 * PURE module.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { emptyRouteModel, type RouteModel, type TrackPoint } from './types';

const ALWAYS_ARRAYS = new Set(['Placemark', 'Folder', 'Document', 'Point', 'LineString']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
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
  if (typeof v === 'object' && '#text' in (v as XmlNode)) return text((v as XmlNode)['#text']);
  return null;
};

/** Parses a KML coordinate list: whitespace-separated "lng,lat[,alt]" tuples. */
export function parseKmlCoordinates(raw: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const tuple of raw.trim().split(/\s+/)) {
    const [lng, lat, alt] = tuple.split(',').map((n) => Number(n));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({ lat, lng, time: null, ele: Number.isFinite(alt) ? alt : null });
  }
  return points;
}

function collectPlacemarks(node: XmlNode | undefined, out: XmlNode[]): void {
  if (!node) return;
  for (const pm of (node.Placemark as XmlNode[] | undefined) ?? []) out.push(pm);
  for (const doc of (node.Document as XmlNode[] | undefined) ?? []) collectPlacemarks(doc, out);
  for (const folder of (node.Folder as XmlNode[] | undefined) ?? []) collectPlacemarks(folder, out);
}

/** Parses a KML document. Throws on input that is not KML at all. */
export function parseKml(xml: string): RouteModel {
  const doc = parser.parse(xml) as XmlNode;
  const kml = doc.kml as XmlNode | undefined;
  if (!kml) throw new Error('Keine KML-Datei (kein <kml>-Element)');

  const model = emptyRouteModel();
  const firstDoc = (kml.Document as XmlNode[] | undefined)?.[0];
  model.name = text(firstDoc?.name);

  const placemarks: XmlNode[] = [];
  collectPlacemarks(kml, placemarks);

  for (const pm of placemarks) {
    const name = text(pm.name);
    const when = text((pm.TimeStamp as XmlNode | undefined)?.when);
    const geometries: XmlNode[] = [pm];
    const multi = pm.MultiGeometry as XmlNode | undefined;
    if (multi) geometries.push(multi);

    for (const g of geometries) {
      for (const point of (g.Point as XmlNode[] | undefined) ?? []) {
        const [p] = parseKmlCoordinates(text(point.coordinates) ?? '');
        if (p) {
          model.stops.push({ name, lat: p.lat, lng: p.lng, time: when, notes: text(pm.description) });
        }
      }
      for (const line of (g.LineString as XmlNode[] | undefined) ?? []) {
        const points = parseKmlCoordinates(text(line.coordinates) ?? '');
        if (points.length > 0) model.tracks.push({ name, points });
      }
    }
  }

  return model;
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

/** Serializes the model as KML 2.2 (stops -> Point, tracks -> LineString). */
export function toKml(model: RouteModel): string {
  const placemarks: XmlNode[] = [
    ...model.stops.map((s) => ({
      ...(s.name ? { name: s.name } : {}),
      ...(s.notes ? { description: s.notes } : {}),
      ...(s.time ? { TimeStamp: { when: s.time } } : {}),
      Point: { coordinates: `${s.lng},${s.lat}` },
    })),
    ...model.tracks.map((t) => ({
      ...(t.name ? { name: t.name } : {}),
      LineString: {
        tessellate: 1,
        coordinates: t.points.map((p) => `${p.lng},${p.lat}${p.ele != null ? `,${p.ele}` : ''}`).join(' '),
      },
    })),
  ];
  const kml = {
    '@_xmlns': 'http://www.opengis.net/kml/2.2',
    Document: {
      ...(model.name ? { name: model.name } : {}),
      Placemark: placemarks,
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ kml }) as string}`;
}
