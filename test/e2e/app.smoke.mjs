// Klicktest der Zuhause-App im echten Browser (headless Chromium) gegen einen eigenen Server mit frischer Datenbank.
//   npm install --no-save playwright-core && npm run build && npm run test:e2e
// Browser: CHROME_PATH oder der von Playwright installierte Chromium (~/.cache/ms-playwright). Screenshots: data/e2e/
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'data', 'e2e');
rmSync(`${DIR}/db`, { recursive: true, force: true });
mkdirSync(`${DIR}/db`, { recursive: true });
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  for (const d of existsSync(cache) ? readdirSync(cache).sort().reverse() : []) {
    for (const exe of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome']) if (existsSync(join(cache, d, exe))) return join(cache, d, exe);
  }
  return undefined; // playwright-core sucht selbst
}
let failed = false;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
  cwd: ROOT, env: { ...process.env, PORT: '4900', HTTPS_PORT: '0', MCP_PORT: '0', DB_PATH: `${DIR}/db/z.db`, BACKUP_INTERVAL_HOURS: '0', AI_WEB_SEARCH: '1' }, stdio: 'pipe',
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));
const base = 'http://127.0.0.1:4900';
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

const browser = await chromium.launch({ executablePath: chromePath(), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// 401 ist erwartet (falsches Passwort im Test, Abfragen vor der Anmeldung)
page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push('console: ' + m.text()); });
const step = (s) => console.log('▶', s);
const shot = (n) => page.screenshot({ path: `${DIR}/${n}.png` });

