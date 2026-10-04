'use strict';
// Zuhause: gemeinsames Konto, gespeicherte Planungen, Auslieferung der App
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers.cjs');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.stop());

const PLAN = {
  version: 1, name: 'Testküche',
  walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, thickness: 12, height: 250 }],
  openings: [],
  items: [
    { id: 'u1', type: 'base-drawers', x: 30, y: 30, rotation: 0, width: 60, depth: 60, height: 90, elevation: 0, front: 'drawers', drawers: 4 },
    { id: 'o1', type: 'wall-doors', x: 30, y: 17.5, rotation: 0, width: 60, depth: 35, height: 72, elevation: 145, front: 'doors' },
    { id: 'k1', type: 'tall-fridge', x: 130, y: 30, rotation: 0, width: 60, depth: 60, height: 216, elevation: 0 },
    { id: 'h1', type: 'stool', x: 200, y: 200, rotation: 0, width: 40, depth: 40, height: 65, elevation: 0 },
  ],
  slots: {}, customMaterials: [], settings: { ceiling: false, backsplash: true, plinth: 10, countertopThickness: 4, timeOfDay: 12 },
};

let admin;
let adminId;

test('Ein Konto für alles: Registrieren per E-Mail, dann auch per Kachel anmelden', async () => {
  admin = client(srv.base);
  const me0 = await admin.get('/api/auth/me');
  assert.equal(me0.data.firstUser, true);
  assert.equal(me0.data.registrationEnabled, true, 'das erste Konto geht immer');

  const reg = await admin.post('/api/auth/register', { email: 'Anna@Example.de', name: 'Anna', password: 'geheim123' });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal(reg.data.user.role, 'admin');
  assert.equal(reg.data.user.email, 'anna@example.de');
  adminId = reg.data.user.id;

  // dieselbe Sitzung gilt im Lager
  const st = await admin.get('/api/auth/status');
  assert.equal(st.data.me.name, 'Anna');
  assert.equal(st.data.setup, false);

  // Kachel-Login (Lager) und E-Mail-Login (Küche) mit demselben Passwort
  const a = client(srv.base);
  assert.equal((await a.post('/api/auth/login', { person_id: adminId, password: 'geheim123' })).status, 200);
  const b = client(srv.base);
  assert.equal((await b.post('/api/auth/login', { email: 'anna@example.de', password: 'falsch!!' })).status, 401);
  assert.equal((await b.post('/api/auth/login', { email: 'ANNA@example.de', password: 'geheim123' })).status, 200);
  assert.equal((await b.get('/api/auth/me')).data.user.name, 'Anna');
});

test('Registrierung: standardmäßig aus, mit Freigabepflicht wartet das Konto', async () => {
  const bob = client(srv.base);
  assert.equal((await bob.post('/api/auth/register', { email: 'bob@example.de', password: 'geheim123' })).status, 403);

  assert.equal((await admin.put('/api/admin/settings', { registrationEnabled: true, requireApproval: true })).status, 200);
  const reg = await bob.post('/api/auth/register', { email: 'bob@example.de', name: 'Bob', password: 'geheim123' });
  assert.equal(reg.data.pending, true);
  assert.equal((await bob.post('/api/auth/login', { email: 'bob@example.de', password: 'geheim123' })).status, 403);
  // wartende Konten erscheinen nicht als Kachel
  assert.ok(!(await bob.get('/api/auth/status')).data.users.some((u) => u.name === 'Bob'));

  const users = (await admin.get('/api/admin/users')).data.users;
  const b = users.find((u) => u.email === 'bob@example.de');
  assert.equal(b.status, 'pending');
  assert.equal((await admin.put(`/api/admin/users/${b.id}`, { status: 'active' })).status, 200);
  assert.equal((await bob.post('/api/auth/login', { email: 'bob@example.de', password: 'geheim123' })).status, 200);
  // Bob darf im Lager buchen, aber nicht verwalten
  assert.equal((await bob.get('/api/items?q=')).status, 200);
  assert.equal((await bob.get('/api/admin/users')).status, 403);
});

