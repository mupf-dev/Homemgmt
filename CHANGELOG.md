# Changelog

## Unreleased

**New name: homemgmt-ng** – the app, website and manual are now called homemgmt-ng (formerly "Zuhause"). Technical
names (container, database file, folders) stay the same; an update needs no changes.

**Reach the assistant faster**: "Assistant" as a home page option in the settings (the installed app now starts with
`/` so the chosen home page applies there too) and an "Assistant" shortcut on the app icon (Android).
**Speak to the wall terminal**: new "Speak" button in the bar – first "Who is booking?", then it listens; the answer
is read aloud. On the terminal the assistant may only read, book, maintain the shopping list and search for prices
(never admin tools, no editing or deleting); the conversation is cleared in idle mode.

**Wall terminal**: shopping list entries can be deleted again (the server didn't read the selected person on
`DELETE`). Tasks can now also be created, changed and deleted on the terminal – with "Who is booking?".

**Price research without OpenRouter**: with a gateway like LiteLLM, price research uses its search tool
(Administration → Assistant → "Search tool in gateway", e.g. `foundry-web`, or `AI_SEARCH_TOOL`). A small agent
researches each product: at most 3 web searches via `POST {address}/search/{search tool}` and 3 pages that the server
fetches itself (public addresses only). There a price only counts as "confirmed" if it appears on a page that was read.
Also: comparison and flyer portals (idealo, kaufDA …) no longer count as retailers, notes are trimmed at the end of a
sentence.

**Tasks** (More → Tasks, card on the overview): one-off or **recurring** (daily, weekly, every 3 months, yearly or a
custom interval – on a fixed schedule or from completion), assigned to a **person** and optionally attached to a
**compartment** ("replace cooker hood filter" → show in house). Tick off with "Undo"; last completed with who and when.
On the **wall terminal** in the navigation, tick off with "Who is booking?"; idle mode shows what is due today.

**Worktop for furniture types** (object library): carcass furniture types can carry a worktop on top – e.g. a washing
machine under a worktop, a utility room run, a cooking island. Thickness, front overhang and material can be set in the
editor; with "connect to kitchen run" it becomes part of the kitchen run, and the grain continues across adjacent base
cabinets. The worktop is not a compartment, the height stays the total height. The format stays `zuhause-objekt/1`
(new optional field `build.countertop`); existing furniture types and their location codes stay unchanged.

**Washing machine and dryer as elements** (`washer`, `dryer`): realistic appliance front instead of a cabinet front –
control panel with detergent drawer, display and rotary knob, porthole with door ring and drum, service flap, ventilation
grille on the dryer; in appliance colors, independent of fronts and handleless. Under a worktop, on a pedestal or as a
stack. Each appliance yields two locations: detergent drawer or condensate container, and the drum.

**Appliance color** (material area `appliance`): washing machine and dryer can be colored – in the furniture type
(editor: "Appliance color") and per piece of furniture in the house plan. On dark and metallic fronts the control panel
becomes black glass and the door ring chrome. Without a setting the front stays white as before. The editor preview now
reflects an environment, so metal and chrome look real there.

**Community furniture in the planner:** the online library under "Furniture" has the furniture types from the
community catalog as its first source – alongside Poly Haven and FurniMesh, with search, groups, preview image,
dimensions and number of compartments. Selecting one installs the furniture type (or updates it to the new version)
and starts placing it right away.

## 0.7.0 – 2026-10-04

**Object library** (More → Object library): furniture types like kitchen cabinets and storage shelves as data instead of
code. **Editor** with 3D preview: dimensions, plinth, panel thickness, columns with drawers, doors with shelves, open
compartments, flaps, fridge and freezer compartments – or your own 3D model (.glb) with defined compartments. The
preview shows each compartment as a frame; **every compartment becomes a location**. Templates (shelf unit, pantry
cabinet, chest of drawers, base cabinet, wardrobe, wall cabinet) as a starting point.

**Community catalog** in its own repo [homemgmt-object-library](https://github.com/mupf-dev/homemgmt-object-library)
with a gallery on GitHub Pages: install and update furniture types, export your own (`.zuhause-objekt.json`) and
contribute them via pull request – validated automatically, without a server and without a key. Starting with cube
shelf 4×4, shoe cabinet, pull-out pantry, tool trolley and bathroom wall cabinet.

Installed furniture types are listed under "Furniture" when planning. The house keeps a **copy** of every furniture type
it uses – changes in the library don't shift any codes; newer versions are applied on the furniture ("Apply version …",
with a warning if the number of compartments changed). Anyone with the "Plan house" permission may edit and install.

## 0.6.0 – 2026-10-04

