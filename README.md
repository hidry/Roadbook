# Projektplan: Roadbook-App für Wohnmobilreisen

> **Status:** Planung · **Erstellt:** 2026-05-31 · **Owner:** Stefan Reinbold
> **Verifikation:** Tech-Stack & API-Limits geprüft (Stand Mai 2026)
> **Validierung:** Zero-Defect-Policy (Logik / Technik / Risiken / Alternativen)

---

## 1. Zielsetzung & Vision

Cross-Platform-App (Android-first für Samsung Galaxy S23, ebenso iPhone-fähig) zur Verwaltung von Wohnmobil-Reiserouten. Kern-Wertversprechen: **Aus den Fotos einer Reise automatisch eine editierbare Route mit Zwischenstopps vorschlagen.**

**Produktambition:** Die App soll perspektivisch verkaufbar sein, ohne manuellen Einrichtungsaufwand pro Endkunde. Diese Anforderung ist die wichtigste Architektur-Determinante (siehe §2).

**Funktionale Anforderungen:**
- Routen verwalten: Startpunkt, Zwischenstopps (Typ: Campingplatz / Stellplatz / freistehend), Endpunkt
- Beim Anlegen eines Eintrags: Fotos vom Gerät wählen → aus Bildmetadaten (GPS + Zeitstempel) Route + Stopps vorschlagen
- Vorschlag vollständig editierbar
- Fotos werden persistent gespeichert
- Mehrere User können dasselbe Roadbook nutzen (Multi-User, kritisch ab Tag 1)
- Quellcode in privatem GitHub-Repo

---

## 2. Architektur-Entscheidungen (mit Begründung)

### 2.1 Verworfen: GitHub als Datenspeicher

Die ursprüngliche Idee, GitHub auch als Datenspeicher (Bilder + Routen-JSON) zu nutzen, wurde nach Prüfung **verworfen** — drei Deal-Breaker:

| # | Problem | Detail |
|---|---------|--------|
| 1 | **Binärdaten/Performance** | Git ist für Quellcode gebaut. Jede Bildänderung erzeugt eine neue Version ohne Delta-Kompression → Repo bläht auf, Clones werden langsam, Löschen ist unmöglich (bleibt in History). Contents-API praktisch ~50 MB/Datei. |
| 2 | **Multi-User** | Git ist kein Echtzeit-Multi-User-Datenstore. Gleichzeitige Schreibzugriffe → Merge-Konflikte auf JSON-Dateien. Kollidiert direkt mit der Sharing-Anforderung. |
| 3 | **Onboarding (Deal-Breaker für Verkauf)** | Jeder Käufer bräuchte GitHub-Account + Personal Access Token + Repo-Setup = exakt der manuelle Aufwand, der ausgeschlossen wurde. |

**Konsequenz:** GitHub wird ausschließlich für **Quellcode** verwendet (privates Repo) — also genau wofür es gebaut ist.

### 2.2 Verworfen: Self-hosted im Homelab

Eigenes Backend (Proxmox + Tailscale) skaliert nicht für fremde Käufer: Single Point of Failure (eigene Hardware), keine Erreichbarkeit für Dritte ohne Tailscale, kein Self-Service-Onboarding. Für ein verkaufbares Produkt ungeeignet.

### 2.3 Gewählt: Managed Multi-Tenant-Backend

Ein **zentrales Backend für alle User** der App. Trennung der Verantwortlichkeiten — bewusst, um die größte Kostenposition (Bilder) vom teuersten Abrechnungsmodell (Egress) zu entkoppeln:

| Schicht | Technologie | Begründung |
|---------|-------------|------------|
| Auth + Onboarding | **Supabase Auth** | Self-Service-Registrierung in der App, null manueller Aufwand. Free-Tier deckt 50K MAU. |
| Strukturierte Daten | **Supabase PostgreSQL + Row-Level-Security (RLS)** | RLS ist der Mechanismus für sicheres Multi-User-Sharing. Priorität: Security. |
| **Bilder (Binärdaten)** | **Cloudflare R2** | **Keine Egress-Gebühren** — vermeidet die Supabase-Egress-Kostenfalle bei foto-lastiger Nutzung. |

---

## 3. Tech-Stack (verifiziert, Stand Mai 2026)

| Komponente | Wahl | Anmerkung |
|------------|------|-----------|
| Framework | **Expo (React Native)** + TypeScript | EAS Build erlaubt iOS-Builds ohne Mac. SDK 55 (stable) verwenden; SDK 56 noch Beta. |
| Sprache | TypeScript | Durchgängig |
| Navigation | Expo Router (file-based) | Standard 2026 |
| Foto-Auswahl | `expo-image-picker` + `expo-media-library` | Mehrfachauswahl |
| EXIF/GPS lesen | `MediaLibrary.getAssetInfoAsync()` → `info.location`, `info.exif` | Liefert lat/lng + Zeitstempel direkt |
| Bildkompression | `expo-image-manipulator` | Vor Upload (z. B. max. 1920px) |
| Karten-Engine | **MapLibre GL** (Rendering) | Open Source, kostenlos. ⚠️ **Nur die Engine** — Tiles separat (s. u.) |
| Karten-Tiles | **Protomaps (PMTiles) auf R2** | Selbst-gehostet, **kein API-Key, kommerziell + offline erlaubt**, MapLibre-kompatibel. ⚠️ **NICHT** `tile.openstreetmap.org` (kommerziell + offline verboten). Kosten s. §6. |
| Reverse-Geocoding | **Eigener Photon/Nominatim** (Prod) | ⚠️ Öffentliche Nominatim-Instanz nur für Dev (max. 1 req/s, kommerziell unzulässig). Produktion: eigener Dienst (Photon ~80 GB) oder bezahlter Geocoder. |
| Lokale DB (Offline-First) | `expo-sqlite` (ggf. WatermelonDB/PowerSync) | **Source of Truth am Gerät**, Sync gegen Supabase — kein reiner Cache (s. §5.4) |
| Auth/DB-Client | `@supabase/supabase-js` | |

