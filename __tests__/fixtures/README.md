# Test-Fixtures

## samsung-s23-exif.json

Enthält die rohen EXIF-Felder wie sie `expo-image-picker` (asset.exif) auf dem
Samsung Galaxy S23 zurückgibt — notwendig um zu verifizieren dass unser GPS-Parsing
das Samsung-Format korrekt verarbeitet.

### Wie extrahieren?

**Variante A — via ADB (empfohlen, erhält GPS):**
```bash
# Fotos vom Gerät ziehen (GPS bleibt erhalten)
adb pull /sdcard/DCIM/Camera/ ./tmp-photos/

# EXIF als JSON extrahieren (nur die relevanten GPS/Zeit-Felder)
exiftool -json -DateTimeOriginal -GPSLatitude -GPSLongitude \
         -GPSLatitudeRef -GPSLongitudeRef \
         ./tmp-photos/*.jpg > __tests__/fixtures/samsung-s23-exif.json

# Temp-Fotos löschen (nicht ins Repo!)
rm -rf ./tmp-photos/
```

**Variante B — EXIF-Viewer-App auf Android:**
App "Exif Metadata" oder ähnliche installieren → jedes Foto öffnen → GPS-Felder
manuell ablesen und in die JSON-Datei eintragen.

### Erwartetes Format (Samsung Galaxy S23)

Die Felder kommen aus dem Android ImagePicker `asset.exif`-Objekt:

```json
[
  {
    "FileName": "20260514_152044.jpg",
    "DateTimeOriginal": "2026:05:14 15:20:44",
    "GPSLatitude": [47.0, 0.0, 0.0],
    "GPSLatitudeRef": "N",
    "GPSLongitude": [10.5, 0.0, 0.0],
    "GPSLongitudeRef": "E"
  }
]
```

Achtung: `GPSLatitude` kann ein Array `[deg, min, sec]`, ein Dezimalwert, oder
ein Rational-String `"45/1"` sein — das Format variiert je nach Kamera/App.
Der Test prüft genau das.
