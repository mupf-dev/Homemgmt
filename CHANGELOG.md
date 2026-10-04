# Changelog

## Unveröffentlicht

**Arbeitsplatte für Möbelarten** (Objektbibliothek): Korpus-Möbelarten können oben eine Arbeitsplatte tragen – z. B.
Waschmaschine unter Arbeitsplatte, Hauswirtschaftszeile, Kochinsel. Stärke, Überstand vorne und Material im Editor
einstellbar; mit „mit Küchenzeile verbinden“ wird sie Teil der Küchenzeile, die Maserung läuft über angrenzende
Unterschränke weiter. Die Platte ist kein Fach, die Höhe bleibt die Gesamthöhe. Das Format bleibt `zuhause-objekt/1`
(neues optionales Feld `build.countertop`); bestehende Möbelarten und ihre Lageradressen bleiben unverändert.

**Waschmaschine und Trockner als Element** (`washer`, `dryer`): realistische Gerätefront statt Schrankfront – Bedienblende
mit Schublade, Display und Drehknopf, Bullauge mit Türring und Trommel, Serviceklappe, beim Trockner Lüftungsgitter; in
Gerätefarben, unabhängig von Fronten und grifflos. Unter Arbeitsplatte, auf Podest oder als Säule. Jedes Gerät ergibt
zwei Lagerplätze: Waschmittelfach bzw. Kondenswasserbehälter und die Trommel.

**Gerätefarbe** (Material-Bereich `appliance`): Waschmaschine und Trockner lassen sich einfärben – in der Möbelart
(Editor: „Gerätefarbe“) und je Möbel im Hausplan. Auf dunklen und metallischen Fronten wird die Bedienblende zu
Schwarzglas und der Türring zu Chrom. Ohne Angabe bleibt die Front weiß wie bisher. Die Editor-Vorschau spiegelt jetzt
eine Umgebung, Metall und Chrom sehen dort echt aus.

## 0.7.0 – 2026-10-04

**Objektbibliothek** (Mehr → Objektbibliothek): Möbelarten wie Küchenschränke und Lagerregale als Daten statt im Code.
**Editor** mit 3D-Vorschau: Maße, Sockel, Plattenstärke, Spalten mit Schubladen, Türen mit Böden, offenen Fächern,
Klappen, Kühl- und Gefrierfächern – oder ein eigenes 3D-Modell (.glb) mit eingetragenen Fächern. Die Vorschau zeigt jedes
Fach als Rahmen; **jedes Fach wird ein Lagerplatz**. Vorlagen (Regal, Vorratsschrank, Kommode, Unterschrank,
Kleiderschrank, Oberschrank) als Ausgangspunkt.

