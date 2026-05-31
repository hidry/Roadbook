/**
 * Photo picking + metadata extraction (README §4 steps 1–2). Uses ImagePicker
 * for multi-select and MediaLibrary.getAssetInfoAsync() for reliable GPS/time
 * (README §3). On Android, GPS in photo metadata requires ACCESS_MEDIA_LOCATION
 * (declared in app.json AND granted at runtime) — otherwise location is empty.
 *
 * Native module wrapper — not unit-tested; the parsing it relies on lives in the
 * pure `exif-date.ts` (which is tested).
 */
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

import { exifDateToIso } from './exif-date';

export interface PickedPhoto {
  id: string;
  uri: string;
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
}

function signedCoord(value: unknown, ref: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const r = typeof ref === 'string' ? ref.toUpperCase() : '';
  const sign = r === 'S' || r === 'W' ? -1 : 1;
  return Math.abs(value) * sign;
}

/** Opens the photo picker and returns each selected photo with its metadata. */
export async function pickAndReadPhotos(): Promise<PickedPhoto[]> {
  const picker = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!picker.granted) {
    throw new Error('Kein Zugriff auf Fotos erlaubt.');
  }
  // MediaLibrary permission unlocks getAssetInfoAsync().location (needs
  // ACCESS_MEDIA_LOCATION on Android, declared in app.json).
  const lib = await MediaLibrary.requestPermissionsAsync();

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    exif: true,
    quality: 1,
  });
  if (result.canceled) return [];

  const out: PickedPhoto[] = [];
  for (const asset of result.assets) {
    let lat: number | null = null;
    let lng: number | null = null;
    let takenAt: string | null = null;

    const exif = asset.exif as Record<string, unknown> | undefined;
    if (exif) {
      takenAt = exifDateToIso((exif.DateTimeOriginal as string) ?? (exif.DateTime as string) ?? null);
      const gpsLat = signedCoord(exif.GPSLatitude, exif.GPSLatitudeRef);
      const gpsLng = signedCoord(exif.GPSLongitude, exif.GPSLongitudeRef);
      if (gpsLat != null && gpsLng != null) {
        lat = gpsLat;
        lng = gpsLng;
      }
    }

    // Prefer MediaLibrary's structured location/time when available.
    if ((lat == null || lng == null || takenAt == null) && asset.assetId && lib.granted) {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset.assetId);
        if (info.location) {
          lat = info.location.latitude;
          lng = info.location.longitude;
        }
        if (!takenAt && info.creationTime) takenAt = new Date(info.creationTime).toISOString();
      } catch {
        // ignore — a single asset without metadata must not break the batch
      }
    }

    out.push({ id: asset.assetId ?? asset.uri, uri: asset.uri, lat, lng, takenAt });
  }
  return out;
}
