/**
 * Uploads a compressed photo to Cloudflare R2 (README §2.3, §9: images go to R2,
 * never Supabase Storage — no egress fees). The app NEVER holds R2 credentials;
 * it asks the `r2-presign` Edge Function (authenticated with the user's Supabase
 * JWT) for a short-lived presigned PUT URL, then uploads directly to R2.
 */
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

const PRESIGN_URL = process.env.EXPO_PUBLIC_R2_PRESIGN_URL;

interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
}

/** Returns the public R2 URL of the uploaded object. Throws on failure. */
export async function uploadPhotoToR2(localUri: string, photoId: string): Promise<string> {
  if (!PRESIGN_URL) throw new Error('EXPO_PUBLIC_R2_PRESIGN_URL ist nicht konfiguriert.');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Nicht angemeldet – Upload nicht möglich.');

  // 1) Ask the Edge Function to sign a PUT for this user's namespaced object.
  const presignRes = await fetch(PRESIGN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ photoId, contentType: 'image/jpeg' }),
  });
  if (!presignRes.ok) {
    throw new Error(`Presign fehlgeschlagen (${presignRes.status}).`);
  }
  const { uploadUrl, publicUrl } = (await presignRes.json()) as PresignResponse;

  // 2) PUT the file's raw bytes straight to R2. We use expo-file-system's native
  //    binary upload instead of fetch(blob): React Native's fetch cannot build a
  //    Blob from a file URI ("Creating blobs from 'ArrayBuffer'… not supported"),
  //    so a blob-based PUT always throws on device.
  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`R2-Upload fehlgeschlagen (${result.status}).`);
  }

  return publicUrl;
}
