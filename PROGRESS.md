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

### P7 — Sync-Härtung & Crash-Diagnose ✅
- [x] `syncEngine` komplett überarbeitet:
  - `resolveUid()`: JWT-Payload dekodieren (nur für Logging), Token-Ablauf + Force-Refresh, `uid vs. jwtSub`-Mismatch-Logging
  - INSERT-first statt UPSERT: kein `ON CONFLICT DO UPDATE`, um PostgreSQL-15-Verhalten zu umgehen (UPDATE USING wird auch für neue Zeilen evaluiert → 42501 bei neuen Rows)
  - Per-Row-Fallback bei Batch-42501 (RLS) oder 23505 (Duplikat): gute Rows kommen durch, eine fehlerhafte blockiert nicht die gesamte Tabelle
  - Owner-ID-Filter + Logging für Roadbooks: Rows mit `owner_id ≠ auth_uid` werden gefiltert und protokolliert
- [x] `repairOwnership(userId)`: setzt falsche `owner_id` auf aktuellen User + markiert `pending_sync = 1`
- [x] Migration `0003_debug_auth.sql`: `debug_auth()`-RPC → liefert `uid`, `role`, `has_claims` direkt aus PostgreSQL (Diagnose, ob PostgREST den JWT korrekt verarbeitet)
- [x] Migration `0004_fix_route_insert_rls.sql`: `route_insert`-Policy entfernt `rb.deleted_at IS NULL`-Guard, der Tombstone-Routes soft-gelöschter Roadbooks am Sync gehindert hat
- [x] Menu-Screen (`src/app/(app)/menu.tsx`): Sync jetzt · Auth-Diagnose · Token erneuern · owner_id reparieren · Pending-Count-Anzeige · Diagnose-Log (Teilen/Löschen)
- [x] Globales Exception-Handling: `ErrorBoundary`-Klassen-Komponente (React-Render-Fehler → `appendLog('RENDER:CRASH')`) + `ErrorUtils.setGlobalHandler` im Root-Layout (unkontrollierte JS-Exceptions → `appendLog('JS:CRASH')`) — beide landen im Menu-Diagnose-Log

### P8 — Cross-Device-Fotos & reale Inbetriebnahme 🔄 (geplant)
> Ausgangslage: R2-Upload + Metadaten-Sync sind im Code vorhanden, aber nie auf
> echtem Gerät verifiziert — und Fotos erscheinen auf einem **zweiten** Gerät
> (gleicher Account) noch NICHT, weil die Anzeige den gerätelokalen Pfad bevorzugt.

**8a — Fotos cross-device verfügbar machen**
- [ ] `local_uri` vom Sync ausschließen — gerätelokaler Pfad gehört nicht in die
      DB/Backend (in `syncEngine.ts` `toRemote()` strippen, analog `pending_sync`)
- [ ] Anzeige-Fallback korrigieren: lokale Datei nur nutzen, wenn sie **auf diesem
      Gerät existiert**, sonst `storageUrl` (`stop/[id].tsx:133`/`:174` — heute
      `localUri ?? storageUrl`, greift auf Gerät B den toten Pfad ab)
- [ ] R2-Download + lokales Caching (sonst lädt Gerät B bei jedem Render neu und
      hat offline kein Bild)
- [ ] Upload-Retry für `upload_status = 'failed'` (heute best-effort beim Import,
      kein Wiederholmechanismus) — z.B. im Background-Sync-Hook mit aufräumen
- [ ] Verifikation auf echtem Gerät (R2-Bucket + Secrets nötig)

**8b — Reale Inbetriebnahme** (bisher der größte offene Block, s. „Stand“)
- [ ] Supabase-Cloud-Projekt + Migrations 0001–0004 einspielen (`supabase db push`)
- [ ] R2-Bucket + Secrets (Edge-Function-Env: Account, Bucket, Keys)
- [ ] EAS-Dev-Build (Custom Dev Client für expo-sqlite/MapLibre)
- [ ] Gerätelauf-Verifikation: Picker/EXIF (ACCESS_MEDIA_LOCATION), MapLibre-Tiles,
      Auth, Sync, Foto-Upload end-to-end + Zwei-Geräte-Test (8a)

---

## Offene Design-Entscheidung: Was ist ein „Roadbook“?
Aktuell legt der Nutzer Roadbooks **pro Fahrzeug** an (Sunlight, Dethleffs). Das
skaliert schlecht (alle Reisen eines Autos landen in einem Roadbook).
- **Empfehlung:** Roadbook = **eine Reise** (z.B. „Norwegen 2025“) — deckt sich mit
  dem Standard ähnlicher Apps (Polarsteps: mehrere „Trips“ pro Konto, je Reise eine
  Route + Steps + Fotos + Zeitraum). Das vorhandene Schema
  (`User → viele Roadbooks → Route → Stops → Photos`, `route.startDate`) trägt das
  bereits.
- **Fahrzeug** dann als optionales Attribut/Tag am Roadbook (oder später eigene
  `vehicles`-Tabelle mit FK), um „alle Reisen mit dem Dethleffs“ filtern zu können.
- „Ein Roadbook pro User“ wird **nicht** empfohlen (verliert die Trennung der Reisen).
- Status: **noch nicht entschieden / nicht umgesetzt** — bewusst offen gehalten.

---

## Stand
MVP-Code vollständig umgesetzt (P0–P7). Headless verifiziert: `npm run typecheck`,
`npm test` (25 Tests), `npm run lint` — alle grün. RLS-Isolationsbeweis läuft in CI.
Sync-Engine gehärtet (P7): JWT-Diagnose, INSERT-first-Strategie, per-Row-Fallback,
Tombstone-RLS-Fix, globales Crash-Logging.
**Offen für echten Betrieb (außerhalb dieser Umgebung):** Supabase-Cloud/EAS-Build,
R2-Bucket + Secrets, Gerätelauf (Picker/EXIF/MapLibre), Map-Tiles (PMTiles).
**Migrations 0003 + 0004** müssen im Cloud-Projekt einmalig eingespielt werden
(via `supabase db push` oder Supabase SQL-Editor).

---

## Nicht im MVP (README §8/§8.1)
Payment/Abo · Sharing-UI · Store-Submission · DSGVO-Volltexte · volle Sync-Engine
(PowerSync/WatermelonDB) · §8.1-Backlog. Schema ist für Sharing & Offline-Sync
bereits vorbereitet.

## Hinweise für die Fortsetzung nach Pause
- Branch: `claude/app-ui-data-persistence-e96qb`
- Was läuft headless: `npm run typecheck`, `npm test`, lokal `npx supabase start` + RLS-Test.
- Was NICHT hier testbar: Gerätelauf (Picker/EXIF/MapLibre), echter R2-Upload, EAS-Build, Supabase-Cloud → brauchen Secrets/Gerät.
- Migrations 0003 + 0004 nach jedem `supabase db push` automatisch eingespielt; für manuelle Cloud-Setups einmalig via SQL-Editor.
