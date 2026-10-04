'use strict';
// Persönliche Einstellungen der App (Startseite, Ansicht im Haus, Darstellung) und letzte Buchungen für die Übersicht
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers.cjs');

let srv;
let anna;
test.before(async () => {
  srv = await startServer();
  anna = client(srv.base);
  await anna.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
});
test.after(() => srv.stop());

test('Standardwerte, ändern, ungültige Werte abgelehnt, ohne Anmeldung nicht', async () => {
  const me = await anna.get('/api/auth/me');
  assert.deepEqual(me.data.user.prefs, { start: 'overview', houseView: '2d', theme: 'auto', fontSize: 'normal' });

  const r = await anna.patch('/api/auth/me/prefs', { start: 'house', theme: 'dark' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { start: 'house', houseView: '2d', theme: 'dark', fontSize: 'normal' });
  assert.equal((await anna.get('/api/auth/me')).data.user.prefs.start, 'house');

  assert.equal((await anna.patch('/api/auth/me/prefs', { fontSize: 'riesig' })).status, 400);
  assert.equal((await anna.get('/api/auth/me')).data.user.prefs.fontSize, 'normal');
  assert.equal((await client(srv.base).patch('/api/auth/me/prefs', { start: 'house' })).status, 401);
});

test('Einstellungen gehören der Person: Ben sieht seine eigenen', async () => {
  await anna.post('/api/persons', { name: 'Ben', password: 'geheim2' });
  const ben = client(srv.base);
  const benId = (await ben.get('/api/auth/status')).data.users.find((u) => u.name === 'Ben').id;
  await ben.post('/api/auth/login', { person_id: benId, password: 'geheim2' });
  assert.equal((await ben.get('/api/auth/me')).data.user.prefs.start, 'overview');
  await ben.patch('/api/auth/me/prefs', { houseView: '3d' });
  assert.equal((await anna.get('/api/auth/me')).data.user.prefs.houseView, '2d');
});

test('Letzte Buchungen über alle Lager', async () => {
  const wh = (await anna.get('/api/warehouses')).data[0];
  await anna.post('/api/places', { warehouse_id: wh.id, col: 'A', row: 1, name: 'Testfach' }).catch(() => {});
  const ci = await anna.post('/api/checkin', { name: 'Mehl', quantity: 2, warehouse_id: wh.id, col: 'A', row: 1 });
  assert.equal(ci.status, 200, JSON.stringify(ci.data));
  const r = await anna.get('/api/movements/recent?limit=3');
  assert.equal(r.status, 200);
  assert.equal(r.data[0].item, 'Mehl');
  assert.equal(r.data[0].type, 'in');
  assert.equal(r.data[0].quantity, 2);
  assert.ok(r.data.length <= 3);
});
