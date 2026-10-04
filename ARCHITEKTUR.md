# Zuhause – Architektur

Zuhause führt **Heimlager** (`inventory`, inkl. Branch `inventory-3d`) und den **Küchenplaner** zu einer vollintegrierten
Lösung zusammen: Die Planungs-Engine des Küchenplaners wird zum **Hausplaner für das ganze Haus**, und die
**Lagerfunktionen leben im Plan** – jedes Fach eines geplanten Möbels ist ein Lagerplatz.

## 1. Ausgangslage und Erkenntnisse

| Verzeichnis    | Was es war | Was übernommen wurde |
|----------------|-----------|----------------------|
| `inventory`    | Heimlager 1.8.1: Lager, Buchungen mit Rückgängig, QR-Scan, Einkaufsliste, Haltbarkeit, Behälter, Fotos, Backups, Import/Export, KI-Assistent, MCP-Server, QR-Schilder für den 3D-Druck, einfacher Haus-Editor (Etagen, Raum-Vielecke, Kisten-Einbauten). Vanilla-JS, `node:sqlite`. | Komplettes Backend (Konten, Lager, Buchungen, Assistent, MCP, Backups) als Modul; ihre Oberfläche wurde vollständig in die App portiert (0.5.0 entfernt). Das Haus-Modell (Etagen, Räume, Dach) floss ins neue Modell ein. |
| `inventory-3d` | Git-Worktree auf `feature/3d-raum`, bereits in 1.8.x gemergt. | Erkenntnis: Es braucht **ein** räumliches Modell für alles (der Weg „ein Raum je Lager“ wurde dort verworfen). |
| `küchenplaner` | Küchenplaner 1.0.0: Wand-Editor mit Fang, prozedurale Schrankmodelle, PBR-Materialbibliothek, Pathtracing, Begehen, E-Mail-Konten, Showroom-Links. TypeScript + Vite + Express. | Die ganze Planungs-Engine (Editor, 3D, Modelle, Materialien) – verallgemeinert vom Raum auf das Haus. |

Wichtigste Erkenntnis: Beide Projekte beschreiben Möbel gleich – Mittelpunkt (x, y), y nach unten, Drehung im
Uhrzeigersinn, Vorderseite lokal nach +y. Nur die Einheiten unterschieden sich (cm/Radiant gegenüber mm/Grad). Damit
konnte die detaillierte Engine des Küchenplaners das Haus-Modell des Lagers ersetzen, ohne Daten zu verlieren (im Lager
war noch kein Haus angelegt).

## 2. Zielbild

```
 Hausplan (ein gemeinsames Dokument)                       Lager (Datenbank)
 ─────────────────────────────────────                     ─────────────────────────────────
 Haus ── Etagen ── Wände, Fenster, Türen                    Lager       = Raum       (Kürzel KU)
             │ └── Räume (aus Wänden erkannt) ───────────►  Spalte      = Möbel      (Buchstabe B)
             └──── Möbel ── Fächer (aus der Front) ───────► Platz/Zeile = Fach       (KU-B2)
                                                            Gegenstände liegen auf Plätzen
```

- **Ein Server** (`server/index.ts`, Express, TypeScript ohne Build), **eine Datenbank** (`data/zuhause.db`),
  **ein Konto** (die Personen des Lagers; Anmeldung per Kachel oder E-Mail, eine Sitzung für alles).
- **Eine App** unter `/` (TypeScript/Vite, Dateien unter `/app/`): Hausplaner, 3D, Lager im Plan, Verwaltung.
- **Ein Modell-Code** für Server und App: `web/app/src/model/` (reines TypeScript, läuft im Browser und per
  Type-Stripping auf dem Server).

## 3. Datenmodell

Alle Maße im Plan in **cm**, 3D in Metern. Gespeichert als ein JSON-Dokument in der Tabelle `house` (mit Version).

```ts
House  { version: 2, name, floors: Floor[], slots, customMaterials, uv, settings }   // Materialien/Licht hausweit
Floor  { id, name, kind: basement|floor|attic|outdoor, elevation, height,
         walls, openings, items, rooms: Room[], code?, underlay?, roof? }
Room   { id, name, code /* Lager-Kürzel */, seed /* Klickpunkt */, polygon? /* erkannt */, floorMaterial? }
Item   { …Küchenplaner-Felder…, levels? /* Böden/Schubladen */, label? /* eigener Name */, storageCol? /* Spalte */ }
```

**Etage = Planung.** Editor, 3D-Szene und Modelle des Küchenplaners arbeiten unverändert mit einer „Planung“ (`Project`).
`floorView(house, floor)` liefert die aktive Etage in dieser Form: Wände, Öffnungen, Möbel und Vorlage gehören zur Etage,
Name, Materialien und Einstellungen zum Haus – Lesen und Schreiben gehen direkt durch. So blieb die ausgereifte Engine
erhalten und das Haus kam darüber.

