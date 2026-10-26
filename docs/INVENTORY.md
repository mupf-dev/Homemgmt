> **Note:** Manual from the standalone Heimlager (as of 1.8.1). Usage and API apply unchanged to the inventory module
> of homemgmt-ng; startup, ports, paths and Docker are now described in the [README](../README.md).

# Heimlager

A small home inventory system as a web application. Runs without external dependencies and only needs
**Node.js 22.13 or later** (uses the built-in SQLite database).

## Getting started

```bash
npm start
# or: node server.js
```

Then open in the browser: <http://localhost:3000>
On the home network the app is reachable at the computer's IP, e.g. `http://192.168.1.20:3000`.

## Docker (server operation)

The project contains a `Dockerfile` and `docker-compose.yml`. The image is based on `node:22-alpine`,
runs as an unprivileged user and stores everything in the `/data` volume.

```bash
# on the server in the project folder
docker compose up -d --build
docker compose logs -f          # check startup
```

Web app: `http://<server>:3000`, MCP: `http://<server>:3100/mcp`. On the first start with an empty database the
initial setup (first admin) appears – so open it yourself right after starting.

**Bring existing data along** (stop the local server with Ctrl+C first so everything is written to `lager.db`):

```bash
docker compose create
docker compose cp ./lager.db heimlager:/data/lager.db
docker compose run --rm -u root --entrypoint chown heimlager -R node:node /data
docker compose up -d
```

**Without Git/build on the server:** build the image locally and transfer it:

```bash
docker build -t heimlager:latest .
docker save heimlager:latest | ssh user@server docker load
# on the server: copy docker-compose.yml over, then docker compose up -d
```

**Backup while running** (in addition to the automatic backups in `/data/backups`):

```bash
docker compose exec heimlager node --no-warnings -e "new (require('node:sqlite').DatabaseSync)('/data/lager.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp heimlager:/data/backup.db ./lager-backup-$(date +%F).db
docker compose exec heimlager rm /data/backup.db
```

**Update:** pull the new version, then `docker compose up -d --build`. The database is migrated automatically on startup.

### Development with Docker

