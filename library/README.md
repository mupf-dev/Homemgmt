# Community-Katalog für Möbelarten

Dieser Ordner ist der **Community-Katalog** der Objektbibliothek von Zuhause. Jede Zuhause-Installation liest
`index.json` (über `raw.githubusercontent.com`, ohne Konto oder Schlüssel) und kann die Möbelarten daraus unter
**Mehr → Objektbibliothek → Community** installieren. Wer eine Möbelart beisteuern will, schickt einen Pull Request.

## Eine Möbelart beisteuern

1. In Zuhause unter **Mehr → Objektbibliothek** eine Möbelart anlegen (oder eine Vorlage kopieren) und im Editor
   mit der 3D-Vorschau fertigstellen.
2. **Exportieren** – die App speichert eine Datei `….zuhause-objekt.json`.
3. Datei nach `library/objekte/<name>.json` legen; die Kennung (`id`) auf `community.<name>` setzen.
4. In `library/index.json` einen Eintrag ergänzen (Felder wie bei den vorhandenen, `file` = Pfad zur Datei).
5. Pull Request öffnen. Bitte eine freie Lizenz angeben, am liebsten `CC0-1.0`.

Möbelarten mit **3D-Modell** (`"build": { "type": "modell" }`): das `.glb` nach `library/modelle/` legen und in der
Möbelart als `"model": { "file": "modelle/<name>.glb" }` eintragen (höchstens 50 MB, besser < 5 MB). Beim
Installieren lädt Zuhause das Modell herunter.

Neue **Versionen**: `version` erhöhen (z. B. `1.0` → `1.1`). Installationen zeigen dann „Aktualisieren“; bereits
geplante Möbel behalten ihre Fächer, bis jemand sie im Hausplan bewusst aktualisiert.

## Format `zuhause-objekt/1`

```json
{
  "format": "zuhause-objekt/1",
  "id": "community.schuhschrank-klappen",
  "name": "Schuhschrank mit 2 Klappen",
  "group": "Diele",
  "version": "1.0",
  "author": "…",
  "license": "CC0-1.0",
  "description": "…",
  "size": { "width": 80, "depth": 24, "height": 100, "elevation": 0, "widths": [50, 80] },
  "snapToWall": true,
  "materials": { "carcass": "lack-white", "front": "lack-white" },
  "build": {
    "type": "korpus",
    "plinth": 0,
    "board": 1.6,
    "back": true,
    "columns": [
      { "size": 1, "elements": [
        { "kind": "drawer", "size": 0.35, "label": "Schublade (Schlüssel)" },
        { "kind": "flap", "size": 1 },
        { "kind": "flap", "size": 1 }
      ] }
    ]
  }
}
```

| Feld | Bedeutung |
|------|-----------|
| `size` | Maße in cm; `elevation` = Abstand vom Boden (z. B. Hängeschrank), `widths` = Breiten-Vorschläge |
| `build.type` | `korpus` (aus Spalten und Elementen) oder `modell` (3D-Modell mit Fächern) |
| `plinth`, `board`, `back` | Sockelhöhe und Plattenstärke in cm, Rückwand ja/nein |
| `columns[].size` | relative Breite der Spalte (von links nach rechts) |
| `elements[].kind` | `drawer` Schublade, `door` Tür, `flap` Klappe, `open` offenes Fach, `cold` Kühlfach, `freezer` Gefrierfach |
| `elements[].size` | relative Höhe (von oben nach unten) |
| `elements[].shelves` | bei `door` und `open`: Anzahl Böden – jeder Boden ist ein eigener Lagerplatz |
| `elements[].label` | eigene Bezeichnung des Fachs (sonst „Schublade 2“, „Tür · Boden 1“ …) |
| `materials` | Kennungen der Materialien (`front`, `carcass`, `handle`, `countertop` …), wie in der App |

Bei `modell`:

```json
"build": { "type": "modell", "model": { "file": "modelle/truhe.glb" },
  "compartments": [ { "label": "Truhe", "kind": "shelf", "box": [0.05, 0.95, 0.1, 0.9, 0.05, 0.95] } ] }
```

`box` = Quader des Fachs als Anteile 0 … 1 von Breite (links → rechts), Höhe (unten → oben) und Tiefe
(hinten → vorne). Jedes Fach wird ein Lagerplatz (Reihenfolge = Fachnummer), höchstens 99 Fächer je Möbel.
