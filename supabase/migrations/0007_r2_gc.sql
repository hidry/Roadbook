-- 0007 — R2 deletion lifecycle (README §7): list photos whose R2 object must be
-- hard-deleted.
--
-- Soft-delete (§5.4) is NOT a DSGVO deletion: when a photo — or its stop/trip —
-- is soft-deleted, the binary in R2 would otherwise live on forever (orphaned
-- objects = storage cost AND a DSGVO violation). The `r2-gc` Edge Function calls
-- this RPC, deletes each object from R2, then tombstones the photo row and
-- clears its storage_url (so the next GC run no longer sees it and devices pull
-- the deletion via `pull_tombstones`, migration 0006).
--
-- SECURITY INVOKER on purpose: only `service_role` (which bypasses RLS) may
-- execute it — for any other role the RLS SELECT policies would hide the
-- tombstoned rows anyway. Never grant this to authenticated/anon.

create or replace function public.photos_to_purge()
returns table (id uuid, storage_url text, deleted_at text)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.storage_url, p.deleted_at
    from photos p
    join stops st on st.id = p.stop_id
    join trips t on t.id = st.trip_id
   where p.storage_url is not null
     and (
       p.deleted_at is not null
       or st.deleted_at is not null
       or t.deleted_at is not null
     )
$$;

revoke all on function public.photos_to_purge() from public;
revoke all on function public.photos_to_purge() from anon;
revoke all on function public.photos_to_purge() from authenticated;
grant execute on function public.photos_to_purge() to service_role;