> ⚠️ **Android-Fallstrick:** GPS-Zugriff auf Foto-Metadaten erfordert die Permission `ACCESS_MEDIA_LOCATION` (Android 10+). Muss in der App-Config deklariert **und** zur Laufzeit angefragt werden — sonst sind GPS-Felder leer.

---

## 4. Feature: Routenvorschlag aus Bildmetadaten

```
1. User wählt Bilder (expo-image-picker, mehrfach)
2. Pro Bild: getAssetInfoAsync() → { location: {lat,lng}, exif.DateTimeOriginal }
3. Sortiere chronologisch nach Zeitstempel (= Reiseverlauf)
4. Clustere GPS-Punkte: räumlich+zeitlich nahe Punkte = ein Stopp
   (Heuristik MVP: < 500 m UND < 2 h → selber Cluster)
5. Reverse-Geocoding pro Cluster → Ortsname (Nominatim)
6. Vorschlag: Start = erster Cluster, Stopps = mittlere, Ende = letzter
7. User editiert: Stopp-Typ (Campingplatz/Stellplatz/freistehend),
   umbenennen, hinzufügen, löschen, neu sortieren
8. Bestätigen → Route + Koordinaten (DB) + komprimierte Bilder (R2)
```

**Risiko & Fallback:** Nicht alle Bilder haben GPS (Screenshots, ältere Kameras, deaktivierte Ortung). → Bilder ohne GPS nicht hart fehlschlagen lassen, sondern manuell zuordnen.

---

## 5. Datenmodell (Multi-Tenant ab Tag 1)

### 5.1 Tabellen (vereinfacht)

> **Konvention:** DB-Spalten in `snake_case` (z. B. `owner_id`, `updated_at`), TS-Felder in `camelCase`. Mapping im DB-Client. Alle Tabellen erben die Offline-/Sync-Felder aus `SyncBase` (s. §5.4).

```typescript
type StopType = 'campingplatz' | 'stellplatz' | 'freistehend';
type StopRole = 'start' | 'stop' | 'end';

// Gemeinsame Basis ALLER Tabellen — Definition + Begründung in §5.4
interface SyncBase {
  id: string;                // CLIENT-generierte UUID
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;  // Soft-Delete
}

interface Roadbook extends SyncBase {
  ownerId: string;          // = auth.uid()
  sharedWith: string[];     // weitere User-IDs (RLS-geprüft)
  name: string;
}

interface Route extends SyncBase {
  roadbookId: string;
  title: string;
  startDate: string;
  // stops als eigene Tabelle, FK auf route
}

interface Stop extends SyncBase {
  routeId: string;
  position: number;         // Reihenfolge; [0]=Start, [last]=Ende. NICHT "order" (SQL-Keyword)
  role: StopRole;
  type: StopType | null;    // nur bei role='stop' relevant
  name: string;
  lat: number;
  lng: number;
  arrivalDate: string | null;
  notes: string | null;
}

interface Photo extends SyncBase {
  stopId: string;
  localUri: string | null;   // lokaler Pfad bis Upload erfolgt
  storageUrl: string | null; // R2-URL — null bis hochgeladen
  uploadStatus: 'pending' | 'uploaded' | 'failed';
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
}
```

> Hinweis: Das vollständige `Photo`-Modell inkl. Upload-Queue ist hier final; §5.4 erläutert die Begründung der Sync-Felder.

### 5.2 Row-Level-Security (Kern der Multi-User-Sicherheit)

```sql
-- RLS aktivieren
ALTER TABLE roadbooks ENABLE ROW LEVEL SECURITY;

-- Lesen: Owner ODER in shared_with — und NICHT soft-deleted
CREATE POLICY "roadbook_select" ON roadbooks
  FOR SELECT USING (
    deleted_at IS NULL
    AND (owner_id = auth.uid() OR auth.uid() = ANY(shared_with))
  );

-- INSERT: WITH CHECK erzwingt, dass owner_id = eigener User (sonst Fremd-Insert möglich)
CREATE POLICY "roadbook_insert" ON roadbooks
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- UPDATE: USING (sichtbare Zeilen) + WITH CHECK (neue Werte) — beide nötig
CREATE POLICY "roadbook_update" ON roadbooks
  FOR UPDATE USING (owner_id = auth.uid())
             WITH CHECK (owner_id = auth.uid());
-- Hartes DELETE i. d. R. gesperrt; "Löschen" = Soft-Delete via UPDATE deleted_at
```

> **Zwei kritische RLS-Regeln** (sonst Security-/Integritätslücke):
> 1. **`WITH CHECK` ist Pflicht für INSERT/UPDATE** — `USING` filtert nur sichtbare Zeilen, validiert aber keine geschriebenen Werte. Ohne `WITH CHECK` kann ein User Datensätze mit fremder `owner_id` anlegen.
> 2. **`deleted_at IS NULL` in *jeder* SELECT-Policy** — sonst bleiben soft-gelöschte Datensätze sichtbar.

**Child-Tabellen** (routes, stops, photos) erben die Zugriffslogik über `EXISTS`-Subqueries auf das Roadbook:

```sql
CREATE POLICY "route_select" ON routes
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM roadbooks r
      WHERE r.id = routes.roadbook_id
        AND r.deleted_at IS NULL
        AND (r.owner_id = auth.uid() OR auth.uid() = ANY(r.shared_with))
    )
  );
-- analog für stops (via route→roadbook) und photos (via stop→route→roadbook)
```

### 5.3 Konfliktrisiko Multi-User

Zwei User editieren denselben Stop gleichzeitig. **MVP:** `updated_at`-Timestamp + last-write-wins. **Später:** Optimistic Locking (Versionsnummer). Im Sharing-UI (Phase 3) berücksichtigen.

