> **Hinweis:** Handbuch aus dem eigenständigen Heimlager (Stand 1.8.1). Bedienung und API gelten unverändert im Modul „Lager“ von Zuhause; Start, Ports, Pfade und Docker stehen jetzt in der [README](../README.md).

# Heimlager

Kleines Lagersystem für zuhause als Webanwendung. Läuft ohne externe Abhängigkeiten,
benötigt nur **Node.js ab Version 22.13** (nutzt die eingebaute SQLite-Datenbank).

## Starten

```bash
npm start
# oder: node server.js
```

Danach im Browser öffnen: <http://localhost:3000>
Im Heimnetz ist die App unter der IP des Rechners erreichbar, z. B. `http://192.168.1.20:3000`.

## Docker (Server-Betrieb)

Im Projekt liegen `Dockerfile` und `docker-compose.yml`. Das Image basiert auf `node:22-alpine`,
läuft als unprivilegierter Benutzer und speichert alles im Volume `/data`.

```bash
# auf dem Server im Projektordner
docker compose up -d --build
docker compose logs -f          # Start prüfen
```

Web-App: `http://<server>:3000`, MCP: `http://<server>:3100/mcp`. Beim ersten Start mit leerer Datenbank
erscheint die Ersteinrichtung (erster Admin) – also direkt nach dem Start selbst öffnen.

**Vorhandene Daten mitnehmen** (lokalen Server vorher mit Strg+C beenden, damit alles in `lager.db` steht):

```bash
docker compose create
docker compose cp ./lager.db heimlager:/data/lager.db
docker compose run --rm -u root --entrypoint chown heimlager -R node:node /data
docker compose up -d
```

**Ohne Git/Build auf dem Server:** Image lokal bauen und übertragen:

```bash
docker build -t heimlager:latest .
docker save heimlager:latest | ssh user@server docker load
# auf dem Server: docker-compose.yml hinkopieren, dann docker compose up -d
```

**Backup im laufenden Betrieb** (zusätzlich zu den automatischen Backups in `/data/backups`):

```bash
docker compose exec heimlager node --no-warnings -e "new (require('node:sqlite').DatabaseSync)('/data/lager.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp heimlager:/data/backup.db ./lager-backup-$(date +%F).db
docker compose exec heimlager rm /data/backup.db
```

**Update:** neuen Stand holen, dann `docker compose up -d --build`. Die Datenbank wird beim Start automatisch migriert.

### Entwicklung mit Docker

`docker-compose.dev.yml` bindet den Projektordner ein und startet den Server bei Änderungen an `server.js`/`mcp.js`
automatisch neu (`node --watch`); Änderungen in `public/` sind nach einem Neuladen im Browser sichtbar.
Die Datenbank liegt in `./data` (dieselbe wie bei `npm start` – nicht beides gleichzeitig starten),
HTTPS läuft mit dem Zertifikat aus `./certs` auf Port 3443.

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml logs -f
docker compose -f docker-compose.dev.yml down
```

### Tests

```bash
npm test
```

Startet für jede Testdatei einen eigenen Server mit frischer Datenbank auf freien Ports (die eigenen Daten
bleiben unberührt) und prüft REST-API, Anmeldung und Rechte, Buchungen und Rückgängig, Einkaufsliste, Fotos,
Auswertung, Import, Backups, API-Schlüssel, den MCP-Server, CSV sowie das Passwort-Reset-Skript.

### Hinter einem Reverse Proxy (empfohlen)

Für die Kamera im Browser braucht die Web-App HTTPS – am einfachsten über einen Reverse Proxy mit TLS.
Dann in `docker-compose.yml` `TRUST_PROXY: "1"` setzen (Sitzungs-Cookie wird „Secure“, die Anmeldesperre
nutzt die echte Client-IP) und die Ports nur noch lokal freigeben (`127.0.0.1:3000:3000`). Beispiel Caddy:

```
lager.example.de {
    reverse_proxy 127.0.0.1:3000
}
mcp.example.de {
    reverse_proxy 127.0.0.1:3100 {
        flush_interval -1
    }
}
```

Für den MCP-Server zusätzlich `MCP_PUBLIC_URL: https://mcp.example.de` setzen. Die Web-App muss nicht öffentlich
sein – es reicht, nur den MCP-Server nach außen freizugeben.

| Variable      | Standard | Bedeutung                                                        |
|---------------|----------|------------------------------------------------------------------|
| `TRUST_PROXY` | –        | `1` = `X-Forwarded-Proto`/`X-Forwarded-For` des Proxys auswerten (nur hinter einem Proxy setzen) |
| `TZ`          | `Europe/Berlin` (Docker) | Zeitzone für Datumsangaben im MCP-Server               |

Healthcheck: `GET /healthz` → `{"ok":true}`.

### HTTPS für den Kamera-Scan auf dem Handy

Browser geben die Kamera nur über HTTPS (oder auf `localhost`) frei. Einmalig ein
selbstsigniertes Zertifikat erzeugen und den Server neu starten:

```bash
npm run cert
npm start
```

