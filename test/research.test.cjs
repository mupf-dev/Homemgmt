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

const BUTTER_HTML = `<!doctype html><html><head><title>Markenbutter | Aldi Süd</title>
<script type="application/ld+json">{"@type":"Product","name":"Deutsche Markenbutter 250 g","offers":{"@type":"Offer","price":"1.19","priceCurrency":"EUR"}}</script>
<style>.x{color:red}</style><script>var geheim = "nicht im Text";</script></head>
<body><nav>Start &amp; Angebote</nav><h1>Deutsche Markenbutter</h1><div class="preis"><span>1,19&nbsp;€</span> 250 g (4,76 €/kg)</div></body></html>`;

test('Gateway: Agent sucht und liest Seiten, bestätigt nur Preise von gelesenen Seiten', async () => {
  const other = await startServer({ RESEARCH_ALLOW_PRIVATE: '1' });
  const { admin: a, user: u } = await setupUsers(other.base);
  await a.put('/api/assistant/settings', { base_url: llm.url, model: 'claude-sonnet', api_key: 'sk-gw', location: '70199' });
  assert.equal((await a.put('/api/assistant/settings', { search_tool: 'foundry web' })).status, 400, 'ungültiger Name');
  const s = (await a.put('/api/assistant/settings', { search_tool: 'foundry-web' })).data;
  assert.equal(s.search_tool, 'foundry-web');
  assert.equal(s.research.available, true);

  const origin = llm.url.replace(/\/v1$/, '');
  const page = `${origin}/seite/butter`;
  llm.pages = { '/seite/butter': BUTTER_HTML, '/weiter': { status: 302, headers: { location: '/seite/butter' } } };
  llm.search = (body, url) => {
    assert.equal(url, '/v1/search/foundry-web');
    assert.equal(body.query, 'Butter 250 g Angebot Stuttgart');
    assert.equal(body.max_results, 6);
    return { results: [
      { title: 'Markenbutter 250 g', url: page, snippet: 'Deutsche Markenbutter 250 g' },
      { title: 'Butter bei Lidl', url: 'https://www.lidl.de/butter', snippet: 'Butter 250 g 1,09 €' },
      { title: 'ohne Adresse', url: 'kein-link', snippet: '…' },
    ] };
  };
  llm.replies.push((body) => {
    assert.equal(body.plugins, undefined, 'kein OpenRouter-Plugin');
    assert.deepEqual(body.tools.map((t) => t.function.name), ['websuche', 'seite_lesen']);
    assert.equal(body.tool_choice, 'auto');
    assert.match(body.messages[0].content, /nur als PLZ angegeben/);
    return { tool_calls: [['websuche', { anfrage: 'Butter 250 g Angebot Stuttgart' }]] };
  });
  llm.replies.push((body) => {
    const t = body.messages.at(-1);
    assert.equal(t.role, 'tool');
    assert.match(t.content, /\[1\] Markenbutter 250 g\nURL: http:\/\/127\.0\.0\.1:\d+\/seite\/butter/);
    assert.doesNotMatch(t.content, /kein-link/);
    return { tool_calls: [['seite_lesen', { url: `${origin}/weiter` }], ['seite_lesen', { url: `${origin}/fehlt` }]] };
  });
  llm.replies.push((body) => {
    const [ok, missing] = body.messages.slice(-2).map((m) => m.content);
    assert.match(ok, /Titel: Markenbutter \| Aldi Süd\nAdresse: http:\/\/127\.0\.0\.1:\d+\/seite\/butter/, 'Weiterleitung gefolgt');
    assert.match(ok, /Strukturierte Preisangaben der Seite:\nDeutsche Markenbutter 250 g: 1\.19 EUR/);
    assert.match(ok, /Start & Angebote/);
    assert.match(ok, /1,19 € 250 g/);
    assert.doesNotMatch(ok, /geheim|color:red/, 'keine Skripte und Styles');
    assert.match(missing, /^Seite nicht lesbar: HTTP 404/);
    return { content: answer([
      { haendler: 'Aldi Süd', packung: '250 g', preis: 1.19, url: page, bestaetigt: true },
      { haendler: 'Lidl', packung: '250 g', preis: 1.09, url: 'https://www.lidl.de/butter', bestaetigt: true },
      { haendler: 'Aldi Süd', packung: '250 g', preis: 0.99, url: `${origin}/weiter`, bestaetigt: true },
      { haendler: 'Idealo-Preisvergleich (Händler in der Quelle nicht genannt)', preis: 1.05, url: 'https://www.idealo.de/x', bestaetigt: false },
    ], 'Aldi Süd ist am günstigsten. Bei Lidl steht der Preis nur im Suchauszug, deshalb ist er nicht bestätigt und sollte vor Ort geprüft werden, gerade bei Aktionen. Noch mehr Text, der nicht mehr hineinpasst und abgeschnitten wird, weil der Hinweis viel zu lang ist für die Anzeige in der Liste und niemand so viel lesen möchte.') };
  });
  const e = (await u.post('/api/shopping', { name: 'Butter' })).data;
  await u.post('/api/shopping/prices', {});
  const r = (await settle(u)).checks[e.id].result;
  assert.deepEqual(r.angebote.map((o) => [o.haendler, o.preis, o.bestaetigt, o.aus_suche]),
    [['Aldi Süd', 1.19, true, true], ['Lidl', 1.09, false, true], ['Aldi Süd', 0.99, false, true]],
    'bestätigt nur mit gelesener Seite und Preis darauf; Portal fällt weg');
  assert.match(r.hinweis, /^Aldi Süd ist am günstigsten\. Bei Lidl .*Aktionen\.$/, 'am Satzende gekürzt');
  assert.ok(r.hinweis.length <= 300);
  assert.deepEqual(r.quellen[0], { url: page, title: 'Markenbutter 250 g' }, 'gelesene Seite zuerst');
  assert.deepEqual(r.recherche, { suchen: 1, seiten: 2 });
  assert.equal(llm.requests.filter((q) => q.path.includes('/search/')).at(-1).auth, 'Bearer sk-gw');
  llm.search = { results: [] };
  await other.stop();
});