### 5.4 Offline-First-Readiness (Schema-Weichen — JETZT setzen)

⚠️ **Status: Die volle Sync-Engine kommt erst Post-MVP (§8.1 Tier 3) — aber das Schema muss von Anfang an offline-ready sein, sonst wird die Nachrüstung eine teure Datenmigration.** Offline ist für die Zielgruppe (unterwegs, kein Netz) Kernbedarf, kein Nice-to-have.

**Architektur-Grundsatzentscheidung: Offline-First, nicht Online-First.**
Die App schreibt **immer zuerst in die lokale SQLite-DB** (Source of Truth am Gerät), Sync zum Backend läuft im Hintergrund. Der umgekehrte Weg (direkt gegen Supabase schreiben, SQLite nur als Lesecache) lässt sich später **nicht** ohne Umbau des gesamten Schreibpfads auf Offline-First umstellen — das ist die teuerste Weiche.

**Diese Felder gehören ab Tag 1 in *jede* Tabelle (roadbooks, routes, stops, photos):**

```typescript
interface SyncBase {
  id: string;            // CLIENT-generierte UUID — NICHT serial/auto-increment!
                         // Offline entstehende Records brauchen ID vor Backend-Kontakt.
  createdAt: string;
  updatedAt: string;     // für last-write-wins-Konfliktauflösung
  deletedAt: string | null;  // Soft-Delete (Tombstone), KEIN hartes DELETE
}
```

**Begründung der drei kritischen Weichen:**
- **Client-UUID als PK:** Nachträglicher Wechsel serial → UUID = Migration aller Primär-/Fremdschlüssel. Klassischer teurer Fehler.
- **`deletedAt` (Soft-Delete):** Verhindert das „Resurrection-Problem" — ein offline-Gerät würde einen serverseitig gelöschten Record beim Sync sonst wieder anlegen. **Achtung Wechselwirkung:** DSGVO-Hard-Delete (§7) muss separat als echte Löschung über alle Geräte implementiert werden — Soft-Delete ≠ DSGVO-Löschung.
- **`updatedAt`:** Basis für last-write-wins (§5.3).

**Foto-Modell zusätzlich anpassen** (Upload-Queue für offline gewählte Bilder):

```typescript
interface Photo extends SyncBase {
  stopId: string;
  localUri: string | null;       // lokaler Pfad bis Upload erfolgt
  storageUrl: string | null;     // R2-URL — null bis hochgeladen
  uploadStatus: 'pending' | 'uploaded' | 'failed';
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
}
```

**Sync-Tool (Entscheidung Post-MVP, [ANNAHME] nach Lastprofil):**

| Option | Charakter | Trade-off |
|--------|-----------|-----------|
| **WatermelonDB** | SQLite-basiert, observable, last-write-wins; offizielles Supabase-Tutorial vorhanden | Proven & kostenlos, aber Backend-Sync-Logik (RPC/Realtime) selbst bauen. Erwartet eigene Sync-Status-Spalten. |
| **PowerSync** | Managed Sync-Engine, first-class Offline, Bucket-System, kausale Konsistenz, integriert Supabase RLS/Auth/Replication | Robustester Weg, aber Zusatzkosten + Komplexität; bekanntes WAL-Growth-Thema bei idle Supabase-Instanzen beachten |

→ Empfehlung: Schema offline-ready bauen (Felder oben), Tool-Festlegung aufschieben. Beide Optionen funktionieren mit dem hier definierten Schema.

---

## 6. Kostenmodell

> **Hinweis Währung:** Anbieter rechnen in USD ab. Umrechnung mit Kurs **1 USD ≈ €0,86** (Stand 2026-05-31). Wechselkursschwankung beeinflusst die realen Eurobeträge.

| Phase | Supabase | Cloudflare R2 | Anmerkung |
|-------|----------|---------------|-----------|
| Entwicklung | Free (€0) | Free (10 GB) | ⚠️ Free-Tier pausiert nach 1 Woche Inaktivität — für Produktion ungeeignet |
| Ab Launch | Pro (~€22/Monat/Projekt) | ~€0,013/GB Storage, **kein Egress** | Skaliert mit MAU, DB-Größe, Storage |

### 6.1 Skalierungs-Kostenprognose (laufend, pro Monat, in EUR)

**Annahmen (explizit):**
- **[ANNAHME]** Pro aktivem User ~500 komprimierte Fotos akkumuliert à ~300 KB → **~150 MB Storage/User**. DB-Metadaten vernachlässigbar.
- **[ANNAHME]** Gelegentliche Nutzung (Reisen loggen, Fotos ansehen) — **nicht** write-/realtime-lastig → niedriger Compute-Bedarf.
- Bilder über R2 (kein Egress), Supabase nur DB + Auth.

| Aktive User | Supabase | Cloudflare R2 | **Summe ~/Monat** | pro User |
|---|---|---|---|---|
| 2 (du + Frau) | €0 Free¹ *oder* €22 Pro | €0 (< 10 GB frei) | **€0–22** | — |
| 10 | €22 Pro | €0 | **~€22** | €2,20 |
| 100 | €22 | < €1 | **~€22** | €0,22 |
| 1.000 | €22 | ~€2 | **~€24** | €0,024 |
| 10.000 | €22 + Compute €45–95² | ~€22 | **~€90–140** | €0,009–0,014 |
| 50.000 | €22 + Compute €170–345² | ~€105 | **~€300–470** | €0,006–0,009 |

¹ Free-Tier **pausiert nach 1 Woche Inaktivität** und hat keine Backups — für zuverlässige Nutzung (auch nur zu zweit) faktisch €22 Pro nötig.
² **[ANNAHME] größte Unsicherheit:** Supabase-Compute skaliert mit Last, nicht linear mit Usern. Ohne echtes Lastprofil nicht exakt prognostizierbar; bei gelegentlicher Nutzung eher unteres Ende. MAU-Limit (100K in Pro) wird selbst bei 50K Usern nicht erreicht.