Dann auf dem Handy `https://<IP des Rechners>:3443` öffnen und die Zertifikatswarnung
einmalig bestätigen. Ohne Zertifikat funktioniert alles außer der Kamera; Codes können
dann von Hand oder mit einem USB-/Bluetooth-Handscanner eingegeben werden.

**Hinweis für WSL2:** Der Server lauscht in der WSL-VM. Damit Handys ihn erreichen, muss
Windows die Ports weiterleiten (PowerShell als Administrator, WSL-IP mit `hostname -I` ermitteln):

```powershell
netsh interface portproxy add v4tov4 listenport=3443 listenaddress=0.0.0.0 connectport=3443 connectaddress=<WSL-IP>
netsh advfirewall firewall add rule name="Heimlager" dir=in action=allow protocol=TCP localport=3443
```

Alternativ in `.wslconfig` den Modus `networkingMode=mirrored` aktivieren.

Optionen über Umgebungsvariablen:

| Variable     | Standard          | Bedeutung                              |
|--------------|-------------------|----------------------------------------|
| `PORT`       | `3000`            | HTTP-Port                              |
| `HTTPS_PORT` | `3443`            | HTTPS-Port (nur mit Zertifikat aktiv)  |
| `DB_PATH`    | `./data/lager.db` | Speicherort der SQLite-Datenbank       |
| `CERT_DIR`   | `./certs`         | Ordner mit `key.pem` und `cert.pem`    |

## Anmeldung

Die App ist nur mit Anmeldung nutzbar. Beim **ersten Start** erscheint „Willkommen bei Heimlager“:
eine vorhandene Person antippen (oder „Neue Person“), Passwort zweimal eingeben – diese Person ist dann **Admin**.
Danach meldet man sich an, indem man seine Kachel antippt und das Passwort eingibt (PIN ab 4 Zeichen geht auch).
Die Anmeldung bleibt 30 Tage auf dem Gerät erhalten.

- **Admins** vergeben unter „Personen verwalten“ Passwörter und Rollen (Benutzer/Admin) und verwalten Lager
  und API-Schlüssel. Personen ohne Passwort erscheinen nicht auf der Anmeldeseite.
- **Mein Konto** (Menü oder Klick auf den eigenen Namen oben): eigenes Passwort ändern, abmelden.
- Buchungen werden immer der angemeldeten Person zugeordnet.

**Passwort vergessen?** Ein Admin setzt es unter „Personen verwalten“ neu. Hat der (einzige) Admin sein
Passwort vergessen, auf dem Server:

```bash
npm run reset-password                          # Personen anzeigen
npm run reset-password -- anna                # zufälliges neues Passwort erzeugen und ausgeben
npm run reset-password -- anna neuesPW --admin   # vorgegebenes Passwort, zusätzlich Admin-Rechte
# im Docker-Container:
docker compose exec heimlager node scripts/reset-password.js anna
```

## Fotos

Gegenstände können ein Foto bekommen – beim Anlegen (optional) oder in der Detailansicht durch Antippen des
Foto-Felds (Kamera oder Galerie). Das Handy verkleinert das Bild vor dem Hochladen (ca. 1280 px, dazu ein
quadratisches Vorschaubild); Vorschaubilder erscheinen in allen Listen und im Scan-Modus zur Bestätigung.
Fotos liegen in der Datenbank und sind damit automatisch in jedem Backup enthalten.

## Als App installieren

Heimlager ist eine installierbare Web-App (PWA): über HTTPS öffnen (Port 3443 oder Reverse Proxy), dann im
Browser „App installieren“ bzw. auf dem iPhone „Teilen → Zum Home-Bildschirm“ (Anleitung auch unter „Mein Konto“).
Langes Drücken auf das App-Symbol springt direkt zu **Scannen, Einbuchen, Ausbuchen, Suchen, Einkaufsliste**.
Die Oberfläche wird zwischengespeichert und startet dadurch schnell; Daten kommen immer frisch vom Server.
Die Icons erzeugt `npm run icons` (Skript `scripts/make-icons.js`).

## Auswertung

Menü → „Auswertung“: Kennzahlen (Gegenstände, Stück, belegte Plätze, Buchungen, Einkaufsliste, ausverkauft),
die am häufigsten genutzten Gegenstände (90 Tage), wer wie viel bucht (30 Tage), **lange nicht angefasste**
Gegenstände (6 Monate / 1 Jahr / 2 Jahre – Kandidaten zum Aussortieren), ausverkaufte Gegenstände und leere Plätze.
Bei mehreren Lagern lässt sich auf ein Lager filtern.

## Export & Import

Administration → „Export & Import“ (nur Admins):

- **Export** als Excel (.xlsx) oder CSV (Semikolon, öffnet in deutschem Excel direkt), alle oder ein Lager.
  Spalten: Code, Name, Beschreibung, Lager, Platz, Menge, Verbrauchsmaterial, Haltbar bis, Platzname, Kategorie, Zuletzt gebucht, Von.
