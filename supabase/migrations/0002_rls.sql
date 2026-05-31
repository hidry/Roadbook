-- Row-Level-Security — the core of multi-user safety (README §5.2, §9, §11).
--
-- Two non-negotiable rules (README §5.2):
--   1. WITH CHECK on every INSERT/UPDATE — USING only filters visible rows, it
--      does NOT validate written values. Without WITH CHECK a user could write
--      rows with a foreign owner_id.
--   2. deleted_at IS NULL in every SELECT policy — otherwise soft-deleted rows
--      stay visible.
--
-- Child tables (routes/stops/photos) inherit access via EXISTS subqueries up the
-- chain to the owning roadbook. Hard DELETE is intentionally NOT granted (no
-- DELETE policy) — "delete" is a soft-delete via UPDATE deleted_at. A real
-- DSGVO hard-delete is a separate privileged flow (README §7).

alter table roadbooks enable row level security;
alter table routes    enable row level security;
alter table stops     enable row level security;
alter table photos    enable row level security;

-- ── roadbooks ────────────────────────────────────────────────────────────────
create policy roadbook_select on roadbooks
  for select using (
    deleted_at is null
    and (owner_id = auth.uid() or auth.uid() = any (shared_with))
  );

create policy roadbook_insert on roadbooks
  for insert with check (owner_id = auth.uid());

create policy roadbook_update on roadbooks
  for update using (owner_id = auth.uid())
              with check (owner_id = auth.uid());

-- ── routes (via roadbook) ────────────────────────────────────────────────────
create policy route_select on routes
  for select using (
    deleted_at is null
    and exists (
      select 1 from roadbooks rb
      where rb.id = routes.roadbook_id
        and rb.deleted_at is null
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy route_insert on routes
  for insert with check (
    exists (
      select 1 from roadbooks rb
      where rb.id = roadbook_id
        and rb.deleted_at is null
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy route_update on routes
  for update using (
    exists (
      select 1 from roadbooks rb
      where rb.id = routes.roadbook_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  ) with check (
    exists (
      select 1 from roadbooks rb
      where rb.id = roadbook_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

-- ── stops (via route -> roadbook) ────────────────────────────────────────────
create policy stop_select on stops
  for select using (
    deleted_at is null
    and exists (
      select 1 from routes rt
      join roadbooks rb on rb.id = rt.roadbook_id
      where rt.id = stops.route_id
        and rt.deleted_at is null
        and rb.deleted_at is null
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy stop_insert on stops
  for insert with check (
    exists (
      select 1 from routes rt
      join roadbooks rb on rb.id = rt.roadbook_id
      where rt.id = route_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy stop_update on stops
  for update using (
    exists (
      select 1 from routes rt
      join roadbooks rb on rb.id = rt.roadbook_id
      where rt.id = stops.route_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  ) with check (
    exists (
      select 1 from routes rt
      join roadbooks rb on rb.id = rt.roadbook_id
      where rt.id = route_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

-- ── photos (via stop -> route -> roadbook) ───────────────────────────────────
create policy photo_select on photos
  for select using (
    deleted_at is null
    and exists (
      select 1 from stops st
      join routes rt on rt.id = st.route_id
      join roadbooks rb on rb.id = rt.roadbook_id
      where st.id = photos.stop_id
        and st.deleted_at is null
        and rt.deleted_at is null
        and rb.deleted_at is null
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy photo_insert on photos
  for insert with check (
    exists (
      select 1 from stops st
      join routes rt on rt.id = st.route_id
      join roadbooks rb on rb.id = rt.roadbook_id
      where st.id = stop_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );

create policy photo_update on photos
  for update using (
    exists (
      select 1 from stops st
      join routes rt on rt.id = st.route_id
      join roadbooks rb on rb.id = rt.roadbook_id
      where st.id = photos.stop_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  ) with check (
    exists (
      select 1 from stops st
      join routes rt on rt.id = st.route_id
      join roadbooks rb on rb.id = rt.roadbook_id
      where st.id = stop_id
        and (rb.owner_id = auth.uid() or auth.uid() = any (rb.shared_with))
    )
  );
