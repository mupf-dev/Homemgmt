'use strict';
// Zuhause – Modul „Lager“ (ehemals Heimlager): Lager, Buchungen, Haus, Assistent – und das gemeinsame Kontosystem
// (Personen, Sitzungen, API-Schlüssel), das auch der Küchenplaner nutzt. Die HTTP-Server startet server/index.ts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword, verifyPassword } = require('./password.cjs');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'zuhause.db');
// Hinter einem Reverse Proxy: X-Forwarded-Proto/-For auswerten (nur setzen, wenn der Proxy diese Header setzt)
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Port des MCP-Servers (nur zur Anzeige unter „API-Schlüssel“; gestartet wird er in server/index.ts)
const MCP_PORT = Number(process.env.MCP_PORT ?? 3100);
// Weitere Module (Küchenplaner …) hängen ihr Schema hier ein – läuft nach jedem Öffnen, auch nach einer Wiederherstellung
const openHooks = [];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ---------- Codes ----------
// Alphabet ohne verwechselbare Zeichen (0/O, 1/I)
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM items WHERE code = ?').get(code)) return code;
  }
}

let db;
// Datenbank öffnen, Schema anlegen und Migrationen ausführen – beim Start und nach einer Wiederherstellung
function openDatabase() {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS places (
      warehouse_id INTEGER NOT NULL DEFAULT 1,
      col TEXT NOT NULL,
      row INTEGER NOT NULL CHECK (row BETWEEN 0 AND 99),
      name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (warehouse_id, col, row)
    );
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      col TEXT NOT NULL,
      row INTEGER NOT NULL CHECK (row BETWEEN 0 AND 99),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES persons(id),
      type TEXT NOT NULL CHECK (type IN ('in','out')),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      col TEXT NOT NULL,
      row INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mov_item ON movements(item_id, id);
  `);

  // Migration: Personen archivieren können (bleiben im Verlauf, aber nicht mehr auswählbar)
  if (!db.prepare('PRAGMA table_info(persons)').all().some((c) => c.name === 'archived')) {
    db.exec('ALTER TABLE persons ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: mehrere Lager. Bestehende Daten landen im ersten Lager („Hauptlager“, Kürzel H).
  {
    if (!db.prepare('SELECT 1 FROM warehouses LIMIT 1').get()) {
      db.prepare("INSERT INTO warehouses (id, code, name) VALUES (1, 'H', 'Hauptlager')").run();
    }
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has('places', 'warehouse_id')) {
      // Primärschlüssel ändert sich → Tabelle neu aufbauen
      db.exec(`
        BEGIN;
        CREATE TABLE places_new (
          warehouse_id INTEGER NOT NULL DEFAULT 1,
          col TEXT NOT NULL,
          row INTEGER NOT NULL CHECK (row BETWEEN 0 AND 99),
          name TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (warehouse_id, col, row)
        );
        INSERT INTO places_new (warehouse_id, col, row, name, category, description, created_at)
          SELECT 1, col, row, name, category, description, created_at FROM places;
        DROP TABLE places;
        ALTER TABLE places_new RENAME TO places;
        COMMIT;`);
    }
    if (!has('items', 'warehouse_id')) db.exec('ALTER TABLE items ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1');
    if (!has('movements', 'warehouse_id')) db.exec('ALTER TABLE movements ADD COLUMN warehouse_id INTEGER NOT NULL DEFAULT 1');
    db.exec('DROP INDEX IF EXISTS idx_items_loc');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_wloc ON items(warehouse_id, col, row)');
  }

  // Migration: Verbrauchsmaterial und Einkaufsliste
  {
    if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'consumable')) {
      db.exec('ALTER TABLE items ADD COLUMN consumable INTEGER NOT NULL DEFAULT 0');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS shopping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
        note TEXT NOT NULL DEFAULT '',
        person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        done_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shopping_open ON shopping(done_at, item_id);`);
  }

  // Migration: Anmeldung (Passwort + Rolle je Person), Sitzungen, API-Schlüssel
  {
    const has = (col) => db.prepare('PRAGMA table_info(persons)').all().some((c) => c.name === col);
    if (!has('password_hash')) db.exec('ALTER TABLE persons ADD COLUMN password_hash TEXT');
    if (!has('role')) db.exec("ALTER TABLE persons ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    // Recht „Haus planen“ (Admins dürfen immer) und persönliche Einstellungen der App (JSON, siehe PREFS)
    if (!has('can_plan')) db.exec('ALTER TABLE persons ADD COLUMN can_plan INTEGER NOT NULL DEFAULT 0');
    if (!has('prefs')) db.exec("ALTER TABLE persons ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'");
    // Wandterminals: Geräte ohne persönliche Anmeldung (Einrichtungslink setzt ein Geräte-Cookie)
    db.exec(`CREATE TABLE IF NOT EXISTS terminals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT
    )`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        scope TEXT NOT NULL DEFAULT 'write' CHECK (scope IN ('read','write')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        last_used_at TEXT
      );`);
    db.exec("DELETE FROM sessions WHERE expires_at < datetime('now')");
  }

  // Migration: Objekt-Codes nachrüsten, Plätze aus vorhandenen Objekten anlegen
  {
    const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
    if (!cols.includes('code')) db.exec('ALTER TABLE items ADD COLUMN code TEXT');
    for (const { id } of db.prepare('SELECT id FROM items WHERE code IS NULL').all()) {
      db.prepare('UPDATE items SET code = ? WHERE id = ?').run(newCode(), id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code ON items(code)');
    db.exec('INSERT OR IGNORE INTO places (warehouse_id, col, row) SELECT DISTINCT warehouse_id, col, row FROM items');
  }

  // Migration: Fotos von Gegenständen (verkleinert, in der Datenbank → automatisch in jedem Backup)
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_photos (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      thumb BLOB NOT NULL,
      image BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

  // Migration: Buchungen rückgängig machen können (vorheriger Platz, neu angelegt, Einkaufsliste)
  {
    const cols = db.prepare('PRAGMA table_info(movements)').all().map((c) => c.name);
    for (const [col, type] of [['prev_warehouse_id', 'INTEGER'], ['prev_col', 'TEXT'], ['prev_row', 'INTEGER'],
      ['created_item', 'INTEGER NOT NULL DEFAULT 0'], ['shopping_id', 'INTEGER'], ['shopping_qty', 'INTEGER NOT NULL DEFAULT 0']]) {
      if (!cols.includes(col)) db.exec(`ALTER TABLE movements ADD COLUMN ${col} ${type}`);
    }
  }

  // Migration: Behälter (Tasche, Box …) – Gegenstände können in einem anderen Gegenstand liegen.
  // Der Inhalt übernimmt immer den Lagerplatz des Behälters (so bleiben Platz-Abfragen unverändert).
  {
    const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
    if (!cols.includes('container')) db.exec('ALTER TABLE items ADD COLUMN container INTEGER NOT NULL DEFAULT 0');
    if (!cols.includes('parent_id')) db.exec('ALTER TABLE items ADD COLUMN parent_id INTEGER REFERENCES items(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)');
    const mcols = db.prepare('PRAGMA table_info(movements)').all().map((c) => c.name);
    for (const col of ['parent_id', 'prev_parent_id']) {
      if (!mcols.includes(col)) db.exec(`ALTER TABLE movements ADD COLUMN ${col} INTEGER`);
    }
  }

  // Migration: Haltbarkeitsdatum (YYYY-MM-DD, optional)
  if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'expires_on')) {
    db.exec('ALTER TABLE items ADD COLUMN expires_on TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_expiry ON items(expires_on) WHERE expires_on IS NOT NULL');

  // Migration: KI-Assistent – Herkunft der Buchungen, Einstellungen, Verbrauchsprotokoll
  if (!db.prepare('PRAGMA table_info(movements)').all().some((c) => c.name === 'source')) {
    db.exec("ALTER TABLE movements ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_key TEXT NOT NULL,
      name TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      quantity INTEGER,
      stock INTEGER,
      person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_price_checks_key ON price_checks(query_key, id);
    CREATE TABLE IF NOT EXISTS assistant_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);

  // Haus (Raumansicht): Etagen mit Umriss, Räumen, Türen/Fenstern und Dach; Einbauten (Regal, Schrank …) je Etage
  // und welcher Lagerplatz in welchem Fach liegt – Plätze aus beliebigen Lagern.
  // Maße in mm; Grundriss mit x nach rechts und y nach unten.
  {
    // Vorversion (ein Raum je Lager) wurde nie ausgeliefert → einfach ersetzen
    const fxCols = db.prepare('PRAGMA table_info(fixtures)').all().map((c) => c.name);
    if (fxCols.includes('warehouse_id')) db.exec('DROP TABLE IF EXISTS fixture_slots; DROP TABLE IF EXISTS fixtures; DROP TABLE IF EXISTS room_layouts;');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'floor',
      sort INTEGER NOT NULL DEFAULT 0,
      elevation INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 2500,
      slab INTEGER NOT NULL DEFAULT 200,
      outline TEXT NOT NULL DEFAULT '[]',
      rooms TEXT NOT NULL DEFAULT '[]',
      openings TEXT NOT NULL DEFAULT '[]',
      roof TEXT,
      background TEXT
    );
    CREATE TABLE IF NOT EXISTS floor_images (
      floor_id INTEGER PRIMARY KEY REFERENCES floors(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS fixtures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      rotation INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      height INTEGER NOT NULL,
      elevation INTEGER NOT NULL DEFAULT 0,
      levels INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_fixtures_floor ON fixtures(floor_id);
    CREATE TABLE IF NOT EXISTS fixture_slots (
      warehouse_id INTEGER NOT NULL,
      col TEXT NOT NULL,
      row INTEGER NOT NULL,
      fixture_id INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
      level INTEGER NOT NULL,
      pos INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (warehouse_id, col, row),
      FOREIGN KEY (warehouse_id, col, row) REFERENCES places(warehouse_id, col, row) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_fixture_slots_fx ON fixture_slots(fixture_id);`);

  // Migration (Zuhause): gemeinsames Konto für alle Module – optionale E-Mail (Anmeldung im Küchenplaner) und
  // Kontostatus (pending = Registrierung wartet auf Freigabe durch einen Admin)
  {
    const cols = db.prepare('PRAGMA table_info(persons)').all().map((c) => c.name);
    if (!cols.includes('email')) db.exec('ALTER TABLE persons ADD COLUMN email TEXT COLLATE NOCASE');
    if (!cols.includes('status')) db.exec("ALTER TABLE persons ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_persons_email ON persons(email) WHERE email IS NOT NULL');
  }
  // Migration (Zuhause): Herkunft eines Einbaus, z. B. „kueche:12:abc“ = Element abc aus Küchenplanung 12
  if (!db.prepare('PRAGMA table_info(fixtures)').all().some((c) => c.name === 'source')) {
    db.exec('ALTER TABLE fixtures ADD COLUMN source TEXT');
  }
  for (const hook of openHooks) hook(db);
}
openDatabase();


// ---------- Hilfsfunktionen ----------
const COLORS = ['#e0574f', '#e0883d', '#d9b032', '#5aa84f', '#3a9c9c', '#3f7fd0', '#7a5ad0', '#c74d9a'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Anmeldung ----------
const SESSION_COOKIE = 'hl_session';
const SESSION_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function checkNewPassword(pw) {
  const s = String(pw ?? '');
  if (s.length < 4) throw new HttpError(400, 'Das Passwort muss mindestens 4 Zeichen haben.');
  if (s.length > 200) throw new HttpError(400, 'Das Passwort ist zu lang.');
  return s;
}

function createSession(personId) {
  const token = randomToken();
  db.prepare(`INSERT INTO sessions (token_hash, person_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .run(sha256(token), personId);
  return token;
}
const isHttps = (req) => req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
function sessionCookie(req, token, maxAge = SESSION_DAYS * 86400) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Öffentliche Felder einer Person (nie den Passwort-Hash herausgeben)
const PERSON_COLS = 'p.id, p.name, p.color, p.role, p.can_plan, p.archived, p.created_at, (p.password_hash IS NOT NULL) AS has_password';
const publicPerson = (p) => p && { id: p.id, name: p.name, color: p.color, role: p.role, email: p.email ?? null };

// Angemeldete Person über Sitzungs-Cookie
function sessionAuth(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = db.prepare(`SELECT s.expires_at, p.* FROM sessions s JOIN persons p ON p.id = s.person_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND p.archived = 0 AND p.status = 'active'`).get(hash);
  if (!row) return null;
  // gleitende Laufzeit: höchstens einmal pro Tag verlängern
  db.prepare(`UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days')
    WHERE token_hash = ? AND expires_at < datetime('now', '+${SESSION_DAYS - 1} days')`).run(hash);
  return { person: row, via: 'session', scope: 'write', sessionHash: hash };
}

// API-Schlüssel ("Authorization: Bearer hlk_…") – für MCP und die REST-API
function keyAuth(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT k.id AS key_id, k.scope, p.* FROM api_keys k JOIN persons p ON p.id = k.person_id
    WHERE k.key_hash = ? AND (k.expires_at IS NULL OR k.expires_at > datetime('now')) AND p.archived = 0 AND p.status = 'active'`).get(sha256(token));
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.key_id);
  return { person: row, via: 'key', scope: row.scope, keyId: row.key_id };
}
const bearer = (req) => (String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i) || [])[1] || null;

// Wandterminal (Geräte-Cookie): darf ansehen und – mit Angabe, wer bucht – buchen; keine Verwaltung, kein Planen
const TERMINAL_COOKIE = 'zh_terminal';
function terminalAuth(req) {
  const token = readCookie(req, TERMINAL_COOKIE);
  if (!token) return null;
  const row = db.prepare('SELECT * FROM terminals WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at + 'Z') > 5 * 60000) {
    db.prepare("UPDATE terminals SET last_seen_at = datetime('now') WHERE id = ?").run(row.id);
  }
  // „Person“ zum Lesen; bei schreibenden Aufrufen ersetzt die gewählte Person (person_id) sie, siehe handle()
  return { person: { id: 0, name: row.name, role: 'terminal', status: 'active' }, via: 'terminal', scope: 'write', terminal: row };
}
// Was ein Terminal schreiben darf (immer mit person_id = wer bucht)
const TERMINAL_WRITES = [
  ['POST', /^\/api\/(checkin|checkout|shopping)$/],
  ['POST', /^\/api\/(movements|shopping)\/\d+\/(undo|restock)$/],
  ['PATCH', /^\/api\/shopping\/\d+$/],
  ['DELETE', /^\/api\/shopping\/\d+$/],
];

// Einfache Bremse gegen Passwort-Raten: nach 5 Fehlversuchen zunehmend lange Sperre
const loginFails = new Map();
function loginThrottle(key) {
  const f = loginFails.get(key);
  if (f && f.until > Date.now()) {
    throw new HttpError(429, `Zu viele Fehlversuche. Bitte in ${Math.ceil((f.until - Date.now()) / 1000)} Sekunden erneut versuchen.`);
  }
}
function loginFailed(key) {
  const f = loginFails.get(key) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - 5)) * 1000;
  loginFails.set(key, f);
}

function normalizeLocation(col, row) {
  const c = String(col || '').trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(c)) throw new HttpError(400, 'Spalte muss aus 1–3 Buchstaben (A–Z) bestehen.');
  const r = Number(row);
  if (!Number.isInteger(r) || r < 0 || r > 99) throw new HttpError(400, 'Zeile muss eine Zahl von 0 bis 99 sein.');
  return { col: c, row: r };
}

// Haltbarkeitsdatum: "2027-03-31", "31.03.2027", "31.3.27" oder nur Monat "03/2027" / "3.27" (= Monatsende).
// Leer = kein Datum. Ergebnis: YYYY-MM-DD oder null.
function expiryDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (x) [y, m, d] = [x[1], x[2], x[3]].map(Number);
  else if ((x = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/))) [d, m, y] = [x[1], x[2], x[3]].map(Number);
  else if ((x = s.match(/^(\d{1,2})[./](\d{2}|\d{4})$/))) { [m, y] = [x[1], x[2]].map(Number); d = 0; }
  else throw new HttpError(400, `Haltbarkeitsdatum „${s}“ nicht verstanden (z. B. 31.03.2027 oder 03/2027).`);
  if (y < 100) y += 2000;
  const date = d === 0 ? new Date(Date.UTC(y, m, 0)) : new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || (d !== 0 && date.getUTCDate() !== d) || y < 2000 || y > 2200) {
    throw new HttpError(400, `Haltbarkeitsdatum „${s}“ gibt es nicht.`);
  }
  return date.toISOString().slice(0, 10);
}

