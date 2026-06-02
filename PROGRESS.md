# Roadbook MVP — Fortschritt

> Tracking-Datei für die MVP-Umsetzung (README §8). Nach jeder Phase abhaken +
> committen + pushen auf `claude/plane-project-mvp-6I6WO`.
> Status-Legende: ⬜ offen · 🔄 in Arbeit · ✅ fertig

**Umgebung:** Expo SDK 56 (README nannte SDK 55; Registry serviert 56 stabil) ·
TypeScript strict · Supabase (lokal/Cloud später) · Bilder via Cloudflare R2.
Kein Mobilgerät/Cloud-Backend in der Build-Umgebung → verifiziert werden hier
Typecheck, Jest-Unit-Tests und (lokal/CI) RLS-Tests. Gerätelauf/EAS/Cloud später.

---

## Phasen

### P0 — Setup ✅
- [x] Expo-Router-Scaffold (SDK 56, TS) in Repo-Root, README erhalten
- [x] package.json (Name, Deps, Test-Scripts), app.json (Permissions/Plugins)
- [x] tooling: jest + ts-jest, eslint (expo lint), .env.example
- [x] Ordnerstruktur (src/lib, src/app, __tests__)
- [ ] Supabase `config.toml` → P2
- [ ] CI-Grundgerüst (.github/workflows/ci.yml) → P2
- [x] Baseline-Install + `tsc --noEmit` grün + `jest` grün + `expo lint` grün

### P1 — Auth (E-Mail + Passwort) ✅
- [x] `src/lib/supabase.ts` (env-config, AsyncStorage-Session)
- [x] `AuthProvider` + Session-Gate (Route-Gruppen (auth)/(app))
- [x] Screens: login, sign-up
- [x] SQLite-DB-Init beim Start (Root-Layout)
- [x] Checkpoint: registrieren & einloggen (Code/Typen, Gerätelauf später)

### P2 — Schema + RLS ✅ (Code) / ⏳ (Live-Run via CI)
- [x] Migration `0001_init.sql` (Tabellen + SyncBase + Indizes, Client-UUID PK, Text-ISO-Timestamps)
- [x] Migration `0002_rls.sql` (USING + WITH CHECK + deleted_at-Filter, Child via EXISTS, kein Hard-DELETE)
- [x] Lokales SQLite-Schema (spiegelt SyncBase)
- [x] mappers (snake_case ↔ camelCase) + Unit-Tests
- [x] repositories (offline-first writes) für roadbook/route/stop/photo
- [x] `scripts/rls-test.ts` (2-User-Isolation, 9 Checks) + CI-Job (`.github/workflows/ci.yml`)
- [x] Supabase `config.toml` (via `supabase init`)
- [⏳] Checkpoint: isolierte Daten per Test belegt — läuft in CI (lokaler Docker-Image-Pull
      ist in der Build-Umgebung durch die Netzwerk-Policy blockiert; GitHub Actions zieht die Images)

### P3 — CRUD-UI ✅
- [x] Roadbook-Liste + anlegen/soft-delete (long-press)
- [x] Routen pro Roadbook
- [x] Stops: anlegen/edit (Typ/Rolle/Datum/Notiz/Koordinaten)/soft-delete
- [x] `syncEngine` push/pull (last-write-wins via updatedAt) + Background-Sync-Hook

### P4 — Kartenansicht ✅
- [x] MapLibre-Wrapper (`components/MapView.tsx`), Style-URL via env (PMTiles-ready)
- [x] Stops als Marker + Routenlinie (GeoJSON)

### P5 — Foto-Import & Routenvorschlag ✅ (Logik) / 🔄 (Edge Function)
- [x] picker + EXIF (`getAssetInfoAsync`, ACCESS_MEDIA_LOCATION)
- [x] `clustering.ts` (Place→Visit→Stop: Orts-Cluster, Übernachtung via Nachtlücke, Ausflüge angehängt; s. `docs/stop-detection-spec.md`) — PURE + Unit-Tests
- [x] `suggestion.ts` (start/stops/end, Wiederkehr/`visitIndex`, Ausflugs-Anhang, GPS-lose Fallback) — PURE + Unit-Tests
- [x] reverse-geocoding (Nominatim dev, throttled + Timeout/Retry/Diagnose, `EXPO_PUBLIC_GEOCODER_URL`) + Unit-Tests
- [x] `compress.ts` (max 1920px) + `r2upload.ts` (presigned PUT)
- [x] Edge Function `r2-presign` (SigV4-presigned PUT, user-scoped key, R2-Keys serverseitig)
- [x] Editier-UI für den Vorschlag → speichern (`import.tsx`)

### P6 — Politur ✅
- [x] Dev-Setup-Doku (`DEVELOPMENT.md`: Supabase CLI, R2, env, EAS, Gates)
- [x] `eas.json` (development/preview/production Build-Profile)
- [x] typecheck + lint + jest grün (App-Code)

---

## Stand
MVP-Code vollständig umgesetzt (P0–P6). Headless verifiziert: `npm run typecheck`,
`npm test` (25 Tests), `npm run lint` — alle grün. RLS-Isolationsbeweis läuft in CI.
**Offen für echten Betrieb (außerhalb dieser Umgebung):** Supabase-Cloud/EAS-Build,
R2-Bucket + Secrets, Gerätelauf (Picker/EXIF/MapLibre), Map-Tiles (PMTiles).

---

## Nicht im MVP (README §8/§8.1)
Payment/Abo · Sharing-UI · Store-Submission · DSGVO-Volltexte · volle Sync-Engine
(PowerSync/WatermelonDB) · §8.1-Backlog. Schema ist für Sharing & Offline-Sync
bereits vorbereitet.

## Hinweise für die Fortsetzung nach Pause
- Branch: `claude/plane-project-mvp-6I6WO`
- Was läuft headless: `npm run typecheck`, `npm test`, lokal `npx supabase start` + RLS-Test.
- Was NICHT hier testbar: Gerätelauf (Picker/EXIF/MapLibre), echter R2-Upload, EAS-Build, Supabase-Cloud → brauchen Secrets/Gerät.
