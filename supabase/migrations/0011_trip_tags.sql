-- 0011 — Free-form tags on trips (PROGRESS "Zukunfts-Features": Tag-System).
--
-- Grouping of many trips runs via TAGS, not via a parent container (decision in
-- PROGRESS "Begriffe & Datenmodell", modeled after Furkot). The vehicle is a
-- tag too (e.g. "Dethleffs") -> filter "alle Reisen mit dem Dethleffs".
-- Postgres stores a real text[]; the local SQLite mirrors it as JSON text
-- (same pattern as shared_with).

alter table trips add column if not exists tags text[] not null default '{}';
