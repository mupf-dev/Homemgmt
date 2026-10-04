'use strict';
// KI-Assistent: Einstellungen, Tool-Schleife, Rückfrage ab 4 Buchungen, Fotos, Fehler des Anbieters
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupUsers, fakeLlm, FAKE_JPEG } = require('./helpers.cjs');

let srv, llm, admin, user;
before(async () => {
  llm = await fakeLlm();
  srv = await startServer();
  ({ admin, user } = await setupUsers(srv.base));
  await admin.post('/api/warehouses', { name: 'Keller', code: 'K' });
});
after(async () => { await srv.stop(); await llm.stop(); });

test('Einstellungen: nur Admins, Schlüssel wird nie ausgeliefert', async () => {
  assert.deepEqual((await user.get('/api/assistant/status')).data, { enabled: false, confirm_from: 4 });
  assert.equal((await user.post('/api/assistant', { message: 'Hallo' })).status, 409, 'noch nicht eingerichtet');
  assert.equal((await user.put('/api/assistant/settings', { model: 'x' })).status, 403);
  assert.equal((await admin.put('/api/assistant/settings', { base_url: 'ftp://x' })).status, 400);
  const s = (await admin.put('/api/assistant/settings', { base_url: llm.url, model: 'test/modell', api_key: 'sk-or-geheim-1234' })).data;
  assert.equal(s.key_set, true);
  assert.equal(s.key_hint, 'sk-or…1234');
  assert.ok(!JSON.stringify(s).includes('geheim'), 'Schlüssel nicht im Klartext');
  assert.equal((await user.get('/api/assistant/status')).data.enabled, true);
  // Verbindungstest
  llm.replies.push({ tool_calls: [['ping', { ok: true }]] });
  const t = (await admin.post('/api/assistant/test')).data;
  assert.equal(t.tools, true);
  assert.equal(llm.requests.at(-1).auth, 'Bearer sk-or-geheim-1234');
  assert.equal(llm.requests.at(-1).path, '/v1/chat/completions');
});

