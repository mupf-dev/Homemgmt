// Gegenstände aus dem früheren Heimlager übernehmen (lesend per API-Schlüssel): Lager und Plätze, Gegenstände mit
// Behältern, Fotos, Verlauf und Einkaufsliste. Plätze, die im alten Haus einem Einbau-Fach zugeordnet waren, werden auf das
// passende Fach des Hausplans abgebildet (gleiche Etage, Punkt im Möbel, Höhe des Bodens); alle übrigen bleiben als Lager
// ohne Hausplan mit ihren bisherigen Adressen. Ersetzt den Lagerinhalt der Zieldatenbank – vorher wird gesichert.
//
//   LAGER_API_KEY=hlk_… npm run import-prod-items -- --url https://lager.example.de [--dry]
//   (oder --from data/prod/lager-export.json, um eine früher geladene Sicherung zu verwenden)

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes('--dry');
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
type Row = Record<string, any>;

// 1. Laden (oder aus Datei)
const snapshot = resolve(opt('save') ?? join(ROOT, 'data', 'prod', 'lager-export.json'));
let data: { warehouses: Row[]; places: Row[]; items: Row[]; persons: Row[]; shopping: { open: Row[]; done: Row[] }; site: Row; photos: Record<string, { image: string; thumb: string }> };
if (opt('from')) data = JSON.parse(readFileSync(opt('from')!, 'utf8'));
else {
  const url = (opt('url') ?? fail('Bitte --url <Adresse des Lagers> oder --from <Datei> angeben.')).replace(/\/+$/, '');
  const key = process.env.LAGER_API_KEY ?? fail('Bitte den API-Schlüssel in LAGER_API_KEY übergeben.');
  const get = async (p: string, raw = false) => {
    const r = await fetch(url + p, { headers: { authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}` } });
    if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
  };
  const warehouses = (await get('/api/warehouses')) as Row[];
  const places = (await Promise.all(warehouses.map((w) => get(`/api/places?wh=${w.id}`)))).flat() as Row[];
  const list = (await get('/api/items?limit=100000')) as Row[];
  const items = [];
  for (const i of list) items.push(await get(`/api/items/${i.id}`)); // mit Verlauf
  const photos: Record<string, { image: string; thumb: string }> = {};
  for (const i of list.filter((x) => x.photo_at)) {
    photos[i.id] = { image: ((await get(`/api/items/${i.id}/photo`, true)) as Buffer).toString('base64'), thumb: ((await get(`/api/items/${i.id}/photo?size=thumb`, true)) as Buffer).toString('base64') };
  }
  data = { warehouses, places, items, persons: (await get('/api/persons')) as Row[], shopping: (await get('/api/shopping')) as any, site: (await get('/api/site')) as Row, photos };
  mkdirSync(dirname(snapshot), { recursive: true });
  writeFileSync(snapshot, JSON.stringify(data));
  console.log(`Geladen: ${data.items.length} Gegenstände, ${data.places.length} Plätze, ${Object.keys(data.photos).length} Fotos → ${snapshot}`);
}

// 2. Ziel-Datenbank öffnen (Schema wie im Server)
process.env.BACKUP_INTERVAL_HOURS = '0';
const DB_PATH = resolve(process.env.DB_PATH ?? join(ROOT, 'data', 'zuhause.db'));
if (!existsSync(DB_PATH)) fail(`${DB_PATH} gibt es nicht.`);
const lager = createRequire(import.meta.url)('../server/lager/server.cjs');
const { createHouse, saveHouse } = await import('../server/haus/index.ts');
createHouse(lager);
const db = lager.db;
const { migrateHouse, roomOf } = await import('../web/app/src/model/house.ts');
const { compartments } = await import('../web/app/src/model/storage.ts');
const { pointInItem } = await import('../web/app/src/model/geom.ts');
const houseRow = db.prepare('SELECT data FROM house WHERE id = 1').get() as Row | undefined;
const house = houseRow ? migrateHouse(JSON.parse(houseRow.data)) : null;

// 3. Fach-Zuordnungen des alten Hauses → Fächer des Hausplans
const slotTarget = new Map<string, { item: string; row: number; label: string }>();
for (const f of data.site?.floors ?? []) {
  const floor = house?.floors.find((x) => x.name === f.name);
  if (!floor) continue;
  for (const fx of f.fixtures ?? []) {
    for (const s of fx.slots ?? []) {
      const p = { x: fx.x / 10, y: fx.y / 10 };
      const h = (fx.elevation + ((s.level + 0.5) * fx.height) / Math.max(1, fx.levels)) / 10;
      let best: { item: string; row: number; label: string; d: number } | null = null;
      for (const it of floor.items) {
        if (!pointInItem(it, p, 15)) continue;
        for (const c of compartments(it, house!.settings)) {
          const y0 = it.elevation + c.y0;
          const y1 = it.elevation + c.y1;
          const d = h < y0 ? y0 - h : h > y1 ? h - y1 : 0;
          if (!best || d < best.d) best = { item: it.id, row: c.row, label: `${roomOf(floor, it)?.name ?? floor.name} · ${c.label}`, d };
        }
      }
      if (best && best.d < 40) slotTarget.set(`${s.wh_code}-${s.col}${s.row}`, best);
    }
  }
}
const planPlace = (t: { item: string; row: number }) => db.prepare('SELECT warehouse_id, col, row FROM places WHERE plan_item = ? AND plan_slot = ?').get(t.item, t.row) as Row | undefined;
const itemsOnSlots = data.items.filter((i) => slotTarget.has(`${i.wh_code}-${i.col}${i.row}`));
console.log(`Fach-Zuordnungen im alten Haus: ${slotTarget.size} Plätze auf Fächer des Hausplans abgebildet; darauf liegen ${itemsOnSlots.length} Gegenstände.`);
for (const [k, t] of slotTarget) console.log(`  ${k} → ${t.label}`);

if (dry) {
  console.log('Probelauf – nichts gespeichert.');
  process.exit(0);
}

// 4. Sicherung, dann Lagerinhalt ersetzen
const backup = DB_PATH.replace(/\.db$/, '') + `-vor-gegenstaende-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`;
db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
console.log(`Sicherung: ${backup}`);

db.exec('BEGIN');
try {
  db.exec('DELETE FROM shopping; DELETE FROM price_checks; DELETE FROM movements; DELETE FROM item_photos; UPDATE items SET parent_id = NULL; DELETE FROM items;');
  // Lager ohne Hausplan werden durch die übernommenen ersetzt
  db.exec('DELETE FROM fixture_slots; DELETE FROM places WHERE warehouse_id IN (SELECT id FROM warehouses WHERE plan_key IS NULL); DELETE FROM warehouses WHERE plan_key IS NULL;');
  // Personen per Name zuordnen, fehlende ohne Passwort anlegen
  const COLORS = ['#e0574f', '#e0883d', '#d9b032', '#5aa84f', '#3a9c9c', '#3f7fd0', '#7a5ad0', '#c74d9a'];
  const personId = new Map<string, number>();
  const person = (name: string, role = 'user', color?: string) => {
    if (personId.has(name)) return personId.get(name)!;
    let p = db.prepare('SELECT id FROM persons WHERE name = ? COLLATE NOCASE').get(name) as Row | undefined;
    if (!p) {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM persons').get() as Row).n;
      p = { id: Number(db.prepare('INSERT INTO persons (name, color, role) VALUES (?, ?, ?)').run(name, color ?? COLORS[n % COLORS.length], role).lastInsertRowid) };
    }
    personId.set(name, p.id);
    return p.id;
  };
  for (const p of data.persons) person(p.name, p.role, p.color);
  const admin = (db.prepare("SELECT id FROM persons WHERE role = 'admin' AND archived = 0 ORDER BY id LIMIT 1").get() as Row).id;

  // Lager-Kürzel, die ein Raum des Hausplans schon trägt, bekommt der Raum neu (Hausplan wird danach neu gespeichert)
  const planCodes = new Set((db.prepare('SELECT code FROM warehouses WHERE plan_key IS NOT NULL').all() as Row[]).map((w) => w.code));
  const clash = data.warehouses.filter((w) => planCodes.has(w.code)).map((w) => w.code);
  if (clash.length && house) {
    for (const f of house.floors) {
      for (const r of f.rooms) if (clash.includes(r.code)) r.code = '';
      if (f.code && clash.includes(f.code)) f.code = '';
    }
    db.prepare(`UPDATE warehouses SET code = '~' || id WHERE plan_key IS NOT NULL AND code IN (${clash.map(() => '?').join(',')})`).run(...clash);
  }
  const whId = new Map<number, number>();
  for (const w of data.warehouses) {
    whId.set(w.id, Number(db.prepare('INSERT INTO warehouses (code, name, description) VALUES (?, ?, ?)').run(w.code, w.name, w.description ?? '').lastInsertRowid));
  }
  for (const p of data.places) {
    db.prepare('INSERT OR IGNORE INTO places (warehouse_id, col, row, name, category, description) VALUES (?, ?, ?, ?, ?, ?)')
      .run(whId.get(p.warehouse_id), p.col, p.row, p.name ?? '', p.category ?? '', p.description ?? '');
  }
  db.exec('COMMIT');
  if (clash.length && house) {
    const r = saveHouse(db, house, admin, lager.HttpError);
    console.log(`Kürzel ${clash.join(', ')} gehören jetzt den übernommenen Lagern; Räume neu benannt (Hausplan Version ${r.version}).`);
  }
  db.exec('BEGIN');

  // Ort eines alten Platzes in der neuen Datenbank
  const where = (x: Row) => {
    const t = slotTarget.get(`${x.wh_code}-${x.col}${x.row}`);
    const pp = t && planPlace(t);
    if (pp) return { wid: pp.warehouse_id, col: pp.col, row: pp.row };
    const w = data.warehouses.find((y) => y.code === x.wh_code);
    return { wid: whId.get(w?.id ?? x.warehouse_id)!, col: x.col, row: x.row };
  };
  const ensure = db.prepare('INSERT OR IGNORE INTO places (warehouse_id, col, row) VALUES (?, ?, ?)');
  const itemId = new Map<number, number>();
  const ins = db.prepare(`INSERT INTO items (code, name, description, warehouse_id, col, row, quantity, consumable, container, expires_on, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const i of data.items) {
    const w = where(i);
    ensure.run(w.wid, w.col, w.row);
    itemId.set(i.id, Number(ins.run(i.code, i.name, i.description ?? '', w.wid, w.col, w.row, i.quantity, i.consumable ? 1 : 0, i.container ? 1 : 0, i.expires_on ?? null, i.created_at ?? new Date().toISOString()).lastInsertRowid));
  }
  // Behälter: Inhalt liegt dort, wo der Behälter liegt
  for (const i of data.items.filter((x) => x.parent_id && itemId.has(x.parent_id))) {
    db.prepare('UPDATE items SET parent_id = ?, warehouse_id = (SELECT warehouse_id FROM items WHERE id = ?), col = (SELECT col FROM items WHERE id = ?), row = (SELECT row FROM items WHERE id = ?) WHERE id = ?')
      .run(itemId.get(i.parent_id), itemId.get(i.parent_id), itemId.get(i.parent_id), itemId.get(i.parent_id), itemId.get(i.id));
  }
  for (const [id, ph] of Object.entries(data.photos ?? {})) {
    if (itemId.has(Number(id))) db.prepare('INSERT INTO item_photos (item_id, thumb, image) VALUES (?, ?, ?)').run(itemId.get(Number(id)), Buffer.from(ph.thumb, 'base64'), Buffer.from(ph.image, 'base64'));
  }
  // Verlauf (älteste zuerst)
  let moves = 0;
  const insM = db.prepare('INSERT INTO movements (item_id, person_id, type, quantity, warehouse_id, col, row, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const i of data.items) {
    for (const h of [...(i.history ?? [])].reverse()) {
      const w = where({ ...h, wh_code: h.wh_code ?? i.wh_code });
      insM.run(itemId.get(i.id), person(h.person), h.type, h.quantity, w.wid, w.col, w.row, h.created_at, h.source ?? 'app');
      moves++;
    }
  }
  // Einkaufsliste
  const insS = db.prepare('INSERT INTO shopping (item_id, name, quantity, note, person_id, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const e of [...data.shopping.open, ...data.shopping.done]) {
    insS.run(e.item_id ? itemId.get(e.item_id) ?? null : null, e.name, e.quantity, e.note ?? '', e.person ? person(e.person) : null, e.created_at, e.done_at ?? null);
  }
  db.exec('COMMIT');
  const moved = itemsOnSlots.length;
  console.log(`Übernommen: ${data.warehouses.length} Lager, ${data.places.length} Plätze, ${data.items.length} Gegenstände (${moved} in Fächer des Hausplans), ${Object.keys(data.photos ?? {}).length} Fotos, ${moves} Buchungen, ${data.shopping.open.length} offene Einkaufsposten.`);
} catch (e) {
  try {
    db.exec('ROLLBACK');
  } catch {
    /* schon beendet */
  }
  throw e;
}
lager.close();
process.exit(0);