**Kern-Erkenntnisse:**
- **R2 ist bis in hohe Stufen praktisch gratis** — der Wegfall der Egress-Gebühren ist der entscheidende Hebel. Über Supabase-Egress wären die Bildkosten ein Vielfaches.
- **Stückkosten sinken massiv mit Skalierung** (€2,20/User bei 10 → ~€0,01/User ab 10.000). Ein Abo von schon €2–3/Monat übersteigt die Backend-Kosten um zwei Größenordnungen — die Ökonomie trägt, sobald überhaupt monetarisiert wird.
- **Eigentlicher Skalierungs-Risikofaktor: Supabase-Compute**, nicht Storage. Mitigation: Reads cachen, unnötige Realtime-Subscriptions vermeiden.

**⚠️ Dritter Kostenposten: Karten-Tiles + Geocoding** (in obiger Tabelle NICHT enthalten — separat zu kalkulieren):
- **Tiles via Protomaps/PMTiles auf R2:** Du zahlst nur R2-Storage (PMTiles-Datei: Weltkarte ~120 GB, Regionalausschnitt z. B. Europa deutlich kleiner) + Class-B-Requests. Größenordnung: ~€10/Monat bei 10 Mio. Tile-Requests — eine Größenordnung günstiger als kommerzielle Karten-SaaS. Kein Egress (R2).
- **Geocoding:** Eigener Photon-Dienst (~80 GB, eigener Server/Container — z. B. dein Homelab für die Dev-Phase) oder bezahlter Geocoder. **[ANNAHME]** genaue Kosten je nach Lösung; vor Skalierung kalkulieren.
- **Fazit:** Karten/Geocoding verschieben das Kostenmodell moderat nach oben, bleiben aber dank PMTiles+R2 im niedrigen zweistelligen Bereich/Monat — kein Dealbreaker, aber kein „kostenlos".

### 6.2 Zusätzliche Fixkosten (nicht Backend)

| Posten | Kosten | Wann relevant |
|--------|--------|---------------|
| Apple Developer Program | ~€85/Jahr ($99) | Ab dauerhafter iPhone-Installation (z. B. Frau am iPhone) — TestFlight/Ad-hoc. Auf Android (S23) via EAS-Build/Sideload kostenlos. |
| Google Play Developer | ~€22 einmalig ($25) | Nur bei Play-Store-Veröffentlichung; für reine Eigennutzung auf Android nicht nötig. |

→ Für **dich + Frau** realistisch: **~€22/Monat (Supabase Pro) + ggf. ~€85/Jahr (Apple)**, Rest im Free-Tier.

**Wirtschaftliches Kernrisiko:** Backend-Kosten skalieren mit aktiven Nutzern und laufen dauerhaft. Ein **Einmalkauf** bei dauerhaften Kosten = Verlust pro aktivem User. → **Abo-/Freemium-Modell** ist wahrscheinlich notwendig. Zusätzlich: Store-Provision (Apple/Google 15–30 %).
**Entscheidung:** bewusst aufgeschoben (two-way door) — wird nach MVP getroffen, ohne Architektur-Umbau.

### 6.3 Free-Tier-Pausing umgehen? (Keep-Alive vs. lokale Entwicklung)

**Frage:** Lässt sich das Pausieren des Supabase Free-Tier (nach 7 Tagen Inaktivität) per GitHub Action verhindern?

**Technisch:** Ja. Cron-Workflow pingt alle paar Tage einen REST-Endpoint mit dem anon-Key. Kosten praktisch null (GitHub-Actions-Integration seit April 2026 auch im Free-Plan).

```yaml
# .github/workflows/keep-alive.yml
name: Keep Supabase Alive
on:
  schedule:
    - cron: "0 8 */3 * *"   # alle 3 Tage, 08:00 UTC
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase REST endpoint
        run: |
          curl -s "${{ secrets.SUPABASE_URL }}/rest/v1/" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -o /dev/null
```

**Bewertung (Zero-Defect):**
- ⚠️ **Unzuverlässig / ToS-Graubereich** — dokumentierte Fälle, in denen Supabase trotz erfolgreicher Pings pausiert. Reine Health-Pings zählen nicht garantiert als Aktivität.
- ⛔ **Dealbreaker: keine Backups** im Free-Tier, keine SLA. Kollidiert mit Priorität *Data Integrity* — besonders bei personenbezogenen GPS-Daten.
- ⚠️ **Permanente Löschung** nach 90 Tagen Pause; bei stillem Ausfall der Action (abgelaufener Token, gedrosselter Schedule) läuft die Uhr.

**Entscheidung:**

| Situation | Vorgehen |
|-----------|----------|
| **Lokale Entwicklung** | **Supabase CLI lokal** (Docker-Stack) — kostenlos, kein Pausing, kein Cloud-Projekt nötig. **Empfohlene Standard-Bauumgebung.** |
| Cloud-Prototyp ohne wertvolle Daten | Keep-Alive-Action akzeptabel |
| Echte Daten (auch nur du + Frau) | **Pro (€22/Monat)** — Backups, kein Pausing, SLA |

**Fazit:** Keep-Alive nur als Übergangslösung für wertlose Prototyp-Daten. Sobald echte Daten reinkommen, ist der ~€22/Monat-Verzicht auf Backups der falsche Trade-off. Für die Bauphase ist lokale Entwicklung via Supabase CLI ohnehin die sauberere Lösung.

---

## 7. Rechtliches / DSGVO (vor Verkauf zwingend)

Beim Verkauf wirst du datenschutzrechtlich **Verantwortlicher** für fremde Nutzerdaten. GPS-Standorte aus EXIF = personenbezogene Daten (Bewegungsprofile).

