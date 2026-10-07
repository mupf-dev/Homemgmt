'use strict';
// Preisrecherche: Websuche je Produkt, Prüfung der Antwort, Zwischenspeicher, Werkzeug im Assistenten
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupUsers, fakeLlm } = require('./helpers.cjs');

let srv, llm, admin, user;
before(async () => {
  llm = await fakeLlm();
  srv = await startServer({ AI_WEB_SEARCH: '1' });
  ({ admin, user } = await setupUsers(srv.base));
  await admin.put('/api/assistant/settings', { base_url: llm.url, model: 'test/modell', api_key: 'sk-test', location: 'Stuttgart-Südheim, 70199' });
});
after(async () => { await srv.stop(); await llm.stop(); });

const cite = (url) => ({ type: 'url_citation', url_citation: { url, title: 'Seite', content: '…' } });
const answer = (offers, hinweis = null) => JSON.stringify({ angebote: offers, hinweis });
async function settle(client) {
  for (let i = 0; i < 50; i++) {
    const st = (await client.get('/api/shopping/prices')).data;
    if (!Object.values(st.checks).some((c) => c.status === 'pending' || c.status === 'running')) return st;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Recherche wird nicht fertig');
}

test('Einkaufsliste prüfen: Websuche, Quellen geprüft, 24 h gespeichert, neu prüfen', async () => {
  const e = (await user.post('/api/shopping', { name: 'Batterien AA', quantity: 4 })).data;
  await user.patch(`/api/shopping/${e.id}`, { note: 'Mignon' });
  llm.replies.push((body) => {
    assert.deepEqual(body.plugins, [{ id: 'web', max_results: 6 }], 'Web-Plugin von OpenRouter');
    assert.match(body.messages[0].content, /Stuttgart-Südheim/, 'Wohnort geht mit');
    assert.match(body.messages[1].content, /Batterien AA[\s\S]*Mignon[\s\S]*Benötigte Menge: 4/);
    return {
      content: `Hier: ${answer([
        { haendler: 'dm', filiale: 'Rotebühlstr.', packung: '8 Stück', preis: '1,25 €', url: 'https://www.dm.de/batterien', bestaetigt: true },
        { haendler: 'Aldi', preis: 2.99, url: 'https://erfunden.example/aldi', bestaetigt: true },
        { haendler: 'Ohne Quelle', preis: 0.5 },
        { haendler: 'Getränke', preis: 20, pfand: '3,42 €', url: 'https://www.dm.de/batterien?x=1', bestaetigt: false },
      ], 'Eigenmarke reicht')}`,
      annotations: [cite('https://www.dm.de/batterien')],
    };
  });
  const started = (await user.post('/api/shopping/prices', {})).data;
  assert.equal(started.available, true);
  assert.ok(['pending', 'running', 'done'].includes(started.checks[e.id].status));
  const st = await settle(user);
  const r = st.checks[e.id].result;
  assert.equal(r.angebote.length, 3, 'Angebot ohne Quelle verworfen');
  assert.deepEqual(r.angebote.map((o) => [o.haendler, o.preis, o.bestaetigt]), [['dm', 1.25, true], ['Aldi', 2.99, false], ['Getränke', 20, false]],
    'Quelle nicht unter den Suchergebnissen → unbestätigt');
  assert.equal(r.angebote[2].pfand, 3.42);
  assert.equal(r.hinweis, 'Eigenmarke reicht');
  assert.equal(r.ort, 'Stuttgart-Südheim, 70199');

  // gespeichert: kein neuer Aufruf; mit force neu
  const n = llm.requests.length;
  await user.post('/api/shopping/prices', {});
  assert.equal((await settle(user)).checks[e.id].id, st.checks[e.id].id);
  assert.equal(llm.requests.length, n, 'Ergebnis aus dem Zwischenspeicher');
  llm.replies.push({ content: 'leider nichts' });
  await user.post('/api/shopping/prices', { force: true });
  const again = (await settle(user)).checks[e.id];
  assert.equal(again.status, 'error');
  assert.match(again.error, /kein auswertbares Ergebnis/);
  await user.del(`/api/shopping/${e.id}`);
});

test('Assistent: preise_recherchieren liefert die günstigsten Angebote', async () => {
  llm.replies.push(
    (body) => {
      assert.ok(body.tools.some((t) => t.function.name === 'preise_recherchieren'));
      return { tool_calls: [['preise_recherchieren', { produkte: ['Spaghetti'] }]] };
    },
    { content: answer([{ haendler: 'Aldi Süd', packung: '500 g', preis: 0.69, url: 'https://www.aldi-sued.de/spaghetti', bestaetigt: true }]), annotations: [cite('https://www.aldi-sued.de/spaghetti')] },
    (body) => {
      const res = JSON.parse(body.messages.at(-1).content);
      assert.equal(res.ergebnisse[0].produkt, 'Spaghetti');
      assert.equal(res.ergebnisse[0].angebote[0].haendler, 'Aldi Süd');
      assert.equal(res.ergebnisse[0].angebote[0].url, undefined, 'Links nur in der App, nicht im Chat');
      return { content: 'Spaghetti gibt es bei Aldi Süd für 0,69 €.' };
    },
  );
  const r = (await user.post('/api/assistant', { message: 'Wo sind Spaghetti gerade am günstigsten?' })).data;
  assert.equal(r.reply, 'Spaghetti gibt es bei Aldi Süd für 0,69 €.');
});

test('Admin kann die Preisrecherche ausschalten', async () => {
  assert.equal((await user.put('/api/assistant/settings', { research_enabled: false })).status, 403);
  const off = (await admin.put('/api/assistant/settings', { research_enabled: false })).data;
  assert.equal(off.research_enabled, false);
  assert.match(off.research.reason, /ausgeschaltet/);
  assert.equal((await user.get('/api/shopping/prices')).data.available, false);
  assert.equal((await user.post('/api/shopping/prices', {})).status, 409);
  llm.replies.push((body) => {
    assert.ok(!body.tools.some((t) => t.function.name === 'preise_recherchieren'), 'Werkzeug weg');
    assert.doesNotMatch(body.messages[0].content, /preise_recherchieren/);
    return { content: 'Ok.' };
  });
  await user.post('/api/assistant', { message: 'Was kostet Milch?' });
  const on = (await admin.put('/api/assistant/settings', { research_enabled: true })).data;
  assert.equal(on.research.available, true);
});

test('Ohne OpenRouter nicht verfügbar', async () => {
  const other = await startServer();
  const { admin: a, user: u } = await setupUsers(other.base);
  await a.put('/api/assistant/settings', { base_url: llm.url, model: 'x', api_key: 'k' });
  const st = (await u.get('/api/shopping/prices')).data;
  assert.equal(st.available, false);
  assert.match(st.reason, /OpenRouter/);
  assert.equal((await u.post('/api/shopping/prices', {})).status, 409);
  assert.equal((await a.get('/api/assistant/settings')).data.research.available, false);
  await other.stop();
});

test('Ohne OpenRouter mit Such-Tool des Gateways: Suche, Treffer als Quellen', async () => {
  const other = await startServer();
  const { admin: a, user: u } = await setupUsers(other.base);
  await a.put('/api/assistant/settings', { base_url: llm.url, model: 'claude-sonnet', api_key: 'sk-gw', location: 'Stuttgart-Südheim, 70199' });
  assert.equal((await a.put('/api/assistant/settings', { search_tool: 'foundry web' })).status, 400, 'ungültiger Name');
  const s = (await a.put('/api/assistant/settings', { search_tool: 'foundry-web' })).data;
  assert.equal(s.search_tool, 'foundry-web');
  assert.equal(s.research.available, true);

  llm.search = (body, url) => {
    assert.equal(url, '/v1/search/foundry-web');
    assert.match(body.query, /^Butter .*Preis Angebot Stuttgart-Südheim$/, 'Produkt, Stadt ohne PLZ');
    assert.equal(body.max_results, 6);
    return { results: [
      { title: 'Markenbutter 250 g', url: 'https://www.aldi-sued.de/butter', snippet: 'Deutsche Markenbutter 250 g 1,19 €' },
      { title: 'ohne Adresse', url: 'kein-link', snippet: '…' },
    ] };
  };
  llm.replies.push((body) => {
    assert.equal(body.plugins, undefined, 'kein OpenRouter-Plugin');
    assert.match(body.messages[1].content, /Suchergebnisse[\s\S]*\[1\] Markenbutter 250 g\nURL: https:\/\/www\.aldi-sued\.de\/butter/);
    assert.doesNotMatch(body.messages[1].content, /kein-link/);
    return { content: answer([
      { haendler: 'Aldi Süd', packung: '250 g', preis: 1.19, url: 'https://www.aldi-sued.de/butter', bestaetigt: true },
      { haendler: 'Lidl', packung: '250 g', preis: 1.09, url: 'https://www.lidl.de/butter', bestaetigt: true },
    ]) };
  });
  const e = (await u.post('/api/shopping', { name: 'Butter' })).data;
  await u.post('/api/shopping/prices', {});
  const r = (await settle(u)).checks[e.id].result;
  assert.deepEqual(r.angebote.map((o) => [o.haendler, o.bestaetigt, o.aus_suche]), [['Aldi Süd', true, true], ['Lidl', false, false]],
    'nicht unter den Treffern → unbestätigt');
  assert.deepEqual(r.quellen, [{ url: 'https://www.aldi-sued.de/butter', title: 'Markenbutter 250 g' }]);
  assert.equal(llm.requests.filter((q) => q.path.includes('/search/')).at(-1).auth, 'Bearer sk-gw');

  // Fehler der Suche landen am Eintrag
  llm.search = () => ({ detail: 'Not Found' });
  await u.post('/api/shopping/prices', { force: true });
  const err = (await settle(u)).checks[e.id];
  assert.equal(err.status, 'error');
  assert.match(err.error, /^Websuche: Not Found/);
  llm.search = { results: [] };
  await other.stop();
});