- **Import** derselben Spalten aus Excel oder CSV (Vorlage zum Herunterladen). Pflicht sind Name und Platz
  (`B12` + Spalte Lager oder `K-B12`). Zeilen mit bekanntem **Code** aktualisieren den Gegenstand, ein unbekannter
  gültiger Code wird übernommen (für vorgedruckte Etiketten), ohne Code wird neu angelegt.
  Vor dem Import zeigt eine **Vorschau** jede Zeile (neu / geändert / unverändert / Fehler); Fehlerzeilen werden
  übersprungen. Mengenänderungen werden als Buchung erfasst, vorher wird automatisch ein Backup angelegt.

So lässt sich z. B. exportieren, in Excel bearbeiten und wieder importieren.

## Buchungen rückgängig machen

Nach jedem Ein- oder Ausbuchen zeigt die Meldung einige Sekunden lang „Rückgängig“. Später geht es in der
Detailansicht eines Gegenstands über „rückgängig“ an der obersten Buchung im Verlauf, per MCP mit dem
Werkzeug `buchung_rueckgaengig`. Zurückgenommen wird alles, was die Buchung verändert hat: Bestand,
Lagerplatz (bei Umlagerung), Einkaufsliste – und eine Einbuchung, die einen Gegenstand neu angelegt hat,
entfernt ihn wieder.

- Nur die **jeweils letzte Buchung** eines Gegenstands kann zurückgenommen werden (sonst stimmen Bestände nicht mehr).
- Nur **eigene** Buchungen; Admins dürfen alle.

## Backups

Der Server legt automatisch ein Backup an (Standard: alle 24 Stunden, die letzten 14 bleiben erhalten), im Ordner
`backups/` neben der Datenbank (`data/backups`, im Docker-Container `/data/backups`). Unter
**Administration → Backups** können Admins:

- sofort ein Backup anlegen, Backups herunterladen oder löschen,
- einen früheren Stand **wiederherstellen** – im laufenden Betrieb; der aktuelle Stand wird vorher automatisch
  gesichert („vor Wiederherstellung“) und lässt sich genauso zurückholen,
- eine Backup-Datei hochladen (nur ablegen oder direkt einspielen). Die Datei wird vorher geprüft.

Manuelle Backups und Sicherungen vor einer Wiederherstellung werden nie automatisch gelöscht.
Wichtig: Backups gehören zusätzlich woandershin (herunterladen, NAS, Cloud) – auf demselben Datenträger helfen sie
bei einem Festplattenschaden nicht.

| Variable                | Standard                 | Bedeutung                                       |
|-------------------------|--------------------------|-------------------------------------------------|
| `BACKUP_DIR`            | `<Datenbank-Ordner>/backups` | Speicherort                                 |
| `BACKUP_INTERVAL_HOURS` | `24`                     | Abstand der automatischen Backups, `0` = aus    |
| `BACKUP_KEEP`           | `14`                     | Anzahl aufbewahrter automatischer Backups       |

## KI-Assistent in der App

Unter **Assistent** (Menü, und als lila Knopf in der Detail- und Platzansicht) nimmt ein KI-Assistent Aufträge per
**Text, Sprache oder Foto** an und bucht selbst: „3 Dosen Tomaten auf Keller B2, haltbar bis 05/2027“, „Leg die
Bohrmaschine in die Werkzeugkiste“, Foto vom Gegenstand + Regal-Etikett „das kommt hierhin“, „Was läuft diese Woche ab?“.

- **Einrichten** (Administration → Assistent): Adresse einer OpenAI-kompatiblen Schnittstelle (Standard
  `https://openrouter.ai/api/v1`), Modell und API-Schlüssel, dann „Verbindung testen“. Das Modell muss Werkzeuge
  (Tool Calling) und für Fotos Bilder unterstützen. Der Schlüssel bleibt auf dem Server und wird nie angezeigt.
- **Werkzeuge:** dieselben wie beim MCP-Server, dazu `foto_zuordnen` (Foto aus dem Chat wird Bild des Gegenstands).
  Der Assistent handelt als angemeldete Person mit deren Rechten; im Verlauf steht „per Assistent“.
- **Buchungen** führt er sofort aus – jede erscheint im Chat mit „rückgängig“. Sind es **4 oder mehr auf einmal**,
  zeigt er sie zuerst zur Bestätigung („Ausführen“ / „Abbrechen“).
- **Fotos:** Die App verkleinert sie und liest QR-Etiketten (Platz, Objekt) selbst aus; der Assistent erkennt den Rest.
- **Sprache:** 🎤 nutzt die Spracherkennung des Browsers (Chrome/Android gut, Safari/iOS eingeschränkt, nur mit HTTPS);
  nach dem Sprechen wird automatisch gesendet. „🔊 Vorlesen“ liest die Antworten vor.