- [ ] Datenschutzerklärung + Impressum (Rechtsform prüfen — **[ANNAHME]**: gewerblich über Artner oder privat)
- [ ] AVV (Auftragsverarbeitungsvertrag) mit Supabase **und** Cloudflare
- [ ] EU-Datenresidenz wählen (Supabase Region: `eu-central-1` / Frankfurt)
- [ ] Lösch- & Auskunfts-/Exportfunktion in der App (Betroffenenrechte)
- [ ] **In-App-Account-Löschung** (Apple-Pflicht für Apps mit Account-Erstellung) + DSGVO-Recht auf Löschung
- [ ] **R2-Lösch-Lebenszyklus:** Beim Löschen eines Fotos/Stops muss das zugehörige R2-Objekt **echt** gelöscht werden (nicht nur DB-Soft-Delete). Sonst verwaiste Objekte = Kosten **und** DSGVO-Verstoß (Daten nicht wirklich gelöscht). Mechanismus: Edge Function bei Löschung oder periodischer Garbage-Collector. **Achtung:** Soft-Delete (§5.4) ≠ DSGVO-Löschung — der echte Hard-Delete (DB-Row + R2-Objekt, über alle Geräte) muss separat implementiert werden.
- [ ] Daten verschlüsselt at-rest; nur extrahierte Koordinaten + komprimierte Bilder speichern, **nicht** das EXIF-volle Original
- [ ] **Importquellen mit Rohdaten** (z. B. Google-Timeline-JSON, §8.1): nur die für die Reise relevanten Stopps/Route übernehmen, Roh-Dump (vollständiges Bewegungsprofil) **nie** in die Cloud laden — direkt auf dem Gerät verwerfen
- [ ] Apple App Store: Developer-Account (99 $/Jahr), Permission-Begründung für Foto/Standort
- [ ] Google Play: Developer-Account (25 $ einmalig), Data-Safety-Formular (GPS deklarieren)

---

## 8. MVP-Scope

**Drin (Kern-Wertversprechen beweisen):**
- Auth (Sign-up/Login)
- Roadbook / Route / Stop CRUD **mit RLS**
- Foto-Import → EXIF/GPS → editierbarer Routenvorschlag
- Bilder komprimiert nach R2
- Kartenansicht (MapLibre)

**Bewusst raus (bis Geschäftsmodell feststeht):**
- Payment/Abo-Integration
- Sharing-UI (Datenmodell trägt es bereits)
- Store-Submission, DSGVO-Volltexte
- Alle Erweiterungen aus §8.1

### 8.1 Feature-Backlog (Post-MVP), sortiert nach Aufwand/Mehrwert

**Architektur-Anker:** Import/Export, Strava-GPX und der EXIF-Vorschlag laufen alle über **Adapter um ein internes, neutrales Routenmodell** (Stops, Tracks, Zeit). Jede Quelle wird beim Import in dieses Modell konvertiert, jeder Export aus ihm erzeugt. Das hält das Datenmodell sauber und entkoppelt die Features voneinander.

```
EXIF-Fotos ──────┐
GPX-Datei ───────┤
KML/KMZ ─────────┼──> [Adapter] ──> Internes Routenmodell ──> [Adapter] ──> Export (GPX/KML)
Strava-GPX ──────┤
Google-Timeline ─┘   (JSON/EU-CSV; nur extrahierte Stopps, kein Roh-Dump)
```

#### Tier 1 — Quick Wins (niedriger Aufwand, gutes Verhältnis)

| Feature | Aufwand | Mehrwert | Hinweis |
|---------|---------|----------|---------|
| **Strava als Link** (+ optional GPX) | niedrig | mittel–hoch | Nur String-Feld; **ToS-sicher** (keine API-Nutzung). Strava-Teilen-Link/QR gibt auch private Aktivitäten gezielt frei. Optionaler GPX-Track (über Import-Adapter) macht Erinnerung Strava-unabhängig — wichtig für „nach Jahren noch wissen". |
| **Ver-/Entsorgung als Stopp-Typ** | niedrig | mittel | Ein zusätzlicher `StopType` (Frischwasser, Grau-/Schwarzwasser); fehlt in generischen Karten-Apps |
| **Wetter pro Stopp** | niedrig | niedrig–mittel | Koordinaten liegen vor; freie API (z. B. Open-Meteo, kein Key/keine Kosten) |
| **Pack-/Abfahrts-Checklisten** | niedrig | niedrig–mittel | Geringer Bauaufwand, wiederkehrender Nutzen |

#### Tier 2 — Hoher Mehrwert, mittlerer Aufwand

| Feature | Aufwand | Mehrwert | Hinweis |
|---------|---------|----------|---------|
| **GPX/KML/KMZ Import & Export** | mittel | hoch | Deckt **Google MyMaps** (über dessen KML-Export/Import), Komoot, Garmin, OsmAnd u. v. m. in einem ab. Kein Vendor-Lock. **Ersetzt die ursprüngliche „MyMaps-Integration" sauber.** Über Adapter (s. o.). |
| **Google-Timeline-Import** | mittel | hoch | Reichere Datenquelle als EXIF (semantisch erkannte Visits + Bewegungssegmente), stärkt den Kern-USP. ⚠️ **Nur manueller Datei-Import** — seit 2024/2025 on-device, keine API/kein Takeout-Cloud-Export mehr. User exportiert `Timeline.json` aus Google Maps, App liest via File-Picker. EU-Variante teils **CSV** → zweiter Parser. Undokumentiertes Format (Community-Schema/GPSBabel) → Wartungsrisiko. ⛔ **DSGVO:** nur extrahierte Stopps/Route speichern, **niemals** den rohen Timeline-Dump (vollständiges Bewegungsprofil). Über Adapter (s. o.). |
| **Reisekosten-Tracking** (Sprit, Stellplatz, Maut/Vignette pro Land) | mittel | mittel | Ergänzt das Roadbook natürlich; Budget pro Reise |
| **Reise-Story-Export** (PDF / read-only Web-Link) | mittel–hoch | mittel–hoch | Reise mit Fotos + Karte teilen, ohne dass der Empfänger die App braucht |
| **Proaktive Reiseerkennung aus der Galerie** | mittel | hoch | „Polarsteps rückwärts": App scannt Galerie und schlägt von selbst Roadbooks für noch nicht erfasste Zeiträume vor. Signal = **GPS-Distanz von zu Hause + zeitliche Häufung + Mehrtägigkeit** (keine Bilderkennung nötig). Baut auf EXIF-Clustering (§4) auf. ⚠️ Inkrementell scannen (Akku); iOS „Limited Photo Access" kann Auto-Scan untergraben; DSGVO: on-device, nur Metadaten; Schwelle gegen Falsch-Positive (Wochenendausflug ≠ Reise). |