`docker-compose.dev.yml` mounts the project folder and restarts the server automatically when `server.js`/`mcp.js`
change (`node --watch`); changes in `public/` show up after reloading the browser.
The database lives in `./data` (the same one as with `npm start` – don't run both at the same time),
HTTPS runs with the certificate from `./certs` on port 3443.

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml logs -f
docker compose -f docker-compose.dev.yml down
```

### Tests

```bash
npm test
```

Starts a separate server with a fresh database on free ports for each test file (your own data stays untouched) and
checks the REST API, sign-in and permissions, transactions and undo, shopping list, photos, insights, import,
backups, API keys, the MCP server, CSV and the password reset script.

### Behind a reverse proxy (recommended)

The web app needs HTTPS for the camera in the browser – easiest via a reverse proxy with TLS.
Then set `TRUST_PROXY: "1"` in `docker-compose.yml` (the session cookie becomes "Secure", the sign-in lockout uses the
real client IP) and only publish the ports locally (`127.0.0.1:3000:3000`). Caddy example:

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

For the MCP server also set `MCP_PUBLIC_URL: https://mcp.example.de`. The web app doesn't have to be public –
exposing only the MCP server is enough.

| Variable      | Default  | Meaning                                                          |
|---------------|----------|------------------------------------------------------------------|
| `TRUST_PROXY` | –        | `1` = evaluate the proxy's `X-Forwarded-Proto`/`X-Forwarded-For` (only set behind a proxy) |
| `TZ`          | `Europe/Berlin` (Docker) | Time zone for dates in the MCP server                  |

Health check: `GET /healthz` → `{"ok":true}`.

### HTTPS for the camera scan on the phone

Browsers only allow camera access over HTTPS (or on `localhost`). Create a self-signed certificate once and restart
the server:

```bash
npm run cert
npm start
```

Then open `https://<computer IP>:3443` on the phone and accept the certificate warning once. Without a certificate
everything works except the camera; codes can then be entered by hand or with a USB/Bluetooth handheld scanner.

**Note for WSL2:** the server listens inside the WSL VM. For phones to reach it, Windows has to forward the ports
(PowerShell as administrator, find the WSL IP with `hostname -I`):

```powershell
netsh interface portproxy add v4tov4 listenport=3443 listenaddress=0.0.0.0 connectport=3443 connectaddress=<WSL-IP>
netsh advfirewall firewall add rule name="Heimlager" dir=in action=allow protocol=TCP localport=3443
```

Alternatively enable `networkingMode=mirrored` in `.wslconfig`.

Options via environment variables:

| Variable     | Default           | Meaning                                |
|--------------|-------------------|----------------------------------------|
| `PORT`       | `3000`            | HTTP port                              |
| `HTTPS_PORT` | `3443`            | HTTPS port (only active with a certificate) |
| `DB_PATH`    | `./data/lager.db` | Location of the SQLite database        |
| `CERT_DIR`   | `./certs`         | Folder containing `key.pem` and `cert.pem` |

## Sign-in

The app can only be used after signing in. On the **first start** "Welcome to Heimlager" appears: tap an existing
person (or "New person") and enter a password twice – that person is then **admin**. After that you sign in by
tapping your tile and entering your password (a PIN of 4 or more characters works too). The sign-in is kept on the
device for 30 days.

- **Admins** assign passwords and roles (user/admin) under "Manage people" and manage storage areas and API keys.
  People without a password don't appear on the sign-in page.
- **My account** (menu or click on your own name at the top): change your own password, sign out.
- Transactions are always attributed to the signed-in person.

**Forgot your password?** An admin resets it under "Manage people". If the (only) admin has forgotten their
password, on the server:

```bash
npm run reset-password                          # list people
npm run reset-password -- anna                # generate and print a random new password
npm run reset-password -- anna neuesPW --admin   # set a given password, also grant admin rights
# in the Docker container:
docker compose exec heimlager node scripts/reset-password.js anna
```

## Photos

Items can get a photo – when creating them (optional) or in the detail view by tapping the photo field (camera or
gallery). The phone shrinks the image before uploading (about 1280 px, plus a square thumbnail); thumbnails appear in
all lists and in scan mode for confirmation. Photos are stored in the database and are therefore automatically
included in every backup.

## Install as an app

Heimlager is an installable web app (PWA): open it over HTTPS (port 3443 or a reverse proxy), then choose "Install
app" in the browser, or on the iPhone "Share → Add to Home Screen" (instructions also under "My account").
Long-pressing the app icon jumps straight to **Scan, Check in, Take out, Search, Shopping list**.
The UI is cached and therefore starts quickly; data always comes fresh from the server.
The icons are generated by `npm run icons` (script `scripts/make-icons.js`).

## Insights

Menu → "Insights": key figures (items, pieces, occupied locations, transactions, shopping list, out of stock), the
most used items (90 days), who books how much (30 days), items **not touched for a long time** (6 months / 1 year /
2 years – candidates for decluttering), out-of-stock items and empty locations.
With several storage areas you can filter by one storage area.

## Export & import

Administration → "Export & import" (admins only):

- **Export** as Excel (.xlsx) or CSV (semicolon-separated, opens directly in German Excel), all or one storage area.
  Columns (German headers): `Code`, `Name`, `Beschreibung` (description), `Lager` (storage area), `Platz` (location),
  `Menge` (quantity), `Verbrauchsmaterial` (consumable), `Haltbar bis` (best before), `Platzname` (location name),
  `Kategorie` (category), `Zuletzt gebucht` (last transaction), `Von` (by).
- **Import** of the same columns from Excel or CSV (template available for download). Name and location are required
  (`B12` + the storage area column, or `K-B12`). Rows with a known **code** update the item, an unknown valid code is
  adopted (for pre-printed labels), rows without a code create a new item.
  Before importing, a **preview** shows every row (new / changed / unchanged / error); error rows are skipped.
  Quantity changes are recorded as transactions, and a backup is created automatically beforehand.

This lets you, for example, export, edit in Excel and import again.

## Undoing transactions

After every check-in or take-out, the notification shows "Undo" for a few seconds. Later you can use "undo" on the
topmost transaction in the history in an item's detail view, or the MCP tool `buchung_rueckgaengig`. Everything the
transaction changed is reverted: stock, location (for a move), shopping list – and a check-in that created a new item
removes it again.

- Only the **most recent transaction** of an item can be undone (otherwise stock levels would no longer add up).
- Only **your own** transactions; admins may undo all.

## Backups

The server creates a backup automatically (default: every 24 hours, the last 14 are kept) in the `backups/` folder
next to the database (`data/backups`, in the Docker container `/data/backups`). Under
**Administration → Backups** admins can:

- create a backup immediately, download or delete backups,
- **restore** an earlier state – while running; the current state is backed up automatically first ("before
  restore") and can be brought back the same way,
- upload a backup file (just store it or restore it right away). The file is validated first.

Manual backups and backups made before a restore are never deleted automatically.
Important: also keep backups somewhere else (download, NAS, cloud) – on the same disk they won't help if the disk fails.

| Variable                | Default                  | Meaning                                         |
|-------------------------|--------------------------|-------------------------------------------------|
| `BACKUP_DIR`            | `<database folder>/backups` | Storage location                             |
| `BACKUP_INTERVAL_HOURS` | `24`                     | Interval of automatic backups, `0` = off        |
| `BACKUP_KEEP`           | `14`                     | Number of automatic backups kept                |

## AI assistant in the app

Under **Assistant** (menu, and as a purple button in the detail and location views) an AI assistant takes requests by
**text, voice or photo** and books by itself: "3 cans of tomatoes to basement B2, best before 05/2027", "Put the drill
in the toolbox", a photo of the item + shelf label "this goes here", "What expires this week?".

- **Setup** (Administration → Assistant): address of an OpenAI-compatible API (default
  `https://openrouter.ai/api/v1`), model and API key, then "Test connection". The model must support tools (tool
  calling) and, for photos, images. The key stays on the server and is never displayed.
- **Tools:** the same as the MCP server, plus `foto_zuordnen` (a photo from the chat becomes the item's picture).
  The assistant acts as the signed-in person with their permissions; the history shows "via assistant".
- **Transactions** are executed immediately – each appears in the chat with "undo". If there are **4 or more at
  once**, it shows them for confirmation first ("Execute" / "Cancel").
- **Photos:** the app shrinks them and reads QR labels (location, item) itself; the assistant recognizes the rest.
- **Voice:** 🎤 uses the browser's speech recognition (good in Chrome/Android, limited in Safari/iOS, HTTPS only);
  the message is sent automatically after speaking. "🔊 Read aloud" reads the answers aloud.
- **Context:** when opened from the detail or location view, the assistant knows what "this" or "here" refers to.
- **Location names:** it understands named locations (Locations → Edit, e.g. "Fridge") directly: "into the fridge".
- **History:** only the latest messages are sent along (at most 20, or about 8000 characters). "Forget that" or
  "New conversation" clears the history, as does the "New conversation" button; after a 30-minute pause a new
  conversation starts automatically (older messages stay visible but are no longer sent).
- **Price research** (shopping list, tool `preise_recherchieren`): one web search per product, the model names the
  cheapest offers with their source; offers whose source is not among the search results count as unconfirmed.
  With **OpenRouter** the web search comes from the web plugin. With a **gateway like LiteLLM** (setting "Search tool in
  gateway", e.g. `foundry-web`) a small agent researches with the tools `websuche` (`POST {address}/search/{search tool}`,
  at most 3) and `seite_lesen` (the server fetches the page, public addresses only, at most 3); a price then only
  counts as confirmed if it appears on a page that was read. Pages that load their prices via JavaScript return no
  text – flyer portals like kaufDA work well. Without a web plugin or search tool, price research is not available.
  Comparison and flyer portals are only a source, never a retailer.
- **Privacy/costs:** messages, photos and search results are sent to the chosen provider. The settings show requests,
  tokens and (if the provider reports them) costs for the last 30 days.

| Variable      | Meaning                                                                |
|---------------|------------------------------------------------------------------------|
| `AI_API_KEY`  | API key (takes precedence over the setting; then it is not stored in the database or backups) |
| `AI_BASE_URL` | Address of the API, e.g. `https://openrouter.ai/api/v1`                |
| `AI_MODEL`    | Model                                                                  |
| `AI_SEARCH_TOOL` | The gateway's search tool for price research without OpenRouter, e.g. `foundry-web` (takes precedence over the setting) |
| `PUBLIC_URL`  | Public address of the app (sent to the provider as referer)            |

## House in 3D

Under Administration → "Set up house" you can model the whole house including the outdoor area: floors (basement,
living floors, attic with gable roof, outdoors) with elevation, room height, outer outline and rooms as polygons; the
walls result automatically from "outline minus rooms". Plus doors, windows, carport/terrace/parking space and fixtures
(shelf unit, cabinet, wall cabinet, fridge, floor space, stairs). Every location – from any storage area – can be
assigned to a shelf of a fixture. The storage plan shows the house in the "3D" tab (three.js under
`public/vendor/three/`, loaded only when opened). Dimensions are stored in mm and shown in cm in the editor.

## MCP server (AI assistants)

A separate port (default `3100`) runs an MCP server (transport "Streamable HTTP", endpoint `/mcp`) through which AI
assistants like Claude can use the inventory: search, check in/take out, move, show locations, shopping list, recent
transactions. Authentication via **API key** (`Authorization: Bearer hlk_…`), which admins create under "API keys":
each key belongs to one person (on whose behalf transactions are booked) and has the permission "Read and book" or
"Read only". The key is shown only once; only a hash is stored.
API keys also work for the REST API (`/api/...`), but not for administrative functions.
Exception in the MCP server: with an admin's key ("Read and book") `lager_anlegen` is additionally available.

```bash
claude mcp add --transport http heimlager http://localhost:3100/mcp --header "Authorization: Bearer hlk_…"
```

For access from outside, publish the port through a reverse proxy (TLS) – the web app itself doesn't have to be
public for that. Turn off buffering in the proxy (Caddy `flush_interval -1`, nginx `proxy_buffering off`).

| Variable              | Default   | Meaning                                                           |
|-----------------------|-----------|-------------------------------------------------------------------|
| `MCP_PORT`            | `3100`    | Port of the MCP server, `0` = off                                 |
| `MCP_HOST`            | `0.0.0.0` | Address, e.g. `127.0.0.1` if the proxy runs on the same machine   |
| `MCP_PUBLIC_URL`      | –         | Public address, e.g. `https://mcp.example.de` (for the origin check and display) |
| `MCP_ALLOWED_ORIGINS` | –         | Additional allowed browser origins, comma-separated               |
| `MCP_KEY_IN_URL`      | –         | `1` = also allow the key in the URL (`/mcp/hlk_…`) for clients without custom headers – but it then ends up in proxy logs |

## Workflow

1. **Sign in** – tap your tile, enter your password.
2. **What would you like to do?** – Scan, Check in, Take out or Search
   (plus storage plan, locations and label printing).
3. Every transaction records person, quantity, location and time.
   Search and the detail view show who last checked an item in or took it out – including the complete history.

## Managing people

Under "Manage people" (in the menu and on the "Who are you?" page) you can add, rename and recolor people. For people
who are no longer needed there are two options:

- **Archive** – the person disappears from the selection, their history stays unchanged.
  Archived people can't book and can be restored at any time.
- **Delete** – immediately if they have no transactions. Otherwise their transactions are first transferred to
  another person (handy for merging duplicate people).

## Scanning with QR codes

In scan mode the camera runs continuously. Recognized codes trigger an action immediately:

| Action        | Scans                                   | Result                                        |
|---------------|-----------------------------------------|-----------------------------------------------|
| **Check in**  | 1. location, 2. item                    | The item is booked to this location. The location stays active, more items can be scanned right after. |
| **Take out**  | The item **twice** in a row             | The item is taken out. Move the camera away briefly between the scans. |
| **New item**  | Unknown (pre-printed) label             | A form for name and location opens, the code is permanently assigned to the item. |

The quantity per transaction (default 1) can be set in scan mode. A beep and a vibration confirm every transaction.
The input field below the camera image also accepts handheld scanner input or codes typed by hand.

### Code format

QR codes contain a link to the app, e.g. `https://192.168.1.20:3443/q/P-K-B12`.
Scanned with the regular camera app, it opens the location or item directly.
The scanner in the app only evaluates the end of the link, so a changed IP does no harm.

| Type         | Code            | Example      |
|--------------|-----------------|--------------|
| Location     | `P-<area code>-<column><row>` | `P-K-B12`, `P-H-AC7` |
| Location (old) | `P-<column><row>` | `P-B12` – older labels, belong to the first storage area |
| Item         | `O-<6 characters>` | `O-K7M2XQ` |

Item codes consist of 6 characters without easily confused characters (no 0/O, 1/I).
The prefix can be omitted when typing.

## Consumables and shopping list

Items can be marked as **consumables** when created or under "Edit" (e.g. batteries, screws, cleaning supplies). When
such an item is taken out, it counts as used up and the quantity taken out is added automatically to the
**shopping list** (tile in the menu, with a count). If it is already on the list, the quantity is increased. Other
items can be added by hand in the detail view with "Add to shopping list", free entries (e.g. "milk") directly on the
list.

On the list:

- **Tick off** (circle) – bought; moves to "Recently bought" and can be brought back from there.
- **Bought + check in** – checks the quantity straight back into the previous location.
- **Bought + store** (free entries that aren't an item yet) – opens "New item" with name, quantity and consumable
  pre-filled; after saving, the entry is ticked off and linked to the item.
- Change the quantity with −/+, add a note (brand, size …), remove the entry.
- **Share:** "WhatsApp" opens WhatsApp with the finished list, "Share…" the phone's share menu (only available over
  HTTPS), plus "Copy" and "Save as text".

## Multiple storage areas

Under "Manage storage areas" you can create any number of storage areas (e.g. basement, garage, attic).
Each storage area has a **name**, a **code** (1–4 characters, e.g. `K`) and its own locations –
B12 in the basement and B12 in the garage are different locations.

- The **current storage area** is selected at the top of the header (appears once there are two storage areas) and is
  remembered per device. Locations, storage plan and label printing refer to this storage area.
- **Search** finds items in all storage areas; locations are then shown with their code (`K-B12`).
  Searching with a code (`K-B12`, `K-B`) searches only that storage area.
- When checking in and editing, you choose storage area + location; this way you can also move things to another
  storage area.
- A storage area can only be deleted when no items are left in it.

On the first start after the update, all existing locations and items are assigned to the storage area
**"Hauptlager" (main storage, code `H`)**. Name and code can be changed afterwards.

## Expiry

Items can get a **best-before date** (check in, edit; optional). There is one date per item – with several packages
with different dates, enter the earliest or create separate items.

- **New package:** when checking in an existing item, you can change the date at the same time.
- **Display:** lists show an orange tag from 30 days before expiry and a red tag after expiry; the detail view always
  shows the date.
- **Menu:** if something has expired or expires within the next 7 days, a notice appears at the top.
- **"Expiry"** (menu) lists what has expired and what expires within 7 days, 30 days, 3 months or 1 year;
  insights show both as key figures. Items with a stock of 0 don't count.
- **Export/import:** column `Haltbar bis` (also `MHD`), e.g. `31.03.2027`, `2027-03-31`, Excel date cells or just
  the month `03/2027` (= end of month).
- **MCP:** `einbuchen` with `haltbar_bis`, `haltbarkeit_setzen` (without changing the quantity) and `haltbarkeit_pruefen`.

## Containers (bag, box, crate)

If a location holds a bag or box containing several things, create it as a **container** ("Container" checkbox when
checking in or editing). A container is a regular item with its own code and label; other items are stored **inside**
it – nested too (a bit bag inside the toolbox).

- **Put in:** in the container's detail view use "Put item inside" or "Check in new item inside", or choose the
  container under "Inside" when checking in/editing (then no location is needed).
- **Location:** the contents always have the container's location. When the container is moved, everything inside
  moves along.
- **Take out of the container:** when editing choose "directly at the location" or check it in at another location.
  Checking in at the same location leaves the item in the container.
- **Display:** at the location, the contents are listed indented below their container; lists show "in …".
- **Scanning:** scan a container → "Fill" → every further scanned item is checked into the container.
- **Undo** puts an item back into the container it came from. If a container is deleted, its contents stay at the
  location. A container with contents can't be turned back into a regular item.
- Via MCP: `einbuchen` and `umlagern` with `behaelter`, new containers with `ist_behaelter`.
- Export/import don't know about containers yet: imported rows with a different location take the item out of its
  container.

## Locations

A location consists of a **column** (letters `A`–`Z`, also multi-letter like `AA`, `AB`, …) and a **row**
(`0`–`99`), e.g. `B12` or `AC7`. Each location can have a **name**, a **category** and a **short description**.
Under "Locations" you can create whole ranges at once (e.g. columns A–C, rows 0–9). Locations that don't exist yet
when checking in are created automatically.

Search can look up a location directly (`B12` shows the location, `B` the whole column), as well as location names,
categories and item codes.

## Printing labels

"Print labels" offers three kinds:

- **Locations** – choose a range or all created locations; label with QR, code, name, category.
- **Items** – all or filtered items; label with QR, name, location and code.
- **Blank item labels** – pre-printed codes to stick on. The item is created on the first scan.

Printing uses the browser's print dialog. There is a large (approx. 7 × 3.6 cm) and a small variant
(approx. 5 × 2.5 cm). Individual labels can be printed directly from the location or item view.

## 3D printing

In the location and item views, "3D print" opens a generator for QR signs.
You can set width, margin, corner radius, plate and QR height, a text below the code, an eyelet for hanging, and
the colors of the base plate and QR code. The preview shows dimensions and module size and warns about modules that
are too small (under 0.8 mm) or insufficient contrast.

| Download            | Intended for                                                            |
|---------------------|-------------------------------------------------------------------------|
| STL (one part)      | Single filament; insert a color change in the slicer at Z = plate thickness |
| 3MF with colors     | Multicolor printers (AMS/MMU): base plate and QR code as two colored parts |
| 2 STL parts (ZIP)   | Slicers without 3MF support: both parts separately                      |

The models are generated entirely in the browser (`public/qr3d.js`).

## Data backup

Everything is in `data/lager.db`. A copy of this file is a complete backup
(stop the server first, or also copy `data/lager.db-wal`).

## API (for custom extensions)

All endpoints except `/api/auth/*` require authentication: session cookie (browser) or
`Authorization: Bearer <API key>`. Administration (creating/changing people, storage areas, API keys) is admin-only.

| Method  | Path                        | Purpose                                                      |
|---------|-----------------------------|--------------------------------------------------------------|
| GET     | `/api/auth/status`          | Sign-in status, people for the sign-in page, `setup`         |
| POST    | `/api/auth/setup`           | Initial setup: define the first admin `{person_id \| name, password}` |
| POST    | `/api/auth/login`           | Sign in `{person_id, password}` (sets the session cookie)    |
| POST    | `/api/auth/logout`          | Sign out                                                     |
| POST    | `/api/auth/password`        | Change your own password `{current, password}`               |
| GET/POST/DELETE | `/api/keys`         | Manage API keys (admins only)                                |
| GET     | `/api/persons`              | List people                                                  |
| GET     | `/api/persons?all=1`        | All people including archived ones, with transaction count   |
| POST    | `/api/persons`              | Create a person `{name, color}`                              |
| PATCH   | `/api/persons/:id`          | Change/archive `{name, color, archived}`                     |
| DELETE  | `/api/persons/:id`          | Delete; if there are transactions, with `?merge_into=<id>`   |
| GET     | `/api/warehouses`           | Storage areas with number of locations/items                 |
| POST    | `/api/warehouses`           | Create a storage area `{name, code, description}`            |
| PATCH   | `/api/warehouses/:id`       | Change a storage area                                        |
| DELETE  | `/api/warehouses/:id`       | Delete an empty storage area                                 |
| GET     | `/api/site`                 | House: `floors` with `outline`, `rooms`, `openings`, `roof`, `background`, `fixtures` (with `slots`), `updated_at` (dimensions in mm) |
| PUT     | `/api/site`                 | Save the whole house (admins only); `if_updated_at` = last loaded state, otherwise 409 |
| GET     | `/api/site/places`          | Locations of all storage areas that are in the house, with occupancy and contents |
| GET     | `/api/site/stats`           | Per location in the house: transactions in the last 90 days, last movement (heatmap) |
| GET/PUT/DELETE | `/api/floors/:id/image` | Background image of a floor (PNG/JPEG/WebP, Base64 `{image}`; changes admins only) |
| GET     | `/api/places?wh=`           | Locations of a storage area with occupancy (all location endpoints take `?wh=<storage area ID>`; without it, the first storage area is used) |
| GET     | `/api/places/:col/:row`     | Location with items                                          |
| PUT     | `/api/places/:col/:row`     | Create/change a location `{name, category, description}`     |
| POST    | `/api/places/bulk`          | Create a range `{col_from, col_to, row_from, row_to, category}` |
| DELETE  | `/api/places/:col/:row`     | Delete an empty location                                     |
| GET     | `/api/resolve?code=`        | Resolve a scan code → `place`, `item`, `unknown`, `invalid`  |
| GET     | `/api/codes/new?n=`         | New, unused item codes for blank labels                      |
| GET     | `/api/items?q=&wh=`         | Search items (optionally in one storage area only)           |
| GET     | `/api/items/:id`            | Item with history                                            |
| PATCH   | `/api/items/:id`            | Change master data (incl. `consumable`, `container`, `container_id` – `null` = out of the container, `expires_on`) |
| GET     | `/api/containers`           | All containers                                               |
| GET     | `/api/expiring?days=&wh=`   | Expired or expiring within `days` days (default 30)          |
| DELETE  | `/api/items/:id`            | Delete an item                                               |
| POST    | `/api/checkin`              | Check in `{person_id, item_id \| code, name, warehouse_id, col, row, quantity, container_id, container, expires_on}` |
| PUT/GET/DELETE | `/api/items/:id/photo` | Photo `{image, thumb}` (Base64 JPEG/WebP): save / fetch (`?size=thumb`) / delete |
| GET     | `/api/stats?wh=&stale_days=` | Insights                                                    |
| POST    | `/api/import`               | Import `{rows, dry}` (admins only)                           |
| POST    | `/api/assistant`            | Assistant `{message, history, images: [{image, thumb, codes}], context}` → `{reply, bookings, confirm?}` |
| POST    | `/api/assistant/confirm`    | Execute deferred transactions `{token}` (`…/cancel`: discard) |
| GET/PUT | `/api/assistant/settings`   | Assistant settings (admins only); `POST /api/assistant/test` |
| POST    | `/api/movements/:id/undo`   | Undo a transaction (the item's latest, your own; admins all) |
| GET/POST | `/api/backups`             | List / create backups (admins only); `…/:name/download`, `…/:name/restore`, `POST /api/backups/upload[?restore=1]` |
| POST    | `/api/checkout`             | Take out `{person_id, item_id \| code, quantity}`            |
| GET     | `/api/shopping`             | Shopping list `{open, done}`                                 |
| POST    | `/api/shopping`             | Entry `{item_id \| name, quantity, note, person_id}`         |
| PATCH   | `/api/shopping/:id`         | Change `{quantity, note, done}`                              |
| POST    | `/api/shopping/:id/restock` | Bought and check in `{quantity?}`; with `col/row` or `container_id` to that place – free entries are created as new items `{name?, consumable?, expires_on?}` |
| DELETE  | `/api/shopping/:id`         | Remove an entry (`/api/shopping?done=1`: all completed ones) |
| GET     | `/api/overview`             | All locations and recent transactions                        |
| GET     | `/q/<code>`                 | QR link, redirects into the app                              |

## Libraries used (in the `public/vendor` folder)

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) – generate QR codes
- [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) – read QR codes from the camera image if the browser has no `BarcodeDetector`
