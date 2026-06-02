/**
 * Photo clustering — the core of the "route from photo metadata" feature
 * (README §4, step 4). PURE module (no React Native) so it is unit-tested
 * headlessly.
 *
 * Heuristic (MVP): chronologically adjacent photos belong to the SAME stop while
 * they stay within 500 m of each other along the travel track. A new stop begins
 * only once the traveller has moved farther than that. Time is used ONLY to order
 * the sequence — it does NOT split a stop, so a multi-hour or overnight stay at
 * one place stays a single stop (a camper's evening + next-morning photos at the
 * same site must not become two stops).
 */

export interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
  /** ISO 8601 timestamp (EXIF DateTimeOriginal). */
  takenAt: string;
}

export interface Cluster {
  photoIds: string[];
  /** Centroid of the cluster. */
  lat: number;
  lng: number;
  /** Earliest timestamp in the cluster (ISO 8601) = arrival. */
  arrivalDate: string;
}

export const DISTANCE_THRESHOLD_M = 500;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two coordinates (Haversine). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Groups GPS-tagged photos into stop clusters. Input order does not matter;
 * points are sorted chronologically first (= the travel sequence, README §4
 * step 3). Returns clusters in chronological order.
 */
export function clusterPhotos(points: GeoPoint[]): Cluster[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));

  const groups: GeoPoint[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const distance = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    // Split on movement only — time gaps (overnight stays) must NOT split a stop.
    const sameCluster = distance < DISTANCE_THRESHOLD_M;
    if (sameCluster) {
      groups[groups.length - 1].push(cur);
    } else {
      groups.push([cur]);
    }
  }

  return groups.map(toCluster);
}

function toCluster(group: GeoPoint[]): Cluster {
  const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
  const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
  const arrivalDate = group
    .map((p) => p.takenAt)
    .reduce((min, t) => (Date.parse(t) < Date.parse(min) ? t : min), group[0].takenAt);
  return { photoIds: group.map((p) => p.id), lat, lng, arrivalDate };
}
