'use strict';
// Aufgaben: einmalig und wiederkehrend, Personen zuordnen, an ein Fach hängen, erledigen und rückgängig,
// Wandterminal darf nur abhaken (mit „wer“)
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client } = require('./helpers.cjs');
const { addInterval, nextDue, localDate } = require('../server/lager/recur.cjs');

test('Wiederholung: Termine rechnen', () => {
  assert.equal(addInterval('2026-10-04', 'day', 3), '2026-10-07');
  assert.equal(addInterval('2026-12-28', 'week', 1), '2027-01-04');
  // Monatsende bleibt Monatsende, auch über mehrere Monate (kein Rutschen auf den 28.)
  assert.equal(addInterval('2026-01-31', 'month', 1), '2026-02-28');
  assert.equal(addInterval('2028-02-29', 'year', 1), '2029-02-28');
  assert.equal(nextDue({ due_on: '2026-01-31', repeat_unit: 'month', repeat_every: 1 }, '2026-03-05'), '2026-03-31');
  // nach Plan: verpasste Termine werden übersprungen, der Rhythmus bleibt
  assert.equal(nextDue({ due_on: '2026-09-28', repeat_unit: 'week', repeat_every: 2 }, '2026-10-04'), '2026-10-12');
  assert.equal(nextDue({ due_on: '2026-10-04', repeat_unit: 'week', repeat_every: 1 }, '2026-10-04'), '2026-10-11');
  // ab Erledigung: von heute an
  assert.equal(nextDue({ due_on: '2026-09-01', repeat_unit: 'day', repeat_every: 3, repeat_from_done: 1 }, '2026-10-04'), '2026-10-07');
  // vorzeitig erledigt (Termin liegt noch in der Zukunft): nächster Termin nach dem geplanten
  assert.equal(nextDue({ due_on: '2026-10-10', repeat_unit: 'month', repeat_every: 3 }, '2026-10-04'), '2027-01-10');
});

let srv;
let anna;
let annaId;
let benId;
test.before(async () => {
  srv = await startServer();
  anna = client(srv.base);
  await anna.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
  annaId = (await anna.get('/api/auth/me')).data.user.id;
  const ben = await anna.post('/api/persons', { name: 'Ben', password: 'geheim2' });
  benId = ben.data.id;
});
test.after(() => srv.stop());

const today = localDate();
const past = addInterval(today, 'day', -3);

test('Aufgaben anlegen, prüfen und sortiert auflisten', async () => {
  assert.equal((await anna.post('/api/tasks', { title: '  ' })).status, 400);
  assert.equal((await anna.post('/api/tasks', { title: 'X', repeat_unit: 'stündlich' })).status, 400);
  assert.equal((await anna.post('/api/tasks', { title: 'X', assignee_id: 999 })).status, 400);
  assert.equal((await anna.post('/api/tasks', { title: 'X', due_on: '31.02.2027' })).status, 400);
  const wh = (await anna.get('/api/warehouses')).data[0];
  const a = await anna.post('/api/tasks', { title: 'Filter Dunstabzug tauschen', due_on: past, repeat_unit: 'month', repeat_every: 3, assignee_id: benId, place: { warehouse_id: wh.id, col: 'b', row: 2 } });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.assignee, 'Ben');
  assert.equal(a.data.col, 'B');
  assert.equal(a.data.wh_code, wh.code);
  const b = await anna.post('/api/tasks', { title: 'Müll rausbringen', repeat_unit: 'week' });
  assert.equal(b.data.due_on, today, 'wiederkehrend ohne Datum: ab heute');
  await anna.post('/api/tasks', { title: 'Keller aufräumen' });
  const list = (await anna.get('/api/tasks')).data;
  assert.equal(list.today, today);
  assert.deepEqual(list.open.map((t) => t.title), ['Filter Dunstabzug tauschen', 'Müll rausbringen', 'Keller aufräumen']);
  assert.deepEqual(list.open.map((t) => [t.overdue, t.due_today]), [[true, false], [false, true], [false, false]]);
});

