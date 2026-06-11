-- 0012 — Explicit table grants (CI: "permission denied for table trips").
--
-- Newer Supabase local stacks no longer guarantee the legacy default
-- privileges (GRANT ALL ... TO anon, authenticated) for tables created in
-- migrations. Result: the data tables had RLS policies but NO base grants, so
-- every request failed with a table-level permission error before RLS even
-- ran (first seen in CI 2026-06-11 after the runner pulled a new CLI).
--
-- Grant exactly what the app needs — RLS still scopes the rows:
--   * authenticated: SELECT/INSERT/UPDATE. Deliberately NO DELETE — "delete"
--     is a soft-delete via UPDATE (§5.4); hard deletes stay privileged flows.
--   * service_role: everything (GC, admin tooling; bypasses RLS anyway).
--   * anon: NOTHING on data tables (the app always talks authenticated).
-- Idempotent: re-granting existing privileges is a no-op on older stacks.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update on table trips, stops, photos, tracks to authenticated;
grant all on table trips, stops, photos, tracks to service_role;

-- Tables created by FUTURE migrations (same migration role) inherit these.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
