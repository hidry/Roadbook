# Roadbook MVP — Fortschritt

> Tracking-Datei für die MVP-Umsetzung (README §8) und die Post-MVP-Phasen.
> **Konvention: eine abgeschlossene Aufgabe = ein eigener Commit** (Code + Doku
> zusammen, keine Sammel-Commits) — nach jeder Phase hier abhaken, committen und
> auf den jeweiligen Arbeits-Branch pushen.
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

### P9 — Cross-Device-Fotos & reale Inbetriebnahme ✅
> R2-Upload auf echtem Gerät verifiziert (49/49 hochgeladen, Bucket gefüllt,
> `storage_url` zurücksynchronisiert). Zwei-Geräte-Test bestanden und
> Map-Tiles eingerichtet (2026-06) — P9 damit vollständig abgeschlossen.

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
- [x] Zwei-Geräte-Test: Foto auf Gerät B sichtbar ✓ (öffentl. R2-Lesezugriff via
      `R2_PUBLIC_BASE_URL` + Build mit 9a; Anzeige fällt auf `storage_url` zurück)

**9b — Reale Inbetriebnahme** ✅
- [x] Supabase-Cloud: Migrations bis 0005 eingespielt
- [x] R2-Bucket (Cloudflare) + API-Token (Object Read & Write) + Public-URL
- [x] R2-Secrets in der Edge Function gesetzt
- [x] Edge Function `r2-presign` deployt (+ CI-Workflow `supabase-functions.yml`)
- [x] Installierbares APK via Runner-Build (`eas build --local`, Profil preview)
- [x] Gerätelauf: Picker/EXIF, Auth, Sync, Foto-Upload end-to-end ✓
- [x] MapLibre-Tiles eingerichtet (Style-URL via env, PMTiles) ✓
- [x] Zwei-Geräte-Test bestanden ✓ (s. 9a)

### P10 — Tombstone-Sync: Löschungen propagieren auf andere Geräte ✅ (Code) / ⏳ (RLS-Proof via CI)
> Schließt das erste „Bekannte Limit" der MVP-Sync-Engine: Die SELECT-RLS filtert
> `deleted_at IS NULL`, daher sah `pullChanges` nie Tombstones — ein Soft-Delete
> blieb auf allen anderen Geräten liegen. Jetzt gibt es einen eigenen
> Lösch-Pull-Kanal.

- [x] Migration `0006_tombstone_pull.sql`: RPC `pull_tombstones(since)` —
      SECURITY DEFINER (umgeht den `deleted_at`-Filter), re-implementiert die
      Ownership-Checks der Policies selbst (owner/`shared_with` via Trip-Kette);
      liefert nur `tbl/id/deleted_at/updated_at`, keine Nutzdaten; EXECUTE nur
      für `authenticated`. Eltern-`deleted_at` wird bewusst NICHT gefiltert
      (Stop-Tombstone unter gelöschtem Trip muss ankommen).
- [x] `syncEngine.pullTombstones()`: eigener Wasserstand
      (`sync:lastTombstonePull`), wendet Löschungen per LWW an
      (`updated_at < remote` — eine NEUERE lokale Änderung überlebt), unbekannte
      Zeilen werden übersprungen; läuft in `syncNow` direkt nach `pullChanges`.
- [x] `src/lib/sync/tombstones.ts` (PURE, RN-frei): Gruppierung +
      Tabellen-Whitelist (`tbl` landet in SQL → Injection-Schutz) +
      Wasserstand-Berechnung; Unit-Tests in `__tests__/tombstones.test.ts`.
- [x] `scripts/rls-test.ts` um 4 Checks erweitert: A zieht eigenen
      Stop-Tombstone; B sieht A's Tombstones NICHT; `since`-Wasserstand filtert;
      Trip-Tombstone + Stop-Tombstone unter gelöschtem Trip kommen beide an.
- [⏳] RLS-Proof läuft in CI (lokal Docker durch Netzwerk-Policy blockiert);
      Migration 0006 geht beim Merge automatisch via `supabase-migrate.yml` live.

### P11 — R2-Lösch-Lebenszyklus (Garbage Collector) ✅ (Code) / ⏳ (Erstlauf nach Merge)
> README §7: Soft-Delete tombstoned nur die DB-Zeile — das R2-Objekt bliebe für
> immer liegen (Kosten + DSGVO-Verstoß). Jetzt räumt ein periodischer GC auf.

