'use strict';
// Wandterminals: Einrichtungslink, Geräte-Anmeldung ohne Person, Buchen nur mit „wer bucht“, keine Verwaltung
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers.cjs');

let srv;
let admin;
let annaId;
test.before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  await admin.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
  annaId = (await admin.get('/api/auth/me')).data.user.id;
});
test.after(() => srv.stop());

/** Einrichtungslink öffnen wie das Tablet: Cookie aus der Weiterleitung übernehmen */
async function pair(path) {
  const r = await fetch(srv.base + path, { redirect: 'manual' });
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('zh_terminal='));
  return { status: r.status, location: r.headers.get('location'), cookie: cookie?.split(';')[0] };
}
const as = (cookie) => async (method, url, body) => {
  const r = await fetch(srv.base + url, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};

let term;
let link;
test('Admin legt ein Terminal an, Einstellungen werden geprüft', async () => {
  const bad = await admin.post('/api/terminals', { name: 'Diele', settings: { orientation: 'schräg' } });
  assert.equal(bad.status, 400);
  const r = await admin.post('/api/terminals', { name: 'Diele', settings: { orientation: 'landscape', houseView: '3d', plz: '10115', idleMinutes: 5 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  term = r.data.terminal;
  link = r.data.path;
  assert.match(link, /^\/terminal\/[\w-]{20,}$/);
  assert.deepEqual(term.settings, { orientation: 'landscape', houseView: '3d', theme: 'auto', fontSize: 'normal', idleMinutes: 5, screensaver: true, plz: '10115' });
  const u = await admin.patch(`/api/terminals/${term.id}`, { settings: { orientation: 'portrait' } });
  assert.equal(u.data.settings.orientation, 'portrait');
  assert.equal(u.data.settings.plz, '10115', 'übrige Einstellungen bleiben');
  assert.equal((await client(srv.base).get('/api/terminals')).status, 401);
});

test('Einrichtungslink setzt das Geräte-Cookie; das Gerät sieht das Haus, aber keine Verwaltung', async () => {
  const p = await pair(link);
  assert.equal(p.status, 302);
  assert.equal(p.location, '/#/haus');
  assert.ok(p.cookie);
  const t = as(p.cookie);
  const me = await t('GET', '/api/auth/me');
  assert.equal(me.data.user, null);
  assert.equal(me.data.terminal.name, 'Diele');
  assert.equal(me.data.terminal.settings.orientation, 'portrait');
  assert.equal((await t('GET', '/api/house')).status, 200);
  assert.equal((await t('GET', '/api/house')).data.can_edit, false);
  assert.equal((await t('GET', '/api/items?q=')).status, 200);
  assert.equal((await t('GET', '/api/terminals')).status, 403);
  assert.equal((await t('GET', '/api/persons?all=1')).status, 403);
  assert.equal((await t('PUT', '/api/house', { house: {}, base_version: 0 })).status, 403);
  assert.equal((await t('POST', '/api/persons', { name: 'X', person_id: annaId })).status, 403);
});

test('Buchen am Terminal nur mit „wer bucht“ – die Buchung gehört dieser Person', async () => {
  const t = as((await pair(link)).cookie);
  const wh = (await admin.get('/api/warehouses')).data[0];
  const body = { name: 'Kerzen', quantity: 4, warehouse_id: wh.id, col: 'A', row: 1 };
  const no = await t('POST', '/api/checkin', body);
  assert.equal(no.status, 400);
  assert.match(no.data.error, /wer bucht/);
  const ok = await t('POST', '/api/checkin', { ...body, person_id: annaId });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const recent = (await admin.get('/api/movements/recent?limit=1')).data[0];
  assert.equal(recent.person, 'Anna');
  assert.equal(recent.item, 'Kerzen');
  const out = await t('POST', '/api/checkout', { item_id: ok.data.id, quantity: 1, person_id: annaId });
  assert.equal(out.status, 200);
  assert.equal(out.data.quantity, 3);
});

test('Neuer Link ersetzt den alten, Löschen sperrt das Gerät aus', async () => {
  const old = (await pair(link)).cookie;
  const n = await admin.post(`/api/terminals/${term.id}/link`, {});
  assert.equal((await pair(link)).status, 404, 'alter Link ungültig');
  assert.equal((await as(old)('GET', '/api/auth/me')).data.terminal, null);
  const fresh = (await pair(n.data.path)).cookie;
  assert.equal((await as(fresh)('GET', '/api/auth/me')).data.terminal.name, 'Diele');
  await admin.del(`/api/terminals/${term.id}`);
  assert.equal((await as(fresh)('GET', '/api/house')).status, 401);
});
