# Changelog Heimlager (bis 1.8.1, vor der Zusammenführung)

## 1.8.1 – 2026-10-01

**Haus exportieren und importieren**
- Haus-Editor: „Exportieren“ lädt den aktuellen Stand als JSON-Datei herunter (Etagen, Räume, Öffnungen, Dach,
  Hintergrund-Lage, Einbauten, Fächer mit Lager-Kürzel statt ID – passt auf jedem Server; Bilder selbst nicht)
- „Importieren“ ersetzt nach Rückfrage den Stand im Editor; Fächer ohne passenden Platz werden weggelassen (mit Hinweis),
  gleichnamige Etagen behalten ID und Hintergrundbild; gespeichert wird erst mit „Speichern“

## 1.8.0 – 2026-10-01

**Haus in 3D**
- Administration → **„Haus einrichten“**: Grundriss-Editor für das ganze Haus samt Außenbereich (am besten am PC):
  Etagen (Etage, Dachboden, Außen) mit Höhenlage, Raumhöhe und Deckenstärke; Außenumriss und Räume als Vielecke
  (Rechteck aufziehen, Ecken ziehen und einfügen, Einrasten an anderen Ecken, Kantenlängen in cm); Wände ergeben sich
  automatisch aus „Umriss minus Räume“, berührende Räume sind offen verbunden
- Türen, Durchgänge und Fenster rasten an der nächsten Wand ein; Dachboden mit Satteldach (Neigung, Kniestock, First),
  Warnung für Möbel unter der Schräge; Außen: Carport, Terrasse, Stellplatz
- Hintergrundbild je Etage (PNG/JPEG/WebP) mit Maßstab über zwei Punkte, Verschieben, Drehen, Deckkraft
- Einbauten: Regal, Schrank, Hängeschrank (Abstand zum Boden), Kühlschrank, Stellfläche, Treppe; Fächer mit Plätzen
  aus allen Lagern (Klick oder Ziehen, „ganze Spalte je Boden“)
- Entwurf im Browser gegen Datenverlust, Nachfrage beim Verlassen, Schutz vor gleichzeitigem Bearbeiten
- Lagerplan: Reiter **3D** zeigt das ganze Haus (three.js r186 und polygon-clipping, laden erst beim Öffnen):
  Hausansicht mit auseinandergezogenen Etagen oder einzelne Etage, Wände aufgeschnitten oder in voller Höhe mit Dach,
  echte Tür- und Fensteröffnungen, Fächer nach Füllstand, Infokarte, Suche wechselt auf die Etage und fährt hin
- Platzansicht: „Im Haus zeigen“
- 3D an weiteren Stellen: kleine Ansicht „hier liegt es“ bei Gegenstand und Platz (antippen = groß); Suche „Treffer im Haus
  zeigen“; Haltbarkeit und Einkaufsliste („Wo liegt der Rest?“) zeigen die betroffenen Fächer; „🏠 Im Haus wählen“ in allen
  Platzfeldern (Einbuchen, Zurücklegen, Umlagern); Assistent zeigt bei Antworten mit Plätzen die Stelle (`places` in der
  Antwort, auch bei reinen Fragen); Startseite mit Kachel „Haus“ samt Vorschaubild; Auswertung „Im Haus“ als Heatmap
  (Füllstand, Buchungen 90 Tage, lange nicht angefasst; `GET /api/site/stats`)
- Kleine Ansichten laden erst, wenn sie ins Bild kommen; beim Seitenwechsel werden alle 3D-Ansichten abgebaut
- Gegenstände als Kisten in den Fächern (nah dran; aus der Ferne wie bisher Farbblöcke): Größe nach Menge, Farbe nach Art
  (Verbrauchsmaterial gelb, Behälter blau mit Deckel, abgelaufen rot, läuft bald ab orange), Foto vorne auf der Kiste,
  aufgebraucht blass, ab 8 Gegenständen „+N“; Überfahren zeigt den Gegenstand, Antippen öffnet eine Karte mit „Gegenstand öffnen“;
  die Suche lässt die gefundenen Kisten leuchten
- API: `GET/PUT /api/site`, `GET /api/site/places`, `GET/PUT/DELETE /api/floors/:id/image`; `/api/places/:col/:row`
  liefert `in_room`, `/api/warehouses` `in_house`
- Neue Tabellen `floors`, `floor_images`, `fixtures`, `fixture_slots`

## 1.7.0 – 2026-09-30

**QR-Schilder im Stapel (Administration → QR-Schilder)**
- Neue Seite `#/print3d` (nur Admins): Codes in mehreren Durchgängen in einer **Sammelliste** sammeln – Platzbereiche
  aus beliebigen Lagern, alle Plätze eines Lagers, Objekte per Filter, leere Objekt-Codes; Doppelte werden übersprungen,
  einzelne Einträge per ✕ entfernt. Die Liste bleibt im Browser gespeichert, bis sie geleert wird
