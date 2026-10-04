'use strict';
// MCP-Server: Protokoll, Anmeldung, Werkzeuge
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, mcp, setupUsers, FAKE_JPEG } = require('./helpers.cjs');

let srv, m, readOnly;
before(async () => {
  srv = await startServer();
  const { admin, benId } = await setupUsers(srv.base);
  await admin.post('/api/warehouses', { name: 'Keller', code: 'K' });
  const key = (await admin.post('/api/keys', { name: 'mcp', person_id: benId, scope: 'write' })).data.key;
  const rkey = (await admin.post('/api/keys', { name: 'mcp-lesen', person_id: benId, scope: 'read' })).data.key;
  m = mcp(srv.mcpUrl, key);
  readOnly = mcp(srv.mcpUrl, rkey);
});
after(() => srv.stop());

test('ohne gültigen Schlüssel: 401', async () => {
  assert.equal((await mcp(srv.mcpUrl).rpc('tools/list')).status, 401);
  assert.equal((await mcp(srv.mcpUrl, 'hlk_falsch').rpc('tools/list')).status, 401);
});

test('initialize, Benachrichtigung, ping', async () => {
  const r = await m.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.body.result.protocolVersion, '2025-06-18');
  assert.equal(r.body.result.serverInfo.name, 'heimlager');
  assert.match(r.body.result.instructions, /Angemeldet als: Ben/);
  const note = await m.rpc('notifications/initialized'); // hat eine id → wie eine Anfrage behandelt
  assert.equal(note.status, 200);
  const res = await fetch(srv.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(res.status, 401);
  assert.deepEqual((await m.rpc('ping')).body.result, {});
});

test('Nur-Lesen-Schlüssel sieht keine buchenden Werkzeuge', async () => {
  const all = (await m.rpc('tools/list')).body.result.tools.map((t) => t.name);
  const ro = (await readOnly.rpc('tools/list')).body.result.tools.map((t) => t.name);
  for (const t of ['einbuchen', 'ausbuchen', 'umlagern', 'buchung_rueckgaengig']) {
    assert.ok(all.includes(t), t);
    assert.ok(!ro.includes(t), t);
  }
  assert.equal((await readOnly.tool('ausbuchen', { objekt: '1' })).isError, true);
});

test('Einbuchen mit Platzangaben, Mehrdeutigkeit, Ausbuchen, Rückgängig', async () => {
  const neu = await m.tool('einbuchen', { name: 'Akkuschrauber', platz: 'Keller B3' });
  assert.equal(neu.isError, false);
  assert.equal(neu.json.gegenstand.platz, 'K-B3');
  assert.match((await m.tool('einbuchen', { name: 'Hammer', platz: 'B3' })).text, /mehrere Lager/);
  await m.tool('einbuchen', { name: 'Hammer', platz: 'H-B3' });
  await m.tool('einbuchen', { name: 'Hammer klein', platz: 'H-B4' });
  const aus = await m.tool('ausbuchen', { objekt: 'hammer' });
  assert.equal(aus.json.gegenstand.name, 'Hammer', 'exakter Name gewinnt');
  assert.ok(aus.json.buchung_id);
  const amb = await m.tool('objekt_anzeigen', { objekt: 'amm' });
  assert.equal(amb.isError, true);
  assert.match(amb.text, /nicht eindeutig/);
  const undo = await m.tool('buchung_rueckgaengig');
  assert.match(undo.text, /Ausbuchung rückgängig/);
  const um = await m.tool('umlagern', { objekt: 'Akkuschrauber', platz: 'H-C1' });
  assert.equal(um.json.gegenstand.platz, 'H-C1');
});

test('Einkaufsliste und Foto über MCP', async () => {
  await m.tool('einbuchen', { name: 'Batterien', platz: 'H-A1', menge: 4, verbrauchsmaterial: true });
  assert.match((await m.tool('ausbuchen', { objekt: 'Batterien', menge: 2 })).text, /auf die Einkaufsliste/);
  const list = await m.tool('einkaufsliste_anzeigen');
  assert.equal(list.json[0].name, 'Batterien');
  assert.match((await m.tool('einkaufsliste_abhaken', { name: 'Batterien', einbuchen: true })).text, /jetzt 4 Stück/);
  assert.match((await m.tool('objekt_foto', { objekt: 'Batterien' })).text, /kein Foto/);
});

