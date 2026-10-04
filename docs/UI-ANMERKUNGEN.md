# UI-Anmerkungen (Sammelliste)

Anmerkungen zum UI-Entwurf (https://claude.ai/artifact/DKwjHa7JYhiB8hRX2gPPXT).
Werden gesammelt und erst auf Kommando abgearbeitet. Status: offen · erledigt · verworfen

## Offene Fragen aus dem Entwurf

- [x] Wandterminal hoch- oder querformatig? → beides, pro Terminal-Profil einstellbar (siehe A1)
- [x] Wandterminal: auch einbuchen oder nur suchen/herausnehmen? → auch einbuchen (siehe A3)
- [x] Planen-Recht pro Person einführen? → ja (siehe A2)
- [x] Ansehen-Modus: 2D oder 3D als Standard? → pro Person wählbar (siehe A4)
- [x] Linke Seitenleiste im Planen-Modus dauerhaft oder Schublade + rechte Leiste? → ausklappbar (siehe A5)
- [x] Übersicht: weitere Karten? → Aufgaben fehlen (siehe A6)
- [ ] Übersicht: „Zuletzt bewegt“ für alle oder nur eigene?
- [x] Einkaufsliste gemeinsam oder pro Person? → eine gemeinsame Liste reicht vorerst (bleibt wie heute)

## Anmerkungen

<!-- Format: - [ ] (Bereich) Anmerkung -->

- [ ] **A1 (Wandterminal)** Ausrichtung im Profil des Terminals einstellbar: **Hochformat** oder **Querformat**.
  Das UI passt sich an: Hochformat = Plan oben, Fach-Inhalt unten (wie im Entwurf); Querformat = Plan links,
  Fach-Inhalt als Seitenleiste rechts, Navigation weiterhin links. Im Entwurf als Umschalter beim Wandterminal ergänzen.

- [ ] **A2 (Rechte/Planen)** Recht **„Planen“ pro Person** einführen. Ohne das Recht nur Ansehen: Knopf „Planen“
  gesperrt, Hausplan-Änderungen auch serverseitig abgelehnt (`PUT /api/house` → 403). Einstellbar in der
  Personenverwaltung (Mehr → Verwaltung) neben der bestehenden Rolle (`persons.role`: admin/user). **Admins dürfen
  immer alles** (bestätigt) – für sie ist der Haken fest gesetzt und nicht abwählbar. Bestehende Personen bei der Einführung: Recht behalten, damit niemand ausgesperrt wird.

- [ ] **A3 (Wandterminal)** Am Terminal darf auch **eingebucht** werden (nicht nur suchen/herausnehmen).
  Wie beim Entnehmen fragt das Terminal per Personen-Kachel „Wer legt das hinein?“, damit der Verlauf stimmt.
  Eingabe per Touch-Tastatur: große Felder, Vorschläge aus vorhandenen Gegenständen, Datum als Auswahl statt Tippen.

- [ ] **A4 (Haus/Ansehen, Einstellungen)** Standard-Ansicht im Ansehen-Modus **pro Person** wählbar: **2D** oder **3D**.
  In Mehr → Einstellungen neben „Beim Öffnen der App zeigen“. Umschalten im Haus bleibt jederzeit möglich, ändert
  aber nicht den Standard. Wandterminals: eigene Einstellung im Terminal-Profil (zusammen mit A1).

- [ ] **A5 (Planen)** Linke Seitenleiste **ausklappbar** statt dauerhaft: Katalog/Möbel, Etage und Materialien als
  Schublade, die sich über ein Werkzeug öffnet und wieder einklappt. Rechts bleibt die Leiste für die Auswahl.

- [ ] **A6 (Übersicht, neu: Aufgaben)** Auf der Übersicht fehlen **Aufgaben**. Neue Karte „Aufgaben“ mit
  offenen Aufgaben des Haushalts. Braucht eine kleine Aufgabenfunktion (anlegen, erledigen, wem zugeordnet,
  fällig am; optional an Raum/Möbel/Fach hängen, z. B. „Filter Dunstabzug tauschen“ an KU). Details vor Umsetzung klären.

- [ ] **A7 (Wandterminal, Ruhezustand)** Ohne Bedienung zeigt das Terminal ein **großes, gedimmtes Haus**,
  gern **fotorealistisch** (Pathtracer), mit **Licht nach Tageszeit** (Sonnenstand) und **Wetter am Ort**
  (Postleitzahl in den Einstellungen; Wetterdienst ohne API-Schlüssel, z. B. Open-Meteo). Antippen weckt das
  Terminal ins Haus. Bild in Abständen neu rechnen bzw. serverseitig vorberechnen, damit das iPad mini nicht
  dauerhaft rendert.

- [ ] **A8 (Handy, offline)** Buchungen bei schlechtem WLAN (Keller) **zwischenspeichern und nachbuchen**,
  statt einen Fehler zu zeigen. Sichtbarer Hinweis „3 Buchungen warten“, automatisches Nachsenden, Konflikte
  (Gegenstand inzwischen weg) verständlich melden.

- [ ] **A9 (Einstellungen)** **Schriftgröße und Dunkelmodus pro Person** einstellbar (Mehr → Einstellungen);
  Wandterminals pro Gerät.