test('Erledigen: wiederkehrend rückt weiter, einmalig ist erledigt; rückgängig stellt her', async () => {
  const open = (await anna.get('/api/tasks')).data.open;
  const filter = open.find((t) => t.title.startsWith('Filter'));
  const r = await anna.post(`/api/tasks/${filter.id}/done`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.due_on, nextDue({ due_on: past, repeat_unit: 'month', repeat_every: 3 }, today));
  assert.ok(r.data.task.due_on > today);
  assert.equal(r.data.task.done_at, null);
  const keller = open.find((t) => t.title === 'Keller aufräumen');
  const k = await anna.post(`/api/tasks/${keller.id}/done`, {});
  assert.ok(k.data.task.done_at);
  assert.equal(k.data.task.done_by_name, 'Anna');
  assert.equal((await anna.post(`/api/tasks/${keller.id}/done`, {})).status, 409);
  const list = (await anna.get('/api/tasks')).data;
  assert.ok(!list.open.some((t) => t.id === keller.id));
  assert.deepEqual(list.done.slice(0, 2).map((d) => [d.title, d.done_by_name]), [['Keller aufräumen', 'Anna'], ['Filter Dunstabzug tauschen', 'Anna']]);
  // rückgängig
  assert.equal((await anna.post(`/api/tasks/${filter.id}/undo`, {})).data.due_on, past);
  assert.equal((await anna.post(`/api/tasks/${keller.id}/undo`, {})).data.done_at, null);
  assert.equal((await anna.post(`/api/tasks/${keller.id}/undo`, {})).status, 409);
});

test('Ändern und löschen', async () => {
  const t = (await anna.get('/api/tasks')).data.open.find((x) => x.title === 'Müll rausbringen');
  const u = await anna.patch(`/api/tasks/${t.id}`, { assignee_id: annaId, repeat_every: 2, repeat_from_done: true, note: 'gelbe Tonne' });
  assert.equal(u.status, 200);
  assert.deepEqual([u.data.assignee, u.data.repeat_every, u.data.repeat_from_done, u.data.note, u.data.title], ['Anna', 2, 1, 'gelbe Tonne', 'Müll rausbringen']);
  const nr = await anna.patch(`/api/tasks/${t.id}`, { repeat_unit: null, place: null });
  assert.equal(nr.data.repeat_unit, null);
  assert.equal((await anna.del(`/api/tasks/${t.id}`)).status, 200);
  assert.equal((await anna.get(`/api/tasks`)).data.open.some((x) => x.id === t.id), false);
});

test('Wandterminal: sieht Aufgaben, hakt ab, legt an, ändert und löscht – immer mit „wer“', async () => {
  const link = (await anna.post('/api/terminals', { name: 'Test-Terminal' })).data.path;
  const r = await fetch(srv.base + link, { redirect: 'manual' });
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('zh_terminal=')).split(';')[0];
  const t = async (method, url, body) => {
    const x = await fetch(srv.base + url, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: x.status, data: await x.json().catch(() => null) };
  };
  const list = await t('GET', '/api/tasks');
  assert.equal(list.status, 200);
  const keller = list.data.open.find((x) => x.title === 'Keller aufräumen');
  assert.equal((await t('POST', '/api/tasks', { title: 'Neu' })).status, 400, 'ohne Person');
  const neu = await t('POST', '/api/tasks', { title: 'Blumen gießen', person_id: benId });
  assert.equal(neu.status, 200, JSON.stringify(neu.data));
  assert.equal((await t('PATCH', `/api/tasks/${neu.data.id}`, { title: 'Blumen gießen (Balkon)', person_id: benId })).data.title, 'Blumen gießen (Balkon)');
  // DELETE mit Inhalt (person_id) – so schickt es die App
  assert.equal((await t('DELETE', `/api/tasks/${neu.data.id}`)).status, 400, 'ohne Person');
  assert.equal((await t('DELETE', `/api/tasks/${neu.data.id}`, { person_id: benId })).status, 200);
  assert.equal((await t('GET', '/api/tasks')).data.open.some((x) => x.id === neu.data.id), false);
  // Einkaufsliste: Eintrag löschen ebenso
  const e = await t('POST', '/api/shopping', { name: 'Milch', person_id: benId });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal((await t('DELETE', `/api/shopping/${e.data.id}`, { person_id: benId })).status, 200);
  const no = await t('POST', `/api/tasks/${keller.id}/done`, {});
  assert.equal(no.status, 400);
  assert.match(no.data.error, /wer bucht/);
  const ok = await t('POST', `/api/tasks/${keller.id}/done`, { person_id: benId });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.task.done_by_name, 'Ben');
  assert.equal((await t('POST', `/api/tasks/${keller.id}/undo`, { person_id: benId })).status, 200);
});