// Herkunft einer Buchung: App (Standard), MCP-Server oder Assistent in der App
const SOURCES = ['app', 'mcp', 'assistent'];
const sourceOf = (body) => (SOURCES.includes(body?.source) ? body.source : 'app');

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${label} muss eine positive ganze Zahl sein.`);
  return n;
}

const colToNum = (s) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
function numToCol(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

function ensurePlace(wid, col, row) {
  db.prepare('INSERT OR IGNORE INTO places (warehouse_id, col, row) VALUES (?, ?, ?)').run(wid, col, row);
}

// Lager
const WH_CODE_RE = /^[A-Z][A-Z0-9]{0,3}$/;
function getWarehouse(id) {
  const w = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(Number(id));
  if (!w) throw new HttpError(404, 'Lager nicht gefunden.');
  return w;
}
// Lager aus ?wh=<id> (fehlt es, gilt das erste Lager – so bleiben alte Aufrufe gültig)
function whFrom(value) {
  if (value === undefined || value === null || value === '') {
    return db.prepare('SELECT * FROM warehouses ORDER BY id LIMIT 1').get();
  }
  return getWarehouse(value);
}

const ITEM_SELECT = `
  SELECT i.id, i.code, i.name, i.description, i.warehouse_id, i.col, i.row, i.quantity, i.consumable, i.created_at,
         i.container, i.parent_id, par.name AS parent_name, par.code AS parent_code, i.expires_on,
         CAST(julianday(i.expires_on) - julianday('now', 'localtime', 'start of day') AS INTEGER) AS expires_in,
         (SELECT COUNT(*) FROM items c WHERE c.parent_id = i.id) AS contents,
         (SELECT COALESCE(SUM(quantity), 0) FROM shopping s WHERE s.item_id = i.id AND s.done_at IS NULL) AS on_list,
         (SELECT updated_at FROM item_photos ph WHERE ph.item_id = i.id) AS photo_at,
         w.code AS wh_code, w.name AS wh_name,
         pl.name AS place_name, pl.category AS place_category,
         m.type  AS last_type, m.created_at AS last_at, m.quantity AS last_quantity,
         p.name  AS last_person, p.color AS last_person_color
  FROM items i
  LEFT JOIN items par ON par.id = i.parent_id
  LEFT JOIN warehouses w ON w.id = i.warehouse_id
  LEFT JOIN places pl ON pl.warehouse_id = i.warehouse_id AND pl.col = i.col AND pl.row = i.row
  LEFT JOIN movements m ON m.id = (SELECT id FROM movements WHERE item_id = i.id ORDER BY id DESC LIMIT 1)
  LEFT JOIN persons p ON p.id = m.person_id
`;

const PLACE_SELECT = `
  SELECT pl.warehouse_id, w.code AS wh_code, w.name AS wh_name,
         pl.col, pl.row, pl.name, pl.category, pl.description, pl.created_at,
         (SELECT COUNT(*) FROM items i WHERE i.warehouse_id = pl.warehouse_id AND i.col = pl.col AND i.row = pl.row) AS items,
         (SELECT COALESCE(SUM(quantity), 0) FROM items i WHERE i.warehouse_id = pl.warehouse_id AND i.col = pl.col AND i.row = pl.row) AS quantity
  FROM places pl JOIN warehouses w ON w.id = pl.warehouse_id
`;

function getItem(id) {
  const item = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
  if (!item) throw new HttpError(404, 'Gegenstand nicht gefunden.');
  return item;
}

function getItemByCode(code) {
  return db.prepare(`${ITEM_SELECT} WHERE i.code = ?`).get(String(code).toUpperCase()) || null;
}

function getPlace(wid, col, row) {
  return db.prepare(`${PLACE_SELECT} WHERE pl.warehouse_id = ? AND pl.col = ? AND pl.row = ?`).get(wid, col, row) || null;
}
function placeItems(wid, col, row) {
  return db.prepare(`${ITEM_SELECT} WHERE i.warehouse_id = ? AND i.col = ? AND i.row = ? ORDER BY i.name`).all(wid, col, row);
}

// ---------- Behälter ----------
const containerContents = (id) => db.prepare(`${ITEM_SELECT} WHERE i.parent_id = ? ORDER BY i.container DESC, i.name`).all(id);

// Behälter holen; nicht das Objekt selbst und nichts, was (auch indirekt) in ihm liegt
function getContainer(id, itemId = null) {
  const box = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(Number(id));
  if (!box) throw new HttpError(404, 'Behälter nicht gefunden.');
  for (let cur = box; cur; cur = cur.parent_id ? db.prepare('SELECT id, name, parent_id FROM items WHERE id = ?').get(cur.parent_id) : null) {
    if (itemId && cur.id === Number(itemId)) {
      throw new HttpError(400, cur.id === box.id ? 'Ein Gegenstand kann nicht in sich selbst liegen.' : `${box.name} liegt selbst in diesem Gegenstand.`);
    }
  }
  return box;
}

// Ziel einer Buchung oder Änderung. container_id: Zahl = in diesen Behälter (er wird dabei zum Behälter),
// null = aus dem Behälter nehmen, fehlt = im Behälter bleiben, solange sich der Platz nicht ändert.
function placement(body, cur, wid, loc) {
  if (body.container_id) {
    const box = getContainer(body.container_id, cur?.id);
    if (!box.container) db.prepare('UPDATE items SET container = 1 WHERE id = ?').run(box.id);
    return { wid: box.warehouse_id, col: box.col, row: box.row, parentId: box.id };
  }
  const same = cur && wid === cur.warehouse_id && loc.col === cur.col && loc.row === cur.row;
  return { wid, col: loc.col, row: loc.row, parentId: body.container_id === undefined && same ? cur.parent_id : null };
}

// Inhalt (auch verschachtelt) auf den Platz seines Behälters setzen
function syncContents(id) {
  const box = db.prepare('SELECT warehouse_id, col, row FROM items WHERE id = ?').get(id);
  if (!box) return;
  db.prepare(`WITH RECURSIVE sub(id) AS (SELECT id FROM items WHERE parent_id = ? UNION SELECT i.id FROM items i JOIN sub ON i.parent_id = sub.id)
    UPDATE items SET warehouse_id = ?, col = ?, row = ? WHERE id IN (SELECT id FROM sub)`).run(id, box.warehouse_id, box.col, box.row);
}


function searchItems(q, limit = 100, wid = null) {
  const term = String(q || '').trim();
  const where = [];
  const args = [];
  if (wid) { where.push('i.warehouse_id = ?'); args.push(wid); }
  let order = 'ORDER BY i.warehouse_id, LENGTH(i.col), i.col, i.row, i.name';
  if (term) {
    const like = `%${term}%`;
    const alts = ['i.name LIKE ?', 'i.description LIKE ?', 'pl.name LIKE ?', 'pl.category LIKE ?', 'i.code = ?', 'w.name LIKE ?'];
    const altArgs = [like, like, like, like, term.toUpperCase(), like];
    // Lagerplatz-Suche wie "B12", "AB7", nur "B" oder mit Lager-Kürzel "K-B12"
    const loc = term.toUpperCase().match(/^(?:([A-Z][A-Z0-9]{0,3})-)?([A-Z]{1,3})\s*(\d{1,2})?$/);
    if (loc) {
      const parts = ['i.col = ?'];
      const partArgs = [loc[2]];
      if (loc[3] !== undefined) { parts.push('i.row = ?'); partArgs.push(Number(loc[3])); }
      if (loc[1]) { parts.push('w.code = ?'); partArgs.push(loc[1]); }
      alts.unshift(`(${parts.join(' AND ')})`);
      altArgs.unshift(...partArgs);
    } else order = 'ORDER BY i.name';
    where.push(`(${alts.join(' OR ')})`);
    args.push(...altArgs);
  }
  const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${order} LIMIT ?`;
  return db.prepare(sql).all(...args, limit);
}

// Scan-Code auswerten: "P-K-B12" (Lager K), "P-B12" (erstes Lager), "O-K7M2XQ", "K7M2XQ" oder eine URL ".../q/<code>"
function parseCode(raw) {
  let s = String(raw || '').trim();
  const m = s.match(/\/q\/([^/?#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/\s+/g, '');
  let x = s.match(/^P-([A-Z][A-Z0-9]{0,3})-([A-Z]{1,3})(\d{1,2})$/);
  if (x) return { type: 'place', wh: x[1], col: x[2], row: Number(x[3]) };
  x = s.match(/^P-?([A-Z]{1,3})-?(\d{1,2})$/);
  if (x) return { type: 'place', wh: null, col: x[1], row: Number(x[2]) };
  x = s.match(/^(?:O-?)?([2-9A-HJ-NP-Z]{6})$/);
  if (x) return { type: 'item', code: x[1] };
  return null;
}

// Einkaufsliste: offene Zeile je Gegenstand hochzählen oder neu anlegen
function addToShopping({ itemId = null, name, quantity, note = '', personId = null }) {
  const open = itemId ? db.prepare('SELECT id FROM shopping WHERE item_id = ? AND done_at IS NULL').get(itemId) : null;
  if (open) {
    db.prepare('UPDATE shopping SET quantity = quantity + ? WHERE id = ?').run(quantity, open.id);
    return open.id;
  }
  return db.prepare('INSERT INTO shopping (item_id, name, quantity, note, person_id) VALUES (?, ?, ?, ?, ?)')
    .run(itemId, name, quantity, note, personId).lastInsertRowid;
}

const SHOPPING_SELECT = `
  SELECT s.id, s.item_id, COALESCE(i.name, s.name) AS name, s.quantity, s.note, s.created_at, s.done_at,
         p.name AS person, p.color AS person_color,
         i.quantity AS stock, i.col, i.row, i.warehouse_id, w.code AS wh_code, w.name AS wh_name
  FROM shopping s
  LEFT JOIN items i ON i.id = s.item_id
  LEFT JOIN warehouses w ON w.id = i.warehouse_id
  LEFT JOIN persons p ON p.id = s.person_id`;

function getShopping(id) {
  const row = db.prepare(`${SHOPPING_SELECT} WHERE s.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Eintrag nicht gefunden.');
  return row;
}

// ---------- API ----------
// auth: 'public' (ohne Anmeldung), 'user' (Standard) oder 'admin' (nur Admins mit Sitzung)
const routes = [];
// raw: Body als Buffer statt JSON (Datei-Upload)
function route(method, pattern, handler, { auth = 'user', raw = false } = {}) {
  routes.push({ method, pattern: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`), handler, auth, raw });
}

// Personen
const personWithStats = (where = '') => db.prepare(`
  SELECT ${PERSON_COLS}, COUNT(m.id) AS bookings, MAX(m.created_at) AS last_at
  FROM persons p LEFT JOIN movements m ON m.person_id = p.id
  ${where} GROUP BY p.id ORDER BY p.archived, p.name COLLATE NOCASE`);

function personName(raw) {
  const name = String(raw || '').trim();
  if (!name) throw new HttpError(400, 'Name darf nicht leer sein.');
  if (name.length > 40) throw new HttpError(400, 'Name ist zu lang.');
  return name;
}
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ROLES = ['user', 'admin'];
const activeAdmins = (exceptId = 0) => db.prepare(
  "SELECT COUNT(*) AS n FROM persons WHERE role = 'admin' AND archived = 0 AND password_hash IS NOT NULL AND id != ?").get(exceptId).n;
const uniqueName = (fn) => {
  try { return fn(); } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Diesen Namen gibt es schon.');
    throw e;
  }
};
const dropSessions = (personId, keepHash = '') =>
  db.prepare('DELETE FROM sessions WHERE person_id = ? AND token_hash != ?').run(personId, keepHash);

// Standard: aktive Personen (z. B. für Auswahllisten), ?all=1: alle mit Buchungsstatistik (Verwaltung, nur Admins)
route('GET', '/api/persons', (_p, _b, qs, ctx) => {
  if (!qs.get('all')) return db.prepare(`SELECT ${PERSON_COLS} FROM persons p WHERE p.archived = 0 ORDER BY p.name COLLATE NOCASE`).all();
  if (ctx.via !== 'session' || ctx.person.role !== 'admin') throw new HttpError(403, 'Nur für Admins.');
  return personWithStats().all();
});

// Anlegen: {name, color?, role?, can_plan?, password?} – ohne Passwort kann sich die Person (noch) nicht anmelden
route('POST', '/api/persons', async (_p, body) => {
  const name = personName(body.name);
  const count = db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;
  const color = COLOR_RE.test(body.color || '') ? body.color : COLORS[count % COLORS.length];
  const role = ROLES.includes(body.role) ? body.role : 'user';
  const hash = body.password ? await hashPassword(checkNewPassword(body.password)) : null;
  const { lastInsertRowid } = uniqueName(() =>
    db.prepare('INSERT INTO persons (name, color, role, can_plan, password_hash) VALUES (?, ?, ?, ?, ?)').run(name, color, role, body.can_plan ? 1 : 0, hash));
  return personWithStats('WHERE p.id = ?').get(lastInsertRowid);
}, { auth: 'admin' });

// Ändern: {name?, color?, archived?, role?, can_plan?, password?}
route('PATCH', '/api/persons/:id', async (p, body, _qs, ctx) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(p.id);
  if (!person) throw new HttpError(404, 'Person nicht gefunden.');
  const name = body.name !== undefined ? personName(body.name) : person.name;
  if (body.color !== undefined && !COLOR_RE.test(body.color)) throw new HttpError(400, 'Ungültige Farbe.');
  const color = body.color ?? person.color;
  const archived = body.archived !== undefined ? (body.archived ? 1 : 0) : person.archived;
  if (body.role !== undefined && !ROLES.includes(body.role)) throw new HttpError(400, 'Ungültige Rolle.');
  const role = body.role ?? person.role;
  const hash = body.password ? await hashPassword(checkNewPassword(body.password)) : person.password_hash;
  const canPlan = body.can_plan !== undefined ? (body.can_plan ? 1 : 0) : person.can_plan;
  const self = person.id === ctx.person.id;
  if (self && (archived || role !== 'admin')) throw new HttpError(409, 'Du kannst dich nicht selbst archivieren oder dir die Admin-Rechte nehmen.');
  if (person.role === 'admin' && (archived || role !== 'admin') && activeAdmins(person.id) === 0) {
    throw new HttpError(409, 'Es muss mindestens einen Admin geben.');
  }
  uniqueName(() => db.prepare('UPDATE persons SET name = ?, color = ?, archived = ?, role = ?, can_plan = ?, password_hash = ? WHERE id = ?')
    .run(name, color, archived, role, canPlan, hash, person.id));
  // neues Passwort oder archiviert → bestehende Anmeldungen beenden (die eigene bleibt)
  if (archived || body.password) dropSessions(person.id, self ? ctx.sessionHash : '');
  return personWithStats('WHERE p.id = ?').get(person.id);
}, { auth: 'admin' });

// Löschen. Hat die Person Buchungen, müssen diese per ?merge_into=<id> einer anderen Person übertragen werden.
route('DELETE', '/api/persons/:id', (p, _b, qs, ctx) => {
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(p.id);
  if (!person) throw new HttpError(404, 'Person nicht gefunden.');
  if (person.id === ctx.person.id) throw new HttpError(409, 'Du kannst dich nicht selbst löschen.');
  if (person.role === 'admin' && activeAdmins(person.id) === 0) throw new HttpError(409, 'Es muss mindestens einen Admin geben.');
  const used = db.prepare('SELECT COUNT(*) AS n FROM movements WHERE person_id = ?').get(person.id).n;
  const mergeInto = qs.get('merge_into');
  if (used > 0 && !mergeInto) {
    throw new HttpError(409, 'Person hat bereits Buchungen. Archivieren oder die Buchungen einer anderen Person übertragen.');
  }
  db.exec('BEGIN');
  try {
    if (mergeInto) {
      const target = db.prepare('SELECT * FROM persons WHERE id = ?').get(mergeInto);
      if (!target || target.id === person.id) throw new HttpError(400, 'Ungültige Zielperson.');
      db.prepare('UPDATE movements SET person_id = ? WHERE person_id = ?').run(target.id, person.id);
      db.prepare('UPDATE kitchen_projects SET person_id = ? WHERE person_id = ?').run(target.id, person.id);
    }
    db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, moved: mergeInto ? used : 0 };
}, { auth: 'admin' });

