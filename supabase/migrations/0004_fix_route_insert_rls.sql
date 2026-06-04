-- Fix route_insert to allow tombstone sync: soft-deleted routes whose parent
-- roadbook is also soft-deleted must still be pushable so deletions propagate
-- to Supabase. The ownership check (owner_id = auth.uid()) is preserved;
-- only the overly-restrictive rb.deleted_at IS NULL guard is removed.

drop policy if exists route_insert on routes;

create policy route_insert on routes
  for insert with check (
    exists (
      select 1 from roadbooks rb
      where rb.id = roadbook_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );
