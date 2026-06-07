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

### P8 — Datenmodell vereinfachen + Umbenennung (`roadbook`→`trip`, Route-Ebene weg) ✅ (Code) / ⏳ (RLS-Proof via CI)
> **Namens-Entscheidung (s.u.):** „Roadbook“ ist der **App-Name** (die Sammlung von
> Straßenreisen), kein Daten-Objekt. Das Top-Level-Objekt heißt **Trip** (UI: „Reise“).
> Die heutige Tabelle `roadbooks` wird zu **`trips`** umbenannt. Stops hängen direkt
> am Trip; die Zwischen-Ebene `routes` entfällt (Branchenstandard 2-stufig:
> Reise → Stops, vgl. Polarsteps/Furkot/Roadie). **Keine relevanten Echtdaten →
> Migration darf destruktiv sein und Alt-Daten löschen** (einfachster Weg).
>
> Zielmodell: `User → viele Trips (= Reise) → Stops → Photos`.
> Code/DB-Begriff = `trip`/`trips` (engl., wie `stops`/`photos`); UI-Text = „Reise“.

- [x] Neue Migration `0005_collapse_to_trips.sql` (destruktiv ok):
  - Tabelle `roadbooks` → **`trips`** umbenennen; `start_date` ergänzen
    (`trip.name` ersetzt das frühere `route.title`)
  - `routes`-Tabelle entfernen
  - `stops.route_id` → `stops.trip_id` (FK auf `trips`, `on delete cascade`),
    analog `idx`-Namen
  - Alt-Daten in `stops/photos` löschen (kein Backfill nötig)
- [x] RLS neu fassen (`0002_rls.sql` ist Basis): Policies `roadbook_*`→`trip_*`,
    `route_*` löschen; `stop_*`/`photo_*` EXISTS-Ketten auf `stops.trip_id → trips`
    verkürzen (Join über `routes` raus). Migration 0004 (route_insert-Fix) wird obsolet.
- [x] SQLite-Schema (`src/lib/db/schema.ts`): `roadbooks`→`trips`, `routes` raus,
    `stops.route_id`→`trip_id`, Indizes anpassen. SQLite lokal droppen & neu anlegen
    (keine Echtdaten) — Schema-Reset beim Start.
- [x] Typen/Mapper (`models.ts`): `Roadbook`→**`Trip`** (+ `startDate`),
    `Route` + `EntityType 'routes'` raus; `EntityType 'roadbooks'`→`'trips'`;
    `Stop.routeId`→`tripId`; `mappers.ts` (snake↔camel) nachziehen.
- [x] Repositories (`repositories.ts`): `roadbookRepo`→`tripRepo`, `routeRepo`
    entfernen, `stopRepo.create` auf `tripId`; Foto-Import (`import.tsx`) erzeugt
    Stops direkt am Trip (kein Default-Route-Anlegen mehr).
- [x] Sync-Engine (`syncEngine.ts`): `TABLES` = `['trips','stops','photos']`;
    Owner-ID-Filter/`repairOwnership` von `roadbooks` auf `trips` umstellen.
- [x] UI: `app/(app)/roadbook/[id].tsx` → `trip/[id].tsx` (zeigt direkt die Stops),
    `route/[id].tsx` auflösen, Liste/Karte/Menu auf `tripId` + Label „Reise(n)“.
- [x] RLS-Test (`scripts/rls-test.ts`) auf 3 Tabellen/`trips` anpassen;
    `npm run typecheck` + `npm test` + RLS-Proof grün.
- [x] Doku: README §5-Datenmodell + CLAUDE.md (Beispiele nennen `route`/`roadbook`)
    auf `Trip`/2-stufig aktualisieren; „Roadbook = App-Name“ festhalten.

### P9 — Cross-Device-Fotos & reale Inbetriebnahme ✅ (Code) / 🔄 (Zwei-Geräte-Test offen)
> R2-Upload auf echtem Gerät verifiziert (49/49 hochgeladen, Bucket gefüllt,
> `storage_url` zurücksynchronisiert). Cross-Device-Anzeige im Code gelöst;
> finaler Zwei-Geräte-Test steht noch aus.

**9a — Fotos cross-device verfügbar machen** ✅
- [x] Upload in den Sync verlegt (Supabase-Metadaten zuerst, dann R2) — **ein**
      Upload-Pfad, der zugleich als **Retry** für `pending`/`failed` dient
      (`syncEngine.pushPhotoUploads`); Sync-Mutex gegen parallele Läufe
- [x] R2-PUT-Bug gefixt: `FileSystem.uploadAsync` (BINARY_CONTENT) statt
      `fetch(blob)` — RN kann aus einer `file://`-URI keinen Blob bauen
- [x] `local_uri` als gerätelokal behandelt: weder pushen noch pullen
      (`toRemote`/`toLocal`) → Gerät B fällt auf `storage_url` zurück
- [x] Anzeige nutzt `localUri ?? storageUrl`; `expo-image` cached die R2-URL
      (Memory+Disk) → kein erneuter Download je Render, offline nach 1. Laden
