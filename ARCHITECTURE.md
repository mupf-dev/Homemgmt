# homemgmt-ng – Architecture

homemgmt-ng (working title "Zuhause") merges **Heimlager** (`inventory`, including the `inventory-3d` branch) and the
**Küchenplaner** (kitchen planner) into one fully integrated solution: the kitchen planner's planning engine becomes a
**house planner for the whole house**, and the **inventory features live in the plan** – every compartment of a
planned piece of furniture is a location.

## 1. Starting point and lessons learned

| Directory      | What it was | What was taken over |
|----------------|-------------|---------------------|
| `inventory`    | Heimlager 1.8.1: storage areas, transactions with undo, QR scan, shopping list, expiry, containers, photos, backups, import/export, AI assistant, MCP server, QR signs for 3D printing, simple house editor (floors, room polygons, box-shaped fixtures). Vanilla JS, `node:sqlite`. | The complete backend (accounts, storage areas, transactions, assistant, MCP, backups) as a module; its UI was fully ported into the app (removed in 0.5.0). The house model (floors, rooms, roof) went into the new model. |
| `inventory-3d` | Git worktree on `feature/3d-raum`, already merged in 1.8.x. | Lesson: there has to be **one** spatial model for everything (the "one room per storage area" approach was abandoned there). |
| `küchenplaner` | Küchenplaner 1.0.0: wall editor with snapping, procedural cabinet models, PBR material library, path tracing, walk-through, email accounts, showroom links. TypeScript + Vite + Express. | The entire planning engine (editor, 3D, models, materials) – generalized from a room to the house. |

Key lesson: both projects describe furniture the same way – center (x, y), y pointing down, clockwise rotation, front
facing local +y. Only the units differed (cm/radians vs. mm/degrees). This let the kitchen planner's detailed engine
replace the inventory's house model without losing data (no house had been created in the inventory yet).

## 2. Target picture

```
 House plan (one shared document)                          Inventory (database)
 ─────────────────────────────────────                     ─────────────────────────────────
 House ── Floors ── walls, windows, doors                   Storage area = room         (code KU)
              │ └── rooms (detected from walls) ────────►   Column       = furniture    (letter B)
              └──── furniture ── compartments (from front) ► Location/row = compartment  (KU-B2)
                                                            Items are stored in locations
```

