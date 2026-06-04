# Roadbook — Developer Setup

App-Code zum MVP aus [`README.md`](./README.md) (§8). Fortschritt: [`PROGRESS.md`](./PROGRESS.md).

> **Stack:** Expo SDK 56 (React Native) + TypeScript · Expo Router · Supabase
> (Auth + Postgres/RLS) · Cloudflare R2 (Fotos) · MapLibre. **Hinweis:** Der
> README nennt SDK 55 (Stand Mai 2026); die npm-Registry liefert inzwischen SDK
> 56 stabil — daher SDK 56.

## Voraussetzungen
- Node 22, npm
- Docker (für lokales Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase …` genügt)
- Für echte Geräte-Builds: ein **Custom Dev Client** (EAS) — MapLibre & expo-sqlite
  sind native Module und laufen **nicht** in Expo Go.

## Installation
```bash
npm install
cp .env.example .env   # Werte ausfüllen (s. u.)
```

## Lokales Backend (Supabase CLI) — wiederholbar
**Empfohlen (ein Befehl, idempotent):**
```bash
npm run dev:up      # startet Supabase (Docker), wendet Migrations an,
                    # schreibt .env (Supabase-Keys frisch, R2/Map bleiben Platzhalter)
npm run rls:test    # RLS-Isolationsbeweis gegen das lokale Supabase
npm run dev:down            # stoppt; `npm run dev:down -- --reset` wischt Daten
```
`dev:up` ist beliebig oft wiederholbar — die lokalen Keys sind deterministisch.

**Manuell (Äquivalent):**
```bash
npx supabase start          # startet Postgres/Auth/REST, wendet Migrations an
npx supabase status -o env  # API_URL / ANON_KEY / SERVICE_ROLE_KEY
```
Schema-Änderungen als neue Datei unter `supabase/migrations/` versionieren
(additiv, s. README §12a).

### Dev-Container / Codespaces
`.devcontainer/devcontainer.json` bringt Node 22 + Docker-in-Docker + die
VS-Code-Expo-Tools mit. In GitHub Codespaces oder „Reopen in Container":
Container öffnen → `npm run dev:up` → loslegen. So läuft das lokale Supabase
reproduzierbar in einer wegwerfbaren Umgebung.

### On-Demand in CI
`.github/workflows/ci.yml` hat `workflow_dispatch` — du kannst die komplette
Suite (Typecheck · Tests · Lint · **RLS-Beweis gegen frisch gebootetes Supabase**)
jederzeit über den Actions-Tab per Klick starten, zusätzlich zu jedem Push/PR.

### Cloud-Projekt (statt lokal)
Projekt in Region **eu-central-1 / Frankfurt** anlegen (README §7). Die Migrations
aus `supabase/migrations/**` ins Cloud-Projekt bringen — zwei Wege:

- **Manuell (lokal, im Projektordner):**
  ```bash
  npx supabase login                              # einmalig, Browser
  npx supabase link --project-ref <ref>           # ref = Settings → General → Reference ID
  npx supabase db push                            # spielt 0001_init + 0002_rls ein
  ```
- **Pipeline (empfohlen):** `supabase-migrate.yml` fährt `supabase db push` bei jedem
  Push auf `main`, der `supabase/migrations/**` ändert (+ manuell per `workflow_dispatch`,
  z. B. um ein frisch neu angelegtes Projekt zu provisionieren). `db push` ist
  **idempotent** — Supabase trackt angewandte Migrations in
  `supabase_migrations.schema_migrations` und führt nur die neuen aus; Re-Runs sind
  No-Ops (kein „nur wenn DB leer"-Guard nötig). Free-Tier-Projekte werden bei
  Inaktivität nur **pausiert**, nicht gelöscht — nach Restore sind die Tabellen wieder da.
  Benötigte Repo-Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

> Client-Keys (`EXPO_PUBLIC_SUPABASE_URL` + **anon/public** Key) stehen im Dashboard
> unter Settings → API. Niemals den `service_role`/`secret` Key in die App/EAS-Env-Vars.

## App starten
```bash
npx expo start            # Dev-Server; Custom Dev Client öffnen (nicht Expo Go)
# bzw. npm run android / npm run ios
```

## Aufs Gerät bringen (EAS)
MapLibre & expo-sqlite sind native Module → **kein Expo Go**, es braucht einen
eigenen Build. Zwei Wege:

- **Dev Client (aktiv entwickeln, Live-Reload):** einmal
  `eas build --profile development --platform android` bauen/installieren, dann
  `npx expo start --dev-client`. Config kommt aus der lokalen `.env` (Metro bündelt
  **auf deinem Rechner**).
- **Standalone-APK (nur testen, ohne lokales Setup):** Workflow `eas-build-android.yml`
  (Actions → *Run workflow*, Profil `preview`) stößt einen **Cloud-EAS-Build** an; die
  fertige APK erscheint auf expo.dev und wird direkt aufs Handy installiert — **kein**
  lokales Node/Metro/`.env` nötig. Der Compile läuft auf EAS-Servern; der Job
  submittet nur (mit `--no-wait`). ⚠️ Cloud-Builds zählen gegen das **EAS-Free-Tier
  (15 Android-Builds/Monat)** — für den Alltag besser der Runner-Build (nächster Punkt).
- **Standalone-APK ohne EAS-Kontingent:** Workflow `eas-build-android-runner.yml`
  (Actions → *Run workflow*) baut dieselbe App via `eas build --local` **auf dem
  GitHub-Runner** statt auf Expos Servern — verbraucht **kein** Cloud-Kontingent,
  nur GitHub-Actions-Minuten. Die fertige APK/AAB liegt als **Run-Artifact** zum
  Download. Nutzt dieselbe `eas.json`/Env-Vars/Keystore via `EXPO_TOKEN`; Ergebnis
  ist signiert. (Public Repo: Minuten frei; privat: 2.000 Linux-Min/Monat, Build ~20–40 min.)

**Config für Cloud-Builds** kommt **nicht** aus `.env`, sondern aus den **EAS
Environment Variables** (expo.dev → Project → Environment Variables), pro Profil
gescoped über das `environment`-Feld in `eas.json`. Für `preview` setzen:
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (optional
`EXPO_PUBLIC_MAP_STYLE_URL`). Diese `EXPO_PUBLIC_*`-Werte sind **nicht geheim** — sie
reisen im Client-Bundle mit und werden durch RLS geschützt, nicht durch Verstecken.

**Voraussetzungen:**
- `app.json`: `owner` + `extra.eas.projectId` (sonst kann ein Robot-Token kein
  `eas init` und der Build bricht mit *„EAS project not configured"* ab).
- GitHub-Secret `EXPO_TOKEN` (expo.dev → Account → Access Tokens).

## Tests & CI
Alle Stufen laufen in CI und sind lokal mit denselben Befehlen reproduzierbar.

**Statische Gates**
```bash
npm run typecheck   # tsc (App + scripts/)
npm test            # Jest: pure Logik (Clustering, Suggestion, Mapper, Geocoding, EXIF-Datum)
npm run lint        # expo lint
```

**RLS-Mandantentrennung** (`scripts/rls-test.ts`: 2 User, 9 Checks — der Sicherheitsnachweis, README §12a)
```bash
npm run dev:up      # lokales Supabase
npm run rls:test
```

**Web-E2E (Playwright) — Stufe 1.** Testet den echten App-Stack im Browser gegen
den SPA-Web-Export: bootet → Registrieren → Roadbook/Route anlegen (Auth via
Supabase, CRUD via `expo-sqlite` Web/wa-sqlite, **async** geöffnet). **Ohne**
Karte (MapLibre web-los → `MapView.web.tsx`) und ohne native Foto/EXIF-Pfade.
```bash
npm run dev:up                  # lokales Supabase (für den CRUD-Flow)
npx playwright install chromium # einmalig
npm run e2e:web:local           # exportiert Web + fährt Playwright
```

**Android-Emulator-E2E (Maestro) — Stufe 2.** Gerätenahe Tests auf einem Android-
Emulator; nur in GitHub Actions (KVM). Baut die App via `expo prebuild` +
`assembleRelease` (debug-signiert, JS gebündelt — keine Secrets), bootet den
Emulator und fährt die `.maestro/`-Flows. Aktuell: minimaler Smoke (App startet →
Login). Lokal mit echtem Emulator/Gerät:
```bash
npx expo run:android        # App auf Emulator/Gerät installieren
maestro test .maestro       # Flows fahren (Maestro installiert)
```

### CI-Workflows & Trigger
| Workflow | Inhalt | Trigger |
|---|---|---|
| `ci.yml` | Typecheck · Test · Lint + RLS-Beweis (bootet Supabase) | PR · push→`main` · manuell |
| `e2e-web.yml` | Playwright Web-E2E (bootet Supabase, exportiert Web, lädt Chromium) | PR · push→`main` · manuell |
| `e2e-android.yml` | Maestro-Smoke auf Android-Emulator (Stufe 2): `prebuild` + `assembleRelease`, KVM, APK gecacht, Disk-Cleanup vorm Emulator | PR · push→`main` · nightly · manuell |
| `supabase-migrate.yml` | `supabase db push` der Cloud-Migrations (idempotent, s. „Cloud-Projekt") | push→`main` bei `supabase/migrations/**` · manuell |
| `eas-build-android.yml` | Stößt einen **Cloud-EAS-Build** einer Standalone-APK an (s. „Aufs Gerät bringen") — nutzt EAS-Kontingent | nur manuell (`workflow_dispatch`) |
| `eas-build-android-runner.yml` | Baut die APK/AAB **auf dem Runner** (`eas build --local`), Artifact am Run — **kein** EAS-Kontingent | nur manuell (`workflow_dispatch`) |

**Trigger-Strategie (keine Doppelläufe):** PRs validieren Feature-Branches;
`push` läuft **nur auf `main`** (Post-Merge-Absicherung). So wird ein PR-Branch
nicht doppelt gebaut. `workflow_dispatch` erlaubt manuelle Läufe im Actions-Tab.

**Runner-Minuten sparen:** `ci.yml`/`e2e-web.yml`/`e2e-android.yml` haben je eine
`concurrency`-Gruppe, die bei neuem Push **überholte PR-Läufe abbricht** (main nie),
und einen `changes`-Job (paths-filter), der die schweren Jobs auf PRs **per
job-level `if` überspringt**, wenn nichts App-/Native-Relevantes geändert wurde —
bzw. den Supabase-RLS-Job, wenn kein DB-Code betroffen ist. Ein so übersprungener
Job meldet „skipped" = **passing**, blockiert also keine required checks; `push`,
`schedule` (nightly) und `workflow_dispatch` laufen immer vollständig.

**Diagnose:** Schlägt der Web-E2E in einem PR fehl, postet der Workflow die
Playwright-Ausgabe inkl. Browser-Konsole als PR-Kommentar — nützlich, wenn
CI-Logs/Artefakte schwer zugänglich sind.

## Foto-Upload (Cloudflare R2)
Bilder gehen **nie** in Supabase Storage, sondern nach R2 (kein Egress, README §2.3/§9).
1. R2-Bucket anlegen (z. B. `roadbook-photos`), öffentliche Lese-URL/Domain einrichten.
2. Server-Secrets (NICHT `EXPO_PUBLIC_*`) für die Edge Function setzen:
   ```bash
   npx supabase secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… \
     R2_SECRET_ACCESS_KEY=… R2_BUCKET=roadbook-photos R2_PUBLIC_BASE_URL=https://…
   npx supabase functions deploy r2-presign
   ```
3. In `.env`: `EXPO_PUBLIC_R2_PRESIGN_URL` auf die Funktions-URL setzen.
Die App holt pro Foto eine signierte PUT-URL (`${user.id}/${photoId}.jpg`) und lädt
das komprimierte JPEG direkt zu R2.

## Karten-Tiles
`EXPO_PUBLIC_MAP_STYLE_URL` setzen. Produktion: selbst-gehostete
**Protomaps/PMTiles auf R2** (README §3) — **nicht** `tile.openstreetmap.org`
(kommerziell + offline untersagt). Ohne Style-URL rendert die Karte einen neutralen
Hintergrund; Marker/Routenlinie funktionieren trotzdem.

## Reverse-Geocoding (Stopp-Namen)
Stopp-Koordinaten → Ortsnamen via `src/lib/geocoding`. Standard ist die öffentliche
**Nominatim**-Instanz (nur DEV: max. 1 Anfrage/s, **nicht** für Produktion erlaubt —
README §3/§11). Für Produktion `EXPO_PUBLIC_GEOCODER_URL` auf eine eigene
Photon-/Nominatim-Instanz oder einen Anbieter zeigen lassen. Der Aufruf hat
**Timeout + Retry** (transiente Fehler: Drosselung/Netz/5xx/Timeout) und scheitert
**nie hart**: schlägt er fehl, werden die Stopps trotzdem angelegt (ohne Namen), und
der Import zeigt den konkreten Grund (z. B. „HTTP 429 – gedrosselt"). Häufigste
Ursache der Meldung „Ortsnamen nicht ermittelbar" ist die Drosselung der
öffentlichen Instanz — der Retry bzw. ein erneuter Import später löst das meist.

## Sync-Diagnose & bekannte Fallstricke

### Diagnose-Werkzeuge (App-Menü → Sync-Reparatur)

| Button | Funktion |
|--------|----------|
| **Sync jetzt** | manueller Push + Pull, Ergebnis im Diagnose-Log sichtbar |
| **Auth-Diagnose** | ruft `debug_auth()` RPC auf → zeigt `uid`/`role`/`has_claims` direkt aus PostgreSQL; `has_claims: false` = PostgREST hat den JWT nicht anerkannt |
| **Token erneuern** | Force-Refresh des Supabase-JWT, dann sofortiger Sync |
| **owner_id reparieren** | `repairOwnership()`: setzt alle Roadbooks mit falscher `owner_id` auf aktuelle `auth_uid` + `pending_sync = 1` |

Das Diagnose-Log (unten im Menü) enthält `SYNC:AUTH`-, `SYNC:PUSH`- und `SYNC:PULL`-Zeilen
sowie `RENDER:CRASH`- und `JS:CRASH`-Einträge aus dem globalen Exception-Handler — ohne
angeschlossenen Debugger der einzige Weg, Produktionsfehler zu sehen.

### 42501 (RLS WITH CHECK) trotz korrekter Daten

Häufigste Ursache: PostgREST hat `auth.uid()` = NULL → alle `WITH CHECK`-Policies schlagen fehl.

**Diagnosevorgehen:**
1. Menü → **Auth-Diagnose** ausführen: `has_claims: false` = PostgREST liest JWT-Claims nicht
2. Ursache häufig: JWT-Signing-Key wurde gewechselt (Supabase migriert automatisch von HS256 auf ECC P-256/ES256). PostgREST muss dann JWKS neu laden.
3. Fix: Supabase-Projekt im Dashboard **pausieren + neu starten** (oder Settings → Restart Service) → PostgREST lädt neue JWKS.

⚠️ **Bekannter Supabase-Fallstrick:** Supabase migriert aktive Projekte automatisch von HS256 auf ECC P-256/ES256. `getSession()` prüft `expires_at` lokal — der Token sieht clientseitig gültig aus, wird von PostgREST aber nicht verifiziert, solange dessen JWKS-Cache das alte Key-Material hält. `resolveUid()` in `syncEngine.ts` loggt `jwtSub` und Ablauf-Zeitstempel, um diesen Zustand sichtbar zu machen.

### Route-Tombstones scheitern am Push

Migration `0004_fix_route_insert_rls.sql` behebt das: die ursprüngliche `route_insert`-Policy
hatte `rb.deleted_at IS NULL`, was Routes von soft-gelöschten Roadbooks vom Sync ausschloss.
Tombstones müssen in Supabase landen, damit Löschungen auf andere Geräte/User propagieren.

### INSERT statt UPSERT

`pushPending()` verwendet `supabase.from(table).insert(payload)`, nicht `.upsert(…, {onConflict: 'id'})`.
Grund: PostgreSQL 15+ evaluiert die `UPDATE USING`-Policy auch in `INSERT ON CONFLICT DO UPDATE`,
selbst wenn kein Konflikt vorliegt → neue Zeilen schlagen mit 42501 fehl, wenn die UPDATE-Policy
restriktiver als INSERT ist. Batch-23505 (Duplikat) oder -42501 (RLS-Verletzung einzelner Rows)
lösen einen Per-Row-Fallback aus: gute Rows kommen durch, fehlerhafte werden einzeln gelogged.

---

## Was hier (Cloud-Build-Umgebung) nicht verifizierbar ist
Gerätelauf (Picker/EXIF/MapLibre-Rendering), echter R2-Upload, EAS-Build und
Supabase-Cloud brauchen Secrets bzw. ein Gerät und passieren außerhalb dieses
Containers. Headless verifiziert sind: Typecheck, Unit-Tests, Lint und (in CI)
der RLS-Isolationsbeweis.