- **Kontext:** Aus der Detail- oder Platzansicht geöffnet, weiß der Assistent, was mit „das“ bzw. „hier“ gemeint ist.
- **Platznamen:** Lagerplätze mit Namen (Lagerplätze → Bearbeiten, z. B. „Kühlschrank“) versteht er direkt: „in den Kühlschrank“.
- **Verlauf:** Mitgeschickt werden nur die letzten Nachrichten (höchstens 20 bzw. etwa 8000 Zeichen). „Vergiss das“ oder
  „Neues Gespräch“ löscht den Verlauf, ebenso der Knopf „Neues Gespräch“; nach 30 Minuten Pause beginnt automatisch ein
  neues Gespräch (ältere Nachrichten bleiben sichtbar, gehen aber nicht mehr mit).
- **Preisrecherche** (Einkaufsliste, Werkzeug `preise_recherchieren`): je Produkt eine Websuche, das Modell nennt die
  günstigsten Angebote mit Quelle; Angebote, deren Quelle nicht unter den Suchergebnissen ist, gelten als unbestätigt.
  Die Websuche kommt bei **OpenRouter** vom Web-Plugin. Bei einem **Gateway wie LiteLLM** (Einstellung „Such-Tool im
  Gateway“, z. B. `foundry-web`) recherchiert ein kleiner Agent mit den Werkzeugen `websuche` (`POST {Adresse}/search/{Such-Tool}`,
  höchstens 3) und `seite_lesen` (der Server lädt die Seite, nur öffentliche Adressen, höchstens 3); bestätigt ist ein
  Preis dann nur, wenn er auf einer gelesenen Seite steht. Seiten, die ihre Preise erst per JavaScript laden, liefern
  keinen Text – Prospektportale wie kaufDA funktionieren gut. Ohne Web-Plugin und Such-Tool ist die Preisrecherche nicht verfügbar.
  Vergleichs- und Prospektportale sind nur Quelle, nie Händler.
- **Datenschutz/Kosten:** Nachrichten, Fotos und Suchergebnisse gehen an den gewählten Anbieter. Die Einstellungen
  zeigen Anfragen, Tokens und (falls der Anbieter sie meldet) Kosten der letzten 30 Tage.

| Variable      | Bedeutung                                                              |
|---------------|------------------------------------------------------------------------|
| `AI_API_KEY`  | API-Schlüssel (hat Vorrang vor der Einstellung; steht dann nicht in Datenbank und Backups) |
| `AI_BASE_URL` | Adresse der Schnittstelle, z. B. `https://openrouter.ai/api/v1`         |
| `AI_MODEL`    | Modell                                                                 |
| `AI_SEARCH_TOOL` | Such-Tool des Gateways für die Preisrecherche ohne OpenRouter, z. B. `foundry-web` (hat Vorrang vor der Einstellung) |
| `PUBLIC_URL`  | Öffentliche Adresse der App (wird dem Anbieter als Referer genannt)    |

## Haus in 3D

Unter Administration → „Haus einrichten“ lässt sich das ganze Haus samt Außenbereich nachbauen: Etagen (Keller, Wohnetagen,
Dachboden mit Satteldach, Außen) mit Höhenlage, Raumhöhe, Außenumriss und Räumen als Vielecke; die Wände ergeben sich
automatisch aus „Umriss minus Räume“. Dazu Türen, Fenster, Carport/Terrasse/Stellplatz und Einbauten (Regal, Schrank,
Hängeschrank, Kühlschrank, Stellfläche, Treppe). Jeder Lagerplatz – aus beliebigen Lagern – kann einem Boden eines Einbaus
zugeordnet werden. Der Lagerplan zeigt das Haus im Reiter „3D“ (three.js unter `public/vendor/three/`, lädt erst beim Öffnen).
Maße werden in mm gespeichert, im Editor in cm angezeigt.

## MCP-Server (KI-Assistenten)

Auf einem eigenen Port (Standard `3100`) läuft ein MCP-Server (Transport „Streamable HTTP“, Endpunkt `/mcp`),
über den KI-Assistenten wie Claude das Lager nutzen können: suchen, ein-/ausbuchen, umlagern, Lagerplätze
anzeigen, Einkaufsliste, letzte Buchungen. Anmeldung per **API-Schlüssel** (`Authorization: Bearer hlk_…`),
die Admins unter „API-Schlüssel“ anlegen: je Schlüssel eine Person (in deren Namen gebucht wird) und die Rechte
„Lesen und buchen“ oder „Nur lesen“. Der Schlüssel wird nur einmal angezeigt; gespeichert ist nur ein Hash.
API-Schlüssel funktionieren auch für die REST-API (`/api/...`), aber nicht für Verwaltungsfunktionen.
Ausnahme im MCP-Server: Mit dem Schlüssel eines Admins („Lesen und buchen“) steht zusätzlich `lager_anlegen` bereit.

```bash
claude mcp add --transport http heimlager http://localhost:3100/mcp --header "Authorization: Bearer hlk_…"
```

Für den Zugriff von außen den Port über einen Reverse Proxy (TLS) veröffentlichen – die Web-App selbst muss
dafür nicht öffentlich sein. Beim Proxy Puffern ausschalten (Caddy `flush_interval -1`, nginx `proxy_buffering off`).