- [x] Migration `0007_r2_gc.sql`: RPC `photos_to_purge()` — Fotos mit
      `storage_url`, deren Zeile **oder** deren Stop/Trip soft-gelöscht ist;
      SECURITY INVOKER, EXECUTE **nur** für `service_role` (bypasst RLS).
- [x] Edge Function `r2-gc`: verlangt den `service_role`-Key als Bearer (nicht
      user-aufrufbar), löscht die R2-Objekte hart (SigV4 DELETE, 404 = schon
      weg), validiert den Objekt-Key gegen das `user/photo.jpg`-Muster (löscht
      nie beliebige Keys), tombstoned danach die Foto-Zeile + `storage_url=null`
      → nächster Lauf überspringt sie, Geräte ziehen die Löschung via
      `pull_tombstones` (P10) nach. Kaskade gelöst: Foto unter gelöschtem
      Stop/Trip bekommt sein eigenes `deleted_at` → kein Re-Upload durch Sync.
- [x] Workflow `r2-gc.yml`: wöchentlicher Cron (Mo 03:23 UTC) + manueller
      Dispatch; ruft die Funktion mit dem Service-Role-Key auf.
- [x] Doku: README §7-Checkliste abgehakt, DEVELOPMENT.md (R2-Abschnitt),
      CLAUDE.md (Ops-Pipelines).
- [⏳] **Setup nach Merge:** Repo-Secret `SUPABASE_SERVICE_ROLE_KEY` anlegen
      (Dashboard → Settings → API); Function deployt `supabase-functions.yml`
      automatisch, Migration 0007 `supabase-migrate.yml`. Danach Erstlauf
      manuell via Actions → „R2 garbage collector" und Summary prüfen
      (`candidates/purged/failures`).

### P12 — Tier-1-Feature: Ver-/Entsorgung als Stopp-Typ ✅
> README §8.1 Tier 1: Ver-/Entsorgungsstation (Frischwasser, Grau-/Schwarzwasser)
> als eigener `StopType` — fehlt in generischen Karten-Apps.

- [x] `StopType` um `'verentsorgung'` erweitert (`models.ts`, README §5)
- [x] Migration `0008_stop_type_verentsorgung.sql`: CHECK-Constraint auf
      `stops.type` erweitert (SQLite hat keinen CHECK → kein Schema-Bump nötig)
- [x] UI: Typ-Auswahl im Stopp-Editor, Label in der Stopp-Liste, Typ-Zyklus im
      Foto-Import — überall Label „Ver-/Entsorgung"
- [x] Mapper-Roundtrip-Test für den neuen Typ

### P13 — Tier-1-Feature: Strava als Link ✅
> README §8.1 Tier 1: bewusst **nur ein String-Feld** am Trip (ToS-sicher, keine
> Strava-API; Vollintegration ist verworfen). Teilen-Link/QR gibt auch private
> Aktivitäten gezielt frei.

- [x] Migration `0009_trip_strava_url.sql`: `trips.strava_url text`
- [x] **Lokale SQLite-Migration jetzt additiv** (`SCHEMA_VERSION = 3`):
      `ADDITIVE_MIGRATIONS` in `schema.ts` + In-Place-Runner in `sqlite.ts`.
      Vorher hätte jeder Versions-Bump die Tabellen gedroppt — das hätte
      `photos.local_uri` und noch nicht gepushte Zeilen vernichtet (Re-Pull
      stellt beides nicht wieder her). Drop-Pfad bleibt nur für < v2.
- [x] `Trip.stravaUrl` (models/mappers/repositories) + Mapper-Tests
      (inkl. Abwärtskompatibilität: Zeile ohne `strava_url` → null)
- [x] `normalizeHttpUrl` (`src/lib/util/url.ts`, PURE): trimmt, ergänzt
      `https://`, lehnt Nicht-http(s)-Schemes und Freitext ab (Wert landet in
      `Linking.openURL`) — Unit-Tests in `__tests__/url.test.ts`
- [x] UI Trip-Screen: Eingabefeld (Speichern bei Blur, Validierungsfehler
      inline) + „In Strava öffnen"-Button

### P14 — Tier-1-Feature: Wetter pro Stopp ✅
> README §8.1 Tier 1: Koordinaten liegen vor; **Open-Meteo** ist frei (kein
> Key/keine Kosten). Wetter ist Deko — best-effort, blockiert nie.