test('Tool-Schleife: sucht, bucht ein, antwortet – mit Herkunft „assistent“', async () => {
  llm.replies.push(
    { tool_calls: [['objekte_suchen', { suchbegriff: 'Akkuschrauber' }]] },
    (body) => {
      assert.match(body.messages.at(-1).content, /Keine Treffer/, 'Werkzeugergebnis geht zurück ans Modell');
      return { tool_calls: [['einbuchen', { name: 'Akkuschrauber', platz: 'K-B3' }]] };
    },
    { content: 'Akkuschrauber liegt jetzt auf K-B3.' },
  );
  const r = await user.post('/api/assistant', { message: 'Leg den Akkuschrauber auf Keller B3', history: [{ role: 'user', content: 'Hallo' }, { role: 'assistant', content: 'Hallo!' }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.reply, 'Akkuschrauber liegt jetzt auf K-B3.');
  assert.equal(r.data.bookings.length, 1);
  assert.equal(r.data.bookings[0].platz, 'K-B3');
  assert.deepEqual(r.data.places, ['K-B3'], 'Plätze für die 3D-Ansicht in der Antwort');
  const req = llm.requests.at(-3).body;
  assert.equal(req.model, 'test/modell');
  assert.match(req.messages[0].content, /Angemeldet als: Ben/);
  assert.deepEqual(req.messages.slice(1, 3).map((m) => m.role), ['user', 'assistant'], 'Verlauf geht mit');
  const names = req.tools.map((t) => t.function.name);
  assert.ok(names.includes('foto_zuordnen') && names.includes('mehrere_einbuchen'));
  assert.ok(!names.includes('lager_anlegen'), 'Ben ist kein Admin');
  const item = (await user.get(`/api/items/${r.data.bookings[0].item_id}`)).data;
  assert.equal(item.history[0].source, 'assistent');
  // Rückgängig in der App funktioniert für Assistenten-Buchungen
  assert.equal((await user.post(`/api/movements/${r.data.bookings[0].movement_id}/undo`)).status, 200);
});

test('„Wo ist …?“: Plätze aus Such-Ergebnissen kommen mit, auch ohne Buchung', async () => {
  await user.post('/api/checkin', { name: 'Akkuschrauber', warehouse_id: (await user.get('/api/warehouses')).data.find((w) => w.code === 'K').id, col: 'B', row: 3 });
  llm.replies.push(
    { tool_calls: [['objekte_suchen', { suchbegriff: 'Akkuschrauber' }]] },
    { content: 'Der Akkuschrauber liegt im Keller auf B3.' },
  );
  const r = await user.post('/api/assistant', { message: 'Wo ist der Akkuschrauber?' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.bookings, []);
  assert.deepEqual(r.data.places, ['K-B3']);
});

test('Ab 4 Buchungen: erst bestätigen, dann ohne Modell ausführen', async () => {
  const before = llm.requests.length;
  llm.replies.push({
    content: 'Ich buche vier Sachen ein.',
    tool_calls: [['mehrere_einbuchen', { platz: 'K-C1', gegenstaende: [{ name: 'Zelt' }, { name: 'Schlafsack', menge: 2 }, { name: 'Isomatte' }, { name: 'Kocher' }] }]],
  });
  const r = (await user.post('/api/assistant', { message: 'Campingzeug auf K-C1' })).data;
  assert.equal(r.bookings.length, 0);
  assert.equal(r.confirm.count, 4);
  assert.deepEqual(r.confirm.actions, ['1× Zelt → K-C1', '2× Schlafsack → K-C1', '1× Isomatte → K-C1', '1× Kocher → K-C1']);
  assert.equal((await user.get('/api/items?q=Zelt')).data.length, 0, 'noch nichts gebucht');
  assert.equal((await admin.post('/api/assistant/confirm', { token: r.confirm.token })).status, 404, 'nur die fragende Person');
  const ok = (await user.post('/api/assistant/confirm', { token: r.confirm.token })).data;
  assert.equal(ok.bookings.length, 4);
  assert.match(ok.reply, /4 Buchungen ausgeführt/);
  assert.equal(llm.requests.length, before + 1, 'Bestätigung braucht keinen weiteren Modell-Aufruf');
  assert.equal((await user.post('/api/assistant/confirm', { token: r.confirm.token })).status, 404, 'nur einmal');

  // 3 einzelne Buchungen gehen sofort durch
  llm.replies.push({ tool_calls: [['ausbuchen', { objekt: 'Zelt' }], ['ausbuchen', { objekt: 'Isomatte' }], ['ausbuchen', { objekt: 'Kocher' }]] }, { content: 'Ausgebucht.' });
  assert.equal((await user.post('/api/assistant', { message: 'Nimm Zelt, Isomatte und Kocher raus' })).data.bookings.length, 3);
  // Abbrechen
  llm.replies.push({ tool_calls: [1, 2, 3, 4].map((i) => ['einbuchen', { name: `Teil ${i}`, platz: 'K-C2' }]) });
  const c = (await user.post('/api/assistant', { message: 'vier Teile' })).data;
  assert.equal(c.confirm.count, 4);
  assert.match((await user.post('/api/assistant/cancel', { token: c.confirm.token })).data.reply, /nichts gebucht/);
  assert.equal((await user.post('/api/assistant/confirm', { token: c.confirm.token })).status, 404);
});

test('Fotos: Bild und QR-Codes gehen ans Modell, foto_zuordnen speichert das Foto', async () => {
  const b64 = FAKE_JPEG.toString('base64');
  llm.replies.push(
    (body) => {
      const content = body.messages.at(-1).content;
      assert.ok(content.some((c) => c.type === 'image_url' && c.image_url.url.startsWith('data:image/jpeg;base64,')));
      assert.match(body.messages[0].content, /Bild 1: Lagerplatz K-D4/);
      return { tool_calls: [['einbuchen', { name: 'Wasserkocher', platz: 'K-D4' }]] };
    },
    { tool_calls: [['foto_zuordnen', { objekt: 'Wasserkocher', bild: 1 }]] },
    { content: 'Wasserkocher mit Foto auf K-D4 eingebucht.' },
  );
  const r = (await user.post('/api/assistant', { images: [{ image: b64, thumb: b64, codes: ['P-K-D4'] }] })).data;
  assert.equal(r.reply, 'Wasserkocher mit Foto auf K-D4 eingebucht.');
  const it = (await user.get('/api/items?q=Wasserkocher')).data[0];
  assert.ok(it.photo_at, 'Foto gespeichert');
  assert.equal((await user.post('/api/assistant', { images: [{ image: 'aGFsbG8=' }] })).status, 400, 'nur JPEG/WebP');
  assert.equal((await user.post('/api/assistant', {})).status, 400, 'leer');
});

test('Kontext, fehlerhafte Argumente, Rundenlimit, Fehler des Anbieters', async () => {
  const it = (await user.get('/api/items?q=Wasserkocher')).data[0];
  llm.replies.push((body) => {
    assert.match(body.messages[0].content, /beim Gegenstand „Wasserkocher“/);
    return { tool_calls: [['ausbuchen', '{kaputt']] };
  }, (body) => {
    assert.match(body.messages.at(-1).content, /kein gültiges JSON/);
    return { content: 'Bitte noch einmal.' };
  });
  assert.equal((await user.post('/api/assistant', { message: 'nimm das raus', context: { item_id: it.id } })).data.reply, 'Bitte noch einmal.');

  for (let i = 0; i < 8; i++) llm.replies.push({ tool_calls: [['lager_auflisten', {}]] });
  assert.match((await user.post('/api/assistant', { message: 'Endlos' })).data.reply, /zu verschachtelt/);

  llm.status = 401;
  const e = await user.post('/api/assistant', { message: 'Hallo' });
  assert.equal(e.status, 502);
  assert.match(e.data.error, /Schlüssel ungültig/);
  llm.status = 200;
  const s = (await admin.get('/api/assistant/settings')).data;
  assert.ok(s.usage_30d.requests > 5);
  assert.ok(s.usage_30d.cost > 0);
});

test('Verlauf: „Neues Gespräch“ per Werkzeug, Begrenzung nach Zeichen', async () => {
  llm.replies.push({ tool_calls: [['gespraech_neu_beginnen', {}]] }, { content: 'Alles klar, neues Gespräch.' });
  const r = (await user.post('/api/assistant', { message: 'Vergiss das bitte', history: [{ role: 'user', content: 'alt' }] })).data;
  assert.equal(r.reset, true);
  assert.equal(r.reply, 'Alles klar, neues Gespräch.');
  llm.replies.push({ content: 'Hallo.' });
  assert.equal((await user.post('/api/assistant', { message: 'Hallo' })).data.reset, false);

  // 30 lange Nachrichten: es gehen nur die neuesten bis ~8000 Zeichen mit, beginnend mit einer Nutzer-Nachricht
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:${'x'.repeat(1500)}` }));
  llm.replies.push({ content: 'ok' });
  await user.post('/api/assistant', { message: 'Und jetzt?', history });
  const sent = llm.requests.at(-1).body.messages.slice(1, -1);
  assert.ok(sent.length >= 4 && sent.length <= 6, `${sent.length} Nachrichten`);
  assert.equal(sent[0].role, 'user');
  assert.ok(sent.reduce((n, m) => n + m.content.length, 0) <= 8000);
  assert.match(sent.at(-1).content, /^29:/, 'die neuesten bleiben');
});

test('Benannte Lagerplätze stehen im Systemprompt', async () => {
  await admin.put('/api/places/X/9?wh=2', { name: 'Kühlschrank' });
  llm.replies.push({ content: 'ok' });
  await user.post('/api/assistant', { message: 'Hallo' });
  assert.match(llm.requests.at(-1).body.messages[0].content, /Benannte Lagerplätze: .*K-X9 „Kühlschrank“/);
});