| Variable              | Standard  | Bedeutung                                                         |
|-----------------------|-----------|-------------------------------------------------------------------|
| `MCP_PORT`            | `3100`    | Port des MCP-Servers, `0` = aus                                   |
| `MCP_HOST`            | `0.0.0.0` | Adresse, z. B. `127.0.0.1`, wenn der Proxy auf demselben Rechner läuft |
| `MCP_PUBLIC_URL`      | –         | Öffentliche Adresse, z. B. `https://mcp.example.de` (für Origin-Prüfung und Anzeige) |
| `MCP_ALLOWED_ORIGINS` | –         | Weitere erlaubte Browser-Origins, kommagetrennt                    |
| `MCP_KEY_IN_URL`      | –         | `1` = Schlüssel auch in der URL erlauben (`/mcp/hlk_…`) für Clients ohne eigene Header – landet dann aber in Proxy-Logs |

## Ablauf

1. **Anmelden** – eigene Kachel antippen, Passwort eingeben.
2. **Was möchtest du tun?** – Scannen, Einbuchen, Ausbuchen oder Suchen
   (plus Lagerplan, Lagerplätze und Etikettendruck).
3. Jede Buchung merkt sich Person, Menge, Lagerplatz und Zeitpunkt.
   In der Suche und in der Detailansicht ist sichtbar, wer einen Gegenstand zuletzt
   eingebucht oder entnommen hat – inklusive vollständigem Verlauf.

## Personen verwalten

Unter „Personen verwalten“ (im Menü und auf der Seite „Wer bist du?“) lassen sich Personen
anlegen, umbenennen und umfärben. Wer nicht mehr gebraucht wird, hat zwei Möglichkeiten:

- **Archivieren** – die Person verschwindet aus der Auswahl, ihr Verlauf bleibt unverändert.
  Archivierte Personen können nicht buchen und lassen sich jederzeit wiederherstellen.
- **Löschen** – ohne Buchungen sofort. Mit Buchungen werden diese vorher einer anderen Person
  übertragen (praktisch, um doppelt angelegte Personen zusammenzuführen).

## Scannen mit QR-Codes

Im Scan-Modus läuft die Kamera dauerhaft. Erkannte Codes lösen sofort eine Aktion aus:

| Ablauf        | Scans                                   | Ergebnis                                      |
|---------------|-----------------------------------------|-----------------------------------------------|
| **Einbuchen** | 1. Lagerplatz, 2. Objekt                | Objekt wird auf diesen Platz gebucht. Der Platz bleibt aktiv, weitere Objekte können direkt nachgescannt werden. |
| **Ausbuchen** | Objekt **zweimal** hintereinander       | Objekt wird entnommen. Zwischen den Scans kurz die Kamera wegbewegen. |
| **Neues Objekt** | Unbekanntes (vorgedrucktes) Etikett   | Formular für Name und Platz öffnet sich, der Code wird dem Objekt fest zugeordnet. |

Die Menge je Buchung (Standard 1) lässt sich im Scan-Modus einstellen. Ein Signalton
und eine Vibration bestätigen jede Buchung. Das Eingabefeld unter dem Kamerabild nimmt
auch Handscanner-Eingaben oder von Hand getippte Codes entgegen.

### Code-Format

QR-Codes enthalten einen Link auf die App, z. B. `https://192.168.1.20:3443/q/P-K-B12`.
Wird er mit der normalen Kamera-App gescannt, öffnet sich direkt der Platz bzw. das Objekt.
Der Scanner in der App wertet nur den Schluss des Links aus, ein Wechsel der IP schadet nicht.

| Art          | Code            | Beispiel     |
|--------------|-----------------|--------------|
| Lagerplatz   | `P-<Lager-Kürzel>-<Spalte><Zeile>` | `P-K-B12`, `P-H-AC7` |
| Lagerplatz (alt) | `P-<Spalte><Zeile>` | `P-B12` – ältere Etiketten, gehören zum ersten Lager |
| Objekt       | `O-<6 Zeichen>` | `O-K7M2XQ`   |

Objekt-Codes bestehen aus 6 Zeichen ohne verwechselbare Buchstaben (kein 0/O, 1/I).
Beim Eintippen darf das Präfix entfallen.

## Verbrauchsmaterial und Einkaufsliste

Gegenstände können beim Anlegen oder unter „Bearbeiten“ als **Verbrauchsmaterial** markiert werden
(z. B. Batterien, Schrauben, Putzmittel). Wird so ein Gegenstand ausgebucht, gilt er als verbraucht und
die ausgebuchte Menge kommt automatisch auf die **Einkaufsliste** (Kachel im Menü, mit Anzahl).
Steht er schon drauf, wird die Menge erhöht. Andere Gegenstände lassen sich in der Detailansicht mit
„Auf Einkaufsliste“ von Hand hinzufügen, freie Einträge (z. B. „Milch“) direkt auf der Liste.

Auf der Liste:

