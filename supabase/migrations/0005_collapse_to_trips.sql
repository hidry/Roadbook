-- 0005 — Collapse the route level into the trip; rename roadbooks -> trips.
--
-- Model change (PROGRESS P8): "Roadbook" is the APP name (the collection of road
-- trips), not a data object. The top-level entity is now a TRIP (UI: "Reise").
-- Stops hang DIRECTLY off a trip; the intermediate `routes` table is removed.
-- This makes the model 2-level (Trip -> Stops -> Photos), the industry norm
-- (Polarsteps/Furkot/Roadie).
--
-- DESTRUCTIVE: there is no relevant production data yet, so stop/photo rows are
-- dropped rather than back-filled. Trips (formerly roadbooks) are preserved.

-- 1) Drop the old policies first (they reference the `routes`/`roadbooks` names).
drop policy if exists photo_select on photos;
drop policy if exists photo_insert on photos;
drop policy if exists photo_update on photos;
drop policy if exists stop_select on stops;
drop policy if exists stop_insert on stops;
drop policy if exists stop_update on stops;
drop policy if exists route_select on routes;
drop policy if exists route_insert on routes;
drop policy if exists route_update on routes;
drop policy if exists roadbook_select on roadbooks;
drop policy if exists roadbook_insert on roadbooks;
drop policy if exists roadbook_update on roadbooks;

-- 2) Drop child data (no backfill from the removed route level).
delete from photos;
delete from stops;

-- 3) Rename roadbooks -> trips; add the trip start date (was route.start_date).
alter table roadbooks rename to trips;
alter table trips add column if not exists start_date text;
alter index if exists idx_roadbooks_owner rename to idx_trips_owner;
alter index if exists idx_roadbooks_updated rename to idx_trips_updated;

-- 4) Re-point stops from routes to trips, then drop the routes table.
alter table stops drop constraint if exists stops_route_id_fkey;
alter table stops rename column route_id to trip_id;
alter table stops add constraint stops_trip_id_fkey
  foreign key (trip_id) references trips (id) on delete cascade;
drop index if exists idx_stops_route;
create index if not exists idx_stops_trip on stops (trip_id, position);

drop table if exists routes;

-- 5) Recreate RLS — 3 tables, EXISTS chains shortened to stop -> trip.
create policy trip_select on trips
  for select using (
    deleted_at is null
    and (owner_id = auth.uid() or auth.uid() = any (shared_with))
  );
create policy trip_insert on trips
  for insert with check (owner_id = auth.uid());
create policy trip_update on trips
  for update using (owner_id = auth.uid())
              with check (owner_id = auth.uid());

create policy stop_select on stops
  for select using (
    deleted_at is null
    and exists (
      select 1 from trips t
      where t.id = stops.trip_id
        and t.deleted_at is null
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy stop_insert on stops
  for insert with check (
    exists (
      select 1 from trips t
      where t.id = trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy stop_update on stops
  for update using (
    exists (
      select 1 from trips t
      where t.id = stops.trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  ) with check (
    exists (
      select 1 from trips t
      where t.id = trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );

create policy photo_select on photos
  for select using (
    deleted_at is null
    and exists (
      select 1 from stops st
      join trips t on t.id = st.trip_id
      where st.id = photos.stop_id
        and st.deleted_at is null
        and t.deleted_at is null
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy photo_insert on photos
  for insert with check (
    exists (
      select 1 from stops st
      join trips t on t.id = st.trip_id
      where st.id = stop_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy photo_update on photos
  for update using (
    exists (
      select 1 from stops st
      join trips t on t.id = st.trip_id
      where st.id = photos.stop_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  ) with check (
    exists (
      select 1 from stops st
      join trips t on t.id = st.trip_id
      where st.id = stop_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