- **One server** (`server/index.ts`, Express, TypeScript without a build), **one database** (`data/zuhause.db`),
  **one account** (the inventory's people; sign-in with a tile or email, one session for everything).
- **One app** at `/` (TypeScript/Vite, files under `/app/`): house planner, 3D, inventory in the plan, administration.
- **One model code base** for server and app: `web/app/src/model/` (plain TypeScript, runs in the browser and via
  type stripping on the server).

## 3. Data model

All plan dimensions in **cm**, 3D in meters. Stored as one JSON document in the `house` table (with a version).

```ts
House  { version: 2, name, floors: Floor[], slots, customMaterials, uv, settings }   // materials/light house-wide
Floor  { id, name, kind: basement|floor|attic|outdoor, elevation, height,
         walls, openings, items, rooms: Room[], code?, underlay?, roof? }
Room   { id, name, code /* storage area code */, seed /* click point */, polygon? /* detected */, floorMaterial? }
Item   { …kitchen planner fields…, levels? /* shelves/drawers */, label? /* custom name */, storageCol? /* column */ }
```

**Floor = plan.** The kitchen planner's editor, 3D scene and models work unchanged with a "plan" (`Project`).
`floorView(house, floor)` returns the active floor in that shape: walls, openings, furniture and template belong to the
floor; name, materials and settings belong to the house – reads and writes pass straight through. This kept the mature
engine intact and put the house on top of it.

**Rooms** (`model/rooms.ts`): the wall axes form a planar graph (T-junctions and crossings are split); every closed
area is a potential room. A room only remembers one point and gets the smallest area containing it – move the walls
and the room follows.

**Compartments** (`model/storage.ts`): derived per furniture type from the same front layout as the 3D models – drawers
by the height ratios of the pull-outs, shelves behind doors, fridge and freezer compartments, open shelves, surfaces.
"Drawer 2" in the inventory is the second drawer in the picture.

**Object library** (`model/objects.ts`): furniture types as data in the `zuhause-objekt/1` format – either a **carcass**
(plinth, panel thickness, columns with elements: drawer, door with shelves, open, flap, fridge/freezer compartment) or a
**3D model** with compartments as regions (0…1 per axis). The same description produces the 3D furniture
(`buildKorpus`), the compartments (`objectCompartments`) and the catalog icon. Optionally a carcass carries a worktop
(`build.countertop`, not a compartment; `korpusLayout` computes the carcass below it); with `join` the piece is part of
a worktop run (`countertopRuns`) – each piece draws its own worktop, the run only makes the texture continuous.
Furniture carries `type: "obj:<id>"`. The library lives on the server (table `object_types`, source own/imported/community);
the **house keeps a copy** of every furniture type it uses (`House.objectTypes`) so that library changes do not shift
any codes – new versions only on request. Community catalog: separate repo
[`homemgmt-object-library`](https://github.com/mupf-dev/homemgmt-object-library) (own license, contributions via pull
request, automatic validation); a GitHub Action generates `index.json` (`zuhause-katalog/1`), preview images and a
gallery on GitHub Pages, read via `OBJECT_CATALOG_URL` without a key. The catalog validates with a copy of
`model/objects.ts` – keep it in sync when the format changes. The built-in furniture stays in code (existing codes
remain stable); the editor's templates recreate them as carcasses.

**Normalization** (`model/house.ts`, `normalizeHouse`): detects rooms, assigns unique storage area codes (codes of
other storage areas are reserved) and column letters per room. Furniture that stays in its room keeps its letter with
priority – codes only change when a piece of furniture really moves. Runs in the app on every change (display) and on
the server when saving (binding).

## 4. Syncing house plan ↔ inventory

`PUT /api/house` (admins only, with `base_version` to prevent concurrent overwrites) normalizes the plan and syncs the
inventory in **one transaction** (`server/haus/index.ts`, `syncStorage`):

| In the plan | In the inventory |
|-------------|------------------|
| Room (or floor, for furniture outside rooms) | Storage area with code and name (`warehouses.plan_key`) |
| Compartment of a piece of furniture | Location `column = furniture letter`, `row = compartment no.`, name "Furniture · Compartment", category = room (`places.plan_item`, `plan_slot`) |
| Furniture moves to another room / gets another column | Locations **and items** move along (via temporary locations, so swapped columns do not block each other) |
| Furniture or compartment removed | An empty location is deleted, a location with contents stays ("no longer in the plan") |
| Room removed | An empty storage area is deleted, otherwise it is detached from the plan |
| Target location created by hand and occupied | Saving is rejected with a clear message (409) |

Because plan locations are ordinary locations, search, scan, QR labels, shopping list, MCP tools and the assistant
work with them right away ("put the batteries in the cutlery drawer" finds the location by name).
`GET /api/house/storage` gives the app the contents of all compartments.

## 5. The app

**Shell (0.6.0):** one navigation for all pages (`shell.ts`: Overview, House, Search, Shopping, More; phone: bar at the
bottom with Scan). The house has two modes: **View** (normal case; `Plan2D.viewOnly`, compartments and contents in the
sidebar or as a bottom sheet) and **Plan** (toolbar, collapsible left sidebar; only with `persons.can_plan`, admins
always). Settings per person (`persons.prefs`, `prefs.ts`): home page, 2D/3D, light/dark, font size. One icon set
(`icons.ts`) instead of emoji. Transactions made without a connection are queued by `lager/outbox.ts` (the server
detects repeats by `request_id`). **Wall terminals** (`terminals`, `terminal.ts`): device cookie via a setup link,
booking only with a selected person, portrait/landscape, idle mode with light by time of day and weather
(`/api/weather`: location via OpenStreetMap, weather via Open-Meteo, both without a key).

| Area | Function |
|------|----------|
| Floors | Tabs in the header, add a floor (above, basement, attic, outdoors; copy exterior walls), name/type/elevation/room height; the floor below appears dashed in the 2D plan |
| Rooms | "Define room" tool (preview of the detected area), name → code, area in m², custom flooring, list of furniture with codes |
| Furniture | Kitchen catalog plus shelf unit, heavy-duty shelving, pantry cabinet, wardrobe, sideboard, chest of drawers, workbench; number of shelves/drawers; custom name; column letter on the furniture in the plan |
| 3D | Floor / up to here / whole house (stacked, with floor slabs), furniture library (Poly Haven CC0 via its API, FurniMesh via its public library pages – the GLB is shrunk and scaled on the server, `server/kueche/furnimesh.ts`), path tracing, walk-through with collision and changing floors via stairs (`walker.ts`), showroom as before |
| Inventory in the plan | "Inventory" colors all compartments by fill level (empty, occupied, expiring, expired); click a compartment → contents, check in, take out, move an existing item, open in the inventory |
| Search | "Where is …?" searches the whole inventory, lights up matches in the house, jumps to floor, furniture and compartment |
| Saving | Automatically on the server ("Plan house" permission), conflict dialog for concurrent edits, draft additionally in the browser; users see the plan and book, but don't change it |
| Import | First creation from the browser draft; import saved kitchen plans "as a floor"; file import of house and plan files |

## 6. Deliberate interim states

- **Old inventory UI removed (0.5.0).** Everything runs in the app; `/alt/` redirects to `/`, `/sw.js` unregisters the
  former service worker. The server API of the old house model (`/api/site`, tables `floors`/`fixtures`) still exists
  for importing (`import-prod`) and can be dropped later.
- **Inventory backend as `.cjs`** (in substance Heimlager 1.8.1 plus account extensions). Typing will follow.
- **Roof** is drawn as a gable roof with knee wall in the house view; sloped ceilings don't constrain furniture yet.
- **House from the inventory model** (`model/fromSite.ts`): walls are derived from room boundaries – rooms that touch
  without a gap count as openly connected (no wall). Such rooms have a **fixed outline** (`Room.manual`).
- **Code changes** rename all locations of a room – printed labels no longer match then (the app shows a notice).
- Saved kitchen plans (`kitchen_projects`) remain available as an import source.

## 7. Roadmap

1. ~~Furniture and furnishing library, refine the house view~~ (0.5.0: Poly Haven + FurniMesh, walk-through with stairs).
   Open: walk-through by touch, head collision under sloped ceilings.
2. **Items visible in the compartment** (boxes/photos as in the old 3D view), containers as objects in the compartment.
3. **Complete the house:** attic with gable roof, stairs between floors, outdoor area (carport, terrace), floor plan
   template per floor aligned with the floor below.
4. **Inventory backend to TypeScript** in modules (account, storage areas, transactions, assistant, backups), Express
   routers instead of a custom router; one three.js for everything.
5. **Variants:** plan drafts next to the current house (e.g. "new kitchen 2027"), showroom link for the house.

## 8. Migration

1. Stop Heimlager and Küchenplaner, then run once
   `npm run migrate -- --lager ../inventory/data/lager.db --kueche ../küchenplaner/data/kuechenplaner.db`.
2. `npm run build && npm start` (or `npm run dev`), open `/` as admin → "Create house plan".
3. Use "Import saved plans" in the account menu to bring in the ground floor plan as a floor, name the rooms with
   "Define room" – from then on all cabinets are in the inventory.