#### Tier 3 — Strategisch / hoher Aufwand

| Feature | Aufwand | Mehrwert | Hinweis |
|---------|---------|----------|---------|
| **Offline-Karten & -Modus** | hoch | hoch | ⚠️ **Trotz hohem Aufwand früh mitdenken** — beeinflusst die Sync-Architektur, nicht nachträglich nachrüstbar. Architektur-Weiche, kein „spät". **Schema-Weichen siehe §5.4** (Client-UUID, Soft-Delete, Sync-Felder — JETZT setzen). Unterwegs oft kein Netz = Kernbedarf der Zielgruppe. |
| **Stellplatz-/Camping-POI-Integration** (park4night, Campercontact, ADAC) | hoch | hoch | Killer-Feature für Wohnmobilisten. **[ANNAHME]** APIs teils kostenpflichtig/restriktiv — Terms vor Integration prüfen. |
| **Wohnmobil-Routing** (Höhe/Gewicht/Breite-Restriktionen) | hoch | hoch (Nische) | Externe Routing-API nötig; echtes Schmerzthema, aber komplex. Spät. |
| **Live-GPS-Tracking** (opt-in) | hoch | mittel | „App kann beides" (live tracken *oder* rekonstruieren) = flexibler als Polarsteps. ⚠️ **Erst nach USP-Validierung** — tritt sonst gegen Polarsteps' optimierte Kernstärke an (gratis, 20 Mio. User, <4 % Akku/Tag). Technik: Background-Location ist Plattform-Minenfeld (iOS „Always"-Permission + Review-Hürde, Android Foreground-Service, Batterie). ⛔ DSGVO: invasivstes Bewegungsprofil. **Wichtig:** Google-Timeline-Import (Tier 2) deckt den Großteil des Nutzens günstiger ab — Google trackt bereits batterieoptimiert. Live-Tracking nur, wenn echtes Echtzeit-Sharing gewünscht ist. |
| **Bilderkennung als Komfort-Add-on** (opt-in) | mittel–hoch | niedrig–mittel | On-device-ML (MLKit/TensorFlow Lite) **nicht** als Reise-Detektor (GPS+Zeit ist überlegen), sondern für Komfort: automatisches Titelbild pro Stopp, grobe Foto-Kategorisierung. Nur falls Kapazität übrig. Cloud-ML ausgeschlossen (DSGVO). |

#### Verworfen / zurückgestuft

| Idee | Status | Grund |
|------|--------|-------|
| Strava-API-Vollintegration | **zurückgestuft → Link-First** | ToS-Risiko, Konflikt mit Multi-User-Sharing, unnötiger Aufwand |
| Google MyMaps direkte Integration | **verworfen → via KML** | Keine offizielle API; durch GPX/KML-Import/Export abgedeckt |
| Strava-Embed (iframe) | **nicht empfohlen** | Nur für öffentliche Aktivitäten, WebView-Aufwand, zuletzt instabil (Ausfälle Jan 2026) |
| Wohnmobil-Bilderkennung als Reise-Filter | **verworfen → GPS+Zeit** | Falsches Signal: die meisten Reisefotos zeigen kein Wohnmobil (würden verworfen), und ein Wohnmobil im Bild beweist keine Reise. GPS-Distanz + Zeit erkennt Reisen zuverlässiger, kostenlos, ohne ML. (Bilderkennung nur als Komfort-Add-on, Tier 3.) |

---

## 9. Kritische „One-Way-Door"-Entscheidungen (jetzt korrekt setzen)

Teuer rückgängig zu machen — daher trotz MVP von Anfang an richtig:

1. **RLS + `owner_id`/`shared_with` ab Tag 1.** Multi-Tenant nachträglich einzuziehen = kompletter Datenmodell-Umbau + Migration. Teuerster vermeidbarer Fehler.
2. **Bilder ausschließlich über R2** (nie Supabase Storage). Sonst Egress-Kostenfalle + spätere URL-Migration.
3. **EU-Region + keine EXIF-vollen Originale speichern.** Erspart spätere DSGVO-Nacharbeit.
4. **Offline-ready Schema + Offline-First-Schreibpfad ab Tag 1** (s. §5.4): Client-UUIDs statt serial, Soft-Delete (`deletedAt`), `updatedAt`-Sync-Feld. Die volle Sync-Engine kommt später — aber Schema und Schreibpfad nachträglich umzustellen = Datenmigration + Umbau des gesamten Datenflusses.

Alles andere (Payment, Sharing-UI, Store, Sync-Tool-Wahl) ist additiv und blockiert nichts.

---

## 10. Roadmap