test('Foto als Bild-Inhalt', async () => {
  const hit = (await m.tool('objekte_suchen', { suchbegriff: 'Batterien' })).json[0];
  const b64 = FAKE_JPEG.toString('base64');
  const { client } = require('./helpers.cjs');
  // Foto per REST mit einem Schlüssel hochladen, der buchen darf
  const tokenClient = client(srv.base);
  await tokenClient.post('/api/auth/login', { person_id: 1, password: 'geheim1' });
  await tokenClient.put(`/api/items/${hit.id}/photo`, { image: b64, thumb: b64 });
  const r = await m.tool('objekt_foto', { objekt: String(hit.id) });
  const img = r.content.find((c) => c.type === 'image');
  assert.equal(img.mimeType, 'image/jpeg');
  assert.equal(img.data, b64);
});

test('Lager anlegen nur mit Admin-Schlüssel', async () => {
  const names = async (c) => (await c.rpc('tools/list')).body.result.tools.map((t) => t.name);
  assert.ok(!(await names(m)).includes('lager_anlegen'), 'Ben ist kein Admin');
  assert.match((await m.tool('lager_anlegen', { name: 'Garage', kuerzel: 'G' })).text, /Nur für Admins/);

  const { client } = require('./helpers.cjs');
  const admin = client(srv.base);
  await admin.post('/api/auth/login', { person_id: 1, password: 'geheim1' });
  const key = (await admin.post('/api/keys', { name: 'mcp-admin', person_id: 1, scope: 'write' })).data.key;
  const rkey = (await admin.post('/api/keys', { name: 'mcp-admin-lesen', person_id: 1, scope: 'read' })).data.key;
  const am = mcp(srv.mcpUrl, key);
  assert.ok((await names(am)).includes('lager_anlegen'));
  assert.ok(!(await names(mcp(srv.mcpUrl, rkey))).includes('lager_anlegen'), 'Nur-Lesen-Schlüssel');

  const r = await am.tool('lager_anlegen', { name: 'Garage', kuerzel: 'g', beschreibung: 'hinten' });
  assert.equal(r.isError, false);
  assert.equal(r.json.kuerzel, 'G');
  assert.match((await am.tool('lager_anlegen', { name: 'Gartenhaus', kuerzel: 'G' })).text, /schon vergeben/);
  assert.match((await am.tool('lager_anlegen', { name: 'X', kuerzel: '1' })).text, /Kürzel/);
  assert.equal((await m.tool('einbuchen', { name: 'Rasenmäher', platz: 'G-A1' })).json.gegenstand.platz, 'G-A1');
});