- [x] `src/lib/weather/` (PURE, RN-frei): Datums-Routing (älter als 7 Tage →
      ERA5-**Archive**-API wegen Nachlauf; letzte Woche bis +16 Tage →
      **Forecast**-API; weiter weg → null), URL-Bau, Response-Parsing,
      WMO-Code → Emoji + deutsches Label, Kompakt-Formatierung,
      `fetchDailyWeather` mit Timeout — liefert bei JEDEM Fehler null
- [x] Unit-Tests (`__tests__/weather.test.ts`): Routing-Grenzen, URL-Inhalt,
      Parsing, Formatierung, fetch-Mocks (OK/HTTP-Fehler/offline/out-of-range)
- [x] UI Stopp-Screen: einzeilige Wetter-Anzeige (Ankunftsdatum, sonst heute)
      unter dem Ankunftsfeld; nur wenn Koordinaten gesetzt sind
- [x] `.env.example`: optionale Endpoint-Overrides
      (`EXPO_PUBLIC_WEATHER_FORECAST_URL` / `_ARCHIVE_URL`)

### P15 — Internes Routenmodell + GPX/KML-Adapter (Architektur-Anker, §8.1) ✅
> Der §8.1-Anker: jede Importquelle konvertiert über einen Adapter in ein
> **neutrales Routenmodell** (Stops, Tracks, Zeit), jeder Export entsteht
> daraus. Deckt Google MyMaps (KML), Komoot/Garmin/OsmAnd/Strava (GPX) ab.

- [x] `src/lib/route-model/` (PURE, RN-frei): `RouteModel { name, stops:
      RoutePoint[], tracks: RouteTrack[] }` — bewusst NICHT die DB-Form
      (keine role/position); die Zuordnung passiert erst im Import-Flow
- [x] GPX-Adapter: `wpt`→Stops, `trk/trkseg`→Track (Segmente eines trk
      konkateniert), `rte/rtept`→Stops; Export als GPX 1.1; ungültige
      Koordinaten werden übersprungen
- [x] KML-Adapter: Placemark/Point→Stop, LineString→Track, Folder/Document
      rekursiv, MultiGeometry; Export als KML 2.2. **KMZ (gezippt) offen**
- [x] `detectRouteFormat` (Extension, dann Content-Sniffing) +
      `parseRouteFile`-Dispatch mit deutschen Fehlermeldungen
- [x] Dependency: `fast-xml-parser` (pure JS, RN-tauglich, kein DOM nötig)
- [x] 12 Unit-Tests inkl. Roundtrips (auch XML-Escaping `&`) — grün
- [x] Folgeschritte: Track-Persistenz (`tracks`-Tabelle) + Karte zeichnet
      Tracks (P16 ✅), Import-/Export-UI (P17)

### P16 — Track-Persistenz + Karte zeichnet echte Strecken ✅ (Code) / ⏳ (RLS via CI)
> Tracks = die echte gefahrene Strecke (aus GPX/KML, später Timeline). Damit
> zeichnet die Karte die reale Route statt Luftlinien; die Diashow-Kamera (§8.1)
> kann später der Straße folgen.

- [x] Migration `0010_tracks.sql`: Tabelle `tracks` (SyncBase + `trip_id` +
      `name` + `points` als **JSON-TEXT** — gleiche Spaltenform in beiden DBs,
      Sync schiebt sie 1:1 ohne Konvertierung) + RLS (gleiche EXISTS-Kette wie
      Stops) + `pull_tombstones` um `tracks` erweitert
- [x] Lokal: `CREATE TABLE tracks` in `schema.ts` — **kein** Versions-Bump
      nötig (CREATE IF NOT EXISTS läuft bei jedem Start)
- [x] `Track`/`TrackGeoPoint` in models, `rowToTrack`/`trackToRow` (Parse mit
      []-Fallback), `trackRepo` (listByTrip/create/remove), Sync-`TABLES` +
      Tombstone-Whitelist um `tracks` erweitert
- [x] Karte (`RouteMap`): zeichnet Tracks als Linien; Luftlinie nur noch als
      **gestrichelter Fallback** ohne Tracks; Kamera-Bounds über Stops+Tracks
- [x] Tests: Track-Mapper-Roundtrip + Fallback, Tombstone-Gruppierung mit
      `tracks`; RLS-Test +3 Checks (Insert eigene/fremde, fremdes SELECT)