try {
  step('App ohne Anmeldung: Startseite ist die Anmeldung, das Haus lässt sich ansehen');
  await page.goto(base + '/');
  await page.waitForSelector('.who[data-id="new"]');
  console.log('  Adresse:', new URL(page.url()).hash);
  await page.goto(base + '/#/haus');
  await page.waitForSelector('#floorTabs .floor-tab');
  console.log('  Etagen-Reiter:', await page.$$eval('#floorTabs .floor-tab', (b) => b.map((x) => x.textContent)));
  console.log('  Status:', await page.textContent('#account'));

  step('Ersteinrichtung in der App (Kachel „Neue Person“), Abmelden, Anmelden per Kachel');
  await page.goto(base + '/#/lager');
  await page.waitForSelector('.who[data-id="new"]');
  await page.click('.who[data-id="new"]');
  await page.fill('#pw [name="name"]', 'Anna');
  await page.fill('#pw [name="password"]', 'geheim1');
  await page.fill('#pw [name="password2"]', 'geheim1');
  await page.click('#pw button');
  await page.waitForSelector('text=Hausplan anlegen', { timeout: 10000 });
  await shot('01-hausplan-anlegen');
  await page.click('[data-c="draft"]');
  await page.waitForSelector('.ov-quick');
  console.log('  Übersicht:', await page.textContent('.l-page h1'), '| Navigation:', await page.$$eval('#shell .sh-nav a', (a) => a.map((x) => x.textContent.trim())));
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.goto(base + '/#/suche');
  await page.reload();
  await page.waitForSelector('.who[data-id]');
  await page.click('.who:has-text("Anna")');
  await page.fill('#pw [name="password"]', 'falsch');
  await page.click('#pw button');
  await page.waitForSelector('#pw .form-error:not([hidden])');
  await page.fill('#pw [name="password"]', 'geheim1');
  await page.click('#pw button');
  await page.waitForSelector('#q');
  console.log('  Kachel-Anmeldung ok, Seite:', await page.textContent('.l-page h1'));
  await page.goto(base + '/#/haus');
  await page.waitForFunction(() => document.querySelector('#saveStatus')?.textContent?.includes('Gespeichert'), null, { timeout: 15000 });
  console.log('  Status:', await page.textContent('#saveStatus'), '| Modus:', await page.evaluate(() => document.body.className));
  const st = await page.evaluate(() => fetch('/api/house/storage').then((r) => r.json()));
  console.log('  Lagerplätze aus dem Plan:', st.places.length, st.places.slice(0, 3).map((p) => `${p.address} ${p.name}`));
  console.log('  Räume:', await page.$$eval('#roomList .room-row b', (b) => b.map((x) => x.textContent)));

  step('Ansehen: Räume mit Füllstand in der Seitenleiste');
  await page.waitForSelector('.view-panel [data-room]');
  console.log('  Räume:', await page.$$eval('.view-panel [data-room] b', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' '))));
  await shot('02-ansehen');

  step('Raum → Möbel → Fach → einbuchen (Seitenleiste, Plan bleibt sichtbar)');
  await page.click('.view-panel [data-room]');
  await page.waitForSelector('.view-panel [data-it]');
  await shot('03-raum');
  await page.click('.view-panel [data-it] >> nth=2');
  await page.waitForSelector('.view-panel [data-r]');
  console.log('  Fächer:', await page.$$eval('.view-panel [data-r]', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ')).slice(0, 4)));
  await shot('04-moebel');
  await page.click('.view-panel [data-r] >> nth=1');
  await page.waitForSelector('.view-panel .fach-in input[name="name"]');
  await page.fill('.fach-in input[name="name"]', 'Testgabel');
  await page.fill('.fach-in input[name="qty"]', '6');
  await page.click('.fach-in [data-exp="30"]');
  console.log('  Haltbar bis (1 Monat):', await page.inputValue('.fach-in input[name="exp"]'));
  await page.click('.fach-in button[type="submit"]');
  await page.waitForSelector('.fach-item >> text=Testgabel', { timeout: 10000 });
  console.log('  Fach-Titel:', await page.textContent('.view-panel .vp-title'));
  await shot('05-fach');

  step('Suche „Wo liegt …?“');
  await page.fill('#houseSearchInput', 'Testgabel');
  await page.waitForSelector('.search-hit', { timeout: 10000 });
  console.log('  Treffer:', await page.$$eval('.search-hit', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' '))));
  await shot('06-suche');
  await page.click('.search-hit');
  await page.waitForSelector('.view-panel .fach-item >> text=Testgabel');
  await page.waitForTimeout(500);
  await shot('07-treffer-im-haus');

  step('Lager-Seiten: Einbuchen mit Fach-Auswahl, Suche, im Haus zeigen');
  await page.goto(base + '/#/ein');
  await page.fill('#name', 'Backpapier');
  await page.click('#where');
  await page.click('.pp-btn >> nth=0');
  await page.click('#f button[type="submit"]');
  await page.waitForSelector('.l-item-head');
  console.log('  Gegenstand:', (await page.innerText('.l-where')).replace(/\s+/g, ' '));
  await page.goto(base + '/#/suche?q=Backpapier');
  await page.waitForSelector('#inHouse:not([hidden])');
  await page.click('#inHouse');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));
  await page.waitForSelector('.view-panel .fach-item');
  console.log('  Haus zeigt:', await page.textContent('.view-panel .vp-title'));
  await page.goto(base + '/#/einkauf');
  await page.fill('#add input[name="name"]', 'Spülmittel');
  await page.click('#add button');
  await page.waitForSelector('.l-shop >> text=Spülmittel');
  await shot('07b-einkauf');
  await page.goto(base + '/#/haus');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));

  step('Assistent (simuliertes Modell): bucht per Werkzeug, zeigt den Ort im Haus');
  const { fakeLlm } = createRequire(import.meta.url)('../helpers.cjs');
  const llm = await fakeLlm();
  await page.evaluate((url) => fetch('/api/assistant/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base_url: url, model: 'test/modell', api_key: 'sk-test' }) }), llm.url);
  llm.replies.push({ tool_calls: [['einbuchen', { name: 'Batterien AA', menge: 8, platz: 'KU-C2' }]] }, { content: '8 Batterien AA liegen jetzt in KU-C2.' });
  await page.goto(base + '/#/assistent');
  await page.fill('#text', 'Leg 8 Batterien AA in die untere Schublade');
  await page.click('#send');
  await page.waitForSelector('.ai-bookings li', { timeout: 15000 });
  console.log('  Antwort:', await page.textContent('.ai-msg.bot .ai-bubble'), '| Buchung:', (await page.innerText('.ai-bookings li')).replace(/\s+/g, ' '));
  console.log('  Orte:', (await page.innerText('.ai-places')).replace(/\s+/g, ' '));
  await shot('07c-assistent');
  await page.click('[data-house]');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));
  await page.waitForSelector('.view-panel .vp-title');
  console.log('  Haus zeigt:', await page.textContent('.view-panel .vp-title'));

  step('Preisrecherche (simulierte Websuche) und Behälter');
  llm.replies.push(() => ({
    content: JSON.stringify({ angebote: [{ haendler: 'dm', filiale: 'Hauptstraße', packung: '500 ml', preis: 1.45, url: 'https://www.dm.de/spuelmittel', bestaetigt: true }, { haendler: 'Rewe', preis: 1.99, url: 'https://www.rewe.de/x', bestaetigt: true }], hinweis: null }),
    annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.dm.de/spuelmittel', title: 'dm', content: '' } }],
  }));
  await page.goto(base + '/#/einkauf');
  await page.waitForSelector('#priceGo');
  await page.click('#priceGo');
  await page.waitForSelector('.price-best', { timeout: 15000 });
  console.log('  Preis:', (await page.innerText('.price-best')).replace(/\s+/g, ' '), '|', (await page.innerText('.price-tour')).split('\n')[1]);
  await shot('07g-preise');
  await llm.stop();
  // Behälter: Werkzeugkiste anlegen, Testgabel hineinlegen
  const box = await page.evaluate(async () => {
    const r = await fetch('/api/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Werkzeugkiste', container: true, warehouse_id: 2, col: 'C', row: 0, quantity: 1 }) }).then((x) => x.json());
    return r;
  });
  await page.goto(base + `/#/item/${box.id}`);
  await page.waitForSelector('#boxPut');
  await page.click('#boxPut');
  await page.fill('.modal .fach-search', 'Testgabel');
  await page.click('.modal [data-put]:has-text("Testgabel")');
  await page.waitForSelector('.l-list >> text=Testgabel');
  console.log('  Behälter:', box.name, '| Inhalt:', await page.$$eval('.l-list .l-main b', (b) => b.map((x) => x.textContent)));

  step('Auswertung und Heatmap');
  await page.goto(base + '/#/auswertung');
  await page.waitForSelector('.l-kpis');
  console.log('  Kennzahlen:', (await page.innerText('.l-kpis')).replace(/\s+/g, ' '));
  await page.click('a[href="#/haus?heat=moves"]');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));
  await page.waitForTimeout(1500);
  console.log('  Heatmap:', await page.$eval('#heatSel', (s) => s.value));
  await shot('07d-heatmap');
  await page.goto(base + '/#/haus');

  step('Etiketten und 3D-Schilder für alle Fächer');
  await page.goto(base + '/#/etiketten');
  await page.waitForSelector('#allF');
  await page.click('#allF');
  await page.click('#showF');
  await page.waitForSelector('.label.fach svg');
  console.log('  ', await page.textContent('#count'), '| erstes:', (await page.innerText('.label.fach')).replace(/\s+/g, ' '));
  await shot('07e-etiketten');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#p3d')]);
  const file = `${DIR}/${dl.suggestedFilename()}`;
  await dl.saveAs(file);
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(file);
  console.log('  3D-Datei:', dl.suggestedFilename(), bytes.length, 'Bytes, ZIP:', bytes.slice(0, 2).toString() === 'PK');
  if (bytes.slice(0, 2).toString() !== 'PK') throw new Error('3MF ist kein ZIP-Paket');
  await page.goto(base + '/#/haus');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));

  step('Verwaltung: Person, API-Schlüssel, Backup, Lager, Export');
  await page.goto(base + '/#/verwaltung/personen');
  await page.click('#add');
  await page.fill('.modal [name="name"]', 'Ben');
  await page.fill('.modal [name="password"]', 'geheim22');
  await page.click('.modal [data-ok]');
  await page.waitForSelector('.l-item:has-text("Ben")');
  console.log('  Personen:', await page.$$eval('.l-item b', (b) => b.map((x) => x.textContent.trim())));
  await page.goto(base + '/#/verwaltung/schluessel');
  await page.fill('#f [name="name"]', 'Claude Test');
  await page.click('#f button');
  await page.waitForSelector('code.key');
  console.log('  Schlüssel:', (await page.textContent('code.key')).slice(0, 8) + '…');
  await page.keyboard.press('Escape');
  await page.goto(base + '/#/verwaltung/backups');
  await page.click('#now');
  await page.waitForSelector('.l-item[data-n]');
  console.log('  Backups:', await page.locator('.l-item[data-n]').count());
  await page.goto(base + '/#/verwaltung/lager');
  await page.waitForSelector('.l-item');
  console.log('  Lager:', (await page.$$eval('.l-item', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 50)))).join(' | '));
  await page.goto(base + '/#/verwaltung/transfer');
  const [x] = await Promise.all([page.waitForEvent('download'), page.click('#xlsx')]);
  console.log('  Export:', x.suggestedFilename());
  await page.goto(base + '/#/verwaltung/assistent');
  await page.waitForSelector('#f');
  await shot('07f-verwaltung');
  await page.goto(base + '/#/haus');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));

  step('Anleitung');
  await page.goto(base + '/#/hilfe');
  await page.waitForSelector('.help section');
  await page.fill('#hq', 'QR-Schilder');
  console.log('  Kapitel:', await page.locator('.help section').count(), '| Treffer „QR-Schilder“:', await page.locator('.help section:not([hidden])').count());
  await page.goto(base + '/#/haus');
  await page.waitForFunction(() => !document.body.classList.contains('mode-lager'));

  step('Planen: Werkzeugleiste, Möbel-Bibliothek – Sessel von Poly Haven importieren und platzieren');
  await page.click('#planStart');
  await page.waitForFunction(() => document.body.classList.contains('haus-plan'));
  await page.click('[data-drawer="catalog"]');
  await page.click('#modelLibrary');
  await page.click('#mlCats [data-cat="sitzen"]');
  await page.waitForSelector('.ml-card[data-id="ArmChair_01"]', { timeout: 30000 });
  console.log('  Treffer Sitzmöbel:', await page.locator('.ml-card').count());
  await page.click('.ml-card[data-id="ArmChair_01"]');
  await page.waitForFunction(() => window.__zuhause.plan.tool === 'place', null, { timeout: 60000 });
  const box2 = await page.locator('#plan canvas').boundingBox();
  await page.mouse.move(box2.x + box2.width * 0.35, box2.y + box2.height * 0.6);
  await page.mouse.click(box2.x + box2.width * 0.35, box2.y + box2.height * 0.6);
  const chair = await page.evaluate(() => { const i = window.__zuhause.store.floor.items.find((x) => x.type === 'model'); return i && { name: i.model.name, w: i.width, d: i.depth, h: i.height }; });
  console.log('  platziert:', JSON.stringify(chair));
  if (!chair) throw new Error('Modell nicht platziert');
  await page.waitForTimeout(2500);
  await page.click('[data-cam="perspective"]');
  await page.waitForTimeout(2500);
  await shot('07h-moebel');
  await page.click('[data-drawer="room"]');

  step('Etage darüber anlegen, Haus-Ansicht');
  await page.click('#floorTabs [data-add]');
  await page.click('[data-k="floor"]');
  await page.waitForFunction(() => document.querySelectorAll('#floorTabs .floor-tab[data-f]').length === 2);
  console.log('  Etagen:', await page.$$eval('#floorTabs .floor-tab[data-f]', (b) => b.map((x) => x.textContent)));
  await page.click('#houseMode [data-h="house"]');
  await page.waitForTimeout(800);
  await shot('08-haus');
  await page.waitForFunction(() => document.querySelector('#saveStatus')?.textContent?.includes('Gespeichert'), null, { timeout: 15000 });
  const h = await page.evaluate(() => fetch('/api/house').then((r) => r.json()));
  console.log('  Server: Version', h.version, 'Etagen', h.house.floors.map((f) => `${f.name}(${f.walls.length} Wände)`));
  await page.click('#planDone');
  await page.waitForFunction(() => document.body.classList.contains('haus-view'));

  step('Einstellungen: Startseite Haus, 3D, dunkel, große Schrift');
  await page.goto(base + '/#/einstellungen');
  await page.click('[data-k="start"] [data-v="house"]');
  await page.click('[data-k="houseView"] [data-v="3d"]');
  await page.click('[data-k="theme"] [data-v="dark"]');
  await page.click('[data-k="fontSize"] [data-v="large"]');
  await page.waitForFunction(() => document.documentElement.dataset.font === 'large');
  await page.waitForTimeout(400);
  await page.goto(base + '/');
  await page.reload();
  await page.waitForFunction(() => location.hash === '#/haus' && document.querySelector('#main')?.className === 'v-3d', null, { timeout: 10000 });
  console.log('  Start:', new URL(page.url()).hash, '| Ansicht:', await page.$eval('#main', (m) => m.className), '| Theme:', await page.evaluate(() => document.documentElement.dataset.theme));
  await shot('09-einstellungen-dunkel');
  await page.evaluate(() => fetch('/api/auth/me/prefs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: 'overview', houseView: '2d', theme: 'auto', fontSize: 'normal' }) }));

  step('Recht „Haus planen“: Ben ohne Recht sieht keinen Planen-Knopf');
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/#/lager');
  await p2.evaluate(async () => {
    const st = await fetch('/api/auth/status').then((r) => r.json());
    const ben = st.users.find((u) => u.name === 'Ben');
    await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person_id: ben.id, password: 'geheim22' }) });
  });
  await p2.goto(base + '/#/haus');
  await p2.reload();
  await p2.waitForSelector('.view-panel [data-room]');
  console.log('  Planen-Knopf für Ben sichtbar:', await p2.isVisible('#planStart'));
  if (await p2.isVisible('#planStart')) throw new Error('Ben darf nicht planen');
  await ctx2.close();

  step('Handy: Leiste unten, Auswahl als Blatt');
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await page.context().storageState() });
  const p3 = await ctx3.newPage();
  await p3.goto(base + '/#/lager');
  await p3.waitForSelector('#tabbar .tab-scan');
  await p3.screenshot({ path: `${DIR}/10-handy-start.png` });
  await p3.goto(base + '/#/haus');
  await p3.waitForSelector('#floorTabs .floor-tab');
  await p3.evaluate(() => { const z = window.__zuhause; const it = z.store.floor.items.find((i) => i.storageCol); z.store.select({ kind: 'item', id: it.id }); });
  await p3.waitForFunction(() => document.body.classList.contains('sheet-open'));
  await p3.waitForTimeout(400);
  await p3.screenshot({ path: `${DIR}/11-handy-blatt.png` });
  console.log('  Blatt:', await p3.textContent('.view-panel .vp-title'));
  await ctx3.close();
} catch (e) {
  failed = true;
  console.log('FEHLER:', e.message);
  await shot('99-fehler');
} finally {
  console.log('Fehler im Browser:', errors.length ? errors : 'keine');
  await browser.close();
  srv.kill();
  if (/Error|Fehler/.test(log)) console.log('Server-Log:', log.slice(-1500));
}
if (failed || errors.length) process.exit(1);
console.log('✓ Klicktest bestanden');
