/**
 * Compresses a photo before upload (README §3/§4: expo-image-manipulator, max
 * ~1920px). Keeping uploads small is what makes the R2 storage cost model work
 * (README §6). Returns a new local URI; we upload the compressed copy and never
 * the EXIF-full original (DSGVO, README §7).
 */
import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.7;

export async function compressPhoto(uri: string): Promise<ImageResult> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_DIMENSION });
  const rendered = await context.renderAsync();
  return rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
}
