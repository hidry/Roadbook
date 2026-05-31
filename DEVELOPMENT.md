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

> Cloud statt lokal: Projekt in Region **eu-central-1 / Frankfurt** anlegen
> (README §7), Migrations mit `supabase db push` ausspielen.

## App starten
```bash
npx expo start            # Dev-Server; Custom Dev Client öffnen (nicht Expo Go)
# bzw. npm run android / npm run ios
```

## Qualitäts-Gates (laufen auch in CI)
```bash
npm run typecheck   # tsc (App + scripts)
npm test            # Jest: Clustering, Suggestion, Mapper, Geocoding, EXIF-Datum
npm run lint        # expo lint
npm run rls:test    # 2-User-RLS-Isolationsbeweis gegen lokales Supabase
```
`.github/workflows/ci.yml` führt alle Gates aus und startet für `rls:test` ein
lokales Supabase (GitHub Actions zieht die Docker-Images).

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

## Was hier (Cloud-Build-Umgebung) nicht verifizierbar ist
Gerätelauf (Picker/EXIF/MapLibre-Rendering), echter R2-Upload, EAS-Build und
Supabase-Cloud brauchen Secrets bzw. ein Gerät und passieren außerhalb dieses
Containers. Headless verifiziert sind: Typecheck, Unit-Tests, Lint und (in CI)
der RLS-Isolationsbeweis.