### P17 — GPX/KML-Import & GPX-Export (UI) ✅ (Code) / ⏳ (Gerätelauf)
> Schließt §8.1 Tier 2 „GPX/KML Import & Export" ab: Datei rein → Vorschau →
> Stopps+Tracks am Trip; Trip raus als GPX (teilen). KMZ weiterhin offen.

- [x] `trip-convert.ts` (PURE): `stopsFromModel` (hinten anhängen; nur bei
      leerem Trip wird der erste Punkt `start`; `arrivalDate` aus `time`),
      `tracksFromModel` (<2 Punkte verworfen), `modelFromTrip` (0/0-Stopps
      übersprungen) — 5 Unit-Tests
- [x] UI Trip-Screen, Karte „Import & Export": Datei-Picker (`*/*`, Format
      entscheidet `parseRouteFile`) → Bestätigungs-Dialog mit Statistik →
      Anlegen + Sync; Export schreibt GPX in den Cache und öffnet das
      Teilen-Sheet (`expo-sharing`); Export deaktiviert ohne Geo-Daten
- [x] Neue Deps: `expo-document-picker`, `expo-sharing` (@56) — **native
      Module → neuer Dev-Client-/EAS-Build nötig** (wie MapLibre/SQLite)
- [⏳] Gerätelauf (Picker/Share-Sheet) steht aus — headless nicht testbar

### P18 — Tag-System für Reisen (inkl. Fahrzeug als Tag) ✅
> Aus „Zukunfts-Features": freie Tags am Trip statt Hierarchie-Ebene (Vorbild
> Furkot); Fahrzeug ist ein Tag (z. B. „Dethleffs") → Filter „alle Reisen mit
> dem Dethleffs".

- [x] Migration `0011_trip_tags.sql`: `trips.tags text[] default '{}'`;
      lokal JSON-TEXT (Muster wie `shared_with`), `SCHEMA_VERSION = 4`
      (additiver ALTER), Sync-Konvertierung Array↔JSON verallgemeinert
      (`TRIP_ARRAY_COLS`)
- [x] `Trip.tags` durch models/mappers (`stringArray`-Helper)/repositories
- [x] `src/lib/util/tags.ts` (PURE): `parseTagInput` (Komma, trim, dedupe
      case-insensitiv), `formatTags`, `collectTags` (A–Z), `hasTag` —
      mit Unit-Tests
- [x] UI: Tags-Feld im Trip-Screen (Blur-Save); Reise-Liste mit
      Tag-Chips zum Filtern (Toggle) + Tags auf der Reise-Karte

### P19 — Reise-Diashow / Wiedergabemodus ✅ (Code) / ⏳ (Gerätelauf)
> README §8.1 Tier 2 (Play-Button): Intro-Karte (Zeitraum, Tage, Stopps, km,
> Fotos), dann Etappe für Etappe mit Kamera-Flug, progressiv wachsender
> Routenlinie und Foto-Slides. Spielt **Tracks falls vorhanden, sonst
> Luftlinie** (entkoppelt von der Quelle, P16). Die Sequenz-Engine wird später
> vom Reise-Story-Export wiederverwendet.

- [x] `src/lib/slideshow/` (PURE, RN-frei): Haversine/`pathDistanceKm`,
      `nearestIndex` + `legsForStops` (Stopps auf nächste Trackpunkte gesnappt,
      Indizes non-decreasing, degenerierte Legs → Luftlinie),
      `slideDurationMs` (∝ Fotoanzahl, gedeckelt), `buildSlideshow`
      (Intro-Statistik: Zeitraum/Tage aus arrivalDates, km entlang Track sonst
      Luftlinie; nur lokalisierte Stopps) — **10 Unit-Tests**
- [x] `SlideshowPlayer` (+ Web-Stub): Vollbild-Karte, Kamera-`fly` pro Etappe,
      wachsende Linie (Legs bis zur aktuellen Folie), Foto-Zyklus pro Stopp
      (`expo-image`), Tap-Zonen zurück/Pause/vor, Fortschritt + Schließen
- [x] Screen `/play?tripId=…` (Header aus) + „▶️ Reise abspielen"-Button im
      Trip-Screen (deaktiviert ohne lokalisierte Stopps)
- [⏳] Gerätelauf (Kamera-Animation/Performance) steht aus

### P20 — CI-Fix: explizite Tabellen-GRANTs (Migration `0012`) ✅
> RLS-Job in CI rot mit „permission denied for table trips" — **vor** jeder
> RLS-Prüfung. Ursache: Der Runner zieht die Supabase-CLI mit `version:
> latest`; neuere lokale Stacks legen Migrations-Tabellen nicht mehr mit den
> alten Default-Privilegien (`GRANT ALL … TO authenticated`) an. `main` war
> aus demselben Grund bereits rot (Run 80, 2026-06-10, vor diesem Branch).

- [x] Migration `0012_grants.sql`: minimale explizite GRANTs —
      `authenticated`: SELECT/INSERT/UPDATE (bewusst **kein** DELETE =
      Soft-Delete-Prinzip §5.4), `service_role`: alles, `anon`: nichts auf
      Datentabellen; `alter default privileges` für künftige Tabellen.
      Idempotent (auf alten Stacks No-op), geht via `supabase db push` auch
      in die Cloud (dort harmlos).
- [x] **Nachfix (Migration `0013`):** Nach 0012 waren 13/15 Checks grün, aber
      die SECURITY-DEFINER-RPC `pull_tombstones` lieferte 0 Zeilen — neuere
      Stacks garantieren den RLS-Bypass des Funktions-Owners nicht mehr.
      Tombstones sind jetzt **first-class unter RLS**: je Tabelle eine
      zusätzliche SELECT-Policy „eigene gelöschte Zeilen" (Eltern-Guards
      bewusst weggelassen), RPC auf **SECURITY INVOKER** umgestellt (liest im
      Aufrufer-Kontext — der Pfad, den die grünen Checks beweisen). Bonus:
      auch der normale Pull sieht Löschungen jetzt mit. RLS-Test prüft die
      Soft-Delete-Vorbedingungen jetzt explizit (+2 Checks).