- Schilder werden auf Druckplatten verteilt (P1S/X1/A1 256 × 256 mm, A1 mini 180 × 180 mm oder eigene Maße, Abstand
  einstellbar), zeilenweise von hinten links und je Platte mittig; Vorschau aller Platten
- Text je Schild: Plätze mit Adresse, Name oder beidem, Objekte mit Code oder Name
- Downloads: 3MF mit Farben je Platte (jedes Schild ein Objekt aus Grundplatte und QR-Code, bei mehreren Platten als ZIP),
  STL je Platte (ein Farbwechsel für die ganze Platte) oder jedes Schild als einzelne STL
- Größe, Öse und Farben teilen sich Einzel- und Stapeldruck
- `qr3d.js`: `arrange`, `threeMFMulti`, `footprint`, `Mesh.moved`; ZIP/3MF optional mit Deflate (`CompressionStream`)

## 1.6.1 – 2026-09-30

**QR-Code als 3D-Modell**
- 3MF: Farben jetzt als `<m:colorgroup>` (3MF-Materials-Erweiterung) statt `<basematerials>` – Bambu Studio und
  Orca Slicer ordnen Grundplatte und QR-Code so beim Laden automatisch zwei Filamenten zu

## 1.6.0 – 2026-09-29

**Preise prüfen (Einkaufsliste)**
- „💶 Preise prüfen“ sucht im Internet, wo die Einträge gerade am günstigsten sind: je Eintrag das günstigste
  Angebot (Händler, nahe Filiale, Preis, Packung, Preis je Einheit, Pfand, Quellenlink), weitere Angebote aufklappbar,
  dazu eine Einkaufstour je Händler
- Websuche über OpenRouter (`plugins: [{ id: 'web' }]`), je Produkt ein Aufruf, im Hintergrund (3 parallel);
  Ergebnisse 24 Stunden gespeichert (Tabelle `price_checks`)
- Angebote ohne Preis oder Quelle werden verworfen; Quellen, die nicht aus den Suchergebnissen stammen, gelten als „unbestätigt“
- Assistent: neues Werkzeug `preise_recherchieren` (Einkaufsliste oder einzelne Produkte)
- Administration → Assistent: Schalter „Preisrecherche aktiv“ und „Wohnort für die Preisrecherche“;
  nur mit OpenRouter verfügbar (`AI_WEB_SEARCH=1` erzwingt es)

**Anleitung**
- Administration → Anleitung: 20 Kapitel zur Bedienung (inkl. Admin-Kapitel) mit Inhaltsverzeichnis, Suche und Links

**Intern**
- Test prüft, dass das Dockerfile alle Server-Module kopiert

## 1.5.0 – 2026-09-29

**Lagerplan**
- Neue Standardansicht „Regale“: je Spalte ein Regal, Fächer mit Name, Menge, Füllbalken und Vorschaubildern;
  eine gemeinsame Kategorie steht einmal im Regalkopf
- Raster bleibt umschaltbar – jetzt mit Namen in den Zellen und Farbe je Füllgrad
- Suche nach Platz oder Objekt (auch in Behältern) hebt Treffer hervor, „nur belegte“ blendet leere Plätze aus
- Ansicht wird pro Lager gemerkt; Suche, Filter und Scrollposition bleiben beim Zurückkommen erhalten
- „Letzte Buchungen“ eingeklappt; `/api/overview` liefert zusätzlich die Objekte je Platz

**Navigation**
- „Zurück“ führt dorthin, wo man hergekommen ist (z. B. „← Lagerplan“), auch nach dem Löschen von Platz oder Objekt;
  ohne Vorgänger (per QR-Code geöffnet) bleibt das bisherige Ziel

**Assistent und MCP**
- Neues Werkzeug `lagerplatz_loeschen` (nur leere Plätze, per Adresse oder Name)

**Fehlerbehebungen**
- „Platz löschen“ war immer gesperrt, auch bei leeren Plätzen
- Einkaufsliste: „Gekauft + einbuchen“ übernimmt jetzt das angegebene Haltbarkeitsdatum

## 1.4.0 – 2026-09-28

- Assistent und MCP verstehen Lagerplätze auch beim Namen: „in den Kühlschrank“, „Schublade Essen“, „Küche Kühlschrank“
  (Füllwörter werden ignoriert, exakte Namen gehen vor, bei mehreren Treffern wird nachgefragt)