**One app for the whole household:** the same navigation on every page – Overview, House, Search, Shopping, More. On
the phone it sits at the bottom, with **Scan** in the middle. New **Overview** as the home page: quick actions,
shopping list to tick off, what expires soon, fill level per floor, recently moved. **More** and **Settings** pages.

**House: View and Plan separated.** View is the normal mode: no tools, no dimensions; tapping a piece of furniture shows
its compartments, a compartment its contents – in the sidebar (the plan stays visible) or on the phone as a bottom
sheet. Furniture in the floor plan colored by fill level, search matches light up in the floor plan too, floors with
matches get a dot. **Plan** via a button (PC only): tools in a toolbar, "Furniture", "Materials" and "Floor" as a
collapsible sidebar, rarely used items in the ⋯ menu, "Delete floor" no longer at the very top, hints only for the
active tool.

**"Plan house" permission per person** (Administration → People); admins always may. The server also rejects changes
to the house plan without the permission.

**Settings per person:** home page (Overview or House), house in 2D or 3D first, light/dark, font size.

**Poor Wi-Fi:** check-ins and take-outs without a connection are queued and synced automatically ("n transactions
waiting"); the server detects repeats and doesn't book twice. Scanning compartments and items works without a network
too.

**Wall terminals** (Administration → Wall terminals): a tablet on the wall without personal sign-in, set up via link or
QR code. Navigation on the left edge, large touch targets, **portrait or landscape** per device. Check in and take out
with **"Who is booking?"** tiles. When not in use, back to the house and **idle mode**: the house dimmed and
photorealistic, light by time of day and local weather (postal code; OpenStreetMap + Open-Meteo, without a key), clock,
shopping list, expiring items.

**House location** (Plan → ⋯): search for an address or postal code or enter coordinates, north direction via compass;
the floor plan shows a north arrow. On the wall terminal the **sun is where it is outside** (sun position from location
and time), **sky and light follow live** (day, clouds, rain, dusk, night with lamps and moonlight, updated every
minute), the weather is shown in the header, and the house is surrounded by **lawn**. In view mode the floor selection
switches from "House" to "Up to here", the selected furniture stays visible, everything else becomes transparent
(without a frame on the terminal).

**Weather on the wall terminal:** clouds in the sky (cover, color by time of day, drifting with the wind – in the
photorealistic image too, since the sky lights the scene), rain, drizzle and snow as a subtle animation over the image
– intensity by real rain rate (mm/h) or snowfall, precipitation in the header –, fog and haze, wet lawn (graded by rain
intensity). **Snow** as a growing patch on and in front of the terrace and on the roof surfaces: with a dusting about
the size of the terrace, from ~10 cm the whole garden; the house itself stays clear. Lawn and snow leave out the house
footprint (no lawn in the stairwell). **Thunderstorms with real-time lightning** (Blitzortung.org, the data behind
lightningmaps.org – without an account, for private use): every strike nearby arrives instantly via server-sent
events; close strikes (≤ 30 km) make the screen flash. Warning in the header from 20 km, in idle mode a notice with the
last strike (distance, direction, age), count and a lightning map (10/25/50 km, dots by age) – only while there is
lightning within 50 km. **Test weather** to try it out: `?testwetter=schnee` (also `schnee-hauch`, `schnee-leicht`,
`schneesturm`, `niesel`, `regen`, `wolkenbruch`, `gewitter`, `nebel`, `wolkig`, `klar`).
**More economical idle mode:** level of detail per terminal (draft/normal/high), lower render resolution, minimum
quality for the photorealistic image (otherwise a clean 3D image), re-rendered only when sun/weather change, paused when
the screen is hidden, last image remembered, progress indicator, flat viewing angle.

**View mode refined:** sidebar with a "House" level (all floors with fill level) above floor → room → furniture →
compartment; the app starts on the ground floor instead of the basement.

**Small things:** one icon set instead of emoji, dates as DD.MM.YYYY with quick picks (1 week … 1 year), suggestions
from existing items when checking into a compartment, colors for dark mode, buttons instead of blue links, guide
updated.

**Internal:** `shell.ts`, `prefs.ts`, `icons.ts`, `terminal.ts`, `lager/home.ts`, `lager/outbox.ts`; columns
`persons.can_plan`, `persons.prefs`, table `terminals`; `GET /api/movements/recent`, `PATCH /api/auth/me/prefs`,
`/api/terminals…`, `/api/weather` (coordinates or postal code), `/api/geocode`, `/api/lightning`, `/api/lightning/stream` (SSE);
`sun.ts` (sun position), `weatherfx.ts` (rain, snow, haze, lightning), `server/lager/lightning.cjs`. Tests:
`test/lightning.test.cjs`. `LIGHTNING=0` turns off the lightning connection (tests). Tests: `test/prefs.test.cjs`,
`test/terminal.test.cjs`, click-through test extended (view/plan, settings, permissions, phone, offline, terminal).

## 0.5.0 – 2026-10-03

**Walk-through like in a game:** walk through the whole house – walls and furniture block you, doors and passages are
open, thresholds up to ~30 cm are stepped over, **stairs lead up and down to the other floors**. Floor and room are
displayed, the floor plan and the floor tabs follow along; when you exit, the previous view returns
(`web/app/src/walker.ts`).

**Furniture and furnishing library:** search 3D models (glTF, CC0) from Poly Haven and filter by category (seating,
tables, beds, cabinets, lights, plants, decor …), place them in the house with one click, scaled to size; upload your
own `.glb` files (`/api/library/models…`). The **"No filter"** switch shows all 521 models (otherwise 242 furnishing
models), new categories tools, garden & nature, other; search also works with German terms (Stuhl, Lampe …).
Second source **FurniMesh** (no account/API key): thousands of realistic, AI-generated pieces of furniture (sofas,
seating, tables, beds, cabinets, lights, bathroom) from the public library pages; when adopted, the GLB is loaded once,
shrunk from ~20 MB to ~2–3 MB (textures 1024 px JPEG, geometry simplified; `@gltf-transform`, `sharp`,
`meshoptimizer`) and scaled to typical dimensions for its category. No explicit license – source and link are shown on
the model.

**House view:** no more gaps between floors, stairs end exactly at the floor above and cut a stairwell into the ceiling
(hole size = footprint of the stairs), attic walls stay under the roof.

**Planner:** furniture can be a **passage** (front without carcass, opening in the wall behind it, no compartments) – so
the tall cabinet in the kitchen is now the passage under the stairs. Stairs keep their rotation when snapped via drag &
drop and only move flush to the wall.

**Lock objects (2D editor):** fix walls, windows/doors, furniture and rooms with "Lock" or the `L` key – they can no
longer be selected, moved or deleted (not via a 3D click or the room list either), corners on locked walls stay fixed,
doors/windows can't be placed into locked walls. Lock icon in the floor plan; under "Floor" → "Locked" unlock
individually/all and "Lock all walls". Can be undone, saved with the house.

**Inventory:** fill containers while scanning and put items into containers, price research in the shopping list,
guide in the app (`?`). The old UI (`/alt/`) has been removed. `npm run import-prod-items` imports the production items
including their compartment assignments into the house plan (read-only, with backup).

## 0.4.0 – 2026-10-03

**The app is the home page** (`/`); the previous inventory UI lives under `/alt/`, `/app/` and `/kueche/` redirect,
QR labels open the app. The former service worker unregisters itself. Own app manifest (installable, shortcuts Scan,
Check in, Search, Shopping list, House).

**Remaining inventory features in the app**
- Sign-in with **tile + password/PIN** and **initial setup** directly in the app (plus email)
- **Assistant:** text, voice, photo (QR labels are recognized), confirmation from 4 transactions, undo per transaction,
  read aloud, context from item/compartment; mentioned locations with "Show in house"
- Assistant/MCP find **compartments by name**: "kitchen fridge top", "pantry shelf level 2" (word by word across
  compartment, furniture, room and storage area); the model's instructions know the house plan scheme
- **Insights** (key figures, most used, who books, not touched for a long time, out of stock) and a **heatmap in the
  house**: fill level, activity (90 days), long untouched (`GET /api/house/stats`)
- **Labels & QR signs:** compartments by floor/room/furniture (also directly from the planner), items, blank labels;
  print or 3D signs as 3MF distributed across build plates
- **Administration:** people (roles, passwords, archive, merge, email approvals, registration), storage areas
  (house plan storage areas view only), API keys, backups (create, download, restore, upload), assistant settings,
  export/import (Excel/CSV with preview)

**Tests:** compartment name search via MCP; click-through test extended with tile sign-in, assistant (simulated model),
insights/heatmap, labels/3MF download and administration

## 0.3.0 – 2026-10-03

**Inventory in the app** (`/app/#/lager`, also on the phone – small screens start there directly)
- Start with a notice about expiring items, search, item (take photo, history, undo, take out, check in, move, edit,
  delete, add to shopping list), check in, take out, location, shopping list (tick off, quantity, bought + check
  in/store, share), expiry, scanning with the camera (compartment + item = check in, item 2× = take out, unknown label =
  create new)
- Places are described and chosen everywhere via the house plan ("Storeroom · Open shelf unit · Shelf 3"; compartment
  picker: floor → room → furniture → compartment with occupancy, alternatively a location code like H-B12)
- "Show in house" from search, item, location and expiry: the planner jumps to the floor, lights up the compartments
  and moves to the furniture; transactions with "Undo" in the notification
- QR labels (`/q/…`) open the app
- Assistant, insights, labels and administration open the previous inventory UI for now

**Import the house from the previous inventory**
- `model/fromSite.ts`: floors, rooms, openings and fixtures from "Set up house" → house plan; walls are derived from
  the room boundaries (opposite edges 4–65 cm apart), openly connected rooms stay without a wall
- `npm run import-prod`: combine the inventory house (GET /api/site) + kitchen plan (export file) into one house plan
  and save it with inventory sync (backup first); missing library textures are downloaded
- Rooms with a fixed outline (open floor plans, outdoor areas) alongside rooms detected from walls
- 3D: stairs, passage (opening without door leaf), gable roof with knee wall and gables (house view), outdoor areas
  (terrace, parking space, carport with roof)

**Internal**
- Saving the house plan as a reusable function (`saveHouse`) for API and import
- Tests: import from the inventory model (`test/fromsite.test.cjs`), click-through test extended with inventory pages

## 0.2.0 – 2026-10-03

**Full integration: the kitchen planner becomes the house planner, the inventory lives in the plan**
- House model with floors (basement, floor, attic, outdoors), elevation and room height; materials and light house-wide
- Floor tabs, add a floor (optionally with the exterior walls of the current floor), floor below as a tracing layer in the plan
- Detect rooms from walls ("Define room"): smallest closed area around the click point, follows when walls are moved;
  name, storage area code, area, custom flooring
- Compartments per piece of furniture from the front layout of the 3D models (drawers, shelves, fridge/freezer
  compartments, open shelves)
- New furniture: open shelf unit, heavy-duty shelving, pantry cabinet, wardrobe, sideboard, chest of drawers, workbench
  (shelves or drawers adjustable), custom name per piece of furniture
- 3D: floor / up to here / whole house with floor slabs; the camera fits the house into view
- **Inventory in the plan:** room = storage area, furniture = column, compartment = location (e.g. `KU-B2` = kitchen,
  furniture B, compartment 2); compartments colored by fill level, click a compartment → contents, check in, take out,
  move; "Where is …?" lights up matches in the house
- Server: house plan as a shared document (`GET/PUT /api/house`, version against overwriting), sync with the inventory
  in one transaction – locations and items move along, compartments with contents are kept; `GET /api/house/storage`
- App under `/app/` (former addresses `/kueche/` and `/textures/` are redirected), automatic saving, conflict dialog,
  import saved kitchen plans as a floor
- Inventory app: "Plan house" leads to the app
- Removed: "Kitchen into house" import from 0.1.0 (replaced by the house plan)
- Tests: house plan ↔ inventory sync (`test/haus.test.cjs`), click-through test in the browser (`npm run test:e2e`)

## 0.1.0 – 2026-10-03

First version of **Zuhause**: Heimlager 1.8.1 (incl. house in 3D from `inventory-3d`) and Küchenplaner 1.0.0 in one
application. Earlier versions: [docs/CHANGELOG-INVENTORY.md](docs/CHANGELOG-INVENTORY.md), [docs/CHANGELOG-KITCHEN.md](docs/CHANGELOG-KITCHEN.md).

**One server, one database**
- Express server (`server/index.ts`, TypeScript without a build): inventory under `/`, kitchen planner under `/kueche/`,
  MCP on its own port
- Shared database `zuhause.db`; kitchen plans in `kitchen_projects` – so they are in every backup too
- `npm run dev` starts everything in one process (Vite as middleware with HMR)

**One account**
- The inventory's people are the accounts; new: optional email and status (awaiting approval)
- Sign-in with a tile or email, one session for both UIs; `GET /api/auth/me`, `POST /api/auth/register`
- Registration off by default; approval requirement, roles and locking in the kitchen planner's user management
- Merging people takes kitchen plans along

**Kitchen into house**
- Kitchen planner → My plans → "Into house": cabinets become fixtures on a floor (aligned to a room, movable,
  rotatable); importing again replaces them and keeps the compartment assignments
- `POST /api/projects/:id/house`; fixtures remember their origin (`fixtures.source`)

**User interfaces**
- Inventory: "Kitchen planner" tile; kitchen planner: ⌂ link back, textures under `/kueche/textures/` (old paths are
  redirected)

**Importing existing data**
- `npm run migrate`: inventory database as the base, kitchen accounts become people (same email/same name), plans,
  settings and imported textures

**Operation**
- One Dockerfile (build stage for the kitchen planner), one Compose service `zuhause`