### P21 — r2-gc-Auth-Fix: eigener Secret-Name `SB_SERVICE_ROLE_KEY` ✅
> Erster echter `r2-gc`-Lauf (workflow_dispatch) → `401 {"error":"Unauthorized"}`
> aus der Funktion selbst, mit Legacy-JWT **und** neuem Secret-Key. Ursache:
> die Funktion verglich gegen den auto-injizierten `SUPABASE_SERVICE_ROLE_KEY` —
> neuere Projekte injizieren ihn nicht zuverlässig, dann ist `serviceKey` leer
> und **jeder** Aufruf scheitert (egal welcher Bearer). `SUPABASE_*`-Secrets
> kann man nicht selbst setzen → kein manueller Workaround.

- [x] Funktion liest den Key jetzt aus dem operator-setzbaren
      `SB_SERVICE_ROLE_KEY` (Fallback: auto-injiziertes `SUPABASE_SERVICE_ROLE_KEY`);
      derselbe Wert dient als erwarteter Bearer **und** als DB-Client-Key.
- [x] Doku (DEVELOPMENT.md): zwei Secrets mit identischem Wert (Supabase-Function
      `SB_SERVICE_ROLE_KEY` + GitHub `SUPABASE_SERVICE_ROLE_KEY` = `service_role`-JWT).
