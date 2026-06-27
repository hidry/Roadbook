/**
 * Edge Function: R2 garbage collector (README §7 — deletion lifecycle).
 *
 * Soft-delete only tombstones the DB row; the photo binary would stay in R2
 * forever (orphaned objects = cost AND a DSGVO violation). This function:
 *   1. asks `photos_to_purge()` (migration 0007) for photos whose own row OR
 *      whose stop/trip is soft-deleted and that still have a `storage_url`,
 *   2. DELETEs each object from R2 (SigV4, same credentials as r2-presign),
 *   3. tombstones the photo row (deleted_at, if not already set) and clears
 *      `storage_url` — so the next run skips it and devices pick the deletion
 *      up via the `pull_tombstones` channel (migration 0006).
 *
 * NOT user-callable: the caller must present the service-role key as Bearer
 * token (the scheduled `r2-gc.yml` workflow does). A user JWT passes the
 * gateway but is rejected here.
 *
 * The same service-role key is used to (a) authenticate the caller and (b) run
 * the DB client that calls `photos_to_purge()` (which only service_role may
 * execute, bypassing RLS). It is read from the operator-set `SB_SERVICE_ROLE_KEY`
 * with a fallback to the platform-injected `SUPABASE_SERVICE_ROLE_KEY`: newer
 * Supabase projects don't reliably inject the latter, which made EVERY call 401
 * regardless of the Bearer. `SB_` (non-reserved prefix) can be set by the
 * operator via `supabase secrets set`; `SUPABASE_*` names cannot.
 *
 * Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * R2_PUBLIC_BASE_URL (shared with r2-presign); SB_SERVICE_ROLE_KEY (operator-set
 * = the project's service_role key); SUPABASE_URL is injected by the platform.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1) Operator-only: Bearer must BE the service-role key (no user JWTs).
  //    Prefer the operator-set SB_SERVICE_ROLE_KEY; fall back to the auto-
  //    injected one (which newer projects may not provide → every call 401'd).
  const serviceKey = Deno.env.get('SB_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!serviceKey || bearer !== serviceKey) return json({ error: 'Unauthorized' }, 401);

  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  const publicBase = (Deno.env.get('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    return json({ error: 'R2 not configured' }, 500);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data, error } = await supabase.rpc('photos_to_purge');
  if (error) return json({ error: `photos_to_purge: ${error.message}` }, 500);

  const candidates = (data ?? []) as { id: string; storage_url: string; deleted_at: string | null }[];
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

  let purged = 0;
  const failures: string[] = [];
  for (const photo of candidates) {
    // storage_url = `${publicBase}/${userId}/${photoId}.jpg` (set by r2-presign).
    // Derive the object key and refuse anything that doesn't match that shape —
    // never delete arbitrary keys.
    const key = photo.storage_url.startsWith(`${publicBase}/`)
      ? photo.storage_url.slice(publicBase.length + 1)
      : '';
    if (!/^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.jpg$/.test(key)) {
      failures.push(`${photo.id}: unexpected storage_url shape`);
      continue;
    }

    const res = await aws.fetch(
      `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`,
      { method: 'DELETE' },
    );
    // 404 = already gone — the DB row still needs to be finalized.
    if (!res.ok && res.status !== 404) {
      failures.push(`${photo.id}: R2 DELETE ${res.status}`);
      continue;
    }

    // Finalize the row: clear storage_url and cascade the tombstone — a photo
    // purged because its stop/trip was deleted gets its own deleted_at, so
    // pull_tombstones propagates it to devices and the sync engine never tries
    // to re-upload it.
    const ts = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('photos')
      .update({ storage_url: null, deleted_at: photo.deleted_at ?? ts, updated_at: ts })
      .eq('id', photo.id);
    if (updErr) {
      failures.push(`${photo.id}: DB update ${updErr.message}`);
      continue;
    }
    purged++;
  }

  return json({ candidates: candidates.length, purged, failures });
});
