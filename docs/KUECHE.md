> **Hinweis:** Handbuch aus dem eigenständigen Küchenplaner (Stand 1.0.0). Die App läuft jetzt unter `/kueche/` von homemgmt-ng; Konten, Start und Docker stehen in der [README](../README.md).

# Küchenplaner 3D

Webbasierter Küchenplaner: 2D-Grundriss → 3D-Küche mit PBR-Materialien, eigenem Textur-Upload und fotorealistischem Pathtracing.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # statischer Build in dist/
```

## Aufbau
- `src/plan2d.ts` – 2D-Editor (Wände, Türen/Fenster, Grundriss-Vorlage + Maßstabskalibrierung, Platzieren mit Wand-Andocken)
- `src/scene3d.ts` – Three.js-Szene (Schatten, GTAO, Tageslicht, Begehen-Modus, Pathtracer via `three-gpu-pathtracer`)
- `src/models.ts` – prozedurale Schrank-/Gerätemodelle
- `src/materials.ts`, `src/procedural.ts` – Materialbibliothek, prozedurale Texturen, Upload eigener Texturen
- `src/catalog.ts` – Elementkatalog
- `src/state.ts` – Projektzustand, Undo/Redo, Autospeichern (localStorage), JSON-Export

## Konten & gespeicherte Planungen

Der Server (`server/index.ts`, Express + eingebautes `node:sqlite`, Node ≥ 22.18) stellt Anmeldung und Profilspeicher bereit.
Das **erste registrierte Konto wird Administrator** und kann unter „Benutzerverwaltung“ Rollen vergeben und Benutzer löschen.

```bash
npm run dev            # Frontend (Vite) + API-Server (Port 3001) gemeinsam
npm run build && npm start   # Produktion: Server liefert dist/ aus, http://localhost:3001
```

- Daten liegen in `data/kuechenplaner.db` (Pfad per `DATA_DIR` änderbar, Port per `PORT`).
- Passwörter: scrypt mit Salt; Sitzungen: zufälliges Token im HttpOnly-Cookie (30 Tage), in der DB nur als SHA-256-Hash.
- Hinter HTTPS `COOKIE_SECURE=1` setzen.
- Ohne Anmeldung funktioniert der Planer weiter, gespeichert wird dann nur lokal im Browser.
- Administratoren können unter „Benutzerverwaltung“ die Registrierung ein-/ausschalten und eine Freigabepflicht für neue Konten aktivieren. Wartende Konten werden dort freigegeben oder abgelehnt; aktive Konten lassen sich sperren (sofortige Abmeldung).

## Betrieb mit Docker

```bash
docker compose up -d --build   # Web-App auf http://<server>:3010
```

Hinter einem Reverse Proxy (z. B. Zoraxy) mit HTTPS `TRUST_PROXY=1` und `COOKIE_SECURE=1` setzen und den Container ohne Host-Port ins Proxy-Netz hängen (`docker-compose.override.yml`). Daten liegen im Volume unter `/data`.
