# Zuhause

Das ganze Haus in 3D planen – und jedes Fach jedes Möbels ist ein Lagerplatz. Zuhause vereint **Heimlager**
(`inventory`, inkl. `inventory-3d`) und den **Küchenplaner 3D**: ein Server, eine Datenbank, ein Konto.
Wie und warum: [ARCHITEKTUR.md](ARCHITEKTUR.md).

| Teil | Adresse | Handbuch |
|------|---------|----------|
| **Haus**: Hausplaner (Etagen, Räume, Möbel, Materialien, Pathtracing) mit Lager im Plan | `/#/haus` | diese Datei, [docs/KUECHE.md](docs/KUECHE.md) |
| **Lager** (Scannen, Ein-/Ausbuchen, Suchen, Einkaufsliste, Haltbarkeit, Assistent, Auswertung, Etiketten, Verwaltung – auch auf dem Handy) | `/#/lager` | unten |
| MCP-Server für KI-Assistenten | Port 3100, `/mcp` | [docs/LAGER.md](docs/LAGER.md#mcp-server-ki-assistenten) |

Benötigt **Node.js ≥ 22.18** (eingebautes `node:sqlite`, TypeScript ohne Build auf dem Server).

## Starten

```bash
npm install
npm run dev                  # Entwicklung: ein Prozess, App mit Vite-HMR → http://localhost:3000
npm run build && npm start   # Betrieb: App gebaut nach dist/app
npm test                     # 86 Tests, jeder mit eigenem Server und frischer Datenbank
npm run typecheck            # App und Server
npm run test:e2e             # Klicktest im Browser (einmalig: npm install --no-save playwright-core)
```

Beim ersten Start mit leerer Datenbank zeigt die App die Ersteinrichtung (Person antippen oder neu anlegen, Passwort –
diese Person wird Admin). Danach meldet man sich per Kachel + Passwort/PIN oder mit E-Mail an.

## Hausplan und Lager

1. **Etagen:** Reiter oben (+ legt Obergeschoss, Keller, Dachgeschoss oder Außenbereich an, auf Wunsch mit den Außenwänden
   der aktuellen Etage). Die Etage darunter erscheint im Plan gestrichelt.
2. **Wände** zeichnen oder einen Grundriss hochladen und nachzeichnen (wie im Küchenplaner).
3. **Räume:** „Raum festlegen“ und in eine umschlossene Fläche klicken. Jeder Raum wird ein **Lager** mit Kürzel
   (Küche → `KU`), eigener Bodenbelag möglich.
4. **Möbel** aus dem Katalog setzen – Küchenschränke, Regale, Schwerlastregal, Vorrats- und Kleiderschrank, Sideboard,
   Kommode, Werkbank. Jedes Möbel mit Fächern bekommt einen **Buchstaben** (im Plan am Möbel), jedes Fach einen
   **Lagerplatz**: `KU-B2` = Küche, Möbel B, Fach 2 („Unterschrank Auszüge 60 · Schublade 3 (unten)“).
5. In 3D **Lager** einschalten: Fächer sind nach Füllstand gefärbt (blau leer, grün belegt, orange läuft ab, rot
   abgelaufen). Fach anklicken → Inhalt, einbuchen, entnehmen, vorhandenen Gegenstand hierher umlagern.
6. Oben **„Wo liegt …?“** sucht im ganzen Lager und lässt die Treffer im Haus aufleuchten.

Der Hausplan wird automatisch gespeichert (Admins) und von allen geteilt; Benutzer sehen ihn und buchen, ändern ihn aber
nicht. Zieht ein Möbel in einen anderen Raum, wandern Plätze und Gegenstände mit. Entfernte Fächer mit Inhalt bleiben
als Platz erhalten. Plan-Plätze sind normale Lagerplätze: Suche, Scan, QR-Etiketten, Einkaufsliste, MCP und Assistent
kennen sie.

## Lager in der App

`/#/lager` (auf dem Handy startet die App direkt dort; als App installierbar): **Scannen** (Fach-Code + Gegenstand =
einbuchen, Gegenstand zweimal = ausbuchen), **Einbuchen** und **Ausbuchen**, **Suchen**, **Einkaufsliste**,
**Haltbarkeit**, Gegenstand mit Foto, Verlauf und Rückgängig, **Assistent** (Text, Sprache, Foto – kennt Fächer beim
Namen: „Küche Kühlschrank oben“), **Auswertung** mit Heatmap im Haus, **Etiketten & QR-Schilder** (Druck oder 3MF) und
**Verwaltung** (Personen, Lager, API-Schlüssel, Backups, Assistent, Export/Import). Orte werden über den Hausplan gewählt
(Etage → Raum → Möbel → Fach) und beschrieben; **„Im Haus zeigen“** springt in den Planer und lässt das Fach leuchten.
QR-Etiketten (`/q/…`) öffnen die App. Für die Kamera braucht es HTTPS (`npm run cert` oder Reverse Proxy).

## Bestehende Daten übernehmen

```bash
npm run migrate -- --lager ../inventory/data/lager.db --kueche ../küchenplaner/data/kuechenplaner.db
```

Die Quellen werden nur gelesen. Konten mit gleicher E-Mail oder gleichem Namen werden zu einer Person (sonst
`--map mail@example.de=Name`). Küchenplanungen und importierte Texturen kommen mit; in der App holt das Kontomenü
**„Gespeicherte Planungen übernehmen“** eine Planung als Etage ins Haus.

**Haus aus „Haus einrichten“ und Küchenplanung übernehmen** (z. B. die Produktivstände):

```bash
# Haus-Grundriss des Lagers (lesend, API-Schlüssel genügt) und Exportdatei des Küchenplaners
curl -H "Authorization: Bearer hlk_…" https://lager.example.de/api/site > data/prod/site.json
npm run import-prod -- --site data/prod/site.json --kueche "data/prod/Haus 1 – EG Küche.kueche.json" [--dry]
```

Wände werden aus den Raumgrenzen abgeleitet, offen verbundene Räume behalten ihren Umriss, die Küchenplanung ersetzt
Wände, Öffnungen und Einbauten ihrer Etage (gleicher Ursprung). Vorher wird die Datenbank gesichert.

## Konto

Ein Konto für alles: die **Personen** des Lagers. Anmeldung per **Kachel + Passwort/PIN** oder **E-Mail + Passwort** –
dieselbe Sitzung gilt überall. Admins verwalten Personen unter Verwaltung → Personen und Registrierung,
Freigabe ebenda. Selbst-Registrierung ist standardmäßig aus.

## API (Haus)

| Methode | Pfad | Zweck |
|---------|------|-------|
| GET | `/api/house` | Hausplan `{house, version, can_edit, reserved}` |
| PUT | `/api/house` | Speichern `{house, base_version}` (Admins) → normalisierter Plan, Abgleich mit dem Lager; 409 bei veraltetem Stand |
| GET | `/api/house/storage` | Alle Plan-Plätze mit Adresse und Inhalt |

Die übrigen Endpunkte (Lager, Buchungen, Konto, Assistent, Backups) stehen in [docs/LAGER.md](docs/LAGER.md#api-für-eigene-erweiterungen).

## Aufbau

```
server/index.ts            Einstieg: Express, Module, HTTPS, MCP
server/lager/              Modul Lager (aus Heimlager): Konto, Lager, Buchungen, Assistent, MCP, Backups
server/haus/               Modul Haus: Hausplan speichern, Abgleich mit dem Lager
server/kueche/             Modul Planungen: gespeicherte Planungen, Benutzerverwaltung, Materialbibliothek
web/app/src/model/         Hausmodell für App und Server: Typen, Katalog, Geometrie, Räume, Fächer, Normalisierung
web/app/src/               App: Editor (plan2d), 3D (scene3d, models, materials), Zustand, Server-Abgleich, Konto
scripts/                   migrate.ts, reset-password.cjs, make-cert.sh, make-icons.cjs
test/                      node:test (je Datei ein eigener Server), e2e/ Klicktest im Browser
docs/                      Handbücher und Changelogs der Ursprungsprojekte
```

## Docker

```bash
docker compose up -d --build     # App: :3000, MCP: :3100
```

Daten im Volume `/data` (`zuhause.db`, `backups/`, `library/`). Migrierte Datenbank hineinkopieren:

```bash
docker compose create
docker compose cp ./data/zuhause.db zuhause:/data/zuhause.db
docker compose cp ./data/library zuhause:/data/library
docker compose run --rm -u root --entrypoint chown zuhause -R node:node /data
docker compose up -d
```

## Umgebungsvariablen

| Variable | Standard | Bedeutung |
|----------|----------|-----------|
| `PORT` | `3000` | HTTP-Port |
| `HTTPS_PORT` | `3443` | HTTPS (nur mit Zertifikat in `CERT_DIR`, `npm run cert`), `0` = aus |
| `DB_PATH` | `data/zuhause.db` | Datenbank; Backups und Texturen liegen daneben |
| `MCP_PORT` / `MCP_HOST` / `MCP_PUBLIC_URL` | `3100` / `0.0.0.0` / – | MCP-Server |
| `TRUST_PROXY` | – | `1` hinter einem Reverse Proxy (Secure-Cookie, echte Client-IP) |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | `24` / `14` | automatische Backups |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | – | KI-Assistent (sonst unter Administration → Assistent) |
