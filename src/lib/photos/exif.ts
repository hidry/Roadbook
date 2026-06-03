/**
 * Photo picking + metadata extraction (README §4 steps 1–2). Uses ImagePicker
 * for multi-select and MediaLibrary.getAssetInfoAsync() for reliable GPS/time
 * (README §3). On Android, GPS in photo metadata requires ACCESS_MEDIA_LOCATION
 * (declared in app.json AND granted at runtime) — otherwise location is empty.
 *
 * The Android 13+ Photo Picker (PICK_VISUAL_MEDIA) strips GPS from returned
 * images and does NOT populate asset.assetId. We work around both problems:
 *   1. GPS stripped from picker EXIF → clear (0,0) so the MediaLibrary path runs.
 *   2. No assetId → extract numeric MediaStore ID from the asset URI so we can
 *      still call getAssetInfoAsync(), which reads location via ExifInterface +
 *      ACCESS_MEDIA_LOCATION.
 *
 * Native module wrapper — not unit-tested; the pure GPS parsing it relies on
 * lives in `exif-gps.ts` (which is tested), and timestamps in `exif-date.ts`.
 */
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

import { exifDateToIso } from './exif-date';
import { gpsFromExif } from './exif-gps';

export interface PickedPhoto {
  id: string;
  uri: string;
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
}

/** Why an import yielded no usable GPS — surfaced to the user to self-diagnose. */
export interface PickDiagnostics {
  total: number;
  withGps: number;
  withTime: number;
  /** Photos the picker returned without a MediaLibrary id (limited access). */
  assetIdMissing: number;
  mediaLibraryGranted: boolean;
  /**
   * Photos whose GPS fields were exactly (0, 0) — the placeholder Android writes
   * when ACCESS_MEDIA_LOCATION is denied or the GPS hadn't locked. Treated as
   * "no GPS" so they don't cluster to the Gulf of Guinea.
   */
  gpsZero: number;
}

export interface PickOutcome {
  photos: PickedPhoto[];
  diagnostics: PickDiagnostics;
}

/**
 * Extract a numeric MediaStore ID from an Android photo URI so we can call
 * getAssetInfoAsync() even when the Photo Picker didn't set asset.assetId.
 *
 * Works for both picker URI formats:
 *   Android 13+ Photo Picker: content://media/picker/…/media/{id}
 *   Legacy gallery:           content://media/external/images/media/{id}
 */
function mediaStoreIdFromUri(uri: string): string | null {
  const m = /\/media\/(\d+)(?:[?/]|$)/.exec(uri);
  return m?.[1] ?? null;
}

/** Opens the photo picker and returns each selected photo with its metadata. */
export async function pickAndReadPhotos(): Promise<PickOutcome> {
  const picker = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!picker.granted) {
    throw new Error('Kein Zugriff auf Fotos erlaubt.');
  }
  // MediaLibrary permission unlocks getAssetInfoAsync().location (needs
  // ACCESS_MEDIA_LOCATION on Android, declared in app.json). On Android this is
  // the reliable source for the embedded GPS — picker EXIF is often stripped.
  const lib = await MediaLibrary.requestPermissionsAsync();

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    exif: true,
    quality: 1,
  });

  const empty: PickDiagnostics = {
    total: 0,
    withGps: 0,
    withTime: 0,
    assetIdMissing: 0,
    mediaLibraryGranted: lib.granted,
    gpsZero: 0,
  };
  if (result.canceled) return { photos: [], diagnostics: empty };

  let assetIdMissing = 0;
  let gpsZero = 0;
  const out: PickedPhoto[] = [];
  for (const asset of result.assets) {
    let lat: number | null = null;
    let lng: number | null = null;
    let takenAt: string | null = null;

    const exif = asset.exif as Record<string, unknown> | undefined;
    if (exif) {
      takenAt = exifDateToIso((exif.DateTimeOriginal as string) ?? (exif.DateTime as string) ?? null);
      const gps = gpsFromExif(exif);
      if (gps) {
        lat = gps.lat;
        lng = gps.lng;
      }
    }

    // Clear picker-EXIF GPS when it is (0, 0) so the MediaLibrary fallback can
    // still query the real embedded location. Samsung (and some other OEMs) write
    // zeroes instead of omitting the GPS tag when location access is restricted.
    if (lat === 0 && lng === 0) { lat = null; lng = null; }

    if (!asset.assetId) assetIdMissing++;

    // Derive the MediaStore ID from the asset URI when the picker didn't expose
    // it directly (Android 13+ Photo Picker omits assetId). With the ID we can
    // call getAssetInfoAsync() which reads the embedded location via
    // ExifInterface + ACCESS_MEDIA_LOCATION, bypassing the picker's GPS strip.
    const effectiveId = asset.assetId ?? mediaStoreIdFromUri(asset.uri);

    // The structured MediaLibrary record is the reliable Android source for the
    // embedded location and capture time — query it whenever anything is missing.
    if ((lat == null || lng == null || takenAt == null) && effectiveId && lib.granted) {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(effectiveId, { shouldDownloadFromNetwork: true });
        if ((lat == null || lng == null) && info.location) {
          lat = info.location.latitude;
          lng = info.location.longitude;
        }
        if ((lat == null || lng == null) && info.exif) {
          const gps = gpsFromExif(info.exif as Record<string, unknown>);
          if (gps) {
            lat = gps.lat;
            lng = gps.lng;
          }
        }
        if (!takenAt && info.creationTime) takenAt = new Date(info.creationTime).toISOString();
      } catch {
        // ignore — a single asset without metadata must not break the batch
      }
    }

    // Final guard: if MediaLibrary also returned (0, 0), count and discard it.
    if (lat === 0 && lng === 0) {
      gpsZero++;
      lat = null;
      lng = null;
    }

    out.push({ id: asset.assetId ?? asset.uri, uri: asset.uri, lat, lng, takenAt });
  }

  const diagnostics: PickDiagnostics = {
    total: out.length,
    withGps: out.filter((p) => p.lat != null && p.lng != null).length,
    withTime: out.filter((p) => p.takenAt != null).length,
    assetIdMissing,
    mediaLibraryGranted: lib.granted,
    gpsZero,
  };
  return { photos: out, diagnostics };
}