- Neues Werkzeug `lagerplaetze_suchen` (nach Name, Kategorie, Beschreibung)
- Der Assistent bekommt die benannten Lagerplätze gleich mit; Fehlermeldungen zu unbekannten Plätzen nennen sie ebenfalls

## 1.3.0 – 2026-09-28

**Assistent und MCP: bessere Anleitung für das Modell**
- Anweisungen mit typischen Abläufen (Einkaufsliste, Neuanlage, Verbrauch) und der Regel, nie nach IDs zu fragen,
  sondern selbst nachzuschlagen bzw. Fehlermeldungen auszuwerten
- Werkzeug-Ergebnisse können einen `hinweis` für den nächsten Schritt enthalten (z. B. nach dem Abhaken fragen, ob eingelagert werden soll)
- `einkaufsliste_abhaken`: per Name (auch Teilwort, ohne ID), klare Meldung bei mehreren/keinen Treffern;
  mit `platz` oder `behaelter` gleich einlagern – freie Einträge werden dabei als Verbrauchsmaterial neu angelegt

**App**
- Einkaufsliste: „Gekauft + einlagern“ für freie Einträge (legt den Gegenstand an und hakt den Eintrag ab)
- Rückgängig einer solchen Neuanlage öffnet den Eintrag wieder

## 1.2.0 – 2026-09-28

- Assistent: „Vergiss das“ / „Neues Gespräch“ löscht den Gesprächsverlauf (neues Werkzeug `gespraech_neu_beginnen`)
- Nach 30 Minuten Pause beginnt automatisch ein neues Gespräch; eine Trennlinie zeigt, ab wo der Verlauf wieder mitgeht
- Der mitgeschickte Verlauf ist zusätzlich auf etwa 8000 Zeichen begrenzt (neueste Nachrichten zuerst)

## 1.1.0 – 2026-09-28

**KI-Assistent in der App**
- Aufträge per Text, Sprache (Spracherkennung des Browsers) oder Foto; Antworten auf Wunsch vorgelesen
- Jede OpenAI-kompatible Schnittstelle (Standard OpenRouter), eingerichtet unter Administration → Assistent;
  Schlüssel bleibt auf dem Server (oder `AI_API_KEY`), Verbindungstest und Verbrauch der letzten 30 Tage
- Dieselben Werkzeuge wie der MCP-Server; Buchungen sofort mit „rückgängig“, ab 4 Buchungen auf einmal Rückfrage
- Fotos mit QR-Erkennung in der App; Foto wird auf Wunsch Bild des Gegenstands
- Aus Detail- und Platzansicht mit Kontext („das“, „hier“)

**Weiteres**
- Neue Werkzeuge (MCP und Assistent): `mehrere_einbuchen`, `objekt_bearbeiten`, `lagerplatz_benennen`, `code_aufloesen`;
  `einbuchen` übernimmt vorgedruckte Etikett-Codes
- Buchungen merken ihre Herkunft; der Verlauf zeigt „per Assistent“ bzw. „per MCP“
- Einheitlicher Stil für Passwort-, URL- und Datumsfelder

## 1.0.0 – 2026-09-28

Erster Release von Heimlager, dem Lagersystem für zuhause.

**Lager und Buchungen**
- Mehrere Lager mit Kürzel, Lagerplätze aus Spalte und Zeile (z. B. `K-B12`) mit Name, Kategorie und Lagerplan
- Einbuchen, Ausbuchen und Umlagern; jede Buchung merkt sich Person, Menge, Platz und Zeitpunkt
- Rückgängig für die jeweils letzte Buchung eines Gegenstands
- Behälter (Tasche, Box, Kiste): Gegenstände liegen darin, auch verschachtelt, und wandern beim Umlagern mit
- Haltbarkeitsdatum mit Hinweis im Menü, Ansicht „Haltbarkeit“ und Kennzahlen in der Auswertung
- Verbrauchsmaterial kommt beim Ausbuchen automatisch auf die Einkaufsliste

**Bedienung**
- Web-App fürs Handy, als App installierbar; Kamera-Scan von QR-Codes (Platz + Objekt, Behälter einräumen)
- Fotos von Gegenständen, Etiketten drucken, 3D-druckbare Etiketten
- Suche, Auswertung, Export/Import als Excel oder CSV

**Betrieb**
- Anmeldung mit Passwort, Rollen Benutzer/Admin, Passwort-Reset per Kommandozeile
- Automatische Backups, Wiederherstellung in der App
- Docker-Image, Betrieb hinter Reverse Proxy (`TRUST_PROXY`)
- MCP-Server für KI-Assistenten mit API-Schlüsseln (nur lesen oder buchen), optional Schlüssel in der URL
- Keine externen Abhängigkeiten, Node.js ab 22.13
