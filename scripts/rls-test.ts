/**
 * RLS tenant-isolation test (README §12a — "the security proof of tenant
 * separation"). Creates two real users and asserts that user A can never read or
 * write user B's data, across SELECT / INSERT / UPDATE and the child tables.
 * Also proves the tombstone pull channel (`pull_tombstones`, migration 0006)
 * only ever returns the caller's own soft-deletes.
 *
 * Run against a LOCAL Supabase (`supabase start`) — never production. The
 * service-role key (used only to create/delete the test users) BYPASSES RLS, so
 * it must stay local/CI. Reads config from env (see .env.example):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: `npm run rls:test`  (loads .env via dotenv)  — exits non-zero on fail.
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON || !SERVICE) {
  console.error('Missing SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. See .env.example.');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function makeUser(tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `rls-${tag}-${randomUUID()}@example.com`;
  const password = 'Passw0rd!test';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${tag}): ${error?.message}`);
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw new Error(`signIn(${tag}): ${signErr.message}`);
  return { id: data.user.id, client };
}

async function main() {
  console.log('RLS tenant-isolation test');
  const a = await makeUser('a');
  const b = await makeUser('b');

  // 1) A inserts its own trip (WITH CHECK owner_id = auth.uid()).
  const tripId = randomUUID();
  const insA = await a.client
    .from('trips')
    .insert({ id: tripId, created_at: nowIso(), updated_at: nowIso(), owner_id: a.id, name: 'A-Trip' });
  check('A can insert its own trip', !insA.error, insA.error?.message);

  // 2) A inserts a stop directly under its trip.
  const stId = randomUUID();
  const insSt = await a.client.from('stops').insert({
    id: stId,
    created_at: nowIso(),
    updated_at: nowIso(),
    trip_id: tripId,
    position: 0,
    role: 'start',
    name: 'A-Stop',
    lat: 60.0,
    lng: 5.0,
  });
  check('A can insert a stop under its trip', !insSt.error, insSt.error?.message);

  // 3) B cannot SEE any of A's rows.
  const selB = await b.client.from('trips').select('*').eq('id', tripId);
  check('B cannot SELECT A trip', !selB.error && (selB.data?.length ?? 0) === 0, `rows=${selB.data?.length}`);
  const selBst = await b.client.from('stops').select('*').eq('id', stId);
  check('B cannot SELECT A stop', !selBst.error && (selBst.data?.length ?? 0) === 0, `rows=${selBst.data?.length}`);

  // 4) A cannot insert a trip claiming B as owner (WITH CHECK).
  const forge = await a.client
    .from('trips')
    .insert({ id: randomUUID(), created_at: nowIso(), updated_at: nowIso(), owner_id: b.id, name: 'forged' });
  check('A cannot INSERT a trip owned by B', !!forge.error, 'expected RLS violation');

  // 5) B cannot insert a stop into A's trip (child WITH CHECK).
  const childForge = await b.client.from('stops').insert({
    id: randomUUID(),
    created_at: nowIso(),
    updated_at: nowIso(),
    trip_id: tripId,
    position: 1,
    role: 'stop',
    name: 'B-into-A',
    lat: 0,
    lng: 0,
  });
  check('B cannot INSERT a stop into A trip', !!childForge.error, 'expected RLS violation');

  // 6) B cannot UPDATE A's trip (USING filters it out → 0 rows affected).
  const updB = await b.client.from('trips').update({ name: 'hijacked' }).eq('id', tripId).select();
  check('B cannot UPDATE A trip', !updB.error && (updB.data?.length ?? 0) === 0, `rows=${updB.data?.length}`);

  // 7) A can still SELECT its own trip (positive control).
  const selA = await a.client.from('trips').select('*').eq('id', tripId);
  check('A can SELECT its own trip', !selA.error && (selA.data?.length ?? 0) === 1, `rows=${selA.data?.length}`);

  // ── Tracks (migration 0010): same access chain as stops ────────────────────
  const trackId = randomUUID();
  const insTr = await a.client.from('tracks').insert({
    id: trackId,
    created_at: nowIso(),
    updated_at: nowIso(),
    trip_id: tripId,
    name: 'A-Track',
    points: '[{"lat":60.0,"lng":5.0,"time":null,"ele":null}]',
  });
  check('A can insert a track under its trip', !insTr.error, insTr.error?.message);

  const selBtr = await b.client.from('tracks').select('*').eq('id', trackId);
  check('B cannot SELECT A track', !selBtr.error && (selBtr.data?.length ?? 0) === 0, `rows=${selBtr.data?.length}`);

  const trForge = await b.client.from('tracks').insert({
    id: randomUUID(),
    created_at: nowIso(),
    updated_at: nowIso(),
    trip_id: tripId,
    name: 'B-into-A',
    points: '[]',
  });
  check('B cannot INSERT a track into A trip', !!trForge.error, 'expected RLS violation');

  // ── Tombstone pull channel (migration 0006) ────────────────────────────────
  type Tombstone = { tbl: string; id: string; deleted_at: string; updated_at: string };
  const EPOCH = '1970-01-01T00:00:00.000Z';

  // 8) A soft-deletes its stop → pull_tombstones returns it for A.
  //    The soft-delete is asserted explicitly (with RETURNING via .select(),
  //    visible to the owner through the tombstone SELECT policies, 0013) so a
  //    failure here pinpoints the precondition instead of a silent rows=0.
  const delTs = nowIso();
  const delStop = await a.client
    .from('stops')
    .update({ deleted_at: delTs, updated_at: delTs })
    .eq('id', stId)
    .select('id');
  check(
    'A can soft-delete its stop',
    !delStop.error && (delStop.data?.length ?? 0) === 1,
    delStop.error?.message ?? `rows=${delStop.data?.length}`,
  );
  const tombA = await a.client.rpc('pull_tombstones', { since: EPOCH });
  const rowsA = (tombA.data ?? []) as Tombstone[];
  check(
    'A pulls its own stop tombstone',
    !tombA.error && rowsA.some((t) => t.tbl === 'stops' && t.id === stId),
    tombA.error?.message ?? `rows=${rowsA.length}`,
  );

  // 9) B must NOT see A's tombstones (SECURITY DEFINER re-checks ownership).
  const tombB = await b.client.rpc('pull_tombstones', { since: EPOCH });
  const rowsB = (tombB.data ?? []) as Tombstone[];
  check('B cannot pull A tombstones', !tombB.error && rowsB.length === 0, tombB.error?.message ?? `rows=${rowsB.length}`);

  // 10) The since watermark filters already-pulled tombstones.
  const tombSince = await a.client.rpc('pull_tombstones', { since: nowIso() });
  const rowsSince = (tombSince.data ?? []) as Tombstone[];
  check('since watermark excludes old tombstones', !tombSince.error && rowsSince.length === 0, `rows=${rowsSince.length}`);

  // 11) Deleting the parent trip: trip tombstone appears AND the stop tombstone
  //     under the now-deleted trip is still delivered (no parent deleted_at guard).
  const delTrip = nowIso();
  const delTripRes = await a.client
    .from('trips')
    .update({ deleted_at: delTrip, updated_at: delTrip })
    .eq('id', tripId)
    .select('id');
  check(
    'A can soft-delete its trip',
    !delTripRes.error && (delTripRes.data?.length ?? 0) === 1,
    delTripRes.error?.message ?? `rows=${delTripRes.data?.length}`,
  );
  const tombA2 = await a.client.rpc('pull_tombstones', { since: EPOCH });
  const rowsA2 = (tombA2.data ?? []) as Tombstone[];
  check(
    'A pulls trip tombstone + stop tombstone under deleted trip',
    !tombA2.error &&
      rowsA2.some((t) => t.tbl === 'trips' && t.id === tripId) &&
      rowsA2.some((t) => t.tbl === 'stops' && t.id === stId),
    tombA2.error?.message ?? `rows=${rowsA2.length}`,
  );

  // Cleanup — removing the users cascades their data (owner_id ON DELETE CASCADE).
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);

  console.log(failures === 0 ? '\nAll RLS isolation checks passed.' : `\n${failures} RLS check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('rls-test crashed:', e);
  process.exit(2);
});
