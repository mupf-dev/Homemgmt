> **Note:** Manual from the standalone Küchenplaner (kitchen planner, as of 1.0.0). The app now runs under `/kueche/` in homemgmt-ng; accounts, startup and Docker are described in the [README](../README.md).

# Küchenplaner 3D

Web-based kitchen planner: 2D floor plan → 3D kitchen with PBR materials, custom texture upload and photorealistic path tracing.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Structure
- `src/plan2d.ts` – 2D editor (walls, doors/windows, floor plan template + scale calibration, placement with wall snapping)
- `src/scene3d.ts` – Three.js scene (shadows, GTAO, daylight, walk-through mode, path tracer via `three-gpu-pathtracer`)
- `src/models.ts` – procedural cabinet/appliance models
- `src/materials.ts`, `src/procedural.ts` – material library, procedural textures, upload of custom textures
- `src/catalog.ts` – element catalog
- `src/state.ts` – project state, undo/redo, autosave (localStorage), JSON export

## Accounts & saved plans

The server (`server/index.ts`, Express + built-in `node:sqlite`, Node ≥ 22.18) provides sign-in and profile storage.
The **first registered account becomes administrator** and can assign roles and delete users under "User management".

```bash
npm run dev            # frontend (Vite) + API server (port 3001) together
npm run build && npm start   # production: the server serves dist/, http://localhost:3001
```

- Data is stored in `data/kuechenplaner.db` (path configurable via `DATA_DIR`, port via `PORT`).
- Passwords: scrypt with salt; sessions: random token in an HttpOnly cookie (30 days), stored in the DB only as a SHA-256 hash.
- Behind HTTPS set `COOKIE_SECURE=1`.
- Without signing in, the planner keeps working, but plans are only saved locally in the browser.
- Under "User management" administrators can turn registration on/off and require approval for new accounts. Pending accounts are approved or rejected there; active accounts can be locked (immediate sign-out).

## Running with Docker

```bash
docker compose up -d --build   # web app at http://<server>:3010
```

Behind a reverse proxy (e.g. Zoraxy) with HTTPS, set `TRUST_PROXY=1` and `COOKIE_SECURE=1` and attach the container to the proxy network without a host port (`docker-compose.override.yml`). Data is stored in the volume under `/data`.