```
[TODO] Phase 0 – Setup
  - Expo (TypeScript) + privates GitHub-Repo (nur Code)
  - Lokale Dev-Umgebung: Supabase CLI (Docker-Stack) — kein Cloud-Pausing (s. §6.3)
  - Supabase-Cloud-Projekt (Region: eu-central-1 / Frankfurt) + R2-Bucket
  - EAS Build konfigurieren (iOS ohne Mac)
  - RLS-Grundgerüst + Auth-Flow (Sign-up/Login)
  → Checkpoint: User kann sich registrieren & einloggen

[TODO] Phase 1 – Multi-Tenant CRUD
  - Roadbooks/Routen/Stops mit RLS (inkl. WITH CHECK + Soft-Delete-Filter)
  - RLS-Policy-Tests in CI (Mandantentrennung nachweisen — s. §12a)
  - Kartenansicht: MapLibre + Protomaps/PMTiles auf R2 (Regionalausschnitt)
  - Offline-ready Schema (Client-UUID, Soft-Delete, updatedAt — s. §5.4)
  - Offline-First-Schreibpfad: lokale SQLite zuerst (volle Sync-Engine erst Post-MVP)
  → Checkpoint: 2 Test-User, nachweislich isolierte Daten (per Test belegt)

[TODO] Phase 2 – Foto-Import & Routenvorschlag
  - expo-image-picker + EXIF/GPS (ACCESS_MEDIA_LOCATION!)
  - Clustering + Reverse-Geocoding (Nominatim)
  - Komprimierung (expo-image-manipulator) → R2-Upload
  - Editier-UI für Vorschläge
  → Checkpoint: Bilder → editierbarer Routenvorschlag

[TODO] Phase 3 – Sharing & Sync-Robustheit
  - Roadbook teilen (Einladung via E-Mail/Code)
  - Konfliktauflösung (last-write-wins → optimistic locking)
  → Checkpoint: geteiltes Roadbook, 2 User

[TODO] Phase 4 – Produktreife
  - DSGVO: Datenschutzerklärung, Lösch-/Exportfunktion, AVVs
  - Monetarisierung (z. B. RevenueCat für IAP) — Modell dann entschieden
  - Foto-/Standort-Permission-Begründungen
  → Checkpoint: store-ready

[TODO] Phase 5 – Launch
  - EAS Build iOS/Android
  - TestFlight + Play Internal Testing
  - Store-Reviews
```

---

## 11. Risiko-Register

| Risiko | Kategorie | Schwere | Mitigation |
|--------|-----------|---------|------------|
| Mandantentrennung-Leck (RLS) | Security | Hoch | RLS mit `WITH CHECK` + Soft-Delete-Filter; **automatisierte RLS-Policy-Tests** (s. §12a) |
| Verwaiste R2-Objekte nach Löschung | Security/Recht/Kosten | Hoch | Lösch-Lebenszyklus (Edge Function/GC); echter Hard-Delete für DSGVO |
| Karten-Tiles/Geocoding: OSM-Policy verbietet kommerziell+offline | Recht/Kosten | Hoch | Protomaps/PMTiles auf R2 (self-hosted, erlaubt); eigener Photon-Geocoder |
| Geocoding öffentliche Nominatim-Instanz | Recht/Betrieb | Hoch | Eigener Dienst Pflicht (kommerziell + >1 req/s unzulässig) — **nicht** „niedrig" |
| Supabase Egress-Kosten bei Fotos | Performance/Kosten | Hoch | Bilder über R2 (kein Egress) |
| Multi-Tenant nachträglich | Data Integrity | Hoch | RLS ab Tag 1 |
| Offline nachträglich (Schema-Migration) | Data Integrity | Hoch | Offline-ready Schema ab Tag 1 (§5.4) |
| GPS = personenbezogene Daten | Security/Recht | Hoch | EU-Region, Verschlüsselung, keine Roh-EXIF, Betroffenenrechte |
| Bilder ohne GPS | UX | Mittel | Manuelle Zuordnung als Fallback |
| Free-Tier-Pausierung | Betrieb | Mittel | Vor Launch auf Pro wechseln |
| Backend-Kosten > Einnahmen | Wirtschaftlich | Mittel | Abo-/Freemium-Modell |
| Backup-Konsistenz (DB ↔ R2 getrennt) | Data Integrity | Mittel | Abgestimmte Backup-Strategie (s. §12a) |
| iOS-Submit ohne Mac | Build | Niedrig | EAS Build; App Store Connect ggf. manuell |

---

## 12a. Test- & Ops-Strategie

Bisher nicht adressiert — für ein Multi-Tenant-Produkt mit Security-Priorität essenziell.

**Testing:**
- **RLS-Policy-Tests (kritisch):** Automatisierte Tests, die *beweisen*, dass User A nicht auf Daten von User B zugreifen kann — für SELECT/INSERT/UPDATE/DELETE und über alle Tabellen (inkl. Child-Tabellen via Subquery). Diese Tests sind der Sicherheitsnachweis der Mandantentrennung und gehören ab Phase 1 in CI.
- Unit-Tests für Clustering-/Adapter-Logik (EXIF→Route, GPX/KML-Parser).
- Integrationstests für den Offline-Sync (Konflikt, Soft-Delete, Resurrection).

**Ops / Betrieb:**
- **Backup-Strategie (zwei getrennte Domänen!):** Supabase-Backups (Pro) enthalten **nicht** die R2-Bilder. Beide müssen abgestimmt gesichert werden, sodass ein Restore konsistent ist (DB-Referenz ↔ vorhandenes R2-Objekt). Restore-Test einplanen.
- **DB-Migrations:** Schema-Versionierung über Supabase CLI Migrations (versioniert im Git-Repo). Mit Offline-Clients: Client-/Server-Schema-Drift bedenken — alte App-Versionen mit altem Schema müssen tolerant behandelt werden (additive Migrations bevorzugen, keine Breaking Changes ohne App-Mindestversion).
- **Monitoring/Error-Tracking:** Crash-/Error-Reporting (z. B. Sentry) ab Beta. Ohne Observability sind Produktionsfehler bei verteilten Offline-Clients schwer zu diagnostizieren.
- **CI/CD:** Lint + Tests + EAS-Build-Automation im GitHub-Repo (passt zu vorhandener DevOps-Erfahrung).
- **OTA-Updates:** EAS Update für JS-Bugfixes ohne Store-Roundtrip — aber Schema-relevante Änderungen brauchen native Builds + Mindestversions-Logik.