**Räume** (`model/rooms.ts`): Die Wandachsen bilden einen ebenen Graphen (T-Stöße und Kreuzungen werden geteilt); jede
geschlossene Fläche ist ein möglicher Raum. Ein Raum merkt sich nur einen Punkt und bekommt die kleinste Fläche, die
ihn enthält – verschiebt man Wände, folgt der Raum.

**Fächer** (`model/storage.ts`): je Möbelart aus derselben Frontaufteilung wie die 3D-Modelle – Schubladen nach den
Höhenverhältnissen der Auszüge, Böden hinter Türen, Kühl- und Gefrierfächer, offene Regalböden, Ablageflächen.
„Schublade 2“ im Lager ist die zweite Schublade im Bild.

**Objektbibliothek** (`model/objects.ts`): Möbelarten als Daten im Format `zuhause-objekt/1` – entweder ein **Korpus**
(Sockel, Plattenstärke, Spalten mit Elementen: Schublade, Tür mit Böden, offen, Klappe, Kühl-/Gefrierfach) oder ein
**3D-Modell** mit Fächern als Bereiche (0…1 je Achse). Aus derselben Beschreibung entstehen 3D-Möbel (`buildKorpus`),
Fächer (`objectCompartments`) und Katalog-Symbol. Möbel tragen `type: "obj:<id>"`. Die Bibliothek liegt auf dem Server
(Tabelle `object_types`, Quelle eigene/importiert/community); das **Haus hält eine Kopie** jeder verwendeten Möbelart
(`House.objectTypes`), damit Bibliotheksänderungen keine Adressen verschieben – neue Versionen nur auf Wunsch.
Community-Katalog: `library/index.json` (`zuhause-katalog/1`) im GitHub-Repo, Beiträge per Pull Request, gelesen über
`OBJECT_CATALOG_URL` ohne Schlüssel. Die eingebauten Möbel bleiben im Code (bestehende Adressen stabil); die Vorlagen im
Editor bilden sie als Korpus nach.

**Normalisieren** (`model/house.ts`, `normalizeHouse`): erkennt Räume, vergibt eindeutige Lager-Kürzel (Kürzel anderer
Lager sind reserviert) und Spaltenbuchstaben je Raum. Möbel, die im Raum bleiben, behalten ihre Buchstaben vorrangig –
Adressen ändern sich nur, wenn ein Möbel wirklich umzieht. Läuft in der App bei jeder Änderung (Anzeige) und auf dem
Server beim Speichern (verbindlich).

## 4. Abgleich Hausplan ↔ Lager

`PUT /api/house` (nur Admins, mit `base_version` gegen gleichzeitiges Überschreiben) normalisiert den Plan und gleicht in
**einer Transaktion** das Lager ab (`server/haus/index.ts`, `syncStorage`):

| Im Plan | Im Lager |
|---------|----------|
| Raum (oder Etage für Möbel außerhalb von Räumen) | Lager mit Kürzel und Name (`warehouses.plan_key`) |
| Fach eines Möbels | Platz `Spalte = Möbel-Buchstabe`, `Zeile = Fach-Nr.`, Name „Möbel · Fach“, Kategorie = Raum (`places.plan_item`, `plan_slot`) |
| Möbel zieht in anderen Raum / bekommt andere Spalte | Plätze **und Gegenstände** wandern mit (über Zwischenplätze, damit getauschte Spalten sich nicht blockieren) |
| Möbel oder Fach entfernt | leerer Platz wird gelöscht, Platz mit Inhalt bleibt („nicht mehr im Plan“) |
| Raum entfernt | leeres Lager wird gelöscht, sonst vom Plan gelöst |
| Ziel-Platz von Hand angelegt und belegt | Speichern wird mit verständlicher Meldung abgelehnt (409) |

Weil Plan-Plätze ganz normale Lagerplätze sind, funktionieren Suche, Scan, QR-Etiketten, Einkaufsliste,
MCP-Werkzeuge und Assistent sofort mit ihnen („leg die Batterien in die Besteckschublade“ findet den Platz per Namen).
`GET /api/house/storage` liefert der App den Inhalt aller Fächer.

## 5. Die App

**Rahmen (0.6.0):** eine Navigation für alle Seiten (`shell.ts`: Übersicht, Haus, Suchen, Einkauf, Mehr; Handy: Leiste
unten mit Scannen). Das Haus hat zwei Modi: **Ansehen** (Normalfall; `Plan2D.viewOnly`, Fächer und Inhalt in der
Seitenleiste bzw. als Blatt von unten) und **Planen** (Werkzeugleiste, ausklappbare linke Leiste; nur mit `persons.can_plan`,
Admins immer). Einstellungen pro Person (`persons.prefs`, `prefs.ts`): Startseite, 2D/3D, Hell/Dunkel, Schriftgröße.
Ein Icon-Satz (`icons.ts`) statt Emoji. Buchungen ohne Verbindung merkt `lager/outbox.ts` vor (Server erkennt
Wiederholungen an `request_id`). **Wandterminals** (`terminals`, `terminal.ts`): Geräte-Cookie über einen
Einrichtungslink, Buchen nur mit gewählter Person, Hoch-/Querformat, Ruhezustand mit Licht nach Tageszeit und Wetter
(`/api/weather`: Ort per OpenStreetMap, Wetter per Open-Meteo, beides ohne Schlüssel).

