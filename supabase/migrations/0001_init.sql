-- Roadbook schema — Multi-Tenant from day one (README §5).
--
-- Design notes:
-- * Primary keys are CLIENT-generated UUIDs (README §5.4/§9) — no serial — so
--   records created offline have a stable id before reaching the backend. We do
--   NOT default-generate them server-side; the client always supplies the id.
-- * Timestamps and dates are stored as TEXT holding the client's exact ISO 8601
--   strings. This keeps the offline-first sync byte-identical in both directions
--   and makes last-write-wins (string compare of UTC "...Z" timestamps) correct
--   without timezone/format drift between SQLite and Postgres.
-- * Every table carries the SyncBase columns (created_at, updated_at,
--   deleted_at) for offline-readiness. "Delete" is a soft-delete (tombstone).

create table if not exists roadbooks (
  id          uuid primary key,
  created_at  text not null,
  updated_at  text not null,
  deleted_at  text,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  shared_with uuid[] not null default '{}',
  name        text not null
);

create table if not exists routes (
  id          uuid primary key,
  created_at  text not null,
  updated_at  text not null,
  deleted_at  text,
  roadbook_id uuid not null references roadbooks (id) on delete cascade,
  title       text not null,
  start_date  text
);

create table if not exists stops (
  id           uuid primary key,
  created_at   text not null,
  updated_at   text not null,
  deleted_at   text,
  route_id     uuid not null references routes (id) on delete cascade,
  position     integer not null,
  role         text not null check (role in ('start', 'stop', 'end')),
  type         text check (type in ('campingplatz', 'stellplatz', 'freistehend')),
  name         text not null,
  lat          double precision not null,
  lng          double precision not null,
  arrival_date text,
  notes        text
);

create table if not exists photos (
  id            uuid primary key,
  created_at    text not null,
  updated_at    text not null,
  deleted_at    text,
  stop_id       uuid not null references stops (id) on delete cascade,
  local_uri     text,
  storage_url   text,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'uploaded', 'failed')),
  taken_at      text,
  lat           double precision,
  lng           double precision
);

-- Indexes for the common access paths + sync delta queries (updated_at).
create index if not exists idx_routes_roadbook on routes (roadbook_id);
create index if not exists idx_stops_route on stops (route_id, position);
create index if not exists idx_photos_stop on photos (stop_id);
create index if not exists idx_roadbooks_owner on roadbooks (owner_id);
create index if not exists idx_roadbooks_updated on roadbooks (updated_at);
create index if not exists idx_routes_updated on routes (updated_at);
create index if not exists idx_stops_updated on stops (updated_at);
create index if not exists idx_photos_updated on photos (updated_at);