---



```bash
npx create-expo-app@latest roadbook --template
# Supabase-Projekt anlegen (Region: eu-central-1 / Frankfurt)
# Erstes Feature: RLS-Schema + Auth-Flow
```

---

## 13. Annahmen & offene Punkte

- **[ANNAHME]** Backend-Wahl Supabase + R2 abgeleitet aus „Verkauf ohne manuellen Aufwand" + „Multi-User kritisch" + Security/EU-Präferenz. Bei abweichenden Prioritäten neu zu bewerten.
- **[ANNAHME]** Rechtsform/Impressumspflicht (gewerblich vs. privat) noch zu klären.
- **OFFEN** Monetarisierungsmodell — bewusst nach MVP.
- **OFFEN** Auth-Methode (E-Mail/Passwort, OAuth, Magic Link?). Falls Social-Login → „Sign in with Apple" als Option zwingend (Store-Pflicht).
- **OFFEN** Sharing-Flow-Detail: Mapping E-Mail → `user_id`; Einladung für noch-nicht-registrierte Nutzer (Pending-Invite).
- **OFFEN** Geocoder-Lösung final (eigener Photon vs. bezahlter Dienst) — vor Skalierung kalkulieren.
- **OFFEN** Foto-Quota/Limits pro Roadbook (DoS-Schutz + spätere Freemium-Grenze).
- **OFFEN** i18n/Mehrsprachigkeit (Auslandsreisen, internationaler Verkauf).

---

## 14. Markt & Wettbewerb / Pricing

> Recherche-Stand Mai 2026. Preise können sich ändern; Zahlungsbereitschaft ist **[ANNAHME]** (keine harten Marktdaten).

**Kernbefund:** Der Markt ist nicht leer, aber die exakte Kombination (Foto-EXIF-Rekonstruktion + Wohnmobil-Stopptypen + Multi-User-Roadbook) gibt es so nicht. Die eigentliche Hürde ist **nicht der Preis, sondern die Reichweite** gegen kostenlose, etablierte Platzhirsche.

### 14.1 Wettbewerber

**Kategorie A — Reise-Tracking/-Tagebuch (am nächsten zum Kern-USP):**

| App | Modell | Preis | Abgrenzung |
|-----|--------|-------|------------|
| **Polarsteps** | Gratis + Buchverkauf | App kostenlos; Travel Books €36–150; 20 Mio.+ User | **Live-GPS-Tracking** (App muss während Reise laufen), nicht Wohnmobil-spezifisch |
| **FindPenguins** | Freemium-Abo | iOS $4,49/Mo bzw. $29,99/Jahr; Android $4,99/$32,99 | Wie Polarsteps, Live-Tracking |

**Kategorie B — Wohnmobil-Stellplatz-Apps (überlappen nur beim POI-Teil §8.1):**

| App | Preis | Lücke |
|-----|-------|-------|
| **park4night** | Gratis; Premium 9,99 €/Jahr | Kein Roadbook/Reisetagebuch mit Fotos |
| **Campercontact** | Gratis; PRO+ 2,49 €/Mo oder 9,99 €/Jahr | dito |
| iOverlander, Caravanya, Stellplatz-Radar, ADAC Camping, CARAMAPS … | meist Freemium ~10 €/Jahr | reine Stellplatz-Suche |

### 14.2 USP / Differenzierung

Keine App gefunden, die aus *bereits vorhandenen* Foto-Metadaten nachträglich eine editierbare Route rekonstruiert (alle setzen auf Live-GPS-Tracking). Differenzierung auf drei kombinierten Achsen: **Foto-EXIF-Rekonstruktion statt Live-Tracking + Wohnmobil-Stopptypen + Multi-User-Roadbook.**

⚠️ **Ehrliche Einordnung:** Polarsteps ist kostenlos, etabliert (20 Mio. User) und für viele „gut genug". Der USP ist eine Nische innerhalb einer Nische — eher „nettes Feature" als „muss ich haben".

### 14.3 Zahlungsbereitschaft & Preisempfehlung [ANNAHME]

**Markt-Anker:** Zielgruppe zahlt gewohnt ~10 €/Jahr (park4night, Campercontact) — oder nichts (Polarsteps). Das deckelt den Rahmen hart.

| Modell | Realistischer Preis | Bewertung |
|--------|---------------------|-----------|
| **Freemium + Pro-Abo** | ~10–20 €/Jahr | Bester Weg; am Markt-Anker. Gratis-Basis senkt Einstiegshürde gegen Polarsteps |
| Einmalkauf | ~5–15 € | Einfach, aber ab Jahr 2–3 Verlust pro aktivem User (laufende Backend-Kosten, §6) |
| Abo 2–3 €/Monat | ~24–36 €/Jahr | Oberes Ende (FindPenguins-Niveau), für Wohnmobil-Zielgruppe schwer durchsetzbar |

**Verknüpfung mit §6:** Backend kostet ~€0,01–0,26/User/Monat. Ein Abo ab 10 €/Jahr deckt das um ein Vielfaches → Kostendeckung ist **technisch** mühelos. Das Problem ist die **Kundengewinnung**, nicht die Marge.

### 14.4 Strategisches Fazit

- Lücke ist real, aber Preisrahmen eng (~10–20 €/Jahr Freemium/Pro plausibel).
- Eigentliche Hürde: Reichweite/Marketing gegen Polarsteps (gratis, 20 Mio. User).
- Als verkaufbares **Nischenprodukt** realistisch, nicht als Selbstläufer.
- **Pragmatischer Pfad:** Erst MVP für Eigennutzung (~22 €/Monat Betrieb), Foto-Rekonstruktion als Differenzierer schärfen, dann anhand echter Nutzung über Monetarisierung entscheiden. Bestätigt die „erst MVP"-Entscheidung.
