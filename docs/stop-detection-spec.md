# Spec: Stopp-Erkennung aus Foto-Metadaten

> Status: **umgesetzt** in `src/lib/photos/clustering.ts` + `suggestion.ts`
> (Tests: `__tests__/clustering.test.ts`, `__tests__/suggestion.test.ts`).
> Bezug: README §4 ("Route aus Foto-Metadaten"), Stopp-Typen `campingplatz | stellplatz | freistehend`.
>
> Übernachtungen werden über die **Nachtlücke** im Zeitverlauf erkannt (Schritt
> 2c), nicht über „zwei Fotos am selben Ort" — so kollabieren Routen nicht mehr
> zu einem Stopp, wenn nur ein Teil der Plätze abends+morgens fotografiert wurde.
>
> Bekannte MVP-Grenze: Wenn das *letzte* Foto eines Tages ausnahmsweise am
> Ausflugsziel (statt am Camp) entsteht und danach nur noch woanders fotografiert
> wird, kann die Nachtlücke am Ausflugsziel verankert werden. Selten, über die
> Editier-UI korrigierbar.

## 1. Ziel & Domänen-Annahme

Aus einer Menge GPS+Zeit-getaggter Fotos einer Camper-Reise einen
**chronologischen Routenvorschlag** erzeugen, dessen Stopps den realen
**Übernachtungs-/Parkorten** entsprechen — nicht jedem Ort, an dem ein Foto
entstand.

Kern-Annahme der Domäne:

> Eine **Basis** ist ein Ort, an dem man verweilt/übernachtet und ggf. mehrfach
> ist. Ein **Ausflugspunkt** (Wanderung, Radtour, Aussichtspunkt) wird einmalig
> und kurz besucht und soll **keinen** eigenen Stopp erzeugen.

## 2. Warum die aktuelle Logik nicht reicht

Heute (`clusterPhotos`): sequenziell, „neuer Stopp, sobald das nächste Foto
> 500 m entfernt ist". Zwei Schwächen:

1. **Ausflüge erzeugen Geister-Stopps.** Jede Wanderung/Radtour > 500 m wird zu
   eigenen Stopps — egal ob man danach an die Basis zurückkehrt.
2. **Ein Distanz-Schwellwert kann „Ausflug" und „Umzug" nicht trennen.**
   - Klein (500 m): Ausflüge splitten fälschlich.
   - Groß (z. B. 20 km): Radtouren sprengen ihn *trotzdem*, und zwei echte
     Stellplätze 15 km auseinander verschmelzen fälschlich.

Ein **einzelner** Distanz- *oder* Zeit-Schwellwert ist also strukturell
ungeeignet. Wir messen das Falsche (Bewegung zwischen Fotos) statt der
relevanten Größe (**Bedeutung eines Ortes**).

## 3. Modell: Ort → Besuch → Stopp

Drei Ebenen statt einer:

- **Ort (Place):** räumlicher Cluster von Fotos (~500 m). „Wo."
- **Besuch (Visit):** ein zeitlich zusammenhängender Aufenthalt an einem Ort.
  Ein Ort kann **mehrere** Besuche haben (Rundreise: Start- und End-Nacht am
  selben Campingplatz). „Wann/wie oft."
- **Stopp (Stop):** ein Besuch, der **signifikant** genug ist (genug
  Verweildauer / Übernachtung / Wiederkehr). Ausflüge sind nicht signifikant
  und fallen weg.

Entscheidend für die Besuchs-Trennung:

| Zwischen zwei Fotos desselben Orts liegt … | neuer Besuch? |
|---|---|
| eine **Tageswanderung / Radtour** (transient, kehrt zurück) | **nein** |
| eine **Übernachtung / signifikanter Aufenthalt woanders** | **ja** |

> **Nicht jede Abwesenheit trennt — nur ein signifikanter Aufenthalt woanders
> trennt.** Radius des Ausflugs ist damit irrelevant (löst die Radtour-Lücke).

## 4. Pipeline

