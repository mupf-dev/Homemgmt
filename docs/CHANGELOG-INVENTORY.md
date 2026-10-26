# Changelog Heimlager (up to 1.8.1, before the merge)

## 1.8.1 – 2026-10-01

**Export and import the house**
- House editor: "Export" downloads the current state as a JSON file (floors, rooms, openings, roof, background
  position, fixtures, compartments with storage area code instead of ID – works on any server; not the images themselves)
- "Import" replaces the state in the editor after confirmation; compartments without a matching location are left out
  (with a notice), floors with the same name keep their ID and background image; nothing is stored until "Save"

## 1.8.0 – 2026-10-01

**House in 3D**
- Administration → **"Set up house"**: floor plan editor for the whole house including the outdoor area (best on a PC):
  floors (floor, attic, outdoors) with elevation, room height and ceiling thickness; outer outline and rooms as
  polygons (drag a rectangle, drag and insert corners, snap to other corners, edge lengths in cm); walls result
  automatically from "outline minus rooms", touching rooms are openly connected
- Doors, passages and windows snap to the nearest wall; attic with gable roof (pitch, knee wall, ridge), warning for
  furniture under the slope; outdoors: carport, terrace, parking space
- Background image per floor (PNG/JPEG/WebP) with scale via two points, move, rotate, opacity
- Fixtures: shelf unit, cabinet, wall cabinet (distance from the floor), fridge, floor space, stairs; compartments
  with locations from all storage areas (click or drag, "whole column per shelf")
- Draft in the browser against data loss, prompt when leaving, protection against concurrent editing
- Storage plan: the **3D** tab shows the whole house (three.js r186 and polygon-clipping, loaded only when opened):
  house view with exploded floors or a single floor, walls cut away or full height with roof, real door and window
  openings, compartments by fill level, info card, search switches to the floor and moves there
- Location view: "Show in house"
- 3D in more places: small "it's here" view for items and locations (tap = large); search "Show matches in house";
  expiry and shopping list ("Where is the rest?") show the affected compartments; "🏠 Choose in house" in all location
  fields (check in, put back, move); the assistant shows the spot for answers with locations (`places` in the
  response, also for plain questions); home page with a "House" tile including a preview image; insights "In the
  house" as a heatmap (fill level, transactions 90 days, not touched for a long time; `GET /api/site/stats`)
- Small views load only when they scroll into view; all 3D views are torn down when changing pages
- Items as boxes in the compartments (close up; from a distance still colored blocks as before): size by quantity,
  color by type (consumable yellow, container blue with lid, expired red, expiring soon orange), photo on the front of
  the box, used up pale, "+N" from 8 items; hovering shows the item, tapping opens a card with "Open item";
  search makes the found boxes glow
- API: `GET/PUT /api/site`, `GET /api/site/places`, `GET/PUT/DELETE /api/floors/:id/image`; `/api/places/:col/:row`
  returns `in_room`, `/api/warehouses` `in_house`
- New tables `floors`, `floor_images`, `fixtures`, `fixture_slots`

## 1.7.0 – 2026-09-30

**QR signs in batches (Administration → QR signs)**
- New page `#/print3d` (admins only): collect codes in several passes into a **collection list** – location ranges
  from any storage areas, all locations of a storage area, items by filter, blank item codes; duplicates are skipped,
  individual entries removed with ✕. The list stays saved in the browser until it is cleared
- Signs are distributed across build plates (P1S/X1/A1 256 × 256 mm, A1 mini 180 × 180 mm or custom dimensions,
  adjustable spacing), row by row from the back left and centered per plate; preview of all plates
- Text per sign: locations with code, name or both, items with code or name
- Downloads: 3MF with colors per plate (each sign one object of base plate and QR code, as a ZIP for several plates),
  STL per plate (one color change for the whole plate) or each sign as a separate STL
- Size, eyelet and colors are shared between single and batch printing
- `qr3d.js`: `arrange`, `threeMFMulti`, `footprint`, `Mesh.moved`; ZIP/3MF optionally with deflate (`CompressionStream`)

## 1.6.1 – 2026-09-30

**QR code as a 3D model**
- 3MF: colors are now written as `<m:colorgroup>` (3MF materials extension) instead of `<basematerials>` – this way
  Bambu Studio and Orca Slicer automatically assign base plate and QR code to two filaments on load

## 1.6.0 – 2026-09-29

**Check prices (shopping list)**
- "💶 Check prices" searches the internet for where the entries are currently cheapest: per entry the cheapest offer
  (retailer, nearby store, price, package, unit price, deposit, source link), more offers expandable, plus a shopping
  trip per retailer
- Web search via OpenRouter (`plugins: [{ id: 'web' }]`), one call per product, in the background (3 in parallel);
  results stored for 24 hours (table `price_checks`)