// Anmeldung
const setupNeeded = () => activeAdmins() === 0;

route('GET', '/api/auth/status', (_p, _b, _qs, ctx) => ({
  setup: setupNeeded(),
  me: ctx.via === 'session' ? publicPerson(ctx.person) : null,
  // Kacheln auf der Anmeldeseite: bei der Ersteinrichtung alle aktiven Personen, sonst nur solche mit Passwort
  users: db.prepare(`SELECT id, name, color FROM persons WHERE archived = 0 AND status = 'active' ${setupNeeded() ? '' : 'AND password_hash IS NOT NULL'}
    ORDER BY name COLLATE NOCASE`).all(),
}), { auth: 'public' });

// Ersteinrichtung: ersten Admin festlegen {person_id | name, password}
route('POST', '/api/auth/setup', async (_p, body, _qs, ctx) => {
  if (!setupNeeded()) throw new HttpError(409, 'Die Einrichtung ist bereits abgeschlossen.');
  const hash = await hashPassword(checkNewPassword(body.password));
  let id;
  if (body.person_id) {
    const person = db.prepare('SELECT * FROM persons WHERE id = ? AND archived = 0').get(body.person_id);
    if (!person) throw new HttpError(404, 'Person nicht gefunden.');
    id = person.id;
    db.prepare("UPDATE persons SET role = 'admin', password_hash = ? WHERE id = ?").run(hash, id);
  } else {
    const name = personName(body.name);
    const count = db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;
    id = uniqueName(() => db.prepare("INSERT INTO persons (name, color, role, password_hash) VALUES (?, ?, 'admin', ?)")
      .run(name, COLORS[count % COLORS.length], hash)).lastInsertRowid;
  }
  ctx.cookies.push(sessionCookie(ctx.req, createSession(id)));
  return { me: publicPerson(db.prepare('SELECT * FROM persons WHERE id = ?').get(id)) };
}, { auth: 'public' });

// Anmelden per Kachel {person_id, password} (Lager) oder per E-Mail {email, password} (Küchenplaner) – dasselbe Konto
route('POST', '/api/auth/login', async (_p, body, _qs, ctx) => {
  const byEmail = typeof body.email === 'string';
  const email = byEmail ? body.email.trim().toLowerCase() : '';
  const key = `${clientIp(ctx.req)}|${byEmail ? email : body.person_id}`;
  loginThrottle(key);
  const person = byEmail
    ? db.prepare('SELECT * FROM persons WHERE email = ? AND archived = 0').get(email)
    : db.prepare('SELECT * FROM persons WHERE id = ? AND archived = 0').get(Number(body.person_id));
  if (!person || !(await verifyPassword(body.password, person.password_hash))) {
    loginFailed(key);
    throw new HttpError(401, byEmail ? 'E-Mail oder Passwort ist falsch.' : 'Passwort ist falsch.');
  }
  loginFails.delete(key);
  if (person.status !== 'active') throw new HttpError(403, 'Dein Konto wurde noch nicht von einem Admin freigegeben.');
  ctx.cookies.push(sessionCookie(ctx.req, createSession(person.id)));
  return { me: publicPerson(person) };
}, { auth: 'public' });

route('POST', '/api/auth/logout', (_p, _b, _qs, ctx) => {
  const token = readCookie(ctx.req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  ctx.cookies.push(sessionCookie(ctx.req, '', 0));
  return { ok: true };
}, { auth: 'public' });

// Eigenes Passwort ändern {current, password}; andere Anmeldungen werden beendet
route('POST', '/api/auth/password', async (_p, body, _qs, ctx) => {
  if (ctx.via !== 'session') throw new HttpError(403, 'Nur mit Anmeldung möglich.');
  if (!(await verifyPassword(body.current, ctx.person.password_hash))) throw new HttpError(400, 'Das aktuelle Passwort ist falsch.');
  const hash = await hashPassword(checkNewPassword(body.password));
  db.prepare('UPDATE persons SET password_hash = ? WHERE id = ?').run(hash, ctx.person.id);
  dropSessions(ctx.person.id, ctx.sessionHash);
  return { ok: true };
});

// ---------- Konto per E-Mail (Küchenplaner) ----------
// Selbst-Registrierung ist standardmäßig aus (Familien-App); Admins schalten sie unter „Benutzerverwaltung“ im
// Küchenplaner ein, optional mit Freigabepflicht. Das allererste Konto wird immer Admin.
const AUTH_SETTINGS = { registrationEnabled: 'auth_registration', requireApproval: 'auth_approval' };
function authSettings() {
  const get = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value === '1';
  return { registrationEnabled: get(AUTH_SETTINGS.registrationEnabled), requireApproval: get(AUTH_SETTINGS.requireApproval) };
}
function setAuthSetting(name, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(AUTH_SETTINGS[name], value ? '1' : '0');
}
// Konto in der Form, die das Küchenplaner-Frontend erwartet
const accountUser = (p) => p && {
  id: p.id, email: p.email ?? '', name: p.name, role: p.role, status: p.status, createdAt: p.created_at, color: p.color,
  canPlan: p.role === 'admin' || !!p.can_plan, prefs: readPrefs(p.prefs),
};
// Persönliche Einstellungen der App: Startseite, Ansicht im Haus, Darstellung
const PREFS = {
  start: ['overview', 'house'],
  houseView: ['2d', '3d'],
  theme: ['auto', 'light', 'dark'],
  fontSize: ['normal', 'large', 'xlarge'],
};
function readPrefs(raw) {
  let o = {};
  try { o = JSON.parse(raw || '{}') || {}; } catch { /* leer */ }
  const out = {};
  for (const [k, vals] of Object.entries(PREFS)) out[k] = vals.includes(o[k]) ? o[k] : vals[0];
  return out;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

route('GET', '/api/auth/me', (_p, _b, _qs, ctx) => {
  const st = authSettings();
  const first = setupNeeded();
  return {
    user: ctx.via === 'session' ? accountUser(ctx.person) : null,
    terminal: ctx.via === 'terminal' ? terminalPublic(ctx.terminal) : null,
    firstUser: first,
    registrationEnabled: first || st.registrationEnabled,
    requireApproval: !first && st.requireApproval,
  };
}, { auth: 'public' });

// Eigene Einstellungen ändern {start?, houseView?, theme?, fontSize?}
route('PATCH', '/api/auth/me/prefs', (_p, body, _qs, ctx) => {
  if (ctx.via !== 'session') throw new HttpError(403, 'Nur mit Anmeldung.');
  const prefs = readPrefs(ctx.person.prefs);
  for (const [k, vals] of Object.entries(PREFS)) {
    if (body[k] === undefined) continue;
    if (!vals.includes(body[k])) throw new HttpError(400, `Ungültiger Wert für ${k}.`);
    prefs[k] = body[k];
  }
  db.prepare('UPDATE persons SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), ctx.person.id);
  return prefs;
});

// ---------- Wandterminals ----------
// Einstellungen je Gerät: Ausrichtung, Ansicht, Darstellung, Rückkehr zum Haus, Ruhezustand, Ort fürs Wetter
const TERMINAL_SETTINGS = {
  orientation: ['portrait', 'landscape'],
  houseView: ['2d', '3d'],
  theme: ['auto', 'light', 'dark'],
  fontSize: ['normal', 'large', 'xlarge'],
  // Ruhezustand fotorealistisch: Entwurf (schnell), Normal, Hoch (lange Rechnung)
  renderQuality: ['normal', 'draft', 'high'],
};
function readTerminalSettings(raw) {
  let o = {};
  try { o = JSON.parse(raw || '{}') || {}; } catch { /* leer */ }
  const out = {};
  for (const [k, vals] of Object.entries(TERMINAL_SETTINGS)) out[k] = vals.includes(o[k]) ? o[k] : vals[0];
  out.idleMinutes = Math.max(1, Math.min(60, Math.round(Number(o.idleMinutes) || 2)));
  out.screensaver = o.screensaver !== false;
  out.plz = /^\d{4,5}$/.test(String(o.plz ?? '')) ? String(o.plz) : '';
  return out;
}
function mergeTerminalSettings(row, patch) {
  const cur = readTerminalSettings(row?.settings);
  const next = { ...cur };
  for (const [k, vals] of Object.entries(TERMINAL_SETTINGS)) {
    if (patch[k] === undefined) continue;
    if (!vals.includes(patch[k])) throw new HttpError(400, `Ungültiger Wert für ${k}.`);
    next[k] = patch[k];
  }
  if (patch.idleMinutes !== undefined) next.idleMinutes = patch.idleMinutes;
  if (patch.screensaver !== undefined) next.screensaver = !!patch.screensaver;
  if (patch.plz !== undefined) {
    const plz = String(patch.plz ?? '').trim();
    if (plz && !/^\d{4,5}$/.test(plz)) throw new HttpError(400, 'Postleitzahl bitte mit 4 oder 5 Ziffern.');
    next.plz = plz;
  }
  return readTerminalSettings(JSON.stringify(next));
}
const terminalPublic = (t) => t && { id: t.id, name: t.name, settings: readTerminalSettings(t.settings), created_at: t.created_at, last_seen_at: t.last_seen_at, paired: !!t.token_hash };
function terminalName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new HttpError(400, 'Bitte einen Namen angeben, z. B. „Diele“.');
  if (name.length > 40) throw new HttpError(400, 'Der Name ist zu lang.');
  return name;
}
/** neuen Einrichtungslink erzeugen (ersetzt den alten – ein damit eingerichtetes Gerät muss neu verbunden werden) */
function newTerminalToken(id) {
  const token = randomToken();
  db.prepare('UPDATE terminals SET token_hash = ? WHERE id = ?').run(sha256(token), id);
  return token;
}
route('GET', '/api/terminals', () => db.prepare('SELECT * FROM terminals ORDER BY name COLLATE NOCASE').all().map(terminalPublic), { auth: 'admin' });
route('POST', '/api/terminals', (_p, body) => {
  const name = terminalName(body.name);
  const settings = mergeTerminalSettings(null, body.settings ?? {});
  const { lastInsertRowid } = db.prepare('INSERT INTO terminals (name, settings) VALUES (?, ?)').run(name, JSON.stringify(settings));
  const token = newTerminalToken(lastInsertRowid);
  return { terminal: terminalPublic(db.prepare('SELECT * FROM terminals WHERE id = ?').get(lastInsertRowid)), path: `/terminal/${token}` };
}, { auth: 'admin' });
route('PATCH', '/api/terminals/:id', (p, body) => {
  const row = db.prepare('SELECT * FROM terminals WHERE id = ?').get(Number(p.id));
  if (!row) throw new HttpError(404, 'Terminal nicht gefunden.');
  const name = body.name !== undefined ? terminalName(body.name) : row.name;
  const settings = mergeTerminalSettings(row, body.settings ?? {});
  db.prepare('UPDATE terminals SET name = ?, settings = ? WHERE id = ?').run(name, JSON.stringify(settings), row.id);
  return terminalPublic(db.prepare('SELECT * FROM terminals WHERE id = ?').get(row.id));
}, { auth: 'admin' });
route('POST', '/api/terminals/:id/link', (p) => {
  const row = db.prepare('SELECT id FROM terminals WHERE id = ?').get(Number(p.id));
  if (!row) throw new HttpError(404, 'Terminal nicht gefunden.');
  return { path: `/terminal/${newTerminalToken(row.id)}` };
}, { auth: 'admin' });
route('DELETE', '/api/terminals/:id', (p) => {
  db.prepare('DELETE FROM terminals WHERE id = ?').run(Number(p.id));
  return { ok: true };
}, { auth: 'admin' });

// Wetter am Ort des Terminals (Ort: OpenStreetMap, Wetter: Open-Meteo – beides ohne Konto/Schlüssel) – für Licht und Anzeige im Ruhezustand
const weatherCache = new Map();
const geoCache = new Map();
const WEATHER_TEXT = [[0, 'klar'], [1, 'heiter'], [2, 'wolkig'], [3, 'bedeckt'], [45, 'Nebel'], [51, 'Niesel'], [61, 'Regen'], [66, 'Eisregen'], [71, 'Schnee'], [80, 'Schauer'], [85, 'Schneeschauer'], [95, 'Gewitter']];
const weatherText = (code) => [...WEATHER_TEXT].reverse().find(([c]) => code >= c)?.[1] ?? '';
/** Ort suchen (Adresse, Ort oder Postleitzahl) über OpenStreetMap/Nominatim – ohne Schlüssel */
async function geocode(q, { postal = false } = {}) {
  const key = `${postal ? 'p' : 'q'}:${q}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const url = postal
    ? `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(q)}&country=de&format=json&limit=1&addressdetails=1`
    : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1&accept-language=de`;
  const list = await fetch(url, { headers: { 'User-Agent': 'Zuhause-Heimserver (Lage des Hauses, Wetter)' }, signal: AbortSignal.timeout(8000) }).then((r) => r.json());
  const out = (Array.isArray(list) ? list : []).map((h) => {
    const a = h.address ?? {};
    return { name: a.city || a.town || a.village || a.suburb || h.name || q, label: h.display_name, lat: Number(h.lat), lon: Number(h.lon) };
  });
  geoCache.set(key, out);
  return out;
}
async function weatherAt(lat, lon, place) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return hit.data;
  const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,cloud_cover,is_day,precipitation&daily=sunrise,sunset&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
  const c = w?.current;
  if (!c) throw new HttpError(502, 'Wetterdienst nicht erreichbar.');
  const data = {
    place, temperature: Math.round(c.temperature_2m), code: c.weather_code, text: weatherText(c.weather_code), cloud: c.cloud_cover,
    precipitation: c.precipitation, is_day: !!c.is_day, sunrise: w.daily?.sunrise?.[0] ?? null, sunset: w.daily?.sunset?.[0] ?? null,
  };
  weatherCache.set(key, { at: Date.now(), data });
  return data;
}
// Wetter: an Koordinaten (Lage des Hauses) oder an der Postleitzahl des Terminals
route('GET', '/api/weather', async (_p, _b, qs, ctx) => {
  try {
    const lat = Number(qs.get('lat'));
    const lon = Number(qs.get('lon'));
    if (qs.get('lat') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return await weatherAt(lat, lon, String(qs.get('place') || '').slice(0, 60));
    }
    const plz = String(qs.get('plz') || (ctx.terminal ? readTerminalSettings(ctx.terminal.settings).plz : '') || '').trim();
    if (!/^\d{4,5}$/.test(plz)) throw new HttpError(400, 'Keine Lage des Hauses und keine Postleitzahl hinterlegt.');
    const g = (await geocode(plz, { postal: true }))[0];
    if (!g) throw new HttpError(404, `Zur Postleitzahl ${plz} wurde kein Ort gefunden.`);
    return await weatherAt(g.lat, g.lon, g.name);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Wetterdienst nicht erreichbar.');
  }
});
route('GET', '/api/geocode', async (_p, _b, qs) => {
  const q = String(qs.get('q') || '').trim().slice(0, 120);
  if (q.length < 3) throw new HttpError(400, 'Bitte mindestens 3 Zeichen eingeben.');
  try {
    return await geocode(q, { postal: /^\d{5}$/.test(q) });
  } catch {
    throw new HttpError(502, 'Ortssuche nicht erreichbar.');
  }
});