- **Abhaken** (Kreis) – gekauft; landet unter „Zuletzt gekauft“ und kann von dort zurückgeholt werden.
- **Gekauft + einbuchen** – bucht die Menge direkt wieder auf den bisherigen Lagerplatz ein.
- **Gekauft + einlagern** (freie Einträge, die noch kein Gegenstand sind) – öffnet „Neuer Gegenstand“ mit Name, Menge
  und Verbrauchsmaterial vorausgefüllt; nach dem Speichern ist der Eintrag abgehakt und mit dem Gegenstand verknüpft.
- Menge mit −/+ ändern, Notiz ergänzen (Marke, Größe …), Eintrag entfernen.
- **Teilen:** „WhatsApp“ öffnet WhatsApp mit der fertigen Liste, „Teilen…“ das Teilen-Menü des Handys
  (nur über HTTPS verfügbar), außerdem „Kopieren“ und „Als Text speichern“.

## Mehrere Lager

Unter „Lager verwalten“ lassen sich beliebig viele Lager anlegen (z. B. Keller, Garage, Dachboden).
Jedes Lager hat einen **Namen** und ein **Kürzel** (1–4 Zeichen, z. B. `K`) und eigene Lagerplätze –
B12 im Keller und B12 in der Garage sind verschiedene Plätze.

- Das **aktuelle Lager** wird oben in der Kopfzeile gewählt (erscheint ab zwei Lagern) und pro Gerät gemerkt.
  Lagerplätze, Lagerplan und Etikettendruck beziehen sich auf dieses Lager.
- Die **Suche** findet Gegenstände in allen Lagern; Plätze werden dann mit Kürzel angezeigt (`K-B12`).
  Mit Kürzel gesucht (`K-B12`, `K-B`) wird nur in diesem Lager gesucht.
- Beim Einbuchen und Bearbeiten wählt man Lager + Platz; so lassen sich Dinge auch in ein anderes Lager umlagern.
- Ein Lager kann nur gelöscht werden, wenn keine Gegenstände mehr darin liegen.

Beim ersten Start nach dem Update werden alle bisherigen Plätze und Gegenstände dem Lager
**„Hauptlager“ (Kürzel `H`)** zugeordnet. Name und Kürzel lassen sich danach ändern.

## Haltbarkeit

Gegenstände können ein **Haltbarkeitsdatum** bekommen (Einbuchen, Bearbeiten; optional). Es gibt ein Datum je
Gegenstand – bei mehreren Packungen mit unterschiedlichem Datum das früheste eintragen oder getrennte Gegenstände anlegen.

- **Neue Packung:** Beim Einbuchen eines vorhandenen Gegenstands lässt sich das Datum gleich mit ändern.
- **Anzeige:** In Listen erscheint ab 30 Tagen vor Ablauf ein orangefarbenes, nach Ablauf ein rotes Schild,
  in der Detailansicht immer das Datum.
- **Menü:** Ist etwas abgelaufen oder läuft in den nächsten 7 Tagen ab, erscheint oben ein Hinweis.
- **„Haltbarkeit“** (Menü) listet Abgelaufenes und was in 7 Tagen, 30 Tagen, 3 Monaten oder 1 Jahr abläuft;
  die Auswertung zeigt beides als Kennzahl. Gegenstände mit Bestand 0 zählen nicht.
- **Export/Import:** Spalte „Haltbar bis“ (auch „MHD“), z. B. `31.03.2027`, `2027-03-31`, Excel-Datumszellen oder nur
  der Monat `03/2027` (= Monatsende).
- **MCP:** `einbuchen` mit `haltbar_bis`, `haltbarkeit_setzen` (ohne Mengenänderung) und `haltbarkeit_pruefen`.

## Behälter (Tasche, Box, Kiste)

Steht auf einem Lagerplatz eine Tasche oder Box, in der mehrere Dinge liegen, wird sie als **Behälter** angelegt
(Häkchen „Behälter“ beim Einbuchen oder Bearbeiten). Ein Behälter ist ein normaler Gegenstand mit eigenem Code und
Etikett; andere Gegenstände liegen **in** ihm – auch verschachtelt (Bit-Tasche in der Werkzeugkiste).

- **Hineinlegen:** in der Detailansicht des Behälters „Gegenstand hineinlegen“ bzw. „Neuen Gegenstand hinein einbuchen“,
  oder beim Einbuchen/Bearbeiten unter „Liegt in“ den Behälter wählen (dann entfällt die Platzangabe).
- **Platz:** Der Inhalt hat immer den Platz des Behälters. Wird der Behälter umgelagert, wandert alles darin mit.
- **Herausnehmen:** beim Bearbeiten „direkt auf dem Lagerplatz“ wählen oder an einem anderen Platz einbuchen.
  Einbuchen am selben Platz lässt den Gegenstand im Behälter.
- **Anzeige:** Auf dem Lagerplatz steht der Inhalt eingerückt unter seinem Behälter, in Listen steht „in …“ dabei.
- **Scannen:** Behälter scannen → „Einräumen“ → jedes weitere gescannte Objekt wird in den Behälter eingebucht.
- **Rückgängig** legt einen Gegenstand wieder in den Behälter, aus dem er kam. Wird ein Behälter gelöscht, bleibt
  sein Inhalt auf dem Platz liegen. Ein Behälter mit Inhalt kann nicht wieder zum normalen Gegenstand werden.