```
Fotos (GPS+Zeit)
  → 1. räumlich clustern            → Orte
  → 2. Signifikanz je Ort messen    → Ort ist Stopp-fähig? (Verweildauer/Übernacht/Wiederkehr)
  → 3. signifikante Orte in Besuche splitten (Trenner = signifikanter Aufenthalt woanders)
  → 4. Besuche chronologisch ordnen → Stopps (Rollen: start/stop/end)
  → 5. Ausflugs-Fotos als Anhang am umgebenden Stopp-Tag; GPS-lose Fotos = unassigned
```

### Schritt 1 — Räumlich clustern (zeit-agnostisch)
Alle Fotos eines Orts zusammenfassen, **Zeit ignorieren**. Greedy/Union-Find:
zwei Fotos gehören zum selben Ort, wenn ihr Abstand < `PLACE_RADIUS_M` (Start:
500 m). (Saubere Variante später: einfache Single-Link-Agglomeration.)

### Schritt 2 — Signifikanz je Besuch
Ein Besuch eines Orts ist **stopp-fähig**, wenn mindestens eines gilt:
- **(a) Übernachtung im eigenen Span:** die Fotos des Besuchs spannen eine
  Nachtgrenze (Abend + nächster Morgen am selben Ort) — *immer* ein Stopp,
  dauerunabhängig, **oder**
- **(b) Tages-Verweildauer** ≥ `MIN_DAYTIME_DWELL_MIN` (Start: **180 min ≈ 3 h**)
  — befördert echte Tagesziele (Stadt-, Strandtag) zum Stopp, **oder**
- **(c) Nachtlücke danach:** zwischen dem letzten Foto dieses Orts und dem
  nächsten Foto liegt eine **lange Nachtpause** (≥6 h, die das Nachtfenster
  berührt) → dort wurde geschlafen. **Das ist der entscheidende Punkt:** ein
  Camp wird so auch erkannt, wenn nur **einmal** (z. B. nur abends) fotografiert
  wurde — (a)/(b) würden es verpassen, **oder**
- **(d) Wiederkehr:** der Ort hat ≥ 2 Besuche (siehe Schritt 3).

Zusätzlich ist das **Reise-Ende** garantiert ein Stopp: das allerletzte Foto hat
keine nachfolgende Nachtlücke, also kann (c) es nicht sehen — der Besuch mit dem
spätesten Foto wird daher direkt zum Stopp erklärt. (Der *erste* Camp braucht
keine Sonderregel: (c) erkennt ihn über die Nachtlücke zum nächsten Tag; ein
echter Ausflug *vor* dem ersten Camp bleibt dagegen Anhang, wie entschieden.)

> **Designentscheidung:** „Geschlafen = Stopp" ist das robuste Leitsignal, und
> es wird über die **Zeitlücke** erkannt, nicht über „zwei Fotos am selben Ort".
> Ein reiner Tagesort wird nur ab ~3 h zum Stopp; das hält kurze Ausflüge
> (Wanderung, Picknick, Mittagspause, Fährwarten) aus der Stopp-Liste heraus.

Nicht stopp-fähige Besuche = **Durchgangs-/Ausflugspunkte** → kein eigener
Stopp; ihre Fotos werden in Schritt 5 angehängt.

### Schritt 3 — Besuche bilden
Für jeden stopp-fähigen Ort die zugehörigen Fotos chronologisch durchgehen.
Ein **neuer Besuch** beginnt, wenn zwischen zwei aufeinanderfolgenden Fotos des
Orts ein **anderer signifikanter Aufenthalt** liegt (= in der globalen
Zeitachse gibt es dazwischen Fotos an einem *anderen* stopp-fähigen Ort, deren
Aufenthalt selbst signifikant ist — typ. eine Übernachtung).

Damit:
- Tagesausflug zwischen zwei Camp-Fotos → kein Trenner → **ein** Besuch.
- Übernachtung(en) woanders zwischen zwei Camp-Aufenthalten → Trenner →
  **mehrere** Besuche desselben Orts.

