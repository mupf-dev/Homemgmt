# Changelog Küchenplaner (kitchen planner, up to 1.0.0, before the merge)

## 1.0.0 – 2026-10-03

First release of the kitchen planner.

**Planning**
- 2D floor plan editor: draw walls (length input, angle and endpoint snapping), doors and windows, room from
  dimensions (rectangle, L-shape), floor plan image as a template with scale calibration
- Catalog with base, wall and tall cabinets, appliances, cooking island, side panels, vertical handle profiles,
  furnishings; snapping to walls and neighbors, width freely adjustable via handles, undo/redo
- Handleless kitchen with grip recesses (horizontal/vertical), fronts (doors, single door/flap, pull-outs 1–4),
  cooking island with column widths, back side as counter or doors, overhangs, downdraft extractor
- Sink BLANCO SUBLINE 500-U (undermount) and faucet BLANCO KANO-S Vario as models

**Materials**
- Library with lacquers, wood, stone, ceramics, metal, tiles, floors (scans from Poly Haven, CC0), Silgranit
- Upload custom textures (incl. normal/roughness map), custom colors via color wheel (matte/normal/high gloss)
- Online libraries Poly Haven and ambientCG with import to the server
- Align textures per area and element (stretch/tile, size, rotation to the degree, offset)
- Color adjustment (hue, saturation, brightness, contrast, tint, gloss)

**3D**
- Real-time with shadows, ambient occlusion, time of day, light controls (sun, sky, lamps, softness)
- Photorealistic mode (GPU path tracing), walk-through, showroom view with tour and full screen

**Accounts & sharing**
- Sign-in, the first user is administrator; registration on/off, approval requirement, user management
- Save plans in the account, open, rename, save as copy, delete
- Showroom link for viewing without signing in (read-only, can be deactivated)

**Operation**
- Docker image (Node 22, Express, SQLite), running behind Zoraxy
