# Plan – offene Punkte zur späteren Bearbeitung

## Ablaufwarnung: Anleitung sagt 7 Tage, Übersicht zeigt 30 Tage

- Die Anleitung in der App (`web/app/src/lager/help.ts`, Abschnitt Haltbarkeit) sagt: „die Startseite warnt bei
  Ablauf in 7 Tagen“.
- Die Übersicht (Karte „Läuft bald ab“, `web/app/src/lager/home.ts`) zeigt aber alles, was in den nächsten **30 Tagen**
  abläuft („In den nächsten 30 Tagen läuft nichts ab.“).
- `docs/INVENTORY.md` folgt seit 0.9.0 dem Code (30 Tage).
- Zu entscheiden: Soll die Übersicht 7 oder 30 Tage zeigen? Danach Anleitung (inkl. englischem Text in
  `web/app/src/i18n/en/lager.json`) bzw. Code angleichen.

## Einbuchen ins eigene Fach holt den Gegenstand aus seinem Behälter

- In der App sendet das Einbuchen-Formular immer `container_id: null`, wenn ein Fach gewählt ist
  (`web/app/src/lager/views.ts`, Einbuchen bzw. Umlagern). Liegt ein Gegenstand in einem Behälter und wird in das Fach
  eingebucht, in dem der Behälter steht, ist er danach nicht mehr im Behälter.
- Über MCP/API bleibt er im Behälter, wenn `container_id` weggelassen wird.
- Vermutlich ungewollt. Zu entscheiden: Soll Einbuchen (Menge erhöhen) am selben Platz den Behälter behalten und nur
  ein ausdrückliches „Umlagern“ ihn herausnehmen? Danach App und Handbuch (`docs/INVENTORY.md`, Abschnitt Behälter)
  angleichen und einen Test ergänzen.
