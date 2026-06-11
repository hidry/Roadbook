-- 0013 — Tombstone visibility via RLS policies; pull_tombstones -> INVOKER.
--
-- CI follow-up to 0012: with the grants fixed, 13/15 RLS checks passed but the
-- SECURITY DEFINER `pull_tombstones` returned 0 rows for the caller's own
-- tombstones. Newer Supabase stacks evidently no longer guarantee that the
-- migration role's function ownership bypasses RLS inside the function body
-- (definer/owner semantics changed). Instead of depending on that implicit
-- bypass, make tombstones FIRST-CLASS under RLS:
--
--   * one additional permissive SELECT policy per table exposes a user's OWN
--     soft-deleted rows (parent alive-guards intentionally absent: a stop
--     tombstone under a deleted trip must stay visible);
--   * `pull_tombstones` becomes SECURITY INVOKER — it now reads through these
--     policies in the caller's context, the exact path the passing checks
--     already prove works.
--
-- Bonus: the regular sync pull (SELECT *) now ALSO sees tombstones, so
-- deletions additionally propagate through the normal pull. Locally they
-- upsert with deleted_at set and are filtered from every UI query.

create policy trip_select_tombstones on trips
  for select using (
    deleted_at is not null
    and (owner_id = auth.uid() or auth.uid() = any (shared_with))
  );

create policy stop_select_tombstones on stops
  for select using (
    deleted_at is not null
    and exists (
      select 1 from trips t
      where t.id = stops.trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );

create policy photo_select_tombstones on photos
  for select using (
    deleted_at is not null
    and exists (
      select 1 from stops st
      join trips t on t.id = st.trip_id
      where st.id = photos.stop_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );

create policy track_select_tombstones on tracks
  for select using (
    deleted_at is not null
    and exists (
      select 1 from trips t
      where t.id = tracks.trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );

-- Same contract as 0006/0010, but INVOKER: visibility comes from the policies
-- above, not from definer privileges.
create or replace function public.pull_tombstones(since text)
returns table (tbl text, id uuid, deleted_at text, updated_at text)
language sql
stable
security invoker
set search_path = public
as $$
  select 'trips'::text, t.id, t.deleted_at, t.updated_at
    from trips t
   where t.deleted_at is not null
     and t.updated_at > since

  union all

  select 'stops'::text, st.id, st.deleted_at, st.updated_at
    from stops st
   where st.deleted_at is not null
     and st.updated_at > since

  union all

  select 'photos'::text, p.id, p.deleted_at, p.updated_at
    from photos p
   where p.deleted_at is not null
     and p.updated_at > since

  union all

  select 'tracks'::text, tr.id, tr.deleted_at, tr.updated_at
    from tracks tr
   where tr.deleted_at is not null
     and tr.updated_at > since
$$;
