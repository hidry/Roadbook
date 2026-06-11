-- 0008 — New stop type "verentsorgung" (README §8.1 Tier 1: Ver-/Entsorgung).
--
-- A supply/disposal station (fresh water, grey/black water) is a stop kind
-- camper apps need but generic map apps lack. Only the CHECK constraint
-- changes; the column stays text. The local SQLite schema has no CHECK on
-- stops.type, so no on-device schema bump is needed.
--
-- The constraint from 0001 was unnamed, so PostgreSQL auto-named it
-- `stops_type_check`.

alter table stops drop constraint if exists stops_type_check;
alter table stops add constraint stops_type_check
  check (type in ('campingplatz', 'stellplatz', 'freistehend', 'verentsorgung'));