- Per MCP: `einbuchen` und `umlagern` mit `behaelter`, neue Behälter mit `ist_behaelter`.
- Export/Import kennen Behälter noch nicht: Importierte Zeilen mit anderem Platz nehmen den Gegenstand aus seinem Behälter.

## Lagerplätze

Ein Lagerplatz besteht aus einer **Spalte** (Buchstaben `A`–`Z`, auch mehrstellig wie `AA`, `AB`, …)
und einer **Zeile** (`0`–`99`), z. B. `B12` oder `AC7`. Jeder Platz kann einen **Namen**, eine
**Kategorie** und eine **Kurzbeschreibung** bekommen. Unter „Lagerplätze“ lassen sich ganze
Bereiche auf einmal anlegen (z. B. Spalten A–C, Zeilen 0–9). Plätze, die beim Einbuchen
noch nicht existieren, werden automatisch angelegt.

In der Suche kann direkt nach einem Platz gesucht werden (`B12` zeigt den Platz, `B` die
ganze Spalte), außerdem nach Platzname, Kategorie und Objekt-Code.

## Etiketten drucken

Unter „Etiketten drucken“ gibt es drei Arten:

- **Lagerplätze** – Bereich wählen oder alle angelegten Plätze; Etikett mit QR, Adresse, Name, Kategorie.
- **Objekte** – alle oder gefilterte Objekte; Etikett mit QR, Name, Platz und Code.
- **Leere Objekt-Etiketten** – vorab gedruckte Codes zum Aufkleben. Beim ersten Scan wird das Objekt angelegt.

Der Ausdruck läuft über den Browser-Druckdialog. Es gibt eine große (ca. 7 × 3,6 cm) und
eine kleine Variante (ca. 5 × 2,5 cm). Einzelne Etiketten können direkt aus der Platz- oder
Objektansicht gedruckt werden.

## 3D-Druck

In der Platz- und Objektansicht öffnet „3D-Druck“ einen Generator für QR-Schilder.
Einstellbar sind Breite, Rand, Eckenradius, Platten- und QR-Höhe, ein Text unter dem Code,
eine Öse zum Aufhängen sowie die Farben für Grundplatte und QR-Code. Die Vorschau zeigt
Maße und Modulgröße und warnt bei zu kleinen Modulen (unter 0,8 mm) oder zu wenig Kontrast.

| Download            | Gedacht für                                                             |
|---------------------|-------------------------------------------------------------------------|
| STL (ein Teil)      | Ein Filament; im Slicer bei Z = Plattenstärke einen Farbwechsel einfügen |
| 3MF mit Farben      | Mehrfarbdrucker (AMS/MMU): Grundplatte und QR-Code als zwei farbige Teile |
| 2 STL-Teile (ZIP)   | Slicer ohne 3MF-Unterstützung: beide Teile einzeln                      |

Die Modelle werden komplett im Browser erzeugt (`public/qr3d.js`).

## Datensicherung

Alles liegt in `data/lager.db`. Eine Kopie dieser Datei ist ein vollständiges Backup
(Server vorher beenden oder zusätzlich `data/lager.db-wal` mitkopieren).

## API (für eigene Erweiterungen)

Alle Endpunkte außer `/api/auth/*` brauchen eine Anmeldung: Sitzungs-Cookie (Browser) oder
`Authorization: Bearer <API-Schlüssel>`. Verwaltung (Personen anlegen/ändern, Lager, API-Schlüssel) nur für Admins.

