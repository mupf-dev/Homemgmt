'use strict';
// REST-API: Anmeldung, Rechte, Buchungen, Rückgängig, Einkaufsliste, Fotos, Auswertung, Import, Backups, API-Schlüssel
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, setupUsers, FAKE_JPEG } = require('./helpers.cjs');

let srv, admin, user, benId;
before(async () => {
  srv = await startServer();
  ({ admin, user, benId } = await setupUsers(srv.base));
});
after(() => srv.stop());

test('Ersteinrichtung und Anmeldung', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/items')).status, 401, 'ohne Anmeldung gesperrt');
  const st = (await anon.get('/api/auth/status')).data;
  assert.equal(st.setup, false);
  assert.deepEqual(st.users.map((u) => u.name).sort(), ['Anna', 'Ben']);
  assert.equal((await anon.post('/api/auth/setup', { name: 'X', password: 'geheim1' })).status, 409, 'Setup nur einmal');
  assert.equal((await anon.post('/api/auth/login', { person_id: benId, password: 'falsch' })).status, 401);
  const ok = await anon.post('/api/auth/login', { person_id: benId, password: '1234' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  await anon.post('/api/auth/logout');
  assert.equal((await anon.get('/api/items')).status, 401, 'nach dem Abmelden gesperrt');
});

test('Passwort-Hashes werden nie ausgeliefert', async () => {
  const all = await admin.get('/api/persons?all=1');
  assert.ok(!JSON.stringify(all.data).includes('scrypt'));
});

test('Sperre nach wiederholt falschem Passwort', async () => {
  const c = client(srv.base);
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { person_id: 999, password: 'x' });
  assert.equal((await c.post('/api/auth/login', { person_id: 999, password: 'x' })).status, 429);
});

test('Rollen: Benutzer darf buchen, aber nicht verwalten', async () => {
  assert.equal((await user.post('/api/warehouses', { name: 'Keller', code: 'K' })).status, 403);
  assert.equal((await user.get('/api/keys')).status, 403);
  assert.equal((await user.get('/api/backups')).status, 403);
  assert.equal((await user.post('/api/import', { dry: true, rows: [{ name: 'x' }] })).status, 403);
  assert.equal((await admin.post('/api/warehouses', { name: 'Keller', code: 'K' })).status, 200);
});