- [x] Verifikation Upload auf echtem Gerät (49/49 OK)
- [ ] Zwei-Geräte-Test: Foto auf Gerät B sichtbar (braucht öffentl. R2-Lesezugriff
      via `R2_PUBLIC_BASE_URL` + neuen Build mit 9a)

**9b — Reale Inbetriebnahme** ✅
- [x] Supabase-Cloud: Migrations bis 0005 eingespielt
- [x] R2-Bucket (Cloudflare) + API-Token (Object Read & Write) + Public-URL
- [x] R2-Secrets in der Edge Function gesetzt
- [x] Edge Function `r2-presign` deployt (+ CI-Workflow `supabase-functions.yml`)
- [x] Installierbares APK via Runner-Build (`eas build --local`, Profil preview)
- [x] Gerätelauf: Picker/EXIF, Auth, Sync, Foto-Upload end-to-end ✓
- [ ] offen: MapLibre-Tiles (PMTiles), Zwei-Geräte-Test

---

## Begriffe & Datenmodell ✅ ENTSCHIEDEN
**„Roadbook“ ist der App-Name** — die Sammlung von Straßenreisen, **kein**
Daten-Objekt. Das Top-Level-Objekt ist der **Trip** (UI: „Reise“). Verbindliche
Terminologie, um künftige Verwirrung zu vermeiden:

| Ebene | Code/DB | UI (deutsch) |
|------|---------|--------------|
| App / Sammlung | — („Roadbook“ = Produktname) | Roadbook |
| Top-Level-Objekt | `trip` / `trips` | Reise |
| Station | `stop` / `stops` | Stopp |
| Foto | `photo` / `photos` | Foto |

Modell: `User → viele Trips → Stops → Photos` (2-stufig, ohne `routes`).
- Begründung: Branchenstandard ist 2-stufig (Reise → Stations). Recherche:
  Polarsteps (Trip → Steps), Furkot (Trip → Stops, Routenlinie implizit), Roadie
  (Route → Stops). Keine dieser Apps hat eine erzwungene Zwischenebene; Gruppierung
  vieler Reisen läuft dort über **Tags / Suche**, nicht über einen Eltern-Container.
- Verworfen: „ein Trip pro User“ (verliert Reise-Trennung) und „Fahrzeug als
  Container-Ebene“ (erzwingt Pseudo-Navigationsebene).
- **Fahrzeug-/Tag-Gruppierung** kommt später als Feature (Tags am Trip, vgl.
  Furkot), nicht als Hierarchie — s. Backlog unten.

---

## Stand
MVP-Code (P0–P7) + Datenmodell-Vereinfachung (P8) umgesetzt. Headless verifiziert:
`npm run typecheck`, `npm test` (71 Tests), `npm run lint` — alle grün.
RLS-Isolationsbeweis läuft in CI (lokal Docker durch Netzwerk-Policy blockiert).
Sync-Engine gehärtet (P7): JWT-Diagnose, INSERT-first-Strategie, per-Row-Fallback,
Tombstone-RLS-Fix, globales Crash-Logging.
P8: Modell auf 2-stufig (`Trip → Stop → Photo`), `roadbooks`/`routes` → `trips`,
Migration `0005`, lokaler SQLite-Schema-Reset (PRAGMA user_version = 2).
**Offen für echten Betrieb (außerhalb dieser Umgebung):** Supabase-Cloud/EAS-Build,
R2-Bucket + Secrets, Gerätelauf (Picker/EXIF/MapLibre), Map-Tiles (PMTiles).
**Migrations 0003 + 0004** sind im Cloud-Projekt bereits eingespielt. Migration
**0005** (P8) muss noch via `supabase db push` (oder SQL-Editor) eingespielt werden
— danach ist 0004 obsolet (Route-Policies entfallen).

---

## Nicht im MVP (README §8/§8.1)
Payment/Abo · Sharing-UI · Store-Submission · DSGVO-Volltexte · volle Sync-Engine
(PowerSync/WatermelonDB) · §8.1-Backlog. Schema ist für Sharing & Offline-Sync
bereits vorbereitet.

## Zukunfts-Features (nach P8/P9)
- **Tag-System für Reisen** (Backlog, nicht sofort): freie Tags an einem **Trip**,
  inkl. **Fahrzeug** als Tag (z.B. „Dethleffs“, „Sunlight“) → Filter „alle Reisen
  mit dem Dethleffs“. Vorbild Furkot (Tags statt Hierarchie). Ersetzt die früher
  angedachte Fahrzeug-Ebene.

## Hinweise für die Fortsetzung nach Pause
- Branch: `claude/app-ui-data-persistence-e96qb`
- Was läuft headless: `npm run typecheck`, `npm test`, lokal `npx supabase start` + RLS-Test.
- Was NICHT hier testbar: Gerätelauf (Picker/EXIF/MapLibre), echter R2-Upload, EAS-Build, Supabase-Cloud → brauchen Secrets/Gerät.
- Migrations 0003 + 0004 nach jedem `supabase db push` automatisch eingespielt; für manuelle Cloud-Setups einmalig via SQL-Editor.