| Methode | Pfad                        | Zweck                                                        |
|---------|-----------------------------|--------------------------------------------------------------|
| GET     | `/api/auth/status`          | Anmeldestatus, Personen für die Anmeldeseite, `setup`        |
| POST    | `/api/auth/setup`           | Ersteinrichtung: ersten Admin festlegen `{person_id \| name, password}` |
| POST    | `/api/auth/login`           | Anmelden `{person_id, password}` (setzt Sitzungs-Cookie)     |
| POST    | `/api/auth/logout`          | Abmelden                                                     |
| POST    | `/api/auth/password`        | Eigenes Passwort ändern `{current, password}`                |
| GET/POST/DELETE | `/api/keys`         | API-Schlüssel verwalten (nur Admins)                         |
| GET     | `/api/persons`              | Personen auflisten                                           |
| GET     | `/api/persons?all=1`        | Alle Personen inkl. archivierter, mit Buchungsanzahl         |
| POST    | `/api/persons`              | Person anlegen `{name, color}`                               |
| PATCH   | `/api/persons/:id`          | Ändern/archivieren `{name, color, archived}`                 |
| DELETE  | `/api/persons/:id`          | Löschen, bei Buchungen mit `?merge_into=<id>`                |
| GET     | `/api/warehouses`           | Lager mit Anzahl Plätze/Objekte                              |
| POST    | `/api/warehouses`           | Lager anlegen `{name, code, description}`                    |
| PATCH   | `/api/warehouses/:id`       | Lager ändern                                                 |
| DELETE  | `/api/warehouses/:id`       | Leeres Lager löschen                                         |
| GET     | `/api/site`                 | Haus: `floors` mit `outline`, `rooms`, `openings`, `roof`, `background`, `fixtures` (mit `slots`), `updated_at` (Maße in mm) |
| PUT     | `/api/site`                 | Haus komplett speichern (nur Admins); `if_updated_at` = zuletzt geladener Stand, sonst 409 |
| GET     | `/api/site/places`          | Plätze aller Lager, die im Haus liegen, mit Belegung und Inhalt |
| GET     | `/api/site/stats`           | Je Platz im Haus: Buchungen der letzten 90 Tage, letzte Bewegung (Heatmap) |
| GET/PUT/DELETE | `/api/floors/:id/image` | Hintergrundbild einer Etage (PNG/JPEG/WebP, Base64 `{image}`; Ändern nur Admins) |
| GET     | `/api/places?wh=`           | Lagerplätze eines Lagers mit Belegung (alle Platz-Endpunkte nehmen `?wh=<Lager-ID>`, ohne Angabe gilt das erste Lager) |
| GET     | `/api/places/:col/:row`     | Platz mit Objekten                                           |
| PUT     | `/api/places/:col/:row`     | Platz anlegen/ändern `{name, category, description}`         |
| POST    | `/api/places/bulk`          | Bereich anlegen `{col_from, col_to, row_from, row_to, category}` |
| DELETE  | `/api/places/:col/:row`     | Leeren Platz löschen                                         |
| GET     | `/api/resolve?code=`        | Scan-Code auflösen → `place`, `item`, `unknown`, `invalid`   |
| GET     | `/api/codes/new?n=`         | Neue, freie Objekt-Codes für Leer-Etiketten                  |
| GET     | `/api/items?q=&wh=`         | Gegenstände suchen (optional nur in einem Lager)             |
| GET     | `/api/items/:id`            | Gegenstand mit Verlauf                                       |
| PATCH   | `/api/items/:id`            | Stammdaten ändern (inkl. `consumable`, `container`, `container_id` – `null` = aus dem Behälter, `expires_on`) |
| GET     | `/api/containers`           | Alle Behälter                                                |
| GET     | `/api/expiring?days=&wh=`   | Abgelaufen oder läuft in `days` Tagen ab (Standard 30)       |
| DELETE  | `/api/items/:id`            | Gegenstand löschen                                           |
| POST    | `/api/checkin`              | Einbuchen `{person_id, item_id \| code, name, warehouse_id, col, row, quantity, container_id, container, expires_on}` |
| PUT/GET/DELETE | `/api/items/:id/photo` | Foto `{image, thumb}` (Base64-JPEG/WebP) speichern / abrufen (`?size=thumb`) / löschen |
| GET     | `/api/stats?wh=&stale_days=` | Auswertung                                                  |
| POST    | `/api/import`               | Import `{rows, dry}` (nur Admins)                            |
| POST    | `/api/assistant`            | Assistent `{message, history, images: [{image, thumb, codes}], context}` → `{reply, bookings, confirm?}` |
| POST    | `/api/assistant/confirm`    | Zurückgestellte Buchungen ausführen `{token}` (`…/cancel`: verwerfen) |
| GET/PUT | `/api/assistant/settings`   | Einstellungen des Assistenten (nur Admins); `POST /api/assistant/test` |
| POST    | `/api/movements/:id/undo`   | Buchung rückgängig machen (letzte des Gegenstands, eigene; Admins alle) |
| GET/POST | `/api/backups`             | Backups auflisten / anlegen (nur Admins); `…/:name/download`, `…/:name/restore`, `POST /api/backups/upload[?restore=1]` |
| POST    | `/api/checkout`             | Ausbuchen `{person_id, item_id \| code, quantity}`           |
| GET     | `/api/shopping`             | Einkaufsliste `{open, done}`                                 |
| POST    | `/api/shopping`             | Eintrag `{item_id \| name, quantity, note, person_id}`       |
| PATCH   | `/api/shopping/:id`         | Ändern `{quantity, note, done}`                              |
| POST    | `/api/shopping/:id/restock` | Gekauft und einbuchen `{quantity?}`; mit `col/row` oder `container_id` dorthin – freie Einträge werden dabei neu angelegt `{name?, consumable?, expires_on?}` |
| DELETE  | `/api/shopping/:id`         | Eintrag entfernen (`/api/shopping?done=1`: alle erledigten)  |
| GET     | `/api/overview`             | Alle Plätze und letzte Buchungen                             |
| GET     | `/q/<code>`                 | QR-Link, leitet in die App weiter                            |

## Verwendete Bibliotheken (im Ordner `public/vendor`)

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) – QR-Codes erzeugen
- [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) – QR-Codes aus dem Kamerabild lesen, falls der Browser keinen `BarcodeDetector` hat
