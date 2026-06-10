-- 0010 — Track persistence (README §8.1 "internes Routenmodell" / PROGRESS P16).
--
-- A track is the real driven path of a trip (imported from GPX/KML; later
-- Google Timeline). With tracks the map draws the actual route instead of
-- straight lines between stops, and the Diashow camera can follow the road.
--
-- `points` is TEXT holding the JSON array of track points
-- ({lat, lng, time|null, ele|null}) — same column type on both sides, so the
-- sync engine moves it byte-identically without conversion (the app parses it
-- in mappers.ts). Tracks follow every SyncBase rule: client UUID, soft-delete,
-- text ISO timestamps.

create table if not exists tracks (
  id          uuid primary key,
  created_at  text not null,
  updated_at  text not null,
  deleted_at  text,
  trip_id     uuid not null references trips (id) on delete cascade,
  name        text,
  points      text not null default '[]'
);

create index if not exists idx_tracks_trip on tracks (trip_id);
create index if not exists idx_tracks_updated on tracks (updated_at);

-- RLS — same access chain as stops (trip owner or shared_with; README §5.2).
alter table tracks enable row level security;

create policy track_select on tracks
  for select using (
    deleted_at is null
    and exists (
      select 1 from trips t
      where t.id = tracks.trip_id
        and t.deleted_at is null
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy track_insert on tracks
  for insert with check (
    exists (
      select 1 from trips t
      where t.id = trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );
create policy track_update on tracks
  for update using (
    exists (
      select 1 from trips t
      where t.id = tracks.trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  ) with check (
    exists (
      select 1 from trips t
      where t.id = trip_id
        and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
    )
  );

-- Extend the tombstone pull channel (0006) by the new table — same contract.
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

  union all

  select 'tracks'::text, tr.id, tr.deleted_at, tr.updated_at
    from tracks tr
    join trips t on t.id = tr.trip_id
   where tr.deleted_at is not null
     and tr.updated_at > since
     and (t.owner_id = auth.uid() or auth.uid() = any (t.shared_with))
$$;