test('Gateway: Limits für Suchen und Seiten, Fehler der Suche gehen ans Modell', async () => {
  const other = await startServer({ RESEARCH_ALLOW_PRIVATE: '1' });
  const { admin: a, user: u } = await setupUsers(other.base);
  await a.put('/api/assistant/settings', { base_url: llm.url, model: 'claude-sonnet', api_key: 'sk-gw', search_tool: 'foundry-web' });
  llm.search = () => ({ detail: 'Not Found' });
  const before = llm.requests.length;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    llm.replies.push((body) => {
      seen.push(body);
      if (body.tool_choice === 'none') return { content: answer([], 'Nichts gefunden.') };
      return { tool_calls: [['websuche', { anfrage: `Spülmittel ${i}a` }], ['websuche', { anfrage: `Spülmittel ${i}b` }]] };
    });
  }
  const e = (await u.post('/api/shopping', { name: 'Spülmittel' })).data;
  await u.post('/api/shopping/prices', {});
  const c = (await settle(u)).checks[e.id];
  assert.equal(c.status, 'done', c.error);
  assert.deepEqual(c.result.angebote, []);
  const searches = llm.requests.slice(before).filter((q) => q.path.includes('/search/'));
  assert.equal(searches.length, 3, 'höchstens 3 Suchen');
  const tools = seen[1].messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.deepEqual(tools, ['Websuche: Not Found', 'Websuche: Not Found']);
  assert.match(seen[2].messages.filter((m) => m.role === 'tool').at(-1).content, /^Limit erreicht/);
  assert.equal(seen.at(-1).tool_choice, 'none', 'letzte Runde ohne Werkzeuge');
  assert.equal(seen.length, 6, 'höchstens 6 Runden');
  llm.replies.length = 0;
  llm.search = { results: [] };
  await other.stop();
});