### Schritt 4 — Stopps & Reihenfolge
Jeder Besuch eines stopp-fähigen Orts = **ein Stopp**, sortiert nach
`arrivalDate` (frühestes Foto des Besuchs). Rollen: erster = `start`, letzter =
`end`, dazwischen = `stop`. Ein Ort mit zwei Besuchen erscheint **zweimal**
chronologisch (Produktentscheidung: zwei separate Einträge, kein „2× besucht").

### Schritt 5 — Ausflugs-Fotos anhängen, GPS-lose unassigned
**Designentscheidung:** Fotos eines nicht-signifikanten (Ausflugs-)Orts werden
**nicht** verworfen oder unassigned, sondern als **Anhang an den umgebenden
Stopp** gehängt — d. h. an den Besuch, der den Ausflug zeitlich umschließt
(z. B. Wanderfotos → Camp-Tag). Zuordnungsregel: der Stopp-Besuch, dessen
Zeitintervall `[arrival, departure]` die Ausflugs-Fotos enthält bzw. (bei
Tagesausflug) der unmittelbar vorausgehende Stopp desselben Tages. **Liegt ein
Ausflug vor dem ersten Stopp (kein vorausgehender Stopp), hängt er an den
nachfolgenden ersten Stopp.**

Diese Fotos erscheinen also in einem separaten Feld des Stopps (z. B.
`attachedPhotoIds`), **getrennt** von den orts-eigenen `photoIds`, damit die UI
„am Stopp entstanden" vs. „Ausflug von hier" unterscheiden kann.

Nur Fotos **ohne GPS/Zeit** landen in `unassignedPhotoIds` (README §4
„Risiko & Fallback" — nichts wird verworfen).

## 5. Parameter (Startwerte, alle tunebar)

| Konstante | Start | Bedeutung |
|---|---|---|
| `PLACE_RADIUS_M` | 500 m | Zwei Fotos = selber Ort |
| Übernachtungs-Regel | Spanne über lokale Nacht | macht **immer** stopp-fähig, dauerunabhängig |
| `MIN_DAYTIME_DWELL_MIN` | 180 min (~3 h) | Tagesort ohne Übernachtung wird erst ab hier ein Stopp |

> Bewusst kein großer Ausflugs-Radius nötig — Ausflüge werden über fehlende
> Verweildauer gefiltert, nicht über Distanz. Die hohe Tages-Schwelle (3 h)
> statt 90 min hält Mittagspausen/Picknick/Fährwarten aus der Stopp-Liste.

## 6. Datenmodell-/API-Änderungen

`Cluster` (clustering.ts) wird zu einem **Besuch** mit mehr Kontext:

```ts
export interface PlaceVisit {
  photoIds: string[];
  lat: number;            // Zentroid des Orts
  lng: number;
  arrivalDate: string;    // frühestes Foto des Besuchs (ISO)
  departureDate: string;  // spätestes Foto des Besuchs (ISO)  ← neu
  placeId: string;        // stabile Orts-ID; gleich bei Wiederkehr  ← neu
  visitIndex: number;     // 0,1,… pro Ort                          ← neu
}
```

`SuggestedStop` (suggestion.ts) bekommt:
- `placeId` / `visitIndex` — damit die UI Wiederkehr erkennen/anzeigen kann.
- `attachedPhotoIds: string[]` — **Ausflugs-Fotos**, die diesem Stopp-Tag
  zugeordnet sind, getrennt von den orts-eigenen `photoIds`.

Öffentliche Funktionsnamen (`clusterPhotos`, `suggestRoute`) bleiben; ggf.
interne Umbenennung. Ausflugs-/Durchgangs-Fotos werden **nicht** als Stopp und
**nicht** unassigned zurückgegeben, sondern in `attachedPhotoIds` des
umgebenden Stopps. `unassignedPhotoIds` enthält nur noch Fotos ohne GPS/Zeit.

## 7. Edge Cases & ehrliche Grenzen

- **Keine Foto an der Basis:** Wird ein Übernachtungsort *nie* fotografiert
  (nur der Wandergipfel), kann **keine** Logik ihn erkennen — die Info fehlt.
  → Auffangen über die Editier-UI (Stopp manuell hinzufügen).
- **Zwei echte Plätze < 500 m an verschiedenen Tagen:** verschmelzen zu einem
  Ort. Schritt 3 trennt sie wieder in zwei Besuche, *falls* dazwischen
  woanders übernachtet wurde — sonst bleibt es ein Stopp (selten, editierbar).
- **Langes Picknick auf Wanderung (1–2 h):** unter 3 h → kein Stopp, Fotos
  hängen am Camp-Tag. Gewollt.
- **Mittags-Durchfahrtsort (< 3 h):** kein Stopp, Fotos als Anhang. Gewollt
  (Stopp-Typen sind übernacht-orientiert); bei Bedarf `MIN_DAYTIME_DWELL_MIN`
  senken.
- **Echter Tagesausflug ≥ 3 h ohne Übernachtung (Stadt/Strand):** wird eigener
  Stopp, Fotos liegen dort (statt schief am entfernten Camp zu hängen).

## 8. Testfälle (Jest, `__tests__/clustering.test.ts` / `suggestion.test.ts`)

1. **Leer** → keine Stopps. *(bestehend)*
2. **Nah in Raum+Zeit** → ein Stopp. *(bestehend)*
3. **Übernachtung am selben Ort** (Abend + Morgen) → **ein** Stopp.
   *(bestehend; muss erhalten bleiben)*
4. **Umzug A→B→C** (je Übernachtung) → drei Stopps `start/stop/end`.
5. **Basis + Tageswanderung** (Camp Abend+Morgen, Gipfel mittags) → **ein**
   Stopp (Camp); Gipfel-Foto in `attachedPhotoIds` des Camp-Stopps.
6. **Basis + 40-km-Radtour** → **ein** Stopp; weite Rad-Fotos in
   `attachedPhotoIds` (Radius irrelevant).
7. **Rundreise** `X(N1) → A → B → C → X(N6-7)` → fünf Stopps, **X zweimal**
   chronologisch (gleiche `placeId`, `visitIndex` 0 und 1).
8. **Tagesziel ≥ 3 h ohne Übernachtung** (Stadt 4 h, danach Camp 30 km weiter)
   → **zwei** Stopps (Stadt + Camp); Stadt-Fotos liegen am Stadt-Stopp.
9. **Kurzer Tages-Halt < 3 h** (Mittagspause 1 h zwischen zwei Camps) → **kein**
   eigener Stopp; Fotos als Anhang am vorausgehenden/umgebenden Stopp.
10. **„Gemischtes" Foto-Muster** (mehrere Camps, nur eines abends+morgens, der
    Rest nur einmal, dazu eine Tageswanderung) → **alle Camps** als Stopps (über
    die Nachtlücke 2c), Wanderung als Anhang. *Regression: vorher 1 Stopp.*
11. **Fotos ohne GPS** → `unassignedPhotoIds`. *(bestehend in suggestion)*
11. **Reihenfolge** unabhängig von Eingabereihenfolge; `arrivalDate` = frühestes
    Foto. *(bestehend)*

### ⚠️ Zu ändernder Bestandstest
`separates a there-and-back trip by movement, not time` (Camp→Oslo→Camp ⇒
heute **3** Stopps). Unter dem neuen Modell hängt es an Oslos Aufenthaltsdauer:
- Oslo transient/< 3 h → **1** Stopp (Bergen), Oslo-Foto in `attachedPhotoIds`.
- Oslo ≥ 3 h oder Übernachtung → **3** Stopps (Bergen · Oslo · Bergen), wobei
  Bergen zweimal mit gleicher `placeId` erscheint.
Test entsprechend in zwei Fälle aufteilen — **bewusste, dokumentierte
Verhaltensänderung.**

## 9. Offene Diskussionspunkte

**Entschieden:**
- ✅ Stopp-Fähigkeit = Übernachtung **oder** Tages-Dwell ≥ ~3 h
  (`MIN_DAYTIME_DWELL_MIN`). Kein 90-Min-Schwellwert.
- ✅ Ausflugs-Fotos = **Anhang** (`attachedPhotoIds`) am umgebenden Stopp,
  nicht `unassigned`.

**Entschieden (Forts.):**
- ✅ Übernacht-Erkennung pragmatisch ohne echte Zeitzone: Spanne ≥ ~6 h, die
  ein Nachtfenster (z. B. 00–06 Uhr, zeitzonen-naiv) berührt. Reicht für MVP.
- ✅ Ausflug ohne vorausgehenden Stopp (ganz am Reiseanfang) → hängt an den
  **nachfolgenden ersten Stopp**, nicht `unassigned`.

**Noch offen (rein technisch, kein Blocker):**
1. Brauchen wir in Schritt 1 wirklich agglomeratives Clustern, oder reicht
   greedy für die MVP-Datenmengen?
```
