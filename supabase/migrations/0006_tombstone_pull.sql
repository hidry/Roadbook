-- 0006 — Tombstone pull channel: make soft-deletes propagate to other devices.
--
-- Problem (PROGRESS "Bekannte Limits"): every SELECT policy filters
-- `deleted_at IS NULL` (0002/0005), so the sync engine's pullChanges never sees
-- tombstones. A soft-delete therefore only existed on the deleting device; any
-- other device that had already synced the row kept it forever.
--
-- Fix: a dedicated RPC that returns ONLY tombstones (id + timestamps, no
-- payload) for rows the caller owns or that are shared with them. It must be
-- SECURITY DEFINER to bypass the deleted_at filter in the SELECT policies, so
-- it re-implements the exact ownership checks of those policies itself.
-- The parent-trip joins deliberately do NOT filter the parent's deleted_at:
-- a stop tombstone under an already-deleted trip must still be delivered.
--
-- `since` compares against updated_at (text ISO-8601 UTC, lexicographically
-- ordered — same convention as the sync engine's last-write-wins).

create or replace function public.pull_tombstones(since text)
returns table (tbl text, id uuid, deleted_at text, updated_at text)
language sql
stable
security definer
set search_path = public
as $$
  select 'trips'::text, t.id, t.deleted_at, t.updated_at
    from trips t
   where t.deleted_at is not null
     and t.updated_at > since
     and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))

  union all

  select 'stops'::text, st.id, st.deleted_at, st.updated_at
    from stops st
    join trips t on t.id = st.trip_id
   where st.deleted_at is not null
     and st.updated_at > since
     and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))

  union all

  select 'photos'::text, p.id, p.deleted_at, p.updated_at
    from photos p
    join stops st on st.id = p.stop_id
    join trips t on t.id = st.trip_id
   where p.deleted_at is not null
     and p.updated_at > since
     and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
$$;

-- SECURITY DEFINER + anonymous access would leak data: lock it down.
revoke all on function public.pull_tombstones(text) from public;
revoke all on function public.pull_tombstones(text) from anon;
grant execute on function public.pull_tombstones(text) to authenticated;
