/**
 * Photo picking + metadata extraction (README §4 steps 1–2). Uses ImagePicker
 * for multi-select and MediaLibrary.getAssetInfoAsync() for reliable GPS/time
 * (README §3). On Android, GPS in photo metadata requires ACCESS_MEDIA_LOCATION
 * (declared in app.json AND granted at runtime) — otherwise location is empty.
 *
 * Android 13+ Photo Picker (PICK_VISUAL_MEDIA) behaviour:
 *   • asset.assetId is NOT set (picker doesn't expose the MediaStore ID)
 *   • asset.uri is a cache-file path (file:///…), NOT a content:// URI
 *   • GPS is stripped from asset.exif even with ACCESS_MEDIA_LOCATION because
 *     the picker copies the image via openInputStream (not openFileDescriptor)
 *
 * Fallback strategy when assetId is absent:
 *   Search MediaLibrary by filename within a ±14 h window (±14 h covers any
 *   UTC offset because EXIF DateTimeOriginal is local time, DATE_TAKEN is UTC).
 *
 * Native module wrapper — not unit-tested; the pure GPS parsing it relies on
 * lives in `exif-gps.ts` (which is tested), and timestamps in `exif-date.ts`.
 */
import * as ImagePicker from 'expo-image-picker';
import {
  getAssetInfoAsync,
  getAssetsAsync,
  requestPermissionsAsync as requestMediaPermissions,
  type AssetInfo,
} from 'expo-media-library/legacy';

import { APP_VERSION, flushLog, logLine } from '@/lib/debug-log';
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
 * Search MediaLibrary for a photo matching fileName within a ±14 h window
 * around takenAt (interpreted as UTC, though it's actually local EXIF time).
 * ±14 h covers all UTC offsets, so the real UTC timestamp is always inside.
 * createdAfter/createdBefore filters on DATE_TAKEN (ms) in MediaStore.
 */
async function findAssetByFilename(
  fileName: string | null | undefined,
  takenAt: string | null,
): Promise<AssetInfo | null> {
  if (!fileName && !takenAt) return null;
  try {
    // Samsung Photo Picker sets DISPLAY_NAME to the MediaStore _ID
    // (e.g. "1000018540.jpg"). Detect this and call getAssetInfoAsync directly
    // with the numeric ID — no library scan needed.
    const numericId = fileName ? /^(\d+)\.[^.]+$/.exec(fileName)?.[1] : null;
    if (numericId) {
      const info = await getAssetInfoAsync(numericId);
      logLine('EXIF', 'getAssetInfoAsync by numericId from fileName', { numericId, hasLocation: !!info?.location });
      return info;
    }

    // Fallback: search by exact filename within a ±14 h window.
    const opts: Parameters<typeof getAssetsAsync>[0] = {
      mediaType: 'photo',
      first: 500,
    };
    if (takenAt) {
      const ms = new Date(takenAt).getTime();
      if (Number.isFinite(ms)) {
        opts.createdAfter = ms - 14 * 3_600_000;
        opts.createdBefore = ms + 14 * 3_600_000;
      }
    }
    const page = await getAssetsAsync(opts);
    const match = fileName
      ? page.assets.find((a) => a.filename === fileName)
      : page.assets[0];
    if (!match) return null;
    return await getAssetInfoAsync(match.id);
  } catch (e) {
    logLine('EXIF', 'findAssetByFilename error', String(e));
    return null;
  }
}

/** Opens the photo picker and returns each selected photo with its metadata. */
export async function pickAndReadPhotos(): Promise<PickOutcome> {
  logLine('EXIF', `pickAndReadPhotos start — app v${APP_VERSION}`);

  const picker = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!picker.granted) {
    throw new Error('Kein Zugriff auf Fotos erlaubt.');
  }
  // MediaLibrary permission unlocks getAssetInfoAsync().location (needs
  // ACCESS_MEDIA_LOCATION on Android, declared in app.json). On Android this is
  // the reliable source for the embedded GPS — picker EXIF is often stripped.
  const lib = await requestMediaPermissions();
  logLine('EXIF', 'permissions', { picker: picker.granted, lib: lib.granted });

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
  if (result.canceled) {
    await flushLog();
    return { photos: [], diagnostics: empty };
  }

  logLine('EXIF', `picker returned ${result.assets.length} assets`);

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

    const exifGpsSource = lat != null ? 'picker-exif' : null;

    if (!asset.assetId) assetIdMissing++;

    // Android 13+ Photo Picker sets assetId = null and returns a cache-file URI
    // (file:///…), so we cannot extract a MediaStore ID from the URI.
    // When assetId is set (legacy picker), use it directly with getAssetInfoAsync.
    // When assetId is absent, search MediaLibrary by filename within ±14 h.
    if ((lat == null || lng == null || takenAt == null) && lib.granted) {
      try {
        let info: AssetInfo | null = null;
        if (asset.assetId) {
          info = await getAssetInfoAsync(asset.assetId, { shouldDownloadFromNetwork: true });
          logLine('EXIF', 'getAssetInfoAsync by assetId', { assetId: asset.assetId, hasLocation: !!info?.location });
        } else {
          info = await findAssetByFilename(asset.fileName, takenAt);
          logLine('EXIF', 'findAssetByFilename', { fileName: asset.fileName, takenAt, found: !!info, hasLocation: !!info?.location });
        }
        if (info) {
          if ((lat == null || lng == null) && info.location) {
            lat = info.location.latitude;
            lng = info.location.longitude;
          }
          if ((lat == null || lng == null) && info.exif) {
            const rawExif = info.exif as Record<string, unknown>;
            // Log raw GPS values so we can diagnose format issues without a rebuild.
            logLine('EXIF', 'info.exif GPS raw', {
              GPSLatitude: rawExif.GPSLatitude,
              GPSLatitudeRef: rawExif.GPSLatitudeRef,
              GPSLongitude: rawExif.GPSLongitude,
              GPSLongitudeRef: rawExif.GPSLongitudeRef,
            });
            const gps = gpsFromExif(rawExif);
            if (gps) {
              lat = gps.lat;
              lng = gps.lng;
            }
          }
          if (!takenAt && info.creationTime) takenAt = new Date(info.creationTime).toISOString();
        }
      } catch (e) {
        logLine('EXIF', 'MediaLibrary fallback error', String(e));
      }
    }

    // Final guard: if MediaLibrary also returned (0, 0), count and discard it.
    if (lat === 0 && lng === 0) {
      gpsZero++;
      lat = null;
      lng = null;
    }

    logLine('EXIF', 'asset result', {
      fileName: asset.fileName,
      assetId: asset.assetId ?? null,
      uriScheme: asset.uri.split(':')[0],
      exifGpsSource,
      lat,
      lng,
      takenAt,
    });

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

  logLine('EXIF', 'diagnostics', diagnostics);
  await flushLog();
  return { photos: out, diagnostics };
}