test('Einbuchen und Ausbuchen, Buchung gehört der angemeldeten Person', async () => {
  const r = await user.post('/api/checkin', { name: 'Hammer', col: 'A', row: 1, quantity: 2, person_id: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.quantity, 2);
  assert.equal(r.data.last_person, 'Ben', 'person_id im Body wird ignoriert');
  assert.ok(r.data.movement_id);
  const out = await user.post('/api/checkout', { item_id: r.data.id, quantity: 5 });
  assert.equal(out.status, 400, 'nicht mehr ausbuchen als da ist');
  assert.equal((await user.post('/api/checkout', { item_id: r.data.id })).data.quantity, 1);
});

test('Verbrauchsmaterial landet auf der Einkaufsliste – Rückgängig nimmt es wieder herunter', async () => {
  const it = (await user.post('/api/checkin', { name: 'Kaffee', col: 'B', row: 2, quantity: 5, consumable: true })).data;
  const out = (await user.post('/api/checkout', { item_id: it.id, quantity: 2 })).data;
  assert.equal(out.shopping_added, 2);
  const list = () => user.get('/api/shopping').then((r) => r.data.open.filter((e) => e.item_id === it.id));
  assert.equal((await list())[0].quantity, 2);
  const u = await user.post(`/api/movements/${out.movement_id}/undo`);
  assert.equal(u.status, 200);
  assert.equal(u.data.item.quantity, 5);
  assert.equal((await list()).length, 0);
});

test('Rückgängig: Neuanlage, Umlagern, nur letzte Buchung, nur eigene', async () => {
  const neu = (await user.post('/api/checkin', { name: 'Wegwerf', col: 'C', row: 3 })).data;
  const u1 = await user.post(`/api/movements/${neu.movement_id}/undo`);
  assert.equal(u1.data.deleted_item, true);
  assert.equal((await user.get(`/api/items/${neu.id}`)).status, 404);

  const it = (await user.post('/api/checkin', { name: 'Kabel', col: 'A', row: 1, quantity: 2 })).data;
  const moved = (await user.post('/api/checkin', { item_id: it.id, col: 'D', row: 4, quantity: 1 })).data;
  assert.equal(`${moved.col}${moved.row}`, 'D4');
  const back = (await user.post(`/api/movements/${moved.movement_id}/undo`)).data.item;
  assert.equal(`${back.col}${back.row}`, 'A1', 'vorheriger Platz wiederhergestellt');
  assert.equal(back.quantity, 2);

  const m1 = (await user.post('/api/checkout', { item_id: it.id })).data.movement_id;
  await user.post('/api/checkout', { item_id: it.id });
  assert.equal((await user.post(`/api/movements/${m1}/undo`)).status, 409, 'nur die letzte Buchung');

  const fremd = (await admin.post('/api/checkin', { item_id: it.id })).data.movement_id;
  assert.equal((await user.post(`/api/movements/${fremd}/undo`)).status, 403, 'fremde Buchung');
  const eigene = (await user.post('/api/checkin', { item_id: it.id })).data.movement_id;
  assert.equal((await admin.post(`/api/movements/${eigene}/undo`)).status, 200, 'Admin darf alle');
});

test('Einkaufsliste: gekauft + einbuchen, Rückgängig öffnet den Eintrag wieder', async () => {
  const it = (await user.post('/api/checkin', { name: 'Milch', col: 'E', row: 1, quantity: 1, consumable: true })).data;
  await user.post('/api/checkout', { item_id: it.id });
  const entry = (await user.get('/api/shopping')).data.open.find((e) => e.item_id === it.id);
  const r = (await user.post(`/api/shopping/${entry.id}/restock`, {})).data;
  assert.equal(r.item.quantity, 1);
  assert.ok(!(await user.get('/api/shopping')).data.open.some((e) => e.id === entry.id));
  await user.post(`/api/movements/${r.movement_id}/undo`);
  assert.ok((await user.get('/api/shopping')).data.open.some((e) => e.id === entry.id), 'wieder offen');
  // neue Packung mit Haltbarkeitsdatum
  await user.post('/api/checkout', { item_id: it.id });
  const again = (await user.get('/api/shopping')).data.open.find((e) => e.item_id === it.id);
  const fresh = (await user.post(`/api/shopping/${again.id}/restock`, { expires_on: '03/2030' })).data;
  assert.equal(fresh.item.expires_on, '2030-03-31', 'Haltbarkeit beim Einlagern übernommen');
  const free = (await user.post('/api/shopping', { name: 'Brot', quantity: 2 })).data;
  assert.equal(free.item_id, null);
  assert.equal((await user.patch(`/api/shopping/${free.id}`, { done: true })).data.done_at !== null, true);
});

test('Fotos: nur JPEG/WebP, Abruf mit Cache, Löschen', async () => {
  const it = (await user.post('/api/checkin', { name: 'Foto-Test', col: 'F', row: 1 })).data;
  assert.equal((await user.put(`/api/items/${it.id}/photo`, { image: 'aGFsbG8=', thumb: 'aGFsbG8=' })).status, 400);
  const b64 = FAKE_JPEG.toString('base64');
  const up = await user.put(`/api/items/${it.id}/photo`, { image: b64, thumb: b64 });
  assert.ok(up.data.photo_at);
  const img = await user.get(`/api/items/${it.id}/photo?size=thumb&v=1`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.deepEqual(img.data, FAKE_JPEG);
  assert.equal((await client(srv.base).get(`/api/items/${it.id}/photo`)).status, 401);
  await user.del(`/api/items/${it.id}/photo`);
  assert.equal((await user.get(`/api/items/${it.id}/photo`)).status, 404);
});

test('Auswertung liefert Kennzahlen und Listen', async () => {
  const d = (await user.get('/api/stats')).data;
  for (const k of ['items', 'quantity', 'places', 'empty_places', 'out_of_stock', 'movements_30d', 'on_list']) assert.equal(typeof d.totals[k], 'number', k);
  assert.ok(d.top_used.length > 0);
  assert.ok(d.by_person.some((p) => p.name === 'Ben'));
  assert.ok(Array.isArray(d.stale) && Array.isArray(d.empty_places));
});

test('Import: Probelauf, Fehlerzeilen, Anlegen, Aktualisieren per Code, Backup vorher', async () => {
  const rows = [
    { name: 'Import-A', platz: 'K-A1', menge: '3', verbrauchsmaterial: 'ja' },
    { name: 'Import-B', lager: 'K', platz: 'A2' },
    { name: 'ohne Platz' },
    { name: 'falsches Lager', platz: 'Z-A1' },
    { code: 'XX', name: 'kaputter Code', platz: 'A1' },
  ];
  const dry = (await admin.post('/api/import', { dry: true, rows })).data;
  assert.deepEqual(dry.summary, { neu: 2, 'geändert': 0, 'unverändert': 0, fehler: 3 });
  assert.equal((await admin.get('/api/items?q=Import-A')).data.length, 0, 'Probelauf ändert nichts');

  const done = (await admin.post('/api/import', { rows })).data;
  assert.match(done.backup, /vor-import/);
  const a = (await admin.get('/api/items?q=Import-A')).data[0];
  assert.equal(a.wh_code, 'K');
  assert.equal(a.quantity, 3);
  assert.equal(a.consumable, 1);

  const upd = (await admin.post('/api/import', { rows: [{ code: a.code, name: 'Import-A2', menge: '1' }] })).data;
  assert.equal(upd.summary['geändert'], 1);
  const a2 = (await admin.get(`/api/items/${a.id}`)).data;
  assert.equal(a2.name, 'Import-A2');
  assert.equal(a2.quantity, 1);
  assert.equal(a2.history[0].type, 'out', 'Mengenänderung als Buchung');
  const again = (await admin.post('/api/import', { dry: true, rows: [{ code: a.code, name: 'Import-A2', menge: '1' }] })).data;
  assert.equal(again.summary['unverändert'], 1);
});

test('Backups: anlegen, herunterladen, wiederherstellen, ungültige Dateien ablehnen', async () => {
  const b = (await admin.post('/api/backups')).data;
  assert.match(b.name, /-manuell\.db$/);
  const dl = await admin.get(`/api/backups/${b.name}/download`);
  assert.equal(dl.data.subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await admin.get('/api/backups/..%2F..%2Fetc%2Fpasswd/download')).status, 400);

  const it = (await admin.post('/api/checkin', { name: 'Nach dem Backup', col: 'G', row: 1 })).data;
  const r = (await admin.post(`/api/backups/${b.name}/restore`)).data;
  assert.equal(r.ok, true);
  assert.equal(r.still_logged_in, true);
  assert.equal((await admin.get(`/api/items/${it.id}`)).status, 404, 'Stand vor dem Backup');
  assert.equal((await user.get('/api/items')).status, 200, 'andere Sitzungen aus dem Backup bleiben gültig');

  assert.equal((await admin.raw('/api/backups/upload?restore=1', Buffer.from('kein sqlite'))).status, 400);
  const up = await admin.raw('/api/backups/upload', dl.data);
  assert.match(up.data.name, /-hochgeladen\.db$/);
});

test('API-Schlüssel: nur lesen vs. buchen, keine Verwaltung', async () => {
  const read = (await admin.post('/api/keys', { name: 'lesen', person_id: benId, scope: 'read' })).data;
  const write = (await admin.post('/api/keys', { name: 'buchen', person_id: benId, scope: 'write' })).data;
  assert.match(read.key, /^hlk_/);
  const r = client(srv.base, { key: read.key });
  const w = client(srv.base, { key: write.key });
  assert.equal((await r.get('/api/items')).status, 200);
  assert.equal((await r.post('/api/checkin', { name: 'x', col: 'A', row: 1 })).status, 403);
  assert.equal((await w.post('/api/checkin', { name: 'per Schlüssel', col: 'A', row: 1 })).data.last_person, 'Ben');
  assert.equal((await w.get('/api/keys')).status, 403, 'Schlüssel können nicht verwalten');
  await admin.del(`/api/keys/${read.id}`);
  assert.equal((await r.get('/api/items')).status, 401, 'widerrufen');
});

test('Behälter: hineinlegen, mitwandern, verschachteln, Rückgängig', async () => {
  const box = (await user.post('/api/checkin', { name: 'Werkzeugkiste', col: 'F', row: 1, container: true })).data;
  assert.equal(box.container, 1);
  const hammer = (await user.post('/api/checkin', { name: 'Hammer', container_id: box.id })).data;
  assert.equal(hammer.parent_id, box.id);
  assert.equal(`${hammer.col}${hammer.row}`, 'F1', 'Inhalt übernimmt den Platz des Behälters');
  assert.equal(hammer.parent_name, 'Werkzeugkiste');

  // Tasche in der Kiste, Bit darin → verschachtelt; Einbuchen am selben Platz lässt es im Behälter
  const tasche = (await user.post('/api/checkin', { name: 'Bit-Tasche', container_id: box.id })).data;
  assert.equal((await user.get(`/api/items/${box.id}`)).data.container, 1);
  const bit = (await user.post('/api/checkin', { name: 'Bit PH2', container_id: tasche.id })).data;
  const again = (await user.post('/api/checkin', { item_id: bit.id, col: 'F', row: 1 })).data;
  assert.equal(again.parent_id, tasche.id, 'gleicher Platz → bleibt in der Tasche');
  assert.equal((await user.get('/api/containers')).data.map((c) => c.name).join(), 'Bit-Tasche,Werkzeugkiste');

  // Kiste umlagern → gesamter Inhalt zieht mit
  await user.patch(`/api/items/${box.id}`, { col: 'G', row: 2 });
  for (const id of [hammer.id, tasche.id, bit.id]) {
    const it = (await user.get(`/api/items/${id}`)).data;
    assert.equal(`${it.col}${it.row}`, 'G2', it.name);
  }
  const detail = (await user.get(`/api/items/${box.id}`)).data;
  assert.equal(detail.contents, 2);
  assert.deepEqual(detail.items.map((i) => i.name), ['Bit-Tasche', 'Hammer']);
  assert.equal((await user.get('/api/places/G/2?wh=1')).data.items.length, 4);

  // keine Kreise, kein Abwählen mit Inhalt
  assert.equal((await user.patch(`/api/items/${box.id}`, { container_id: bit.id })).status, 400);
  assert.equal((await user.patch(`/api/items/${box.id}`, { container_id: box.id })).status, 400);
  assert.equal((await user.patch(`/api/items/${box.id}`, { container: false })).status, 409);

  // Hammer an anderen Platz → aus der Kiste; Rückgängig legt ihn zurück hinein
  const out = (await user.post('/api/checkin', { item_id: hammer.id, col: 'H', row: 3 })).data;
  assert.equal(out.parent_id, null);
  const back = (await user.post(`/api/movements/${out.movement_id}/undo`)).data.item;
  assert.equal(back.parent_id, box.id);
  assert.equal(`${back.col}${back.row}`, 'G2');
  // ausdrücklich herausnehmen am selben Platz
  assert.equal((await user.patch(`/api/items/${hammer.id}`, { container_id: null })).data.parent_id, null);

  // Behälter löschen → Inhalt bleibt auf dem Platz liegen
  await user.del(`/api/items/${tasche.id}`);
  const loose = (await user.get(`/api/items/${bit.id}`)).data;
  assert.equal(loose.parent_id, null);
  assert.equal(`${loose.col}${loose.row}`, 'G2');
});

test('Haltbarkeitsdatum: Formate, ablaufende Liste, Auswertung, neue Packung, Import', async () => {
  const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString('sv-SE'); };
  const milch = (await user.post('/api/checkin', { name: 'H-Milch', col: 'J', row: 1, quantity: 2, expires_on: iso(-2) })).data;
  assert.equal(milch.expires_on, iso(-2));
  assert.equal(milch.expires_in, -2);
  const reis = (await user.post('/api/checkin', { name: 'Reis', col: 'J', row: 1, expires_on: '31.3.30' })).data;
  assert.equal(reis.expires_on, '2030-03-31');
  assert.equal((await user.post('/api/checkin', { name: 'Mehl', col: 'J', row: 1, expires_on: '02/2032' })).data.expires_on, '2032-02-29', 'Monat = Monatsende');
  assert.equal((await user.post('/api/checkin', { name: 'X', col: 'J', row: 1, expires_on: '31.02.2030' })).status, 400);
  assert.equal((await user.post('/api/checkin', { name: 'X', col: 'J', row: 1, expires_on: 'bald' })).status, 400);
  const tee = (await user.post('/api/checkin', { name: 'Tee', col: 'J', row: 2, expires_on: iso(10) })).data;
  await user.post('/api/checkin', { name: 'Leer', col: 'J', row: 2, quantity: 1, expires_on: iso(-5) }).then((r) => user.post('/api/checkout', { item_id: r.data.id }));

  const soon = (await user.get('/api/expiring?days=30')).data.map((i) => i.name);
  assert.deepEqual(soon, ['H-Milch', 'Tee'], 'nach Datum, ohne leeren Bestand und ohne ferne Daten');
  assert.deepEqual((await user.get('/api/expiring?days=0')).data.map((i) => i.name), ['H-Milch']);
  const st = (await user.get('/api/stats')).data;
  assert.equal(st.totals.expired, 1);
  assert.equal(st.totals.expiring, 1);
  assert.deepEqual(st.expiring.map((i) => i.name), ['H-Milch', 'Tee']);

  // neue Packung ersetzt das Datum, ohne Angabe bleibt es; Bearbeiten mit leer entfernt es
  assert.equal((await user.post('/api/checkin', { item_id: milch.id, expires_on: iso(60) })).data.expires_on, iso(60));
  assert.equal((await user.post('/api/checkin', { item_id: milch.id })).data.expires_on, iso(60));
  assert.equal((await user.patch(`/api/items/${tee.id}`, { expires_on: '' })).data.expires_on, null);

  // Import: Text und Excel-Seriennummer (46113 = 2026-04-01)
  const r = await admin.post('/api/import', { rows: [
    { code: reis.code, haltbar_bis: '46113' },
    { name: 'Nudeln', platz: 'J3', haltbar_bis: '12/2031' },
    { name: 'Kaputt', platz: 'J3', haltbar_bis: '99.99.99' },
  ] });
  assert.deepEqual(r.data.summary, { neu: 1, 'geändert': 1, 'unverändert': 0, fehler: 1 });
  assert.equal((await user.get(`/api/items/${reis.id}`)).data.expires_on, '2026-04-01');
  assert.equal((await user.get('/api/items?q=Nudeln')).data[0].expires_on, '2031-12-31');
});

test('Lagerplan: Übersicht liefert Plätze und Objekte je Platz', async () => {
  const kiste = (await user.post('/api/checkin', { name: 'Plan-Kiste', col: 'P', row: 3, container: true })).data;
  await user.post('/api/checkin', { name: 'Plan-Schraube', container_id: kiste.id, quantity: 7 });
  const d = (await user.get(`/api/overview?wh=${kiste.warehouse_id}`)).data;
  const p3 = d.locations.find((l) => l.col === 'P' && l.row === 3);
  assert.equal(p3.quantity, 8);
  const names = d.items.filter((i) => i.col === 'P' && i.row === 3).map((i) => i.name).sort();
  assert.deepEqual(names, ['Plan-Kiste', 'Plan-Schraube'], 'auch Inhalt von Behältern');
  assert.ok('photo_at' in d.items[0]);
  assert.ok(Array.isArray(d.recent));
});
