'use strict';
// Servermeldungen auf Englisch: Sprache je Anfrage aus Cookie zh_lang oder Accept-Language, ohne beides Deutsch
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupUsers, fakeLlm } = require('./helpers.cjs');

let srv, llm, admin;
before(async () => {
  llm = await fakeLlm();
  srv = await startServer();
  ({ admin } = await setupUsers(srv.base));
});
after(async () => { await srv.stop(); await llm.stop(); });

// Anfrage mit der Sitzung des Clients und zusätzlicher Sprachangabe
async function call(c, method, url, body, { lang, acceptLanguage } = {}) {
  const headers = { cookie: [c.cookie, lang ? `zh_lang=${lang}` : ''].filter(Boolean).join('; ') };
  if (acceptLanguage) headers['accept-language'] = acceptLanguage;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

test('Fehlermeldung je nach Sprache: Cookie, Accept-Language, sonst Deutsch', async () => {
  const en = await call(admin, 'GET', '/api/items/999999', undefined, { lang: 'en' });
  assert.equal(en.status, 404);
  assert.equal(en.data.error, 'Item not found.');
  const al = await call(admin, 'GET', '/api/items/999999', undefined, { acceptLanguage: 'en-GB,en;q=0.9' });
  assert.equal(al.data.error, 'Item not found.');
  const de = await call(admin, 'GET', '/api/items/999999');
  assert.equal(de.data.error, 'Gegenstand nicht gefunden.');
  // Cookie hat Vorrang vor Accept-Language
  const both = await call(admin, 'GET', '/api/items/999999', undefined, { lang: 'de', acceptLanguage: 'en' });
  assert.equal(both.data.error, 'Gegenstand nicht gefunden.');
  // Platzhalter
  const v = await call(admin, 'POST', '/api/checkin', { name: 'Milch', col: 'A', row: 1, expires_on: 'morgen' }, { lang: 'en' });
  assert.equal(v.status, 400);
  assert.equal(v.data.error, 'Expiry date "morgen" not understood (e.g. 31.03.2027 or 03/2027).');
});

test('Mehrzahl: Lager mit Gegenständen lässt sich nicht löschen', async () => {
  const w = (await admin.post('/api/warehouses', { name: 'Garage', code: 'G' })).data;
  await admin.post('/api/checkin', { name: 'Leiter', warehouse_id: w.id, col: 'A', row: 1 });
  const one = await call(admin, 'DELETE', `/api/warehouses/${w.id}`, undefined, { lang: 'en' });
  assert.equal(one.status, 409);
  assert.equal(one.data.error, 'There is still 1 item in the storage area. Please move or delete it first.');
  await admin.post('/api/checkin', { name: 'Eimer', warehouse_id: w.id, col: 'A', row: 2 });
  const two = await call(admin, 'DELETE', `/api/warehouses/${w.id}`, undefined, { lang: 'en' });
  assert.equal(two.data.error, 'There are still 2 items in the storage area. Please move or delete them first.');
  const de = await call(admin, 'DELETE', `/api/warehouses/${w.id}`);
  assert.equal(de.data.error, 'Im Lager liegen noch 2 Gegenstände. Bitte zuerst umlagern oder löschen.');
});

test('Assistent: antwortet in der Sprache der App, Systemprompt sagt es dem Modell', async () => {
  await admin.put('/api/assistant/settings', { base_url: llm.url, model: 'test/modell', api_key: 'sk-test-1234' });
  llm.replies.push({ content: '' });
  const en = await call(admin, 'POST', '/api/assistant', { message: 'Hello' }, { lang: 'en' });
  assert.equal(en.status, 200);
  assert.equal(en.data.reply, 'Done.', 'Ersatzantwort auf Englisch');
  const sys = llm.requests.at(-1).body.messages[0].content;
  assert.match(sys, /Antworte auf Englisch/);
  assert.doesNotMatch(sys, /Antworte auf Deutsch/);

  llm.replies.push({ content: '' });
  const de = await call(admin, 'POST', '/api/assistant', { message: 'Hallo' });
  assert.equal(de.data.reply, 'Erledigt.');
  assert.match(llm.requests.at(-1).body.messages[0].content, /Antworte auf Deutsch/);

  // Werkzeugmeldungen für die Buchungskarten in der App
  llm.replies.push({ tool_calls: [['einbuchen', { name: 'Hammer', platz: 'G-B1' }]] }, { content: 'OK' });
  const b = await call(admin, 'POST', '/api/assistant', { message: 'Put the hammer in G-B1' }, { lang: 'en' });
  assert.equal(b.data.bookings[0].text, 'Checked in 1× Hammer to G-B1. Stock now 1.');
});