test('Küchenplanungen gehören dem Konto, Showroom-Link ohne Anmeldung', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/projects')).status, 401);
  const created = await admin.post('/api/projects', { name: 'Meine Küche', data: PLAN });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal((await admin.get('/api/projects')).data.projects.length, 1);

  const bob = client(srv.base);
  await bob.post('/api/auth/login', { email: 'bob@example.de', password: 'geheim123' });
  assert.equal((await bob.get('/api/projects')).data.projects.length, 0);
  assert.equal((await bob.get(`/api/projects/${id}`)).status, 404);

  const share = await admin.post(`/api/projects/${id}/share`, {});
  const shared = await anon.get(`/api/shared/${share.data.token}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.data.name, 'Meine Küche');
});

test('Personen zusammenführen nimmt Küchenplanungen mit', async () => {
  const users = (await admin.get('/api/admin/users')).data.users;
  const bobId = users.find((u) => u.email === 'bob@example.de').id;
  const bob = client(srv.base);
  await bob.post('/api/auth/login', { email: 'bob@example.de', password: 'geheim123' });
  assert.equal((await bob.post('/api/projects', { name: 'Bobs Küche', data: PLAN })).status, 201);

  const del = await admin.del(`/api/persons/${bobId}?merge_into=${adminId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const names = (await admin.get('/api/projects')).data.projects.map((p) => p.name).sort();
  assert.deepEqual(names, ['Bobs Küche', 'Meine Küche']);
});

test('App unter /, frühere Adressen (/app/, /kueche/, /alt/, /textures/) werden umgeleitet', async () => {
  const res = await fetch(`${srv.base}/`);
  assert.ok([200, 503].includes(res.status), `Status ${res.status}`);
  if (res.status === 200) assert.match(await res.text(), /<div id="app">/);
  for (const [from, to] of [['/app/', '/'], ['/kueche/', '/'], ['/textures/wood_floor/thumb.jpg', '/app/textures/wood_floor/thumb.jpg']]) {
    const r = await fetch(`${srv.base}${from}`, { redirect: 'manual' });
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  // QR-Etiketten öffnen die App
  const q = await fetch(`${srv.base}/q/P-H-B12`, { redirect: 'manual' });
  assert.equal(q.headers.get('location'), '/#/q/P-H-B12');
  // frühere Oberfläche führt zur App; ihr Service-Worker wird durch einen abmeldenden ersetzt
  const alt = await fetch(`${srv.base}/alt/`, { redirect: 'manual' });
  assert.equal(alt.headers.get('location'), '/');
  const sw = await fetch(`${srv.base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(await sw.text(), /unregister/);
  assert.equal((await fetch(`${srv.base}/irgendwas`)).status, 404);
  if (res.status === 200) assert.equal((await fetch(`${srv.base}/app/vendor/qrcode.js`)).status, 200);
});

test('Eigenes 3D-Modell (.glb) hochladen: wird gespeichert und ausgeliefert, anderes wird abgelehnt', async () => {
  // kleinstes gültiges GLB: Kopf + leerer JSON-Block
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28, ' '));
  const glb = Buffer.alloc(12 + 8 + json.length);
  glb.write('glTF', 0, 'latin1');
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.write('JSON', 16, 'latin1');
  json.copy(glb, 20);
  const res = await fetch(`${srv.base}/api/library/models/upload?name=Mein%20Sofa.glb`, { method: 'POST', body: glb, headers: { 'content-type': 'application/octet-stream', cookie: admin.cookie } });
  const d = await res.json();
  assert.equal(res.status, 200, JSON.stringify(d));
  assert.equal(d.name, 'Mein Sofa');
  assert.match(d.url, /^\/library\/models\/eigene\/[0-9a-f]+\.glb$/);
  const get = await fetch(srv.base + d.url);
  assert.equal(get.status, 200);
  assert.equal(Buffer.from(await get.arrayBuffer()).length, glb.length);
  const bad = await fetch(`${srv.base}/api/library/models/upload?name=x.txt`, { method: 'POST', body: 'hallo', headers: { 'content-type': 'application/octet-stream', cookie: admin.cookie } });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${srv.base}/api/library/models/upload`, { method: 'POST', body: glb })).status, 401);
});