// Registrieren {email, name?, password}. Gibt es schon eine Person mit diesem Namen ohne E-Mail und Passwort
// (z. B. im Lager angelegt), wird sie übernommen statt doppelt angelegt.
route('POST', '/api/auth/register', async (_p, body, _qs, ctx) => {
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  const pw = String(body.password ?? '');
  if (pw.length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben.');
  const name = personName(String(body.name ?? '').trim() || email.split('@')[0]);
  const hash = await hashPassword(checkNewPassword(pw));
  db.exec('BEGIN IMMEDIATE');
  let id;
  try {
    const first = setupNeeded();
    const st = authSettings();
    if (!first && !st.registrationEnabled) throw new HttpError(403, 'Die Registrierung ist derzeit deaktiviert.');
    if (db.prepare('SELECT 1 FROM persons WHERE email = ?').get(email)) throw new HttpError(409, 'Diese E-Mail ist bereits registriert.');
    const role = first ? 'admin' : 'user';
    const status = !first && st.requireApproval ? 'pending' : 'active';
    const free = db.prepare('SELECT id FROM persons WHERE name = ? COLLATE NOCASE AND email IS NULL AND password_hash IS NULL').get(name);
    if (free) {
      id = free.id;
      db.prepare('UPDATE persons SET email = ?, password_hash = ?, role = ?, status = ?, archived = 0 WHERE id = ?').run(email, hash, role, status, id);
    } else {
      const count = db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;
      id = uniqueName(() => db.prepare('INSERT INTO persons (name, color, role, password_hash, email, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, COLORS[count % COLORS.length], role, hash, email, status)).lastInsertRowid;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  if (person.status !== 'active') {
    return { user: null, pending: true, message: 'Dein Konto wurde angelegt und muss noch von einem Admin freigegeben werden.' };
  }
  ctx.cookies.push(sessionCookie(ctx.req, createSession(person.id)));
  return { user: accountUser(person) };
}, { auth: 'public' });

// API-Schlüssel (nur Admins). Der Schlüssel selbst wird nur beim Anlegen einmal zurückgegeben.
const KEY_SELECT = `
  SELECT k.id, k.name, k.prefix, k.scope, k.created_at, k.expires_at, k.last_used_at,
         k.person_id, p.name AS person, p.color AS person_color, p.archived AS person_archived
  FROM api_keys k JOIN persons p ON p.id = k.person_id`;

route('GET', '/api/keys', () => db.prepare(`${KEY_SELECT} ORDER BY k.id DESC`).all(), { auth: 'admin' });
route('GET', '/api/keys/info', () => ({
  mcp_port: MCP_PORT || null,
  mcp_url: process.env.MCP_PUBLIC_URL ? `${process.env.MCP_PUBLIC_URL.replace(/\/+$/, '')}/mcp` : null,
}), { auth: 'admin' });

// {name, person_id, scope: 'read'|'write', expires_days?}
route('POST', '/api/keys', (_p, body) => {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Bitte einen Namen angeben (z. B. „Claude Handy“).');
  if (name.length > 60) throw new HttpError(400, 'Name ist zu lang.');
  const person = db.prepare('SELECT * FROM persons WHERE id = ? AND archived = 0').get(Number(body.person_id));
  if (!person) throw new HttpError(400, 'Bitte eine aktive Person auswählen.');
  const scope = body.scope === 'read' ? 'read' : 'write';
  const days = body.expires_days ? positiveInt(body.expires_days, 'Gültigkeit') : null;
  const key = `hlk_${randomToken(24)}`;
  const { lastInsertRowid } = db.prepare(`INSERT INTO api_keys (name, prefix, key_hash, person_id, scope, expires_at)
    VALUES (?, ?, ?, ?, ?, ${days ? `datetime('now', '+${days} days')` : 'NULL'})`)
    .run(name, key.slice(0, 10), sha256(key), person.id, scope);
  return { ...db.prepare(`${KEY_SELECT} WHERE k.id = ?`).get(lastInsertRowid), key };
}, { auth: 'admin' });

route('DELETE', '/api/keys/:id', (p) => {
  if (!db.prepare('DELETE FROM api_keys WHERE id = ?').run(Number(p.id)).changes) throw new HttpError(404, 'Schlüssel nicht gefunden.');
  return { ok: true };
}, { auth: 'admin' });

// Lager
const WAREHOUSE_SELECT = `
  SELECT w.*,
    (SELECT COUNT(*) FROM places pl WHERE pl.warehouse_id = w.id) AS places,
    (SELECT COUNT(*) FROM items i WHERE i.warehouse_id = w.id) AS items,
    (SELECT COALESCE(SUM(quantity), 0) FROM items i WHERE i.warehouse_id = w.id) AS quantity,
    (SELECT COUNT(*) FROM fixture_slots s WHERE s.warehouse_id = w.id) AS in_house
  FROM warehouses w`;

function warehouseFields(body, cur = { code: '', name: '', description: '' }) {
  const name = body.name !== undefined ? String(body.name).trim() : cur.name;
  if (!name) throw new HttpError(400, 'Name darf nicht leer sein.');
  if (name.length > 60) throw new HttpError(400, 'Name ist zu lang.');
  const code = body.code !== undefined ? String(body.code).trim().toUpperCase() : cur.code;
  if (!WH_CODE_RE.test(code)) throw new HttpError(400, 'Kürzel: 1–4 Zeichen, Buchstaben und Ziffern, beginnend mit einem Buchstaben.');
  const description = body.description !== undefined ? String(body.description).trim() : cur.description;
  return { name, code, description };
}
const uniqueCode = (fn) => {
  try { return fn(); } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Dieses Kürzel ist schon vergeben.');
    throw e;
  }
};

route('GET', '/api/warehouses', () => db.prepare(`${WAREHOUSE_SELECT} ORDER BY w.id`).all());

function createWarehouse(body) {
  const f = warehouseFields(body);
  const { lastInsertRowid } = uniqueCode(() =>
    db.prepare('INSERT INTO warehouses (code, name, description) VALUES (?, ?, ?)').run(f.code, f.name, f.description));
  return db.prepare(`${WAREHOUSE_SELECT} WHERE w.id = ?`).get(lastInsertRowid);
}
route('POST', '/api/warehouses', (_p, body) => createWarehouse(body), { auth: 'admin' });

route('PATCH', '/api/warehouses/:id', (p, body) => {
  const cur = getWarehouse(p.id);
  const f = warehouseFields(body, cur);
  uniqueCode(() => db.prepare('UPDATE warehouses SET code = ?, name = ?, description = ? WHERE id = ?').run(f.code, f.name, f.description, cur.id));
  return db.prepare(`${WAREHOUSE_SELECT} WHERE w.id = ?`).get(cur.id);
}, { auth: 'admin' });

// Nur leere Lager löschen; ihre (leeren) Plätze werden mitgelöscht
route('DELETE', '/api/warehouses/:id', (p) => {
  const w = getWarehouse(p.id);
  if (db.prepare('SELECT COUNT(*) AS n FROM warehouses').get().n <= 1) throw new HttpError(409, 'Das letzte Lager kann nicht gelöscht werden.');
  const n = db.prepare('SELECT COUNT(*) AS n FROM items WHERE warehouse_id = ?').get(w.id).n;
  if (n > 0) throw new HttpError(409, `Im Lager liegen noch ${n} Gegenstände. Bitte zuerst umlagern oder löschen.`);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM places WHERE warehouse_id = ?').run(w.id);
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(w.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { ok: true };
}, { auth: 'admin' });

// ---------- Haus (Etagen, Räume, Einbauten, Fächer) ----------
const FLOOR_KINDS = ['floor', 'attic', 'outdoor'];
const ROOM_KINDS = ['room', 'carport', 'terrace', 'parking', 'area'];
const FIXTURE_KINDS = ['shelf', 'cabinet', 'wall_cabinet', 'fridge', 'floor', 'stairs'];
const OPENING_KINDS = ['door', 'passage', 'window'];
const COORD = 200000; // ±200 m reichen für jedes Grundstück

function siteOf() {
  const floors = db.prepare('SELECT * FROM floors ORDER BY sort, elevation, id').all();
  const fixtures = db.prepare('SELECT * FROM fixtures ORDER BY id').all();
  const slots = db.prepare(`SELECT s.fixture_id, s.warehouse_id, w.code AS wh_code, s.col, s.row, s.level, s.pos
    FROM fixture_slots s JOIN warehouses w ON w.id = s.warehouse_id ORDER BY s.fixture_id, s.level, s.pos`).all();
  const images = new Map(db.prepare('SELECT floor_id, updated_at FROM floor_images').all().map((r) => [r.floor_id, r.updated_at]));
  const byFx = new Map();
  for (const f of fixtures) {
    const { floor_id: _f, ...rest } = f;
    byFx.set(f.id, { ...rest, floor_id: f.floor_id, slots: [] });
  }
  for (const s of slots) byFx.get(s.fixture_id)?.slots.push({ warehouse_id: s.warehouse_id, wh_code: s.wh_code, col: s.col, row: s.row, level: s.level, pos: s.pos });
  const updated = db.prepare("SELECT value FROM settings WHERE key = 'site_updated_at'").get();
  return {
    floors: floors.map((f) => ({
      id: f.id, name: f.name, kind: f.kind, elevation: f.elevation, height: f.height, slab: f.slab,
      outline: JSON.parse(f.outline), rooms: JSON.parse(f.rooms), openings: JSON.parse(f.openings),
      roof: f.roof ? JSON.parse(f.roof) : null, background: f.background ? JSON.parse(f.background) : null,
      image_at: images.get(f.id) || null,
      fixtures: [...byFx.values()].filter((x) => x.floor_id === f.id).map(({ floor_id: _f, ...x }) => x),
    })),
    updated_at: updated ? updated.value : null,
  };
}

// Ganzzahl (mm, Grad …) aus einem Bereich, sonst 400 mit verständlicher Meldung
function mmValue(v, label, min, max) {
  const n = Math.round(Number(v));
  if (v === null || v === '' || !Number.isFinite(Number(v)) || n < min || n > max) {
    throw new HttpError(400, `${label}: bitte eine Zahl von ${min} bis ${max} angeben.`);
  }
  return n;
}
function polygon(v, label, { min = 3, optional = false } = {}) {
  if ((v === undefined || v === null || (Array.isArray(v) && !v.length)) && optional) return [];
  if (!Array.isArray(v) || v.length < min || v.length > 200) throw new HttpError(400, `${label}: braucht ${min} bis 200 Eckpunkte.`);
  return v.map((pt, i) => {
    if (!Array.isArray(pt) || pt.length !== 2) throw new HttpError(400, `${label}: Eckpunkt ${i + 1} ist ungültig.`);
    return [mmValue(pt[0], `${label}, Eckpunkt ${i + 1} x`, -COORD, COORD), mmValue(pt[1], `${label}, Eckpunkt ${i + 1} y`, -COORD, COORD)];
  });
}
const angle = (v) => ((Math.round(Number(v) || 0) % 360) + 360) % 360;
const text = (v, max = 40) => String(v ?? '').trim().slice(0, max);

function siteFields(body) {
  const floors = Array.isArray(body.floors) ? body.floors : [];
  if (floors.length > 30) throw new HttpError(400, 'Zu viele Etagen.');
  const seen = new Map();
  const placeExists = db.prepare('SELECT 1 FROM places WHERE warehouse_id = ? AND col = ? AND row = ?');
  const warehouses = new Map(db.prepare('SELECT id, code FROM warehouses').all().map((w) => [w.id, w.code]));
  const codes = new Map([...warehouses].map(([id, code]) => [code, id]));
  return floors.map((fl, fi) => {
    const fname = text(fl.name) || `Etage ${fi + 1}`;
    const L = `„${fname}“`;
    if (!FLOOR_KINDS.includes(fl.kind ?? 'floor')) throw new HttpError(400, `${L}: unbekannte Art.`);
    const kind = fl.kind ?? 'floor';
    const f = {
      id: Number.isInteger(fl.id) ? fl.id : null, name: fname, kind, sort: fi,
      elevation: mmValue(fl.elevation ?? 0, `${L}: Höhenlage`, -20000, 50000),
      height: mmValue(fl.height ?? 2500, `${L}: Raumhöhe`, kind === 'outdoor' ? 0 : 1000, 10000),
      slab: mmValue(fl.slab ?? 200, `${L}: Deckenstärke`, 0, 1000),
      outline: polygon(fl.outline, `${L}: Umriss`, { optional: kind === 'outdoor' }),
    };
    f.rooms = (Array.isArray(fl.rooms) ? fl.rooms : []).map((r, i) => {
      const rl = `${L}, Raum ${text(r.name) || i + 1}`;
      if (!ROOM_KINDS.includes(r.kind ?? 'room')) throw new HttpError(400, `${rl}: unbekannte Art.`);
      const room = { name: text(r.name), kind: r.kind ?? 'room', polygon: polygon(r.polygon, rl) };
      if (r.height !== undefined && r.height !== null) room.height = mmValue(r.height, `${rl}: Höhe`, 0, 10000);
      return room;
    });
    if (f.rooms.length > 200) throw new HttpError(400, `${L}: zu viele Räume.`);
    f.openings = (Array.isArray(fl.openings) ? fl.openings : []).map((o, i) => {
      const ol = `${L}, Öffnung ${i + 1}`;
      if (!OPENING_KINDS.includes(o.kind)) throw new HttpError(400, `${ol}: Art muss Tür, Durchgang oder Fenster sein.`);
      const sill = o.kind !== 'window' ? 0 : mmValue(o.sill ?? 0, `${ol}: Brüstung`, 0, 10000);
      return {
        kind: o.kind, x: mmValue(o.x, `${ol}: x`, -COORD, COORD), y: mmValue(o.y, `${ol}: y`, -COORD, COORD),
        rotation: angle(o.rotation), width: mmValue(o.width, `${ol}: Breite`, 100, 20000),
        height: mmValue(o.height, `${ol}: Höhe`, 100, 10000), sill,
      };
    });
    if (f.openings.length > 300) throw new HttpError(400, `${L}: zu viele Öffnungen.`);
    if (fl.roof) {
      if (fl.roof.type !== 'gable') throw new HttpError(400, `${L}: unbekannte Dachform.`);
      f.roof = {
        type: 'gable', pitch: mmValue(fl.roof.pitch, `${L}: Dachneigung (°)`, 5, 75),
        knee: mmValue(fl.roof.knee ?? 0, `${L}: Kniestock`, 0, 5000), ridge: fl.roof.ridge === 'y' ? 'y' : 'x',
      };
    } else f.roof = null;
    if (fl.background) {
      const b = fl.background;
      f.background = {
        x: mmValue(b.x ?? 0, `${L}: Hintergrund x`, -COORD, COORD), y: mmValue(b.y ?? 0, `${L}: Hintergrund y`, -COORD, COORD),
        scale: Math.max(0.001, Math.min(10000, Number(b.scale) || 1)), rotation: angle(b.rotation),
        opacity: Math.max(0, Math.min(1, Number(b.opacity ?? 0.5))),
      };
    } else f.background = null;

    const fixtures = Array.isArray(fl.fixtures) ? fl.fixtures : [];
    if (fixtures.length > 500) throw new HttpError(400, `${L}: zu viele Einbauten.`);
    f.fixtures = fixtures.map((x, i) => {
      const name = text(x.name);
      const label = `${L}, ${name ? `„${name}“` : `Einbau ${i + 1}`}`;
      if (!FIXTURE_KINDS.includes(x.kind)) throw new HttpError(400, `${label}: unbekannte Art.`);
      const fx = {
        kind: x.kind, name,
        x: mmValue(x.x, `${label}: Position x`, -COORD, COORD), y: mmValue(x.y, `${label}: Position y`, -COORD, COORD),
        rotation: angle(x.rotation),
        width: mmValue(x.width, `${label}: Breite`, 50, 20000), depth: mmValue(x.depth, `${label}: Tiefe`, 50, 20000),
        height: mmValue(x.height, `${label}: Höhe`, 10, 10000), elevation: mmValue(x.elevation ?? 0, `${label}: Abstand zum Boden`, 0, 10000),
        levels: mmValue(x.levels ?? 1, `${label}: ${x.kind === 'stairs' ? 'Stufen' : 'Böden'}`, 1, 50),
        source: x.source ? text(x.source, 80) : null,
      };
      const slots = Array.isArray(x.slots) ? x.slots : [];
      if (x.kind === 'stairs' && slots.length) throw new HttpError(400, `${label}: Auf einer Treppe gibt es keine Fächer.`);
      fx.slots = slots.map((sl) => {
        const wid = sl.warehouse_id !== undefined ? Number(sl.warehouse_id) : codes.get(String(sl.wh_code || '').toUpperCase());
        if (!warehouses.has(wid)) throw new HttpError(400, `${label}: unbekanntes Lager.`);
        const loc = normalizeLocation(sl.col, sl.row);
        const key = `${warehouses.get(wid)}-${loc.col}${loc.row}`;
        if (seen.has(key)) throw new HttpError(400, `Platz ${key} ist zweimal zugeordnet (${seen.get(key)} und ${label}).`);
        seen.set(key, label);
        if (!placeExists.get(wid, loc.col, loc.row)) throw new HttpError(400, `Platz ${key} gibt es nicht.`);
        return {
          warehouse_id: wid, ...loc,
          level: mmValue(sl.level ?? 0, `${label}, Platz ${key}: Boden`, 0, fx.levels - 1),
          pos: mmValue(sl.pos ?? 0, `${label}, Platz ${key}: Position`, 0, 99),
        };
      });
      return fx;
    });
    return f;
  });
}

route('GET', '/api/site', () => siteOf());

// Speichert das ganze Haus auf einmal (Editor). Etagen behalten ihre IDs (Hintergrundbilder hängen daran);
// Einbauten werden neu angelegt. if_updated_at schützt davor, Änderungen von anderen zu überschreiben.
function saveSite(body) {
  const cur = db.prepare("SELECT value FROM settings WHERE key = 'site_updated_at'").get()?.value ?? null;
  if (body.if_updated_at !== undefined && cur !== body.if_updated_at) {
    throw new HttpError(409, 'Das Haus wurde inzwischen woanders geändert. Bitte neu laden.');
  }
  const floors = siteFields(body);
  const known = new Set(db.prepare('SELECT id FROM floors').all().map((r) => r.id));
  db.exec('BEGIN');
  try {
    const keep = [];
    const ins = db.prepare(`INSERT INTO floors (name, kind, sort, elevation, height, slab, outline, rooms, openings, roof, background)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const upd = db.prepare(`UPDATE floors SET name = ?, kind = ?, sort = ?, elevation = ?, height = ?, slab = ?, outline = ?, rooms = ?,
                            openings = ?, roof = ?, background = ? WHERE id = ?`);
    const insFx = db.prepare(`INSERT INTO fixtures (floor_id, kind, name, x, y, rotation, width, depth, height, elevation, levels, source)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insSlot = db.prepare('INSERT INTO fixture_slots (warehouse_id, col, row, fixture_id, level, pos) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('DELETE FROM fixtures'); // Fach-Zuordnungen fallen mit weg
    for (const f of floors) {
      const vals = [f.name, f.kind, f.sort, f.elevation, f.height, f.slab, JSON.stringify(f.outline), JSON.stringify(f.rooms),
        JSON.stringify(f.openings), f.roof ? JSON.stringify(f.roof) : null, f.background ? JSON.stringify(f.background) : null];
      let id = f.id;
      if (id && known.has(id)) upd.run(...vals, id);
      else id = Number(ins.run(...vals).lastInsertRowid);
      keep.push(id);
      for (const fx of f.fixtures) {
        const fxId = insFx.run(id, fx.kind, fx.name, fx.x, fx.y, fx.rotation, fx.width, fx.depth, fx.height, fx.elevation, fx.levels, fx.source).lastInsertRowid;
        for (const sl of fx.slots) insSlot.run(sl.warehouse_id, sl.col, sl.row, fxId, sl.level, sl.pos);
      }
    }
    const gone = [...known].filter((id) => !keep.includes(id));
    for (const id of gone) db.prepare('DELETE FROM floors WHERE id = ?').run(id);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('site_updated_at', strftime('%Y-%m-%d %H:%M:%f', 'now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return siteOf();
}
route('PUT', '/api/site', (_p, body) => saveSite(body), { auth: 'admin' });

// Plätze aller Lager, die im Haus liegen, mit Belegung und Inhalt (für die 3D-Ansicht)
route('GET', '/api/site/places', () => {
  const places = db.prepare(`${PLACE_SELECT} JOIN fixture_slots s ON s.warehouse_id = pl.warehouse_id AND s.col = pl.col AND s.row = pl.row`).all();
  // Gegenstände für die Kisten in den Fächern (Inhalt von Behältern steckt im Behälter: parent_id)
  const items = db.prepare(`SELECT i.id, i.warehouse_id, i.col, i.row, i.name, i.quantity, i.consumable, i.container, i.parent_id,
      CAST(julianday(i.expires_on) - julianday('now', 'localtime', 'start of day') AS INTEGER) AS expires_in,
      (SELECT COUNT(*) FROM items c WHERE c.parent_id = i.id) AS contents,
      (SELECT updated_at FROM item_photos ph WHERE ph.item_id = i.id) AS photo_at
    FROM items i JOIN fixture_slots s ON s.warehouse_id = i.warehouse_id AND s.col = i.col AND s.row = i.row
    ORDER BY i.name COLLATE NOCASE`).all();
  return { places, items };
});

// Auswertung im Haus: je Platz Buchungen der letzten 90 Tage und wann die dort liegenden Gegenstände zuletzt bewegt wurden
route('GET', '/api/site/stats', () => {
  const moves = db.prepare(`SELECT m.warehouse_id, m.col, m.row, COUNT(*) AS n FROM movements m
    JOIN fixture_slots s ON s.warehouse_id = m.warehouse_id AND s.col = m.col AND s.row = m.row
    WHERE m.created_at >= datetime('now', '-90 days') GROUP BY m.warehouse_id, m.col, m.row`).all();
  const touched = db.prepare(`SELECT i.warehouse_id, i.col, i.row, MAX(m.created_at) AS last_at FROM items i
    JOIN fixture_slots s ON s.warehouse_id = i.warehouse_id AND s.col = i.col AND s.row = i.row
    JOIN movements m ON m.item_id = i.id GROUP BY i.warehouse_id, i.col, i.row`).all();
  const code = new Map(db.prepare('SELECT id, code FROM warehouses').all().map((w) => [w.id, w.code]));
  const out = {};
  const at = (r) => (out[`${code.get(r.warehouse_id)}-${r.col}${r.row}`] ||= { moves_90: 0, last_at: null });
  for (const r of moves) at(r).moves_90 = r.n;
  for (const r of touched) at(r).last_at = r.last_at;
  return out;
});

// Hintergrundbild einer Etage (Grundriss zum Nachzeichnen), als Base64 im JSON: {image: "data:image/png;base64,…"}
function floorImage(b64) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  let type = null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) type = 'image/jpeg';
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) type = 'image/png';
  else if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') type = 'image/webp';
  if (!type) throw new HttpError(400, 'Hintergrund: nur PNG, JPEG oder WebP.');
  if (buf.length > 15 * 1024 * 1024) throw new HttpError(413, 'Hintergrundbild ist zu groß (max. 15 MB).');
  return { type, buf };
}
const getFloor = (id) => {
  const f = db.prepare('SELECT id FROM floors WHERE id = ?').get(Number(id));
  if (!f) throw new HttpError(404, 'Etage nicht gefunden.');
  return f;
};
route('PUT', '/api/floors/:id/image', (p, body) => {
  const f = getFloor(p.id);
  const { type, buf } = floorImage(body.image);
  db.prepare(`INSERT INTO floor_images (floor_id, type, data, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(floor_id) DO UPDATE SET type = excluded.type, data = excluded.data, updated_at = excluded.updated_at`).run(f.id, type, buf);
  return { ok: true, image_at: db.prepare('SELECT updated_at FROM floor_images WHERE floor_id = ?').get(f.id).updated_at };
}, { auth: 'admin' });
route('GET', '/api/floors/:id/image', (p, _b, qs) => {
  const row = db.prepare('SELECT type, data FROM floor_images WHERE floor_id = ?').get(Number(p.id));
  if (!row) throw new HttpError(404, 'Kein Hintergrundbild.');
  return { [SEND_DATA]: Buffer.from(row.data), type: row.type, cache: qs.get('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache' };
});
route('DELETE', '/api/floors/:id/image', (p) => {
  db.prepare('DELETE FROM floor_images WHERE floor_id = ?').run(getFloor(p.id).id);
  return { ok: true };
}, { auth: 'admin' });

// Lagerplätze (jeweils ?wh=<Lager-ID>)
route('GET', '/api/places', (_p, _b, qs) => db.prepare(`${PLACE_SELECT} WHERE pl.warehouse_id = ? ORDER BY LENGTH(pl.col), pl.col, pl.row`).all(whFrom(qs.get('wh')).id));

route('GET', '/api/places/:col/:row', (p, _b, qs) => {
  const w = whFrom(qs.get('wh'));
  const loc = normalizeLocation(p.col, p.row);
  const place = getPlace(w.id, loc.col, loc.row);
  if (!place) throw new HttpError(404, 'Lagerplatz nicht angelegt.');
  const inRoom = !!db.prepare('SELECT 1 FROM fixture_slots WHERE warehouse_id = ? AND col = ? AND row = ?').get(w.id, loc.col, loc.row);
  return { ...place, in_room: inRoom, items: placeItems(w.id, loc.col, loc.row) };
});

function savePlace(wid, col, row, body) {
  const w = getWarehouse(wid);
  const loc = normalizeLocation(col, row);
  const cur = getPlace(w.id, loc.col, loc.row) || { name: '', category: '', description: '' };
  const name = body.name !== undefined ? String(body.name).trim() : cur.name;
  const category = body.category !== undefined ? String(body.category).trim() : cur.category;
  const description = body.description !== undefined ? String(body.description).trim() : cur.description;
  db.prepare(`INSERT INTO places (warehouse_id, col, row, name, category, description) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(warehouse_id, col, row) DO UPDATE SET name = excluded.name, category = excluded.category, description = excluded.description`)
    .run(w.id, loc.col, loc.row, name, category, description);
  return getPlace(w.id, loc.col, loc.row);
}
route('PUT', '/api/places/:col/:row', (p, body, qs) => savePlace(whFrom(qs.get('wh')).id, p.col, p.row, body));

// Bereich anlegen, z. B. Spalten A–C, Zeilen 0–9
route('POST', '/api/places/bulk', (_p, body, qs) => {
  const w = whFrom(body.warehouse_id ?? qs.get('wh'));
  const from = normalizeLocation(body.col_from, body.row_from);
  const to = normalizeLocation(body.col_to ?? body.col_from, body.row_to ?? body.row_from);
  const c1 = colToNum(from.col), c2 = colToNum(to.col);
  if (c2 < c1 || to.row < from.row) throw new HttpError(400, 'Bereich ist verkehrt herum angegeben.');
  const total = (c2 - c1 + 1) * (to.row - from.row + 1);
  if (total > 2600) throw new HttpError(400, `Das wären ${total} Plätze – bitte einen kleineren Bereich wählen.`);
  const category = String(body.category || '').trim();
  const stmt = db.prepare('INSERT OR IGNORE INTO places (warehouse_id, col, row, category) VALUES (?, ?, ?, ?)');
  let created = 0;
  const places = [];
  db.prepare('BEGIN').run();
  try {
    for (let c = c1; c <= c2; c++) {
      for (let r = from.row; r <= to.row; r++) {
        created += stmt.run(w.id, numToCol(c), r, category).changes;
        places.push({ warehouse_id: w.id, col: numToCol(c), row: r });
      }
    }
    db.prepare('COMMIT').run();
  } catch (e) { db.prepare('ROLLBACK').run(); throw e; }
  return { created, total, places };
});

// Nur leere Plätze; liefert den gelöschten Platz (Name, Kategorie …)
function deletePlace(wid, col, row) {
  const loc = normalizeLocation(col, row);
  const pl = db.prepare(`${PLACE_SELECT} WHERE pl.warehouse_id = ? AND pl.col = ? AND pl.row = ?`).get(wid, loc.col, loc.row);
  if (!pl) throw new HttpError(404, `Lagerplatz ${loc.col}${loc.row} gibt es nicht.`);
  if (pl.items > 0) throw new HttpError(409, 'Auf dem Platz liegen noch Gegenstände.');
  db.prepare('DELETE FROM places WHERE warehouse_id = ? AND col = ? AND row = ?').run(wid, loc.col, loc.row);
  return pl;
}
route('DELETE', '/api/places/:col/:row', (p, _b, qs) => {
  deletePlace(whFrom(qs.get('wh')).id, p.col, p.row);
  return { ok: true };
});

// Code auflösen (Scan)
function resolveCode(raw) {
  const parsed = parseCode(raw);
  if (!parsed) return { type: 'invalid' };
  if (parsed.type === 'place') {
    // alte Etiketten ohne Kürzel gehören zum ersten Lager (ID 1)
    const w = parsed.wh
      ? db.prepare('SELECT * FROM warehouses WHERE code = ?').get(parsed.wh)
      : db.prepare('SELECT * FROM warehouses WHERE id = 1').get();
    if (!w) return { type: 'invalid', reason: parsed.wh ? `Lager „${parsed.wh}“ gibt es nicht.` : 'Lager nicht gefunden.' };
    ensurePlace(w.id, parsed.col, parsed.row);
    return { type: 'place', place: { ...getPlace(w.id, parsed.col, parsed.row), items: placeItems(w.id, parsed.col, parsed.row) } };
  }
  const item = getItemByCode(parsed.code);
  return item ? { type: 'item', item } : { type: 'unknown', code: parsed.code };
}
route('GET', '/api/resolve', (_p, _b, query) => resolveCode(query.get('code')));

route('GET', '/api/codes/new', (_p, _b, query) => {
  const n = Math.min(200, Math.max(1, Number(query.get('n')) || 1));
  const codes = new Set();
  while (codes.size < n) codes.add(newCode());
  return [...codes];
});

// Gegenstände
route('GET', '/api/items', (_p, _b, query) =>
  searchItems(query.get('q'), Number(query.get('limit')) || 100, query.get('wh') ? getWarehouse(query.get('wh')).id : null));

function itemWithHistory(id, limit = 50) {
  const item = getItem(id);
  const history = db.prepare(`
    SELECT m.id, m.type, m.quantity, m.warehouse_id, w.code AS wh_code, m.col, m.row, m.created_at,
           m.person_id, p.name AS person, p.color AS person_color, m.parent_id, par.name AS parent_name, m.source
    FROM movements m JOIN persons p ON p.id = m.person_id LEFT JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN items par ON par.id = m.parent_id
    WHERE m.item_id = ? ORDER BY m.id DESC LIMIT ?`).all(item.id, limit);
  return { ...item, history, items: item.container ? containerContents(item.id) : [] };
}
route('GET', '/api/items/:id', (p) => itemWithHistory(p.id));

// Abgelaufen oder läuft in den nächsten ?days= Tagen ab (Standard 30), nur was noch da ist
function expiringItems(days = 30, wid = null) {
  const d = Math.min(3650, Math.max(0, Math.round(Number(days)) || 0));
  return db.prepare(`${ITEM_SELECT} WHERE i.expires_on IS NOT NULL AND i.quantity > 0
    AND i.expires_on <= date('now', 'localtime', '+${d} days') ${wid ? 'AND i.warehouse_id = ?' : ''}
    ORDER BY i.expires_on, i.name LIMIT 500`).all(...(wid ? [wid] : []));
}
route('GET', '/api/expiring', (_p, _b, qs) =>
  expiringItems(qs.get('days') ?? 30, qs.get('wh') ? getWarehouse(qs.get('wh')).id : null));

// alle Behälter (für die Auswahl „liegt in …“)
route('GET', '/api/containers', () => db.prepare(`${ITEM_SELECT} WHERE i.container = 1 ORDER BY i.name COLLATE NOCASE`).all());

// Einbuchen: neuer Gegenstand oder Zugang zu vorhandenem Gegenstand
function checkin(person, body) {
  const quantity = positiveInt(body.quantity ?? 1, 'Menge');
  let itemId;
  let movementId;
  let existing = null;
  let created = false;
  if (body.item_id) existing = getItem(body.item_id);
  else if (body.code && getItemByCode(body.code)) existing = getItemByCode(body.code);

  db.prepare('BEGIN').run();
  try {
    if (existing) {
      // Lagerplatz (und Lager) oder Behälter optional ändern (z. B. beim Zurücklegen an neuen Ort)
      const loc = body.col ? normalizeLocation(body.col, body.row) : { col: existing.col, row: existing.row };
      const wid = body.warehouse_id ? getWarehouse(body.warehouse_id).id : existing.warehouse_id;
      const to = placement(body, existing, wid, loc);
      ensurePlace(to.wid, to.col, to.row);
      // neue Packung: Haltbarkeitsdatum optional mit ändern
      const expires = body.expires_on !== undefined ? expiryDate(body.expires_on) : existing.expires_on;
      db.prepare('UPDATE items SET quantity = quantity + ?, warehouse_id = ?, col = ?, row = ?, parent_id = ?, expires_on = ? WHERE id = ?')
        .run(quantity, to.wid, to.col, to.row, to.parentId, expires, existing.id);
      syncContents(existing.id);
      itemId = existing.id;
    } else {
      const name = String(body.name || '').trim();
      if (!name) throw new HttpError(400, 'Bezeichnung darf nicht leer sein.');
      const to = body.container_id
        ? placement(body, null)
        : placement(body, null, whFrom(body.warehouse_id).id, normalizeLocation(body.col, body.row));
      ensurePlace(to.wid, to.col, to.row);
      const description = String(body.description || '').trim();
      let code = String(body.code || '').trim().toUpperCase();
      if (code && !CODE_RE.test(code)) throw new HttpError(400, 'Ungültiger Objekt-Code.');
      if (!code) code = newCode();
      const { lastInsertRowid } = db.prepare(`INSERT INTO items (code, name, description, warehouse_id, col, row, quantity, consumable, container, parent_id, expires_on)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(code, name, description, to.wid, to.col, to.row, quantity, body.consumable ? 1 : 0, body.container ? 1 : 0, to.parentId, expiryDate(body.expires_on));
      itemId = lastInsertRowid;
      created = true;
    }
    const item = getItem(itemId);
    const moved = existing && (existing.warehouse_id !== item.warehouse_id || existing.col !== item.col || existing.row !== item.row
      || existing.parent_id !== item.parent_id);
    movementId = db.prepare(`INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row, parent_id,
        prev_warehouse_id, prev_col, prev_row, prev_parent_id, created_item, source) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(itemId, person.id, quantity, item.warehouse_id, item.col, item.row, item.parent_id,
        moved ? existing.warehouse_id : null, moved ? existing.col : null, moved ? existing.row : null, moved ? existing.parent_id : null,
        created ? 1 : 0, sourceOf(body)).lastInsertRowid;
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { ...getItem(itemId), movement_id: movementId };
}

// Ausbuchen: Menge entnehmen
function checkout(person, body) {
  const quantity = positiveInt(body.quantity ?? 1, 'Menge');
  const item = body.item_id ? getItem(body.item_id) : getItemByCode(body.code);
  if (!item) throw new HttpError(404, 'Gegenstand nicht gefunden.');
  if (item.quantity < quantity) throw new HttpError(400, `Nur ${item.quantity} Stück im Lager.`);
  let movementId;
  db.prepare('BEGIN').run();
  try {
    db.prepare('UPDATE items SET quantity = quantity - ? WHERE id = ?').run(quantity, item.id);
    // Verbrauchsmaterial ist nach dem Ausbuchen weg → nachkaufen
    const shoppingId = item.consumable ? addToShopping({ itemId: item.id, name: item.name, quantity, personId: person.id }) : null;
    movementId = db.prepare(`INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row, parent_id, shopping_id, shopping_qty, source)
        VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, person.id, quantity, item.warehouse_id, item.col, item.row, item.parent_id, shoppingId, shoppingId ? quantity : 0, sourceOf(body)).lastInsertRowid;
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { ...getItem(item.id), shopping_added: item.consumable ? quantity : 0, movement_id: movementId };
}

// Buchung rückgängig machen – nur die jeweils letzte Buchung eines Gegenstands (sonst stimmen die Bestände nicht mehr),
// nur eigene Buchungen (Admins mit Sitzung: alle)
function undoMovement(ctx, id) {
  const mv = db.prepare('SELECT m.*, p.name AS person FROM movements m JOIN persons p ON p.id = m.person_id WHERE m.id = ?').get(Number(id));
  if (!mv) throw new HttpError(404, 'Buchung nicht gefunden (vielleicht schon rückgängig gemacht).');
  const admin = ctx.via === 'session' && ctx.person.role === 'admin';
  if (mv.person_id !== ctx.person.id && !admin) throw new HttpError(403, `Das ist eine Buchung von ${mv.person} – nur eigene Buchungen können rückgängig gemacht werden.`);
  if (db.prepare('SELECT MAX(id) AS id FROM movements WHERE item_id = ?').get(mv.item_id).id !== mv.id) {
    throw new HttpError(409, 'Nur die letzte Buchung eines Gegenstands kann rückgängig gemacht werden.');
  }
  const item = getItem(mv.item_id);
  let message;
  let deleted = false;
  db.prepare('BEGIN').run();
  try {
    if (mv.type === 'out') {
      db.prepare('UPDATE items SET quantity = quantity + ? WHERE id = ?').run(mv.quantity, item.id);
      // was dabei auf die Einkaufsliste kam, wieder herunternehmen
      const entry = mv.shopping_id && db.prepare('SELECT * FROM shopping WHERE id = ? AND done_at IS NULL').get(mv.shopping_id);
      if (entry && mv.shopping_qty) {
        if (entry.quantity > mv.shopping_qty) db.prepare('UPDATE shopping SET quantity = quantity - ? WHERE id = ?').run(mv.shopping_qty, entry.id);
        else db.prepare('DELETE FROM shopping WHERE id = ?').run(entry.id);
      }
      message = `Ausbuchung rückgängig: ${mv.quantity}× ${item.name} wieder im Lager (jetzt ${item.quantity + mv.quantity} Stück).`;
    } else if (mv.created_item) {
      // die Buchung hat den Gegenstand angelegt → Gegenstand wieder entfernen (kam er von der Einkaufsliste: Eintrag wieder öffnen)
      db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
      if (mv.shopping_id) db.prepare('UPDATE shopping SET done_at = NULL WHERE id = ?').run(mv.shopping_id);
      deleted = true;
      message = `Neuanlage rückgängig: ${item.name} wurde wieder entfernt.`;
    } else {
      if (item.quantity < mv.quantity) {
        throw new HttpError(409, `Es sind nur noch ${item.quantity} Stück da – die Einbuchung von ${mv.quantity} Stück kann nicht mehr zurückgenommen werden.`);
      }
      db.prepare('UPDATE items SET quantity = quantity - ? WHERE id = ?').run(mv.quantity, item.id);
      if (mv.prev_col) {
        // zurück an den vorherigen Platz bzw. in den vorherigen Behälter (falls es ihn noch gibt)
        let box = null;
        if (mv.prev_parent_id) try { box = getContainer(mv.prev_parent_id, item.id); } catch { /* weg oder liegt inzwischen darin */ }
        const to = box || { id: null, warehouse_id: mv.prev_warehouse_id, col: mv.prev_col, row: mv.prev_row };
        ensurePlace(to.warehouse_id, to.col, to.row);
        db.prepare('UPDATE items SET warehouse_id = ?, col = ?, row = ?, parent_id = ? WHERE id = ?').run(to.warehouse_id, to.col, to.row, to.id, item.id);
        syncContents(item.id);
      }
      // „gekauft + eingebucht“ → Eintrag wieder auf die Einkaufsliste
      if (mv.shopping_id && !db.prepare('SELECT 1 FROM shopping WHERE item_id = ? AND done_at IS NULL').get(item.id)) {
        db.prepare('UPDATE shopping SET done_at = NULL WHERE id = ?').run(mv.shopping_id);
      }
      message = `Einbuchung rückgängig: ${mv.quantity}× ${item.name} zurückgenommen (jetzt ${item.quantity - mv.quantity} Stück).`;
    }
    db.prepare('DELETE FROM movements WHERE id = ?').run(mv.id);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { ok: true, message, item: deleted ? null : getItem(item.id), deleted_item: deleted };
}

route('POST', '/api/movements/:id/undo', (p, _b, _qs, ctx) => undoMovement(ctx, p.id));
// Wiederholte Buchungen (App bucht nach schlechtem WLAN nach, die erste Antwort ging evtl. verloren) erkennt der Server
// an request_id und liefert das frühere Ergebnis, statt doppelt zu buchen. Gemerkt werden die letzten 24 Stunden.
const doneRequests = new Map();
function once(ctx, body, fn) {
  const rid = typeof body?.request_id === 'string' ? body.request_id.slice(0, 80) : '';
  if (!rid) return fn();
  const key = `${ctx.person.id}:${rid}`;
  const now = Date.now();
  for (const [k, v] of doneRequests) if (now - v.at > 864e5) doneRequests.delete(k); else break;
  const hit = doneRequests.get(key);
  if (hit) return { ...hit.result, repeated: true };
  const result = fn();
  doneRequests.set(key, { at: now, result });
  return result;
}
route('POST', '/api/checkin', (_p, body, _qs, ctx) => once(ctx, body, () => checkin(ctx.person, body)));
route('POST', '/api/checkout', (_p, body, _qs, ctx) => once(ctx, body, () => checkout(ctx.person, body)));

// Stammdaten ändern (Name, Beschreibung, Lagerplatz)
function updateItem(id, body) {
  const item = getItem(id);
  const name = body.name !== undefined ? String(body.name).trim() : item.name;
  if (!name) throw new HttpError(400, 'Bezeichnung darf nicht leer sein.');
  const description = body.description !== undefined ? String(body.description).trim() : item.description;
  const loc = body.col !== undefined || body.row !== undefined
    ? normalizeLocation(body.col ?? item.col, body.row ?? item.row)
    : { col: item.col, row: item.row };
  const wid = body.warehouse_id ? getWarehouse(body.warehouse_id).id : item.warehouse_id;
  const consumable = body.consumable !== undefined ? (body.consumable ? 1 : 0) : item.consumable;
  const container = body.container !== undefined ? (body.container ? 1 : 0) : item.container;
  const expires = body.expires_on !== undefined ? expiryDate(body.expires_on) : item.expires_on;
  if (!container && item.contents) throw new HttpError(409, `In ${item.name} liegen noch ${item.contents} Gegenstände – bitte zuerst herausnehmen.`);
  db.prepare('BEGIN').run();
  try {
    const to = placement(body, item, wid, loc);
    ensurePlace(to.wid, to.col, to.row);
    db.prepare('UPDATE items SET name = ?, description = ?, warehouse_id = ?, col = ?, row = ?, parent_id = ?, consumable = ?, container = ?, expires_on = ? WHERE id = ?')
      .run(name, description, to.wid, to.col, to.row, to.parentId, consumable, container, expires, item.id);
    syncContents(item.id);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return getItem(item.id);
}
route('PATCH', '/api/items/:id', (p, body) => updateItem(p.id, body));

route('DELETE', '/api/items/:id', (p) => {
  getItem(p.id);
  db.prepare('DELETE FROM items WHERE id = ?').run(p.id);
  return { ok: true };
});

// Einkaufsliste
const shoppingOpen = () => db.prepare(`${SHOPPING_SELECT} WHERE s.done_at IS NULL ORDER BY COALESCE(i.name, s.name) COLLATE NOCASE`).all();
route('GET', '/api/shopping', () => ({
  open: shoppingOpen(),
  done: db.prepare(`${SHOPPING_SELECT} WHERE s.done_at IS NOT NULL ORDER BY s.done_at DESC LIMIT 20`).all(),
}));

// Neu: {item_id} oder {name}, dazu quantity, note
function shoppingAdd(person, body) {
  const quantity = positiveInt(body.quantity ?? 1, 'Menge');
  const note = String(body.note || '').trim().slice(0, 200);
  const personId = person.id;
  let id;
  if (body.item_id) {
    const item = getItem(body.item_id);
    id = addToShopping({ itemId: item.id, name: item.name, quantity, note, personId });
  } else {
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Was soll gekauft werden?');
    if (name.length > 100) throw new HttpError(400, 'Bezeichnung ist zu lang.');
    // gleichnamigen Gegenstand automatisch verknüpfen, damit „Gekauft“ direkt einbuchen kann
    const item = db.prepare('SELECT id FROM items WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(name);
    id = addToShopping({ itemId: item?.id ?? null, name, quantity, note, personId });
  }
  return getShopping(id);
}
route('POST', '/api/shopping', (_p, body, _qs, ctx) => shoppingAdd(ctx.person, body));

// Ändern: {quantity?, note?, done?}
function shoppingUpdate(id, body) {
  const cur = getShopping(id);
  const quantity = body.quantity !== undefined ? positiveInt(body.quantity, 'Menge') : cur.quantity;
  const note = body.note !== undefined ? String(body.note).trim().slice(0, 200) : cur.note;
  let doneAt = cur.done_at;
  if (body.done !== undefined) doneAt = body.done ? (cur.done_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
  if (!doneAt && cur.done_at && cur.item_id && db.prepare('SELECT 1 FROM shopping WHERE item_id = ? AND done_at IS NULL AND id != ?').get(cur.item_id, cur.id)) {
    throw new HttpError(409, 'Der Gegenstand steht schon auf der Liste.');
  }
  db.prepare('UPDATE shopping SET quantity = ?, note = ?, done_at = ? WHERE id = ?').run(quantity, note, doneAt, cur.id);
  return getShopping(cur.id);
}
route('PATCH', '/api/shopping/:id', (p, body) => shoppingUpdate(p.id, body));

// Gekauft und gleich wieder einbuchen: {quantity?}
function shoppingRestock(person, id, body = {}) {
  const entry = getShopping(id);
  if (!entry.item_id) throw new HttpError(400, 'Dieser Eintrag ist mit keinem Gegenstand verknüpft.');
  const quantity = positiveInt(body.quantity ?? entry.quantity, 'Menge');
  const item = getItem(entry.item_id);
  let movementId;
  db.prepare('BEGIN').run();
  try {
    // neue Packung: Haltbarkeitsdatum wie beim Einbuchen optional mit ändern
    const expires = body.expires_on !== undefined ? expiryDate(body.expires_on) : item.expires_on;
    db.prepare('UPDATE items SET quantity = quantity + ?, expires_on = ? WHERE id = ?').run(quantity, expires, item.id);
    movementId = db.prepare(`INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row, shopping_id, source)
        VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?)`)
      .run(item.id, person.id, quantity, item.warehouse_id, item.col, item.row, entry.id, sourceOf(body)).lastInsertRowid;
    db.prepare("UPDATE shopping SET done_at = datetime('now') WHERE id = ?").run(entry.id);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { entry: getShopping(entry.id), item: getItem(item.id), movement_id: movementId };
}
// Gekauft und einlagern – auch für freie Einträge (dann mit Platz/Behälter: neuer Gegenstand, standardmäßig Verbrauchsmaterial).
// body: {quantity?, warehouse_id?, col?, row?, container_id?, expires_on?, consumable?, name?, description?, source?}
function shoppingStore(person, id, body = {}) {
  const entry = getShopping(id);
  const target = body.col || body.container_id;
  if (entry.item_id && !target) return { ...shoppingRestock(person, id, body), created: false };
  if (!entry.item_id && !target) {
    throw new HttpError(400, `${entry.name} ist noch kein Gegenstand im Lager – zum Einlagern bitte einen Lagerplatz oder Behälter angeben, dann wird er neu angelegt.`);
  }
  const quantity = positiveInt(body.quantity ?? entry.quantity, 'Menge');
  const place = body.container_id ? { container_id: body.container_id } : { warehouse_id: body.warehouse_id, col: body.col, row: body.row };
  const res = checkin(person, entry.item_id
    ? { item_id: entry.item_id, quantity, ...place, expires_on: body.expires_on, source: body.source }
    : { name: String(body.name || '').trim() || entry.name, description: body.description ?? entry.note, quantity, ...place, expires_on: body.expires_on,
      consumable: body.consumable ?? true, source: body.source });
  db.prepare("UPDATE shopping SET item_id = ?, done_at = COALESCE(done_at, datetime('now')) WHERE id = ?").run(res.id, entry.id);
  db.prepare('UPDATE movements SET shopping_id = ? WHERE id = ?').run(entry.id, res.movement_id);
  return { entry: getShopping(entry.id), item: getItem(res.id), movement_id: res.movement_id, created: !entry.item_id };
}
route('POST', '/api/shopping/:id/restock', (p, body, _qs, ctx) => shoppingStore(ctx.person, p.id, body));

route('DELETE', '/api/shopping/:id', (p) => {
  getShopping(p.id);
  db.prepare('DELETE FROM shopping WHERE id = ?').run(p.id);
  return { ok: true };
});

// Erledigte Einträge aufräumen
route('DELETE', '/api/shopping', (_p, _b, qs) => {
  if (qs.get('done') !== '1') throw new HttpError(400, 'Nur erledigte Einträge können gesammelt gelöscht werden (?done=1).');
  return { deleted: db.prepare('DELETE FROM shopping WHERE done_at IS NOT NULL').run().changes };
});

// Übersicht: belegte Lagerplätze
function recentMovements(wid = null, limit = 30) {
  return db.prepare(`
    SELECT m.id, m.type, m.quantity, m.warehouse_id, w.code AS wh_code, w.name AS wh_name, m.col, m.row, m.created_at,
           m.person_id, p.name AS person, p.color AS person_color, i.name AS item, i.id AS item_id, m.source
    FROM movements m JOIN persons p ON p.id = m.person_id JOIN items i ON i.id = m.item_id
    LEFT JOIN warehouses w ON w.id = m.warehouse_id
    ${wid ? 'WHERE m.warehouse_id = ?' : ''} ORDER BY m.id DESC LIMIT ?`).all(...(wid ? [wid] : []), limit);
}
// Letzte Buchungen aller Lager (Übersicht der App)
route('GET', '/api/movements/recent', (_p, _b, qs) => recentMovements(null, Math.max(1, Math.min(50, Number(qs.get('limit')) || 8))));
route('GET', '/api/overview', (_p, _b, qs) => {
  const w = whFrom(qs.get('wh'));
  return {
    locations: db.prepare(`${PLACE_SELECT} WHERE pl.warehouse_id = ? ORDER BY LENGTH(pl.col), pl.col, pl.row`).all(w.id),
    // schlank, für Vorschaubilder und Suche im Lagerplan
    items: db.prepare(`SELECT i.id, i.name, i.col, i.row, i.quantity, i.container, i.parent_id,
        (SELECT updated_at FROM item_photos ph WHERE ph.item_id = i.id) AS photo_at
      FROM items i WHERE i.warehouse_id = ? ORDER BY i.name COLLATE NOCASE LIMIT 5000`).all(w.id),
    recent: recentMovements(w.id),
  };
});

// ---------- Fotos ----------
// Die App verkleinert Fotos selbst (Vorschau ~240 px, Bild ~1280 px) und schickt sie als Base64-JPEG/WebP.
const SEND_DATA = Symbol('sendData');
function imageBuffer(b64, label, maxBytes) {
  const buf = Buffer.from(String(b64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!jpeg && !webp) throw new HttpError(400, `${label}: nur JPEG oder WebP.`);
  if (buf.length > maxBytes) throw new HttpError(413, `${label} ist zu groß.`);
  return buf;
}
const imageType = (buf) => (buf[0] === 0xff ? 'image/jpeg' : 'image/webp');

function saveItemPhoto(id, body) {
  const item = getItem(id);
  const thumb = imageBuffer(body.thumb, 'Vorschaubild', 300 * 1024);
  const image = imageBuffer(body.image, 'Foto', 3 * 1024 * 1024);
  db.prepare(`INSERT INTO item_photos (item_id, thumb, image, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(item_id) DO UPDATE SET thumb = excluded.thumb, image = excluded.image, updated_at = excluded.updated_at`).run(item.id, thumb, image);
  return getItem(item.id);
}
route('PUT', '/api/items/:id/photo', (p, body) => saveItemPhoto(p.id, body));
route('GET', '/api/items/:id/photo', (p, _b, qs) => {
  const row = db.prepare('SELECT thumb, image FROM item_photos WHERE item_id = ?').get(Number(p.id));
  if (!row) throw new HttpError(404, 'Kein Foto.');
  const data = Buffer.from(qs.get('size') === 'thumb' ? row.thumb : row.image);
  // die URL enthält ?v=<Änderungszeit> → darf lange im Browser-Cache bleiben
  return { [SEND_DATA]: data, type: imageType(data), cache: qs.get('v') ? 'private, max-age=31536000, immutable' : 'private, no-cache' };
});
route('DELETE', '/api/items/:id/photo', (p) => {
  db.prepare('DELETE FROM item_photos WHERE item_id = ?').run(getItem(p.id).id);
  return getItem(p.id);
});

// ---------- Auswertung ----------
// ?wh=<Lager-ID> (optional), ?stale_days=365: „lange nicht angefasst“
route('GET', '/api/stats', (_p, _b, qs) => {
  const wid = qs.get('wh') ? getWarehouse(qs.get('wh')).id : null;
  const staleDays = Math.min(3650, Math.max(30, Number(qs.get('stale_days')) || 365));
  const expiryDays = Math.min(365, Math.max(1, Number(qs.get('expiry_days')) || 30));
  const wItems = wid ? 'AND i.warehouse_id = ?' : '';
  const wPlaces = wid ? 'AND pl.warehouse_id = ?' : '';
  const a = wid ? [wid] : [];
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const totals = {
    items: one(`SELECT COUNT(*) AS n FROM items i WHERE 1 ${wItems}`, ...a).n,
    quantity: one(`SELECT COALESCE(SUM(quantity), 0) AS n FROM items i WHERE 1 ${wItems}`, ...a).n,
    places: one(`SELECT COUNT(*) AS n FROM places pl WHERE 1 ${wPlaces}`, ...a).n,
    empty_places: one(`SELECT COUNT(*) AS n FROM places pl WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.warehouse_id = pl.warehouse_id
      AND i.col = pl.col AND i.row = pl.row) ${wPlaces}`, ...a).n,
    out_of_stock: one(`SELECT COUNT(*) AS n FROM items i WHERE i.quantity = 0 ${wItems}`, ...a).n,
    consumables: one(`SELECT COUNT(*) AS n FROM items i WHERE i.consumable = 1 ${wItems}`, ...a).n,
    movements_30d: one(`SELECT COUNT(*) AS n FROM movements m JOIN items i ON i.id = m.item_id
      WHERE m.created_at >= datetime('now', '-30 days') ${wItems}`, ...a).n,
    on_list: one("SELECT COUNT(*) AS n FROM shopping WHERE done_at IS NULL").n,
    expired: one(`SELECT COUNT(*) AS n FROM items i WHERE i.quantity > 0 AND i.expires_on < date('now', 'localtime') ${wItems}`, ...a).n,
    expiring: one(`SELECT COUNT(*) AS n FROM items i WHERE i.quantity > 0 AND i.expires_on >= date('now', 'localtime')
      AND i.expires_on <= date('now', 'localtime', '+${expiryDays} days') ${wItems}`, ...a).n,
  };
  const topUsed = db.prepare(`
    SELECT i.id, i.name, i.quantity, w.code AS wh_code, i.col, i.row, COUNT(m.id) AS uses
    FROM movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = i.warehouse_id
    WHERE m.created_at >= datetime('now', '-90 days') ${wItems}
    GROUP BY i.id ORDER BY uses DESC, i.name LIMIT 10`).all(...a);
  const byPerson = db.prepare(`
    SELECT p.id, p.name, p.color, COUNT(m.id) AS n,
           SUM(m.type = 'in') AS ins, SUM(m.type = 'out') AS outs
    FROM movements m JOIN persons p ON p.id = m.person_id JOIN items i ON i.id = m.item_id
    WHERE m.created_at >= datetime('now', '-30 days') ${wItems}
    GROUP BY p.id ORDER BY n DESC LIMIT 10`).all(...a);
  // zuletzt angefasst = letzte Buchung, sonst Anlagedatum
  const stale = db.prepare(`
    SELECT * FROM (
      SELECT i.id, i.name, i.quantity, w.code AS wh_code, i.col, i.row,
             COALESCE((SELECT MAX(created_at) FROM movements WHERE item_id = i.id), i.created_at) AS touched_at
      FROM items i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.quantity > 0 ${wItems}
    ) WHERE touched_at < datetime('now', '-${staleDays} days') ORDER BY touched_at LIMIT 50`).all(...a);
  const outOfStock = db.prepare(`${ITEM_SELECT} WHERE i.quantity = 0 ${wItems} ORDER BY i.name LIMIT 50`).all(...a);
  const emptyPlaces = db.prepare(`
    SELECT pl.warehouse_id, w.code AS wh_code, pl.col, pl.row, pl.name FROM places pl JOIN warehouses w ON w.id = pl.warehouse_id
    WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.warehouse_id = pl.warehouse_id AND i.col = pl.col AND i.row = pl.row) ${wPlaces}
    ORDER BY pl.warehouse_id, LENGTH(pl.col), pl.col, pl.row LIMIT 200`).all(...a);
  return { totals, stale_days: staleDays, expiry_days: expiryDays, expiring: expiringItems(expiryDays, wid), top_used: topUsed, by_person: byPerson, stale, out_of_stock: outOfStock, empty_places: emptyPlaces };
});

// ---------- Import ----------
// Zeilen (aus CSV/Excel, in der App gelesen): {code?, name, beschreibung?, lager?, platz?, menge?, verbrauchsmaterial?}
// Code vorhanden → Gegenstand aktualisieren; Code unbekannt → mit diesem Code anlegen; ohne Code → neu anlegen.
// dry: nur prüfen. Beim echten Import wird vorher ein Backup angelegt; Mengenänderungen werden als Buchung erfasst.
const yes = (v) => /^(1|ja|j|yes|y|true|wahr|x)$/i.test(String(v ?? '').trim());
// Excel speichert Datumszellen als Seriennummer (Tage seit 30.12.1899)
const excelDate = (v) => (/^\d{5}(\.\d+)?$/.test(String(v ?? '').trim())
  ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10) : v);
function importRows(ctx, rows, dry) {
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'Keine Zeilen zum Importieren.');
  if (rows.length > 20000) throw new HttpError(413, 'Zu viele Zeilen (max. 20 000).');
  const whs = db.prepare('SELECT * FROM warehouses ORDER BY id').all();
  const whBy = (ref) => {
    const r = String(ref || '').trim().toLocaleLowerCase('de');
    return whs.find((w) => w.code.toLowerCase() === r) || whs.find((w) => w.name.toLocaleLowerCase('de') === r);
  };
  const plan = rows.map((raw, i) => {
    const row = i + 2; // Zeile 1 = Überschriften
    try {
      const code = String(raw.code ?? '').trim().toUpperCase().replace(/^O-/, '');
      if (code && !CODE_RE.test(code)) throw new HttpError(400, `Ungültiger Code „${raw.code}“ (6 Zeichen, ohne 0/O/1/I).`);
      const existing = code ? getItemByCode(code) : null;
      const name = String(raw.name ?? '').trim();
      if (!existing && !name) throw new HttpError(400, 'Bezeichnung fehlt.');
      if (name.length > 200) throw new HttpError(400, 'Bezeichnung ist zu lang.');
      // Lager + Platz: "B12" + Lager-Spalte, oder "K-B12"
      let wid = existing?.warehouse_id ?? whs[0].id;
      let loc = existing ? { col: existing.col, row: existing.row } : null;
      const platz = String(raw.platz ?? '').trim().toUpperCase().replace(/^P-/, '').replace(/\s+/g, '');
      if (raw.lager !== undefined && String(raw.lager).trim()) {
        const w = whBy(raw.lager);
        if (!w) throw new HttpError(400, `Lager „${raw.lager}“ gibt es nicht.`);
        wid = w.id;
      }
      if (platz) {
        const m = platz.match(/^(?:([A-Z][A-Z0-9]{0,3})-)?([A-Z]{1,3})-?(\d{1,2})$/);
        if (!m) throw new HttpError(400, `Platz „${raw.platz}“ nicht verstanden (z. B. B12 oder K-B12).`);
        if (m[1]) {
          const w = whBy(m[1]);
          if (!w) throw new HttpError(400, `Lager „${m[1]}“ gibt es nicht.`);
          wid = w.id;
        }
        loc = normalizeLocation(m[2], m[3]);
      }
      if (!loc) throw new HttpError(400, 'Lagerplatz fehlt.');
      const hasQty = raw.menge !== undefined && String(raw.menge).trim() !== '';
      const qty = hasQty ? Number(String(raw.menge).replace(',', '.')) : null;
      if (hasQty && (!Number.isInteger(qty) || qty < 0)) throw new HttpError(400, `Menge „${raw.menge}“ ist keine ganze Zahl ≥ 0.`);
      const hasCons = raw.verbrauchsmaterial !== undefined && String(raw.verbrauchsmaterial).trim() !== '';
      const desc = raw.beschreibung !== undefined ? String(raw.beschreibung).trim() : null;
      const hasExp = raw.haltbar_bis !== undefined;
      const exp = hasExp ? expiryDate(excelDate(raw.haltbar_bis)) : null;

      if (!existing) {
        return { row, action: 'neu', name, code: code || '(neu)', wid, loc, qty: qty ?? 0, desc: desc ?? '', consumable: hasCons && yes(raw.verbrauchsmaterial), exp, newCode: code };
      }
      const changes = [];
      const upd = { name: existing.name, description: existing.description, consumable: existing.consumable, expires_on: existing.expires_on };
      if (hasExp && exp !== existing.expires_on) { upd.expires_on = exp; changes.push(exp ? `haltbar bis ${exp.split('-').reverse().join('.')}` : 'ohne Haltbarkeitsdatum'); }
      if (name && name !== existing.name) { changes.push(`Name → ${name}`); upd.name = name; }
      if (desc !== null && desc !== existing.description) { changes.push('Beschreibung'); upd.description = desc; }
      if (hasCons && (yes(raw.verbrauchsmaterial) ? 1 : 0) !== existing.consumable) { upd.consumable = yes(raw.verbrauchsmaterial) ? 1 : 0; changes.push(upd.consumable ? 'wird Verbrauchsmaterial' : 'kein Verbrauchsmaterial mehr'); }
      const moved = wid !== existing.warehouse_id || loc.col !== existing.col || loc.row !== existing.row;
      if (moved) changes.push(`Platz → ${whs.find((w) => w.id === wid).code}-${loc.col}${loc.row}`);
      const diff = hasQty ? qty - existing.quantity : 0;
      if (diff) changes.push(`Menge ${existing.quantity} → ${qty}`);
      return { row, action: changes.length ? 'geändert' : 'unverändert', name: upd.name, code, existing, upd, wid, loc, diff, changes };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return { row, action: 'fehler', name: String(raw.name ?? ''), code: String(raw.code ?? ''), message: e.message };
    }
  });
  // doppelte Codes in der Datei
  const seen = new Map();
  for (const p of plan) {
    const c = p.newCode || (p.existing && p.code);
    if (!c) continue;
    if (seen.has(c)) Object.assign(p, { action: 'fehler', message: `Code ${c} kommt mehrfach vor (auch Zeile ${seen.get(c)}).` });
    else seen.set(c, p.row);
  }
  const summary = { neu: 0, 'geändert': 0, 'unverändert': 0, fehler: 0 };
  for (const p of plan) summary[p.action]++;
  const out = plan.map((p) => ({ row: p.row, action: p.action, name: p.name, code: p.code, message: p.message || (p.changes || []).join(', ') }));
  if (dry) return { dry: true, summary, rows: out };

  const backup = createBackup('vor-import');
  db.prepare('BEGIN').run();
  try {
    for (const p of plan) {
      if (p.action === 'neu') {
        ensurePlace(p.wid, p.loc.col, p.loc.row);
        const id = db.prepare('INSERT INTO items (code, name, description, warehouse_id, col, row, quantity, consumable, expires_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(p.newCode || newCode(), p.name, p.desc, p.wid, p.loc.col, p.loc.row, p.qty, p.consumable ? 1 : 0, p.exp).lastInsertRowid;
        if (p.qty > 0) {
          db.prepare(`INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row, created_item) VALUES (?, ?, 'in', ?, ?, ?, ?, 1)`)
            .run(id, ctx.person.id, p.qty, p.wid, p.loc.col, p.loc.row);
        }
      } else if (p.action === 'geändert') {
        ensurePlace(p.wid, p.loc.col, p.loc.row);
        // anderer Platz → aus dem Behälter nehmen, der eigene Inhalt zieht mit
        const moved = p.wid !== p.existing.warehouse_id || p.loc.col !== p.existing.col || p.loc.row !== p.existing.row;
        db.prepare('UPDATE items SET name = ?, description = ?, consumable = ?, expires_on = ?, warehouse_id = ?, col = ?, row = ?, parent_id = ?, quantity = quantity + ? WHERE id = ?')
          .run(p.upd.name, p.upd.description, p.upd.consumable, p.upd.expires_on, p.wid, p.loc.col, p.loc.row, moved ? null : p.existing.parent_id, p.diff, p.existing.id);
        if (moved) syncContents(p.existing.id);
        if (p.diff) {
          db.prepare('INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(p.existing.id, ctx.person.id, p.diff > 0 ? 'in' : 'out', Math.abs(p.diff), p.wid, p.loc.col, p.loc.row);
        }
      }
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { dry: false, summary, rows: out, backup: backup.name };
}
route('POST', '/api/import', (_p, body, _qs, ctx) => importRows(ctx, body.rows, !!body.dry), { auth: 'admin' });

// ---------- Backups ----------
// Automatisch alle BACKUP_INTERVAL_HOURS Stunden (0 = aus), die letzten BACKUP_KEEP automatischen bleiben erhalten.
// Manuelle Backups und Sicherungen vor einer Wiederherstellung werden nicht automatisch gelöscht.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14));
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const BACKUP_RE = /^lager-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_\d+)?(?:-(manuell|vor-wiederherstellung|vor-import|hochgeladen))?\.db$/;
const BACKUP_KINDS = { undefined: 'automatisch', manuell: 'manuell', 'vor-wiederherstellung': 'vor Wiederherstellung', 'vor-import': 'vor Import', hochgeladen: 'hochgeladen' };
const SEND_FILE = Symbol('sendFile');

function listBackups() {
  let names = [];
  try { names = fs.readdirSync(BACKUP_DIR); } catch { return []; }
  return names.map((name) => {
    const m = name.match(BACKUP_RE);
    if (!m) return null;
    const st = fs.statSync(path.join(BACKUP_DIR, name));
    return { name, kind: m[7] || 'auto', kind_label: BACKUP_KINDS[m[7]], size: st.size, created_at: st.mtime.toISOString() };
  }).filter(Boolean).sort((a, b) => b.name.localeCompare(a.name));
}

// eindeutiger Dateiname: lager-2026-09-25_224500[-art].db, bei Gleichstand in derselben Sekunde mit _2, _3 …
function backupName(kind = '') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const suffix = kind ? `-${kind}` : '';
  let name = `lager-${stamp}${suffix}.db`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `lager-${stamp}_${i}${suffix}.db`;
  return name;
}

function createBackup(kind = '') {
  const name = backupName(kind);
  const file = path.join(BACKUP_DIR, name);
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  // VACUUM INTO erzeugt eine konsistente, kompakte Kopie – auch während der Server läuft
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file);
  // alte automatische Backups aufräumen
  for (const b of listBackups().filter((x) => x.kind === 'auto').slice(BACKUP_KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
  return listBackups().find((b) => b.name === name);
}

function backupFile(name) {
  if (!BACKUP_RE.test(String(name))) throw new HttpError(400, 'Ungültiger Backup-Name.');
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Backup nicht gefunden.');
  return file;
}

// Prüfen, ob eine Datei eine intakte Heimlager-Datenbank ist
function validateDbFile(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1') !== 'SQLite format 3\0') throw new HttpError(400, 'Das ist keine SQLite-Datenbank.');
  let check;
  try {
    check = new DatabaseSync(file, { readOnly: true });
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new HttpError(400, 'Die Datenbank ist beschädigt.');
    const tables = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    for (const t of ['persons', 'items', 'movements']) if (!tables.has(t)) throw new HttpError(400, 'Das ist keine Heimlager-Datenbank.');
    return { items: check.prepare('SELECT COUNT(*) AS n FROM items').get().n, persons: check.prepare('SELECT COUNT(*) AS n FROM persons').get().n };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `Datei lässt sich nicht öffnen: ${e.message}`);
  } finally { check?.close(); }
}

// Datenbank im laufenden Betrieb ersetzen. Vorher wird der aktuelle Stand gesichert.
// Die Sitzung der Person, die wiederherstellt, bleibt erhalten (falls es sie im Backup gibt).
function restoreFrom(source, ctx) {
  // zuerst kopieren: das Sichern des aktuellen Stands räumt alte Backups auf und könnte die Quelle löschen
  const file = path.join(BACKUP_DIR, `restore-${randomToken(6)}.tmp`);
  fs.copyFileSync(source, file);
  try { return restoreCopy(file, ctx); } finally { fs.rmSync(file, { force: true }); }
}
function restoreCopy(file, ctx) {
  const stats = validateDbFile(file);
  const safety = createBackup('vor-wiederherstellung');
  const keep = ctx?.sessionHash ? { hash: ctx.sessionHash, id: ctx.person.id, name: ctx.person.name } : null;
  db.close();
  const swap = (src) => {
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });
    fs.copyFileSync(src, DB_PATH);
    openDatabase();
  };
  try { swap(file); } catch (e) {
    console.error('Wiederherstellung fehlgeschlagen, alter Stand wird zurückgespielt:', e);
    swap(path.join(BACKUP_DIR, safety.name));
    throw new HttpError(500, 'Wiederherstellung fehlgeschlagen – der vorherige Stand ist wieder aktiv.');
  }
  if (keep && db.prepare('SELECT 1 FROM persons WHERE id = ? AND name = ? AND archived = 0').get(keep.id, keep.name)) {
    db.prepare(`INSERT OR REPLACE INTO sessions (token_hash, person_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(keep.hash, keep.id);
  }
  console.log(`Datenbank wiederhergestellt (${stats.items} Gegenstände). Sicherung des vorherigen Stands: ${safety.name}`);
  return { ok: true, ...stats, safety: safety.name, still_logged_in: !!(keep && sessionAuthHash(keep.hash)) };
}
const sessionAuthHash = (hash) => db.prepare("SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')").get(hash);

// automatische Backups: beim Start prüfen, dann stündlich
function autoBackup() {
  if (!(BACKUP_INTERVAL_HOURS > 0)) return;
  const last = listBackups().find((b) => b.kind === 'auto');
  if (last && Date.now() - new Date(last.created_at).getTime() < BACKUP_INTERVAL_HOURS * 3600e3) return;
  try { console.log(`Automatisches Backup: ${createBackup().name}`); } catch (e) { console.error('Automatisches Backup fehlgeschlagen:', e.message); }
}
setTimeout(autoBackup, 60e3).unref();
setInterval(autoBackup, 3600e3).unref();

route('GET', '/api/backups', () => ({
  dir: BACKUP_DIR, keep: BACKUP_KEEP, interval_hours: BACKUP_INTERVAL_HOURS, backups: listBackups(),
}), { auth: 'admin' });
route('POST', '/api/backups', () => createBackup('manuell'), { auth: 'admin' });
route('GET', '/api/backups/:name/download', (p) => ({ [SEND_FILE]: backupFile(p.name), filename: p.name }), { auth: 'admin' });
route('DELETE', '/api/backups/:name', (p) => { fs.rmSync(backupFile(p.name)); return { ok: true }; }, { auth: 'admin' });
route('POST', '/api/backups/:name/restore', (p, _b, _qs, ctx) => restoreFrom(backupFile(p.name), ctx), { auth: 'admin' });
// Hochgeladene Datei (Rohdaten im Body) prüfen, als Backup ablegen und einspielen
route('POST', '/api/backups/upload', (_p, body, qs, ctx) => {
  if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Keine Datei empfangen.');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = path.join(BACKUP_DIR, `upload-${randomToken(6)}.tmp`);
  fs.writeFileSync(tmp, body);
  try {
    validateDbFile(tmp);
    if (qs.get('restore') !== '1') {
      // nur ablegen: als Backup „hochgeladen“ speichern
      const name = backupName('hochgeladen');
      fs.renameSync(tmp, path.join(BACKUP_DIR, name));
      return listBackups().find((b) => b.name === name);
    }
    return restoreFrom(tmp, ctx);
  } finally { fs.rmSync(tmp, { force: true }); }
}, { auth: 'admin', raw: true });

// ---------- HTTP ----------

function sendJson(res, status, data, cookies = []) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function readRaw(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Datei ist zu groß.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, file, filename) {
  const st = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Length': st.size,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 20e6) req.destroy(); }); // Fotos, Import
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'Ungültiges JSON.')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // QR-Code-Links: /q/P-B12 oder /q/O-K7M2XQ → in die Zuhause-App (Platz bzw. Gegenstand, unbekannt = neu anlegen)
  if (url.pathname.startsWith('/q/')) {
    res.writeHead(302, { Location: `/#/q/${encodeURIComponent(url.pathname.slice(3))}` });
    return res.end();
  }
  // Einrichtungslink eines Wandterminals: Geräte-Cookie setzen, dann in die App
  const tm = url.pathname.match(/^\/terminal\/([A-Za-z0-9_-]{20,80})$/);
  if (tm) {
    const row = db.prepare('SELECT id FROM terminals WHERE token_hash = ?').get(sha256(tm[1]));
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Dieser Einrichtungslink ist ungültig oder wurde ersetzt. Bitte in der Verwaltung einen neuen erzeugen.');
    }
    const secure = isHttps(req) ? '; Secure' : '';
    res.writeHead(302, {
      Location: '/#/haus',
      'Set-Cookie': [`${TERMINAL_COOKIE}=${tm[1]}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${5 * 365 * 86400}${secure}`, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`],
    });
    return res.end();
  }
  if (url.pathname === '/healthz') {
    try { db.prepare('SELECT 1').get(); return sendJson(res, 200, { ok: true }); } catch { return sendJson(res, 503, { ok: false }); }
  }
  // Oberfläche liefert die Zuhause-App (server/index.ts); hier nur API, QR-Links und Healthcheck
  if (!url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Nicht gefunden.' });
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      const ctx = { req, cookies: [], ...(keyAuth(bearer(req)) || sessionAuth(req) || terminalAuth(req) || {}) };
      if (r.auth !== 'public') {
        if (!ctx.person) throw new HttpError(401, 'Bitte anmelden.');
        if (ctx.via === 'key' && ctx.scope === 'read' && req.method !== 'GET') throw new HttpError(403, 'Dieser API-Schlüssel darf nur lesen.');
        if (r.auth === 'admin' && (ctx.via !== 'session' || ctx.person.role !== 'admin')) throw new HttpError(403, 'Nur für Admins.');
      }
      const body = !['POST', 'PATCH', 'PUT'].includes(req.method) ? {} : r.raw ? await readRaw(req) : await readBody(req);
      // Terminal: nur freigegebene Buchungen, und nur mit der Person, die am Gerät gewählt wurde
      if (ctx.via === 'terminal' && req.method !== 'GET' && r.auth !== 'public') {
        if (!TERMINAL_WRITES.some(([mt, re]) => mt === req.method && re.test(url.pathname))) throw new HttpError(403, 'Am Wandterminal nicht möglich.');
        const who = Number(body.person_id ?? url.searchParams.get('person_id'));
        const person = who ? db.prepare("SELECT * FROM persons WHERE id = ? AND archived = 0 AND status = 'active'").get(who) : null;
        if (!person) throw new HttpError(400, 'Bitte zuerst antippen, wer bucht.');
        ctx.person = person;
      }
      const result = await r.handler(m.groups || {}, body, url.searchParams, ctx);
      if (result?.[SEND_FILE]) return sendFile(res, result[SEND_FILE], result.filename);
      if (result?.[SEND_DATA]) {
        res.writeHead(200, { 'Content-Type': result.type, 'Content-Length': result[SEND_DATA].length, 'Cache-Control': result.cache || 'no-store' });
        return res.end(result[SEND_DATA]);
      }
      return sendJson(res, 200, result, ctx.cookies);
    }
    sendJson(res, 404, { error: 'Unbekannter Endpunkt.' });
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Interner Fehler.' });
  }
}

// MCP-Server (für KI-Assistenten) auf eigenem Port – Anmeldung nur per API-Schlüssel
// Kern-Funktionen für die Werkzeuge (MCP-Server und Assistent)
const core = {
  get db() { return db; }, HttpError, WAREHOUSE_SELECT, createWarehouse, keyAuth, parseCode, normalizeLocation, searchItems, getItem, getItemByCode, itemWithHistory,
  getPlace, savePlace, deletePlace, resolveCode, saveItemPhoto, placeItems, containerContents, expiringItems, checkin, checkout, updateItem, shoppingOpen, shoppingAdd, shoppingUpdate, shoppingRestock, shoppingStore, recentMovements, undoMovement,
};

// ---------- KI-Assistent ----------
const assistant = require('./assistant.cjs').createAssistant(core, {
  timeZone: process.env.TZ || 'Europe/Berlin',
  publicUrl: process.env.PUBLIC_URL || process.env.MCP_PUBLIC_URL || '',
});
const assistantAuth = (ctx) => ({ person: ctx.person, scope: ctx.scope });
route('GET', '/api/assistant/status', () => ({ enabled: assistant.enabled(), confirm_from: assistant.CONFIRM_FROM }));
route('GET', '/api/assistant/settings', () => assistant.publicSettings(), { auth: 'admin' });
route('PUT', '/api/assistant/settings', (_p, body) => assistant.saveSettings(body), { auth: 'admin' });
route('POST', '/api/assistant/test', () => assistant.test(), { auth: 'admin' });
route('POST', '/api/assistant', (_p, body, _qs, ctx) => assistant.chat(assistantAuth(ctx), body));
route('POST', '/api/assistant/confirm', (_p, body, _qs, ctx) => assistant.confirm(assistantAuth(ctx), body.token));
// Preisrecherche für die Einkaufsliste (Websuche über den KI-Anbieter)
route('GET', '/api/shopping/prices', () => assistant.research.forShopping());
route('POST', '/api/shopping/prices', (_p, body, _qs, ctx) => {
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : null;
  const entries = shoppingOpen().filter((e) => !ids || ids.includes(e.id));
  assistant.research.start(ctx.person, entries, { force: !!body.force });
  return assistant.research.forShopping();
});
route('POST', '/api/assistant/cancel', (_p, body, _qs, ctx) => assistant.cancel(assistantAuth(ctx), body.token));

// MCP-Server (eigener Port, nur API-Schlüssel) – gestartet von server/index.ts
function mcpHandler({ allowedOrigins = [], keyInUrl = false } = {}) {
  const { createMcpHandler } = require('./mcp.cjs');
  return createMcpHandler(core, {
    version: require('../../package.json').version,
    allowedOrigins,
    keyInUrl,
    timeZone: process.env.TZ || 'Europe/Berlin',
  });
}

// Anmeldung einer Anfrage: API-Schlüssel oder Sitzungs-Cookie → { person, via, scope, sessionHash? } oder null
const authenticate = (req) => keyAuth(bearer(req)) || sessionAuth(req) || terminalAuth(req) || null;

// Schema eines weiteren Moduls einhängen: läuft sofort und nach jedem erneuten Öffnen (Wiederherstellung)
function onOpen(hook) { openHooks.push(hook); hook(db); }

module.exports = {
  handle, authenticate, onOpen, mcpHandler, HttpError, DB_PATH,
  get db() { return db; },
  siteOf, saveSite, authSettings, setAuthSetting, accountUser,
  close() { try { db.close(); } catch { /* ignorieren */ } },
};
