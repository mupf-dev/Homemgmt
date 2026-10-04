// Produktive Pläne zum Testen einspielen: Haus-Grundriss aus dem früheren Heimlager (GET /api/site als JSON) und die
// Küchenplanung (Exportdatei des Küchenplaners) werden zu einem Hausplan zusammengesetzt und in die Datenbank
// gespeichert – mit demselben Abgleich wie beim Speichern in der App (Räume → Lager, Fächer → Plätze).
//
//   npm run import-prod -- --site data/prod/site.json --kueche "data/prod/Haus 1 – EG Küche.kueche.json"
//   Optionen: --floor Erdgeschoss       Etage, in die die Küchenplanung kommt (Wände, Öffnungen, Vorlage, Möbel)
//             --library https://kuechenplaner.example.org   fehlende Bibliotheks-Texturen von dort laden
//             --json data/prod/haus.zuhause.json            Ergebnis zusätzlich als Datei
//             --dry                                         nur prüfen und berichten, nichts speichern
// Vorher wird die Datenbank gesichert (<db>-vor-import-<Zeit>.db).

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const sitePath = opt('site') ?? fail('Bitte --site <site.json> angeben (GET /api/site des Lagers).');
const kuechePath = opt('kueche');
const floorName = opt('floor') ?? 'Erdgeschoss';
const libraryBase = opt('library') ?? 'https://kuechenplaner.example.org';
const dry = args.includes('--dry');

const { siteToHouse } = await import('../web/app/src/model/fromSite.ts');
const { normalizeHouse, storageUnits } = await import('../web/app/src/model/house.ts');
type Item = import('../web/app/src/model/types.ts').Item;

const site = JSON.parse(readFileSync(sitePath, 'utf8'));
const house = siteToHouse(site, 'Haus 1');
console.log(`Lager-Haus: ${house.floors.map((f) => `${f.name} (${f.walls.length} Wände, ${f.rooms.length} Räume, ${f.items.length} Möbel)`).join(', ')}`);

if (kuechePath) {
  const k = JSON.parse(readFileSync(kuechePath, 'utf8'));
  const fl = house.floors.find((f) => f.name === floorName) ?? fail(`Etage „${floorName}“ gibt es im Lager-Haus nicht.`);
  // Küchenplaner und Lager teilen sich den Ursprung (linke obere Außenecke) – die Küche passt ohne Verschiebung
  const ix = k.items.map((i: Item) => i.x);
  const iy = k.items.map((i: Item) => i.y);
  const box = { x0: Math.min(...ix) - 60, x1: Math.max(...ix) + 60, y0: Math.min(...iy) - 60, y1: Math.max(...iy) + 60 };
  const kept = fl.items.filter((it) => !(it.x > box.x0 && it.x < box.x1 && it.y > box.y0 && it.y < box.y1));
  console.log(`Küche „${k.name}“: ${k.walls.length} Wände, ${k.openings.length} Öffnungen, ${k.items.length} Elemente → ${floorName}`);
  console.log(`  ersetzt ${fl.items.length - kept.length} vereinfachte Einbauten des Lagers im Küchenbereich, behält ${kept.length} (${kept.map((i) => i.type).join(', ')})`);
  fl.walls = k.walls;
  fl.openings = k.openings;
  fl.height = Math.max(...k.walls.map((w: { height: number }) => w.height));
  if (k.underlay) fl.underlay = k.underlay;
  fl.items = [...k.items, ...kept];
  house.slots = { ...house.slots, ...k.slots };
  house.customMaterials = k.customMaterials ?? [];
  house.uv = k.uv;
  house.settings = { ...house.settings, ...k.settings };
  house.name = 'Haus 1';
}

// Texturen aus der Online-Bibliothek (Pfad /library/…) liegen auf dem Server des Küchenplaners – fehlende nachladen
const DB_PATH = resolve(process.env.DB_PATH ?? join(ROOT, 'data', 'zuhause.db'));
const libDir = join(dirname(DB_PATH), 'library');
const urls = new Set<string>();
JSON.stringify(house, (_k, v) => {
  if (typeof v === 'string' && v.startsWith('/library/')) urls.add(v);
  return v;
});
let loaded = 0;
for (const u of urls) {
  const file = join(libDir, decodeURIComponent(u.slice('/library/'.length)));
  if (existsSync(file)) continue;
  if (dry) {
    loaded++;
    continue;
  }
  const r = await fetch(libraryBase + u);
  if (!r.ok) {
    console.warn(`  Textur fehlt auf ${libraryBase}: ${u} (${r.status})`);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  loaded++;
}
console.log(`Bibliotheks-Texturen: ${urls.size} verwendet, ${loaded} ${dry ? 'würden geladen' : 'nachgeladen'}`);

if (opt('json')) {
  writeFileSync(opt('json')!, JSON.stringify(house));
  console.log(`Datei: ${opt('json')}`);
}

if (dry) {
  normalizeHouse(house);
  for (const u of storageUnits(house)) if (u.items.length) console.log(`  Lager ${u.code} „${u.name}“: ${u.items.map((s) => `${s.col}=${s.item.type}(${s.compartments.length})`).join(' ')}`);
  console.log('Probelauf – nichts gespeichert.');
  process.exit(0);
}

// Datenbank sichern, dann wie beim Speichern in der App ablegen
process.env.BACKUP_INTERVAL_HOURS = '0';
const lager = createRequire(import.meta.url)('../server/lager/server.cjs');
const { createHouse, saveHouse } = await import('../server/haus/index.ts');
const { createKitchen } = await import('../server/kueche/index.ts');
createHouse(lager);
createKitchen(lager, { dataDir: dirname(DB_PATH) });
const backup = DB_PATH.replace(/\.db$/, '') + `-vor-import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`;
lager.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
console.log(`Sicherung: ${backup}`);
const admin = lager.db.prepare("SELECT id FROM persons WHERE role = 'admin' AND archived = 0 ORDER BY id LIMIT 1").get() as { id: number } | undefined;
const res = saveHouse(lager.db, house, admin?.id ?? null, lager.HttpError);
console.log(`Gespeichert als Version ${res.version}: ${JSON.stringify(res.sync)}`);
for (const u of storageUnits(res.house)) if (u.items.length) console.log(`  Lager ${u.code} „${u.name}“: ${u.items.map((s) => `${u.code}-${s.col} ${s.item.label ?? s.item.type} (${s.compartments.length} Fächer)`).join(', ')}`);
lager.close();
process.exit(0);
