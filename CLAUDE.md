# CLAUDE.md

Guidance for working in this repo. Details live in [`README.md`](./README.md)
(project plan / architecture rationale), [`DEVELOPMENT.md`](./DEVELOPMENT.md)
(setup), and [`PROGRESS.md`](./PROGRESS.md) (status).

Roadbook is an Expo (React Native) + TypeScript app: a multi-tenant roadbook for
camper trips whose USP is reconstructing an editable route from photo EXIF
GPS/time metadata. Backend is Supabase (Auth + Postgres/RLS); photos go to
Cloudflare R2.

## Commands
```bash
npm run typecheck   # tsc for app + scripts/ (must stay green)
npm test            # Jest unit tests for the pure logic
npm run lint        # expo lint
npm run dev:up      # boot local Supabase (Docker) + write .env  (idempotent)
npm run dev:down    # stop it  (-- --reset wipes local data)
npm run rls:test    # 2-user RLS tenant-isolation proof vs local Supabase
npm run e2e:web:local  # web E2E: export web + Playwright (needs dev:up + chromium)
npx expo start      # run the app (needs a custom dev client, see below)
```
CI (`.github/workflows/`): `ci.yml` (typecheck + test + lint + RLS proof),
`e2e-web.yml` (Playwright web E2E) and `e2e-android.yml` (Maestro smoke on an
Android emulator) — these run on PRs and on push to `main` only (no double runs
on PR branches) + `workflow_dispatch`. To save runner minutes: each has a
`concurrency` group that cancels superseded PR runs, and a `changes`
(paths-filter) job that gates the heavy work on PRs — the E2E jobs skip when no
app/native files changed, and `ci.yml`'s Supabase RLS job skips when no DB code
changed (a skipped job reports "passing", so required checks aren't blocked).
Plus two ops pipelines: `supabase-migrate.yml`
(`supabase db push` of the cloud migrations) and two manual (`workflow_dispatch`)
Android build pipelines: `eas-build-android.yml` (CLOUD EAS build — uses the
limited free build quota) and `eas-build-android-runner.yml` (compiles on the
GitHub runner via `eas build --local` — installable APK artifact, NO cloud
quota). See DEVELOPMENT.md "Tests & CI" / "Aufs Gerät bringen". Keep them green.

## Architecture & conventions
- **Offline-first**: every write goes to local SQLite FIRST (the on-device
  Source of Truth); the sync engine (`src/lib/sync/`) pushes to Supabase later.
  Don't write straight to Supabase from the UI.
- **All tables extend `SyncBase`** (`src/types/models.ts`): client-generated UUID
  PK (never serial), `createdAt`/`updatedAt`, `deletedAt`. **"Delete" = soft-delete**
  (set `deletedAt`); no hard DELETE in normal flow.
- **Naming**: DB columns are `snake_case`, TS fields are `camelCase`. Convert in
  `src/lib/db/mappers.ts` — keep that the single mapping point.
- **Multi-tenant from day one**: RLS in `supabase/migrations/0002_rls.sql`. Every
  SELECT policy filters `deleted_at IS NULL`; every INSERT/UPDATE has `WITH CHECK`.
  Changing this is a One-Way-Door — be deliberate.
- **Images only to R2** (never Supabase Storage). The app gets a presigned PUT
  from the `r2-presign` Edge Function; R2 keys stay server-side.
- **Pure logic stays RN-free**: `src/lib/photos/{clustering,suggestion,exif-date}.ts`
  and `mappers.ts`/`geocoding` import no React Native, so Jest can test them
  headlessly. Keep new pure logic free of RN imports and add tests in `__tests__/`.
- **Routing**: Expo Router, file-based under `src/app/`. `(auth)` = logged-out,
  `(app)` = logged-in; gating is in the group `_layout.tsx` files.

## Gotchas
- **MapLibre & expo-sqlite are native modules** → need a custom dev client / EAS
  build; they do NOT run in Expo Go.
- **Android GPS from photos** needs `ACCESS_MEDIA_LOCATION` (declared in
  `app.json`, requested at runtime) — otherwise EXIF location is empty.
- **Schema changes**: add a new file in `supabase/migrations/` (additive,
  versioned). The local SQLite schema (`src/lib/db/schema.ts`) mirrors it.
- **Expo SDK 56** is used (README §3 mentions 55; the registry now ships 56 stable).
- New migrations must also be reflected in the SQLite schema and `mappers.ts`.

## Scope
MVP = §8 of the README (Auth, CRUD+RLS, photo→route, R2 upload, map). Out of MVP:
payment, sharing UI, store submission, DSGVO full texts, the §8.1 backlog, and the
full managed sync engine (schema is already prepared for it).