**Community-Katalog** im eigenen Repo [homemgmt-object-library](https://github.com/mupf-dev/homemgmt-object-library) mit
Galerie auf GitHub Pages: Möbelarten installieren und aktualisieren, eigene exportieren (`.zuhause-objekt.json`) und per
Pull Request beisteuern – automatisch geprüft, ohne Server und ohne Schlüssel. Start mit Würfelregal 4×4,
Schuhschrank, Apothekerschrank, Werkzeugwagen und Bad-Hängeschrank.

Installierte Möbelarten stehen beim Planen unter „Möbel“. Das Haus behält eine **Kopie** jeder verwendeten Möbelart –
Änderungen in der Bibliothek verschieben keine Adressen; neuere Versionen übernimmt man am Möbel („Version …
übernehmen“, mit Warnung bei geänderter Fächerzahl). Bearbeiten und installieren darf, wer „Haus planen“ darf.

## 0.6.0 – 2026-10-04

**Eine App für den ganzen Haushalt:** dieselbe Navigation auf jeder Seite – Übersicht, Haus, Suchen, Einkauf, Mehr. Am
Handy liegt sie unten, **Scannen** in der Mitte. Neue **Übersicht** als Startseite: Schnellaktionen, Einkaufsliste zum
Abhaken, was bald abläuft, Füllstand je Etage, zuletzt bewegt. Seiten **Mehr** und **Einstellungen**.

**Haus: Ansehen und Planen getrennt.** Ansehen ist der Normalfall: keine Werkzeuge, keine Maße; Möbel antippen zeigt die
Fächer, ein Fach seinen Inhalt – in der Seitenleiste (Plan bleibt sichtbar) bzw. am Handy als Blatt von unten. Möbel im
Grundriss nach Füllstand gefärbt, Suchtreffer leuchten auch im Grundriss, Etagen mit Treffern bekommen einen Punkt.
**Planen** per Knopf (nur am PC): Werkzeuge in einer Leiste, „Möbel“, „Materialien“ und „Etage“ als ausklappbare Leiste,
Seltenes im Menü ⋯, „Etage löschen“ nicht mehr ganz oben, Hinweise nur für das aktive Werkzeug.

**Recht „Haus planen“ pro Person** (Verwaltung → Personen); Admins dürfen immer. Auch der Server lehnt Änderungen am
Hausplan ohne das Recht ab.

**Einstellungen pro Person:** Startseite (Übersicht oder Haus), Haus zuerst in 2D oder 3D, Hell/Dunkel, Schriftgröße.

**Schlechtes WLAN:** Ein- und Ausbuchen ohne Verbindung wird vorgemerkt und automatisch nachgebucht („n Buchungen
warten“); der Server erkennt Wiederholungen und bucht nicht doppelt. Scannen von Fächern und Gegenständen klappt auch
ohne Netz.

**Wandterminals** (Verwaltung → Wandterminals): Tablet an der Wand ohne persönliche Anmeldung, eingerichtet per Link
oder QR-Code. Navigation am linken Rand, große Touch-Flächen, **Hoch- oder Querformat** je Gerät. Ein- und Ausbuchen mit
**„Wer bucht?“**-Kacheln. Ohne Bedienung zurück zum Haus und **Ruhezustand**: das Haus gedimmt und fotorealistisch, Licht
nach Tageszeit und Wetter am Ort (Postleitzahl; OpenStreetMap + Open-Meteo, ohne Schlüssel), Uhr, Einkaufsliste,
Ablaufendes.

**Lage des Hauses** (Planen → ⋯): Adresse oder Postleitzahl suchen oder Koordinaten eingeben, Nordrichtung per Kompass;
der Grundriss zeigt einen Nordpfeil. Am Wandterminal steht damit die **Sonne wie draußen** (Sonnenstand aus Ort und
Uhrzeit), **Himmel und Licht laufen live mit** (Tag, Bewölkung, Regen, Dämmerung, Nacht mit Lampen und Mondlicht,
jede Minute neu), das Wetter steht in der Kopfzeile, und ums Haus liegt **Rasen**. Beim Ansehen wechselt die Etagenwahl
von „Haus“ auf „Bis hier“, das gewählte Möbel bleibt sichtbar, alles andere wird durchsichtig (am Terminal ohne Rahmen).

**Wetter am Wandterminal:** Wolken am Himmel (Bedeckung, Farbe nach Tageszeit, ziehen mit dem Wind – auch im
fotorealistischen Bild, da der Himmel die Szene beleuchtet), Regen, Niesel und Schnee als dezente Animation über dem Bild
– Stärke nach echter Regenrate (mm/h) bzw. Schneefall, Regenmenge in der Kopfzeile –, Nebel und Dunst, nasser Rasen
(abgestuft nach Regenstärke). **Schnee** als wachsender Fleck auf und vor der Terrasse und auf den Dachflächen: bei einem
Hauch etwa Terrassengröße, ab ~10 cm der ganze Garten; das Haus selbst bleibt frei. Rasen und Schnee sparen die
Hausfläche aus (kein Rasen im Treppenloch). **Gewitter mit Blitzen in Echtzeit** (Blitzortung.org, die Daten hinter
lightningmaps.org – ohne Konto, für private Nutzung): jeder Einschlag im Umkreis kommt per Server-Sent Events sofort an;
nahe Blitze (≤ 30 km) lassen den Bildschirm aufblitzen. Warnung in der Kopfzeile ab 20 km, im Ruhezustand Hinweis mit
dem letzten Blitz (Entfernung, Richtung, Alter), Anzahl und eine Blitzkarte (10/25/50 km, Punkte nach Alter) – nur,
solange es bis 50 km blitzt. **Testwetter** zum Ausprobieren: `?testwetter=schnee` (auch `schnee-hauch`,
`schnee-leicht`, `schneesturm`, `niesel`, `regen`, `wolkenbruch`, `gewitter`, `nebel`, `wolkig`, `klar`).
**Ruhezustand sparsamer:** Detailgrad je Terminal (Entwurf/Normal/Hoch), geringere Rechenauflösung, Mindestqualität fürs
fotorealistische Bild (sonst sauberes 3D-Bild), nur bei geänderter Sonne/Wetter neu, Pause bei verdecktem Bildschirm,
letztes Bild gemerkt, Fortschrittsanzeige, flacher Blickwinkel.

**Ansehen verfeinert:** Seitenleiste mit Ebene „Haus“ (alle Etagen mit Füllstand) über Etage → Raum → Möbel → Fach; die
App startet im Erdgeschoss statt im Keller.

**Kleinigkeiten:** ein Icon-Satz statt Emoji, Datum als TT.MM.JJJJ mit Schnellwahl (1 Woche … 1 Jahr), Vorschläge aus
vorhandenen Gegenständen beim Einbuchen ins Fach, Farben für den Dunkelmodus, Knöpfe statt blauer Links, Anleitung
aktualisiert.

**Intern:** `shell.ts`, `prefs.ts`, `icons.ts`, `terminal.ts`, `lager/home.ts`, `lager/outbox.ts`; Spalten
`persons.can_plan`, `persons.prefs`, Tabelle `terminals`; `GET /api/movements/recent`, `PATCH /api/auth/me/prefs`,
`/api/terminals…`, `/api/weather` (Koordinaten oder Postleitzahl), `/api/geocode`, `/api/lightning`, `/api/lightning/stream` (SSE);
`sun.ts` (Sonnenstand), `weatherfx.ts` (Regen, Schnee, Dunst, Blitze), `server/lager/lightning.cjs`. Tests:
`test/lightning.test.cjs`. `LIGHTNING=0` schaltet die Blitzverbindung ab (Tests). Tests: `test/prefs.test.cjs`, `test/terminal.test.cjs`, Klicktest erweitert
(Ansehen/Planen, Einstellungen, Rechte, Handy, offline, Terminal).

## 0.5.0 – 2026-10-03

**Begehen wie im Spiel:** durch das ganze Haus laufen – Wände und Möbel bremsen, Türen und Durchgänge sind offen,
Schwellen bis ~30 cm werden überstiegen, **Treppen führen hinauf und hinunter in die anderen Etagen**. Anzeige von
Etage und Raum, der Grundriss und die Etagenreiter laufen mit; beim Beenden kehrt die vorherige Ansicht zurück
(`web/app/src/walker.ts`).

**Möbel- und Einrichtungsbibliothek:** 3D-Modelle (glTF, CC0) von Poly Haven suchen und nach Kategorien filtern
(Sitzen, Tische, Betten, Schränke, Leuchten, Pflanzen, Deko …), mit einem Klick ins Haus setzen, maßstäblich skalieren;
eigene `.glb`-Dateien hochladen (`/api/library/models…`). Schalter **„Ohne Filter“** zeigt alle 521 Modelle (sonst 242
Einrichtungsmodelle), neue Kategorien Werkzeug, Garten & Natur, Sonstiges; Suche auch mit deutschen Begriffen (Stuhl, Lampe …).
Zweite Quelle **FurniMesh** (ohne Konto/API-Schlüssel): Tausende realistische, KI-erzeugte Möbel (Sofas, Sitzmöbel,
Tische, Betten, Schränke, Leuchten, Bad) aus den öffentlichen Bibliotheksseiten; beim Übernehmen wird das GLB einmal
geladen, von ~20 MB auf ~2–3 MB verkleinert (Texturen 1024 px JPEG, Geometrie ausgedünnt; `@gltf-transform`, `sharp`,
`meshoptimizer`) und auf typische Maße der Kategorie skaliert. Keine ausdrückliche Lizenz – Quelle und Link stehen am Modell.

**Haus-Ansicht:** keine Lücken mehr zwischen den Etagen, Treppen enden genau an der Etage darüber und schneiden ein
Treppenloch in die Decke (Lochgröße = Grundfläche der Treppe), Dachboden-Wände bleiben unter dem Dach.

**Planer:** Möbel können ein **Durchgang** sein (Front ohne Korpus, Öffnung in der Wand dahinter, keine Fächer) – so
ist der Hochschrank in der Küche jetzt der Durchgang unter der Treppe. Treppen behalten beim Andocken per Drag & Drop
ihre Drehung und rücken nur bündig an die Wand.

**Objekte sperren (2D-Editor):** Wände, Fenster/Türen, Möbel und Räume per „Sperren“ oder Taste `L` festsetzen – nicht
mehr auswählbar, verschiebbar oder löschbar (auch nicht über 3D-Klick oder die Raumliste), Ecken an gesperrten Wänden
bleiben fest, Türen/Fenster lassen sich nicht in gesperrte Wände setzen. Schloss-Symbol im Grundriss; unter „Etage“ →
„Gesperrt“ einzeln/alle entsperren und „Alle Wände sperren“. Rückgängig machbar, wird mit dem Haus gespeichert.

**Lager:** Behälter beim Scannen befüllen und Gegenstände in Behälter legen, Preisrecherche in der Einkaufsliste,
Anleitung in der App (`?`). Die alte Oberfläche (`/alt/`) ist entfernt. `npm run import-prod-items` übernimmt die
produktiven Gegenstände samt Fach-Zuordnungen in den Hausplan (nur lesend, mit Sicherung).

## 0.4.0 – 2026-10-03

**Die App ist die Startseite** (`/`); die bisherige Lager-Oberfläche liegt unter `/alt/`, `/app/` und `/kueche/` leiten
weiter, QR-Etiketten öffnen die App. Der frühere Service-Worker meldet sich ab. Eigenes App-Manifest (installierbar,
Schnellzugriffe Scannen, Einbuchen, Suchen, Einkaufsliste, Haus).

**Restliche Lagerfunktionen in der App**
- Anmeldung per **Kachel + Passwort/PIN** und **Ersteinrichtung** direkt in der App (zusätzlich E-Mail)
- **Assistent:** Text, Sprache, Foto (QR-Etiketten werden erkannt), Rückfrage ab 4 Buchungen, Rückgängig je Buchung,
  Vorlesen, Kontext aus Gegenstand/Fach; genannte Plätze mit „Im Haus zeigen“
- Assistent/MCP finden **Fächer beim Namen**: „Küche Kühlschrank oben“, „Vorratsregal Boden 2“ (wortweise über Fach,
  Möbel, Raum und Lager); Anleitung fürs Modell kennt das Hausplan-Schema
- **Auswertung** (Kennzahlen, meistgenutzt, wer bucht, lange nicht angefasst, ausverkauft) und **Heatmap im Haus**:
  Füllstand, Bewegung (90 Tage), lange unberührt (`GET /api/house/stats`)
- **Etiketten & QR-Schilder:** Fächer nach Etage/Raum/Möbel (auch direkt aus dem Planer), Gegenstände, leere Etiketten;
  Druck oder 3D-Schilder als 3MF auf Druckplatten verteilt
- **Verwaltung:** Personen (Rollen, Passwörter, Archiv, Zusammenführen, E-Mail-Freigaben, Registrierung), Lager
  (Hausplan-Lager nur ansehen), API-Schlüssel, Backups (anlegen, herunterladen, wiederherstellen, hochladen),
  Assistent-Einstellungen, Export/Import (Excel/CSV mit Vorschau)

**Tests:** Fach-Namenssuche per MCP; Klicktest um Kachel-Anmeldung, Assistent (simuliertes Modell), Auswertung/Heatmap,
Etiketten/3MF-Download und Verwaltung erweitert

## 0.3.0 – 2026-10-03

**Lager in der App** (`/app/#/lager`, auch auf dem Handy – kleine Bildschirme starten direkt dort)
- Start mit Hinweis auf Ablaufendes, Suchen, Gegenstand (Foto aufnehmen, Verlauf, Rückgängig, Entnehmen, Einbuchen,
  Umlagern, Bearbeiten, Löschen, auf die Einkaufsliste), Einbuchen, Ausbuchen, Platz, Einkaufsliste (abhaken, Menge,
  gekauft + einbuchen/einlagern, teilen), Haltbarkeit, Scannen mit der Kamera (Fach + Gegenstand = einbuchen,
  Gegenstand 2× = ausbuchen, unbekanntes Etikett = neu anlegen)
- Orte werden überall über den Hausplan beschrieben („Abstellraum · Regal offen · Boden 3“) und gewählt (Fach-Auswahl:
  Etage → Raum → Möbel → Fach mit Belegung, alternativ Platzadresse wie H-B12)
- „Im Haus zeigen“ aus Suche, Gegenstand, Platz und Haltbarkeit: Planer springt auf die Etage, lässt die Fächer
  leuchten und fährt zum Möbel; Buchungen mit „Rückgängig“ im Hinweis
- QR-Etiketten (`/q/…`) öffnen die App
- Assistent, Auswertung, Etiketten und Verwaltung öffnen vorerst die bisherige Lager-Oberfläche

**Haus aus dem bisherigen Lager übernehmen**
- `model/fromSite.ts`: Etagen, Räume, Öffnungen und Einbauten aus „Haus einrichten“ → Hausplan; Wände werden aus den
  Raumgrenzen abgeleitet (gegenüberliegende Kanten im Abstand 4–65 cm), offen verbundene Räume bleiben ohne Wand
- `npm run import-prod`: Lager-Haus (GET /api/site) + Küchenplanung (Exportdatei) zu einem Hausplan zusammensetzen
  und mit Lager-Abgleich speichern (vorher Sicherung), fehlende Bibliotheks-Texturen werden nachgeladen
- Räume mit festem Umriss (offene Grundrisse, Außenflächen) neben aus Wänden erkannten Räumen
- 3D: Treppe, Durchgang (Öffnung ohne Türblatt), Satteldach mit Kniestock und Giebeln (Haus-Ansicht), Außenflächen
  (Terrasse, Stellplatz, Carport mit Dach)

**Intern**
- Speichern des Hausplans als wiederverwendbare Funktion (`saveHouse`) für API und Import
- Tests: Übernahme aus dem Lager-Modell (`test/fromsite.test.cjs`), Klicktest um Lager-Seiten erweitert

## 0.2.0 – 2026-10-03

**Vollintegration: der Küchenplaner wird zum Hausplaner, das Lager lebt im Plan**
- Hausmodell mit Etagen (Keller, Etage, Dachgeschoss, Außen), Höhenlage und Raumhöhe; Materialien und Licht hausweit
- Etagen-Reiter, Etage anlegen (auf Wunsch mit den Außenwänden der aktuellen Etage), Etage darunter als Durchpause im Plan
- Räume aus Wänden erkennen („Raum festlegen“): kleinste geschlossene Fläche um den Klickpunkt, folgt beim Verschieben
  von Wänden; Name, Lager-Kürzel, Fläche, eigener Bodenbelag
- Fächer je Möbel aus der Frontaufteilung der 3D-Modelle (Schubladen, Böden, Kühl-/Gefrierfächer, offene Böden)
- Neue Möbel: Regal offen, Schwerlastregal, Vorratsschrank, Kleiderschrank, Sideboard, Kommode, Werkbank (Böden bzw.
  Schubladen einstellbar), eigener Name je Möbel
- 3D: Etage / bis hier / ganzes Haus mit Geschossdecken; Kamera passt das Haus ins Bild
- **Lager im Plan:** Raum = Lager, Möbel = Spalte, Fach = Platz (z. B. KU-B2); Fächer farbig nach Füllstand, Fach
  anklicken → Inhalt, einbuchen, entnehmen, umlagern; „Wo liegt …?“ lässt Treffer im Haus leuchten
- Server: Hausplan als gemeinsames Dokument (`GET/PUT /api/house`, Version gegen Überschreiben), Abgleich mit dem Lager
  in einer Transaktion – Plätze und Gegenstände wandern mit, Fächer mit Inhalt bleiben erhalten; `GET /api/house/storage`
- App unter `/app/` (frühere Adressen `/kueche/` und `/textures/` werden umgeleitet), automatisches Speichern,
  Konfliktdialog, gespeicherte Küchenplanungen als Etage übernehmen
- Lager-App: „Haus planen“ führt zur App
- Entfernt: Übernahme „Küche ins Haus“ aus 0.1.0 (ersetzt durch den Hausplan)
- Tests: Abgleich Hausplan ↔ Lager (`test/haus.test.cjs`), Klicktest im Browser (`npm run test:e2e`)

## 0.1.0 – 2026-10-03

Erste Fassung von **Zuhause**: Heimlager 1.8.1 (inkl. Haus in 3D aus `inventory-3d`) und Küchenplaner 1.0.0 in einer
Anwendung. Frühere Versionen: [docs/CHANGELOG-LAGER.md](docs/CHANGELOG-LAGER.md), [docs/CHANGELOG-KUECHE.md](docs/CHANGELOG-KUECHE.md).

**Ein Server, eine Datenbank**
- Express-Server (`server/index.ts`, TypeScript ohne Build): Lager unter `/`, Küchenplaner unter `/kueche/`, MCP auf eigenem Port
- Gemeinsame Datenbank `zuhause.db`; Küchenplanungen in `kitchen_projects` – damit auch in jedem Backup
- `npm run dev` startet alles in einem Prozess (Vite als Middleware mit HMR)

**Ein Konto**
- Personen des Lagers sind die Konten; neu mit optionaler E-Mail und Status (wartet auf Freigabe)
- Anmeldung per Kachel oder E-Mail, eine Sitzung für beide Oberflächen; `GET /api/auth/me`, `POST /api/auth/register`
- Registrierung standardmäßig aus; Freigabepflicht, Rollen und Sperren in der Benutzerverwaltung des Küchenplaners
- Personen zusammenführen nimmt Küchenplanungen mit

**Küche ins Haus**
- Küchenplaner → Meine Planungen → „Ins Haus“: Schränke werden Einbauten auf einer Etage (an einem Raum ausgerichtet,
  verschiebbar, drehbar); erneutes Übernehmen ersetzt sie und behält die Fach-Zuordnungen
- `POST /api/projects/:id/house`; Einbauten merken ihre Herkunft (`fixtures.source`)

**Oberflächen**
- Lager: Kachel „Küchenplaner“; Küchenplaner: ⌂-Link zurück, Texturen unter `/kueche/textures/` (alte Pfade werden umgeleitet)

**Übernahme bestehender Daten**
- `npm run migrate`: Lager-Datenbank als Basis, Küchen-Konten werden Personen (gleiche E-Mail/gleicher Name), Planungen,
  Einstellungen und importierte Texturen

**Betrieb**
- Ein Dockerfile (Build-Stufe für den Küchenplaner), ein Compose-Service `zuhause`