| Bereich | Funktion |
|---------|----------|
| Etagen | Reiter in der Kopfzeile, Etage anlegen (darüber, Keller, Dachgeschoss, Außen; Außenwände übernehmen), Name/Art/Höhenlage/Raumhöhe; die Etage darunter erscheint im 2D-Plan gestrichelt |
| Räume | Werkzeug „Raum festlegen“ (Vorschau der erkannten Fläche), Name → Kürzel, Fläche in m², eigener Bodenbelag, Liste der Möbel mit Adressen |
| Möbel | Küchenkatalog plus Regal, Schwerlastregal, Vorratsschrank, Kleiderschrank, Sideboard, Kommode, Werkbank; Anzahl Böden/Schubladen; eigener Name; Spaltenbuchstabe am Möbel im Plan |
| 3D | Etage / bis hier / ganzes Haus (gestapelt, mit Geschossdecken), Möbel-Bibliothek (Poly Haven CC0 über deren API, FurniMesh über die öffentlichen Bibliotheksseiten – GLB wird serverseitig verkleinert und skaliert, `server/kueche/furnimesh.ts`), Pathtracing, Begehen mit Kollision und Etagenwechsel über Treppen (`walker.ts`), Showroom wie bisher |
| Lager im Plan | „Lager“ färbt alle Fächer nach Füllstand (leer, belegt, läuft ab, abgelaufen); Fach anklicken → Inhalt, einbuchen, entnehmen, vorhandenen Gegenstand umlagern, im Lager öffnen |
| Suche | „Wo liegt …?“ sucht im ganzen Lager, lässt Treffer im Haus leuchten, springt zu Etage, Möbel und Fach |
| Speichern | automatisch auf dem Server (Recht „Haus planen“), Konfliktdialog bei gleichzeitiger Bearbeitung, Entwurf zusätzlich im Browser; Benutzer sehen den Plan und buchen, ändern ihn aber nicht |
| Übernahme | erstes Anlegen aus dem Browser-Entwurf; gespeicherte Küchenplanungen „als Etage“ übernehmen; Datei-Import von Haus- und Planungsdateien |

## 6. Bewusste Zwischenstände

- **Alte Lager-Oberfläche entfernt (0.5.0).** Alles läuft in der App; `/alt/` leitet auf `/`, `/sw.js` meldet den
  früheren Service-Worker ab. Die Server-API des alten Haus-Modells (`/api/site`, Tabellen `floors`/`fixtures`) besteht
  noch für die Übernahme (`import-prod`) und kann später entfallen.
- **Lager-Backend als `.cjs`** (inhaltlich Heimlager 1.8.1 plus Konto-Erweiterungen). Typisierung folgt.
- **Dach** wird als Satteldach mit Kniestock in der Haus-Ansicht gezeichnet; Dachschrägen begrenzen Möbel noch nicht.
- **Haus aus dem Lager-Modell** (`model/fromSite.ts`): Wände werden aus Raumgrenzen abgeleitet – Räume, die sich ohne
  Abstand berühren, gelten als offen verbunden (keine Wand). Solche Räume haben einen **festen Umriss** (`Room.manual`).
- **Kürzel-Änderungen** benennen alle Plätze eines Raums um – gedruckte Etiketten passen dann nicht mehr (Hinweis in der App).
- Gespeicherte Küchenplanungen (`kitchen_projects`) bleiben als Importquelle erhalten.

## 7. Roadmap

1. ~~Möbel- und Einrichtungsbibliothek, Haus-Ansicht verfeinern~~ (0.5.0: Poly Haven + FurniMesh, Begehen mit Treppen).
   Offen: Begehen per Touch, Kollision mit dem Kopf unter Dachschrägen.
2. **Gegenstände im Fach sichtbar** (Kisten/Fotos wie im alten 3D), Behälter als Objekte im Fach.
3. **Haus vervollständigen:** Dachgeschoss mit Satteldach, Treppen zwischen Etagen, Außenbereich (Carport, Terrasse),
   Grundriss-Vorlage je Etage mit Ausrichtung zur Etage darunter.
4. **Lager-Backend nach TypeScript** in Module (Konto, Lager, Buchungen, Assistent, Backups), Express-Router statt
   eigenem Router; ein three.js für alles.
5. **Varianten:** Planungsstände als Entwürfe neben dem gültigen Haus (z. B. „Küche neu 2027“), Showroom-Link fürs Haus.

## 8. Umstieg

1. Heimlager und Küchenplaner beenden, dann einmalig
   `npm run migrate -- --lager ../inventory/data/lager.db --kueche ../küchenplaner/data/kuechenplaner.db`.
2. `npm run build && npm start` (oder `npm run dev`), als Admin `/` öffnen → „Hausplan anlegen“.
3. Über das Kontomenü „Gespeicherte Planungen übernehmen“ die EG-Planung als Etage holen, mit „Raum festlegen“ die
   Räume benennen – ab dann sind alle Schränke im Lager.