- [⏳] **Setup:** `SB_SERVICE_ROLE_KEY` als Supabase-Function-Secret setzen
      (Dashboard → Edge Functions → Manage secrets), Wert = derselbe `eyJ…`-JWT
      wie im GitHub-Secret. Danach Redeploy (Merge → `supabase-functions.yml`)
      und Workflow erneut anstoßen.

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
**MVP abgeschlossen (P0–P9, Stand 2026-06).** Alle MVP-Reste erledigt:
Zwei-Geräte-Test bestanden (Foto auf Gerät B via `storage_url`/R2 sichtbar),
MapLibre-Tiles eingerichtet, Migrations bis 0005 im Cloud-Projekt eingespielt,
Edge Function `r2-presign` deployt, App läuft auf echten Geräten end-to-end
(Auth, CRUD, Foto-Import → Routenvorschlag, R2-Upload, Karte).
Headless verifiziert: `npm run typecheck`, `npm test`, `npm run lint` — alle grün;
RLS-Isolationsbeweis läuft in CI.
Sync-Engine gehärtet (P7): JWT-Diagnose, INSERT-first-Strategie, per-Row-Fallback,
Tombstone-RLS-Fix, globales Crash-Logging.
P8: Modell auf 2-stufig (`Trip → Stop → Photo`), `roadbooks`/`routes` → `trips`,
Migration `0005`, lokaler SQLite-Schema-Reset (PRAGMA user_version = 2).
**Post-MVP umgesetzt:** P10 Tombstone-Sync (Lösch-Propagation auf andere Geräte,
Migration `0006`) + P11 R2-Lösch-Lebenszyklus (GC: Edge Function `r2-gc` +
Migration `0007` + Cron `r2-gc.yml`).
**Nächste Schritte:** Repo-Secret `SUPABASE_SERVICE_ROLE_KEY` setzen + GC-Erstlauf
(s. P11), danach Feature-Backlog (README §8.1) der Reihe nach: ✅ P12
Ver-/Entsorgungs-Stopp-Typ → ✅ P13 Strava-Link → ✅ P14 Wetter pro Stopp →
✅ P15 internes Routenmodell + GPX/KML-Adapter → ✅ P16 Track-Persistenz + Karte →
✅ P17 Import-/Export-UI → ✅ P18 Tags → ✅ P19 Reise-Diashow.
**Damit ist die geplante Feature-Reihe komplett.** Offen (Gerät): Dev-Client-
Build wegen neuer nativer Module (expo-document-picker/-sharing), Gerätelauf von
Import/Export und Diashow; Cloud: Migrations 0006–0011 via `supabase db push`.

---

## Nicht im MVP (README §8/§8.1)
Payment/Abo · Sharing-UI · Store-Submission · DSGVO-Volltexte · volle Sync-Engine
(PowerSync/WatermelonDB) · §8.1-Backlog. Schema ist für Sharing & Offline-Sync
bereits vorbereitet.

## Zukunfts-Features (nach P8/P9)
- ✅ **Tag-System für Reisen** — umgesetzt in P18 (Migration `0011`, Tag-Chips
  in der Reise-Liste; Fahrzeug als Tag statt Hierarchie-Ebene, Vorbild Furkot).
- ✅ **Reise-Diashow / Wiedergabemodus** — umgesetzt in P19 (Sequenz-Engine
  RN-frei in `src/lib/slideshow/`, Player mit Kamera-Flug + wachsender Linie +
  Foto-Slides; Tracks falls vorhanden, sonst Luftlinie). Der **Reise-Story-
  Export** (MP4/Web-Link) bleibt offen und nutzt dieselbe Sequenz-Engine.

## Bekannte Limits der MVP-Sync-Engine
- ✅ **GELÖST (P10, Migration `0006`): Löschungen propagieren jetzt auch per Pull.**
  Früher: Die SELECT-RLS filtert `deleted_at IS NULL`, also lieferte
  `pullChanges` keine Tombstones — ein Soft-Delete blieb auf anderen Geräten
  liegen. Jetzt zieht `syncEngine.pullTombstones()` Löschungen über die RPC
  `pull_tombstones` (eigener Kanal mit `since`-Wasserstand) und wendet sie per
  Last-write-wins lokal an. Damit ist auch das Aufräumen **direkt in der Cloud**
  (SQL-Editor: `deleted_at` setzen) zulässig — die Geräte ziehen die Löschung
  beim nächsten Sync nach.
- **Dubletten entstehen nicht durch Doppel-Sync** (alles dedupt über die
  Client-UUID via `ON CONFLICT(id)`), sondern wenn dieselbe Reise unter **zwei
  UUIDs** angelegt/gepusht wurde (z. B. Reinstall + Neuanlage in der Testphase).
  Ein Frischgerät zieht ab Wasserstand `1970` **alles** und macht solche Cloud-
  Dubletten als Erstes sichtbar. `SYNC:PULL`-Log (seit 2026-06) zeigt die Zeilen-
  zahl pro Tabelle → Dublette sofort erkennbar.

## Hinweise für die Fortsetzung nach Pause
- Branch: `claude/app-ui-data-persistence-e96qb`
- Was läuft headless: `npm run typecheck`, `npm test`, lokal `npx supabase start` + RLS-Test.
- Was NICHT hier testbar: Gerätelauf (Picker/EXIF/MapLibre), echter R2-Upload, EAS-Build, Supabase-Cloud → brauchen Secrets/Gerät.
- Migrations 0003 + 0004 nach jedem `supabase db push` automatisch eingespielt; für manuelle Cloud-Setups einmalig via SQL-Editor.