test('Behälter über MCP', async () => {
  const box = await m.tool('einbuchen', { name: 'Campingtasche', platz: 'K-D1', ist_behaelter: true });
  assert.equal(box.json.gegenstand.behaelter, true);
  const lampe = await m.tool('einbuchen', { name: 'Stirnlampe', behaelter: 'Campingtasche' });
  assert.match(lampe.text, /K-D1 in Campingtasche/);
  assert.match(lampe.json.gegenstand.liegt_in, /^Campingtasche \(/);
  await m.tool('umlagern', { objekt: 'Akkuschrauber', behaelter: 'Campingtasche' });
  const um = await m.tool('umlagern', { objekt: 'Campingtasche', platz: 'H-E5' });
  assert.match(um.text, /Inhalt \(2 Gegenstände\) ist mitgewandert/);
  const zeig = await m.tool('objekt_anzeigen', { objekt: 'Campingtasche' });
  assert.deepEqual(zeig.json.inhalt_liste.map((i) => `${i.name} ${i.platz}`), ['Akkuschrauber H-E5', 'Stirnlampe H-E5']);
  const raus = await m.tool('umlagern', { objekt: 'Stirnlampe', platz: 'H-E5' });
  assert.equal(raus.json.gegenstand.liegt_in, undefined, 'mit Platz aus dem Behälter genommen');
  assert.match((await m.tool('umlagern', { objekt: 'Stirnlampe' })).text, /platz" oder "behaelter/);
});

test('Haltbarkeit über MCP', async () => {
  const neu = await m.tool('einbuchen', { name: 'Joghurt', platz: 'H-J1', haltbar_bis: '01.01.2020' });
  assert.match(neu.json.gegenstand.haltbar_bis, /^01\.01\.2020 \(seit \d+ Tagen abgelaufen\)$/);
  assert.match((await m.tool('einbuchen', { name: 'X', platz: 'H-J1', haltbar_bis: 'irgendwann' })).text, /nicht verstanden/);
  const liste = await m.tool('haltbarkeit_pruefen', { tage: 7 });
  assert.deepEqual(liste.json.map((i) => i.name), ['Joghurt']);
  const set = await m.tool('haltbarkeit_setzen', { objekt: 'Joghurt', haltbar_bis: '12/2099' });
  assert.match(set.text, /haltbar bis 31\.12\.2099/);
  assert.equal(set.json.gegenstand.menge, 1, 'Menge unverändert');
  assert.match((await m.tool('haltbarkeit_pruefen')).text, /Nichts abgelaufen/);
  assert.match((await m.tool('haltbarkeit_setzen', { objekt: 'Joghurt' })).text, /kein Haltbarkeitsdatum mehr/);
});

test('Neue Werkzeuge: mehrere einbuchen, bearbeiten, Platz benennen, Code auflösen', async () => {
  const names = (await m.rpc('tools/list')).body.result.tools.map((t) => t.name);
  assert.ok(!names.includes('foto_zuordnen'), 'nur im Assistenten');
  const r = await m.tool('mehrere_einbuchen', { platz: 'K-F1', gegenstaende: [{ name: 'Seil', menge: 2 }, { name: 'Karabiner', behaelter: 'Campingtasche' }, { objekt: 'gibtsnicht' }] });
  assert.equal(r.json.meldung, '2 von 3 eingebucht.');
  assert.match(r.json.ergebnisse[2].fehler, /gibtsnicht/);
  assert.match(r.json.ergebnisse[1].gegenstand.liegt_in, /Campingtasche/);
  const seil = await m.tool('objekt_bearbeiten', { objekt: 'Seil', name: 'Kletterseil', verbrauchsmaterial: true });
  assert.equal(seil.json.gegenstand.name, 'Kletterseil');
  assert.equal(seil.json.gegenstand.menge, 2);
  assert.match((await m.tool('lagerplatz_benennen', { platz: 'K-F1', name: 'Sportregal' })).text, /K-F1 gespeichert: Sportregal/);
  await m.tool('lagerplatz_benennen', { platz: 'K-F9', name: 'Altes Fach' });
  assert.match((await m.tool('lagerplatz_loeschen', { platz: 'Altes Fach' })).text, /K-F9 \(Altes Fach\) gelöscht/);
  assert.match((await m.tool('lagerplatz_loeschen', { platz: 'K-F9' })).text, /gibt es nicht/);
  assert.match((await m.tool('lagerplatz_loeschen', { platz: 'K-F1' })).text, /noch Gegenstände/);
  const code = await m.tool('code_aufloesen', { code: 'P-K-F1' });
  assert.equal(code.json.name, 'Sportregal');
  assert.equal(code.json.gegenstaende.length, 1);
  const hist = await m.tool('objekt_anzeigen', { objekt: 'Kletterseil' });
  assert.ok(hist.json.verlauf.length);
});

test('Einkaufsliste: abhaken per Name, Hinweis zum Einlagern, freien Eintrag gleich anlegen', async () => {
  await m.tool('einkaufsliste_hinzufuegen', { name: 'Fladenbrot' });
  const add = await m.tool('einkaufsliste_hinzufuegen', { name: 'Fladenbrötchen', menge: 2 });
  assert.match(add.json.im_lager, /^nein/);
  // Name ohne ID genügt; mehrdeutig → Rückfrage mit beiden Einträgen
  assert.match((await m.tool('einkaufsliste_abhaken', { name: 'fladen' })).text, /Mehrere Einträge passen: Fladenbrot .*Fladenbrötchen/);
  assert.match((await m.tool('einkaufsliste_abhaken', { name: 'Käse' })).text, /steht nicht auf der Einkaufsliste. Offen: .*Fladenbrot/);
  assert.match((await m.tool('einkaufsliste_abhaken', {})).text, /Namen des Eintrags/);
  // nur abhaken → Hinweis, nachzufragen
  const nur = await m.tool('einkaufsliste_abhaken', { name: 'fladenbrot' });
  assert.equal(nur.json.meldung, 'Fladenbrot abgehakt.');
  assert.match(nur.json.hinweis, /noch kein Gegenstand.*Frag den Nutzer, ob und wo/);
  // mit Platz → neuer Gegenstand (Verbrauchsmaterial), Eintrag verknüpft und abgehakt
  const neu = await m.tool('einkaufsliste_abhaken', { name: 'Fladenbrötchen', platz: 'K-E1', haltbar_bis: '05.10.2026' });
  assert.match(neu.text, /Fladenbrötchen abgehakt und neu angelegt – jetzt 2 Stück auf K-E1/);
  assert.equal(neu.json.gegenstand.verbrauchsmaterial, true);
  assert.match(neu.json.gegenstand.haltbar_bis, /^05\.10\.2026/);
  // Rückgängig entfernt den Gegenstand und öffnet den Eintrag wieder
  assert.match((await m.tool('buchung_rueckgaengig', { buchung_id: neu.json.buchung_id })).text, /Neuanlage rückgängig/);
  assert.ok((await m.tool('einkaufsliste_anzeigen')).json.some((e) => e.name === 'Fladenbrötchen'));
  // vorhandener Gegenstand: Hinweis nennt den bisherigen Platz, einbuchen: true bucht dorthin
  await m.tool('einkaufsliste_hinzufuegen', { objekt: 'Batterien' });
  assert.match((await m.tool('einkaufsliste_abhaken', { name: 'Batterien' })).json.hinweis, /gleich wieder auf H-A1 eingebucht/);
  await m.tool('einkaufsliste_hinzufuegen', { objekt: 'Batterien', menge: 3 });
  assert.match((await m.tool('einkaufsliste_abhaken', { name: 'batterien', einbuchen: true })).text, /abgehakt und eingebucht – jetzt \d+ Stück auf H-A1/);
});

test('Lagerplätze per Name: einbuchen „in den Kühlschrank“, suchen, mehrdeutig, unbekannt', async () => {
  await m.tool('lagerplatz_benennen', { platz: 'K-X0', name: 'Kühlschrank' });
  await m.tool('lagerplatz_benennen', { platz: 'H-X1', name: 'Kühlschrank Garage' });
  await m.tool('lagerplatz_benennen', { platz: 'K-X2', name: 'Schublade Essen' });
  // exakter Name schlägt Teiltreffer, Füllwörter werden ignoriert
  const r = await m.tool('einbuchen', { name: 'Tomaten', menge: 4, platz: 'in den Kühlschrank' });
  assert.equal(r.json.gegenstand.platz, 'K-X0');
  assert.equal((await m.tool('einbuchen', { name: 'Senf', platz: 'Hauptlager Kühlschrank Garage' })).json.gegenstand.platz, 'H-X1');
  assert.equal((await m.tool('umlagern', { objekt: 'Senf', platz: 'schublade essen' })).json.gegenstand.platz, 'K-X2');
  assert.match((await m.tool('einbuchen', { name: 'X', platz: 'Kühl' })).text, /passt zu mehreren Plätzen: .*H-X1 „Kühlschrank Garage“.*K-X0 „Kühlschrank“/);
  const unbekannt = await m.tool('einbuchen', { name: 'X', platz: 'Dachboden' });
  assert.match(unbekannt.text, /nicht verstanden.*Benannte Plätze: .*K-X0 „Kühlschrank“/);
  const such = await m.tool('lagerplaetze_suchen', { suchbegriff: 'kühlschrank' });
  assert.deepEqual(such.json.map((p) => p.platz), ['K-X0']);
  assert.ok((await m.tool('lagerplaetze_suchen', {})).json.length >= 3);
  // Adressen funktionieren weiter, auch mit Lagernamen
  assert.equal((await m.tool('umlagern', { objekt: 'Senf', platz: 'Keller B3' })).json.gegenstand.platz, 'K-B3');
});