- Offers without a price or source are discarded; sources that don't come from the search results count as "unconfirmed"
- Assistant: new tool `preise_recherchieren` (shopping list or individual products)
- Administration → Assistant: switches "Price research active" and "Place of residence for price research";
  only available with OpenRouter (`AI_WEB_SEARCH=1` forces it)

**Guide**
- Administration → Guide: 20 chapters on usage (incl. admin chapters) with table of contents, search and links

**Internal**
- A test checks that the Dockerfile copies all server modules

## 1.5.0 – 2026-09-29

**Storage plan**
- New default view "Shelves": one shelf unit per column, compartments with name, quantity, fill bar and thumbnails;
  a shared category appears once in the shelf header
- The grid can still be selected – now with names in the cells and color by fill level
- Search by location or item (also inside containers) highlights matches, "occupied only" hides empty locations
- The view is remembered per storage area; search, filter and scroll position are kept when coming back
- "Recent transactions" collapsed; `/api/overview` additionally returns the items per location

**Navigation**
- "Back" leads to where you came from (e.g. "← Storage plan"), also after deleting a location or item;
  without a predecessor (opened via QR code) the previous target remains

**Assistant and MCP**
- New tool `lagerplatz_loeschen` (empty locations only, by code or name)

**Bug fixes**
- "Delete location" was always disabled, even for empty locations
- Shopping list: "Bought + check in" now applies the given best-before date

## 1.4.0 – 2026-09-28

- Assistant and MCP also understand locations by name: "into the fridge", "food drawer", "kitchen fridge"
  (filler words are ignored, exact names take precedence, with several matches it asks back)
- New tool `lagerplaetze_suchen` (by name, category, description)
- The assistant receives the named locations right away; error messages about unknown locations list them too

## 1.3.0 – 2026-09-28

**Assistant and MCP: better instructions for the model**
- Instructions with typical workflows (shopping list, creating new items, consumption) and the rule never to ask for
  IDs but to look them up itself or evaluate error messages
- Tool results can contain a `hinweis` (hint) for the next step (e.g. after ticking off, ask whether to store the item)
- `einkaufsliste_abhaken`: by name (also partial word, without ID), clear message for several/no matches;
  with `platz` or `behaelter` stores it right away – free entries are created as new consumables

**App**
- Shopping list: "Bought + store" for free entries (creates the item and ticks off the entry)
- Undoing such a creation reopens the entry

## 1.2.0 – 2026-09-28

- Assistant: "Forget that" / "New conversation" clears the conversation history (new tool `gespraech_neu_beginnen`)
- After a 30-minute pause a new conversation starts automatically; a divider shows from where the history is sent again
- The history sent along is additionally limited to about 8000 characters (newest messages first)

## 1.1.0 – 2026-09-28

**AI assistant in the app**
- Requests by text, voice (the browser's speech recognition) or photo; answers read aloud on request
- Any OpenAI-compatible API (default OpenRouter), set up under Administration → Assistant;
  the key stays on the server (or `AI_API_KEY`), connection test and usage for the last 30 days
- The same tools as the MCP server; transactions immediately with "undo", confirmation from 4 transactions at once
- Photos with QR recognition in the app; on request the photo becomes the item's picture
- From the detail and location views with context ("this", "here")

**More**
- New tools (MCP and assistant): `mehrere_einbuchen`, `objekt_bearbeiten`, `lagerplatz_benennen`, `code_aufloesen`;
  `einbuchen` accepts pre-printed label codes
- Transactions remember their origin; the history shows "via assistant" or "via MCP"
- Consistent style for password, URL and date fields

## 1.0.0 – 2026-09-28

First release of Heimlager, the home inventory system.

**Storage areas and transactions**
- Multiple storage areas with codes, locations made of column and row (e.g. `K-B12` = storage area K, column B, row 12)
  with name, category and storage plan
- Check in, take out and move; every transaction records person, quantity, location and time
- Undo for the most recent transaction of an item
- Containers (bag, box, crate): items are stored inside, nested too, and move along when moved
- Best-before date with a notice in the menu, an "Expiry" view and key figures in the insights
- Consumables are added to the shopping list automatically when taken out

**Usage**
- Web app for the phone, installable as an app; camera scan of QR codes (location + item, fill containers)
- Photos of items, label printing, 3D-printable labels
- Search, insights, export/import as Excel or CSV

**Operation**
- Sign-in with password, user/admin roles, password reset via the command line
- Automatic backups, restore in the app
- Docker image, operation behind a reverse proxy (`TRUST_PROXY`)
- MCP server for AI assistants with API keys (read only or book), optionally the key in the URL
- No external dependencies, Node.js 22.13 or later
