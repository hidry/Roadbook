/**
 * Edge Function: returns a short-lived presigned PUT URL for Cloudflare R2
 * (README §2.3, §9 — images go to R2, never Supabase Storage). The app never
 * holds R2 credentials; this function (which DOES, via Supabase secrets) signs a
 * URL scoped to the authenticated user's own object namespace.
 *
 * The object key is derived SERVER-SIDE from the verified user id, so a client
 * can never write into another user's prefix:  `${user.id}/${photoId}.jpg`.
 *
 * Secrets (set via `supabase secrets set ...`, see .env.example):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 *   R2_PUBLIC_BASE_URL
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1) Verify the caller via their Supabase JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  // 2) Read request + build the user-scoped object key.
  let photoId = '';
  let contentType = 'image/jpeg';
  try {
    const body = await req.json();
    photoId = String(body.photoId ?? '');
    if (body.contentType) contentType = String(body.contentType);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(photoId)) return json({ error: 'photoId must be a UUID' }, 400);

  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  const publicBase = Deno.env.get('R2_PUBLIC_BASE_URL');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    return json({ error: 'R2 not configured' }, 500);
  }

  const key = `${user.id}/${photoId}.jpg`;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

  // 3) Presign a PUT valid for 5 minutes (query-signed URL).
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const signed = await aws.sign(`${endpoint}?X-Amz-Expires=300`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    aws: { signQuery: true },
  });

  return json({ uploadUrl: signed.url, publicUrl: `${publicBase.replace(/\/$/, '')}/${key}` });
});
