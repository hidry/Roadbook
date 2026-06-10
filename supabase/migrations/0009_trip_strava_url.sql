-- 0009 — Strava as a link (README §8.1 Tier 1, "Strava als Link").
--
-- Deliberately just a string field on the trip: ToS-safe (no Strava API use),
-- zero coupling. A Strava share link / QR also exposes private activities in a
-- targeted way. A full API integration was rejected (README §8.1 "Verworfen").

alter table trips add column if not exists strava_url text;
