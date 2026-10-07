'use strict';
// Heimlager – Preisrecherche für die Einkaufsliste. Je Produkt eine Recherche mit Websuche: bei OpenRouter ein
// Modell-Aufruf mit dem Web-Plugin (plugins: [{ id: 'web' }], Quellen kommen als annotations zurück), sonst ein kleiner
// Agent mit den Werkzeugen websuche (Such-Tool eines Gateways wie LiteLLM, POST /search/{tool}) und seite_lesen (der
// Server lädt die Seite). Dort gilt ein Preis nur als bestätigt, wenn er auf einer gelesenen Seite steht.
// Läuft als Auftrag im Hintergrund, Ergebnisse werden in price_checks gespeichert und 24 Stunden wiederverwendet.

const { fetchPage } = require('./webpage.cjs');

const FRESH_HOURS = 24;
const CONCURRENCY = 3;
const TIMEOUT_MS = 120_000;
const MAX_OFFERS = 4;
const SEARCH_RESULTS = 6;
const MAX_SEARCHES = 3; // je Produkt im Agenten
const MAX_PAGES = 3;
const MAX_ROUNDS = 6;
// Vergleichs- und Prospektportale sind Quellen, aber keine Händler
const PORTAL = /idealo|kaufda|marktguru|check24|geizhals|billiger\.de|preisvergleich|prospekt|guenstiger\.de|nicht genannt|unbekannt/i;

const AGENT_TOOLS = [
  { type: 'function', function: {
    name: 'websuche', description: `Websuche (höchstens ${MAX_SEARCHES} je Produkt). Liefert Titel, Adresse und kurzen Auszug je Treffer.`,
    parameters: { type: 'object', properties: { anfrage: { type: 'string', description: 'Suchanfrage, z. B. "Butter 250 g Angebot Aldi Süd Stuttgart"' } }, required: ['anfrage'] },
  } },
  { type: 'function', function: {
    name: 'seite_lesen', description: `Lädt eine Webseite und gibt ihren Text samt Preisangaben zurück (höchstens ${MAX_PAGES} je Produkt).`,
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Adresse, meist aus den Suchergebnissen' } }, required: ['url'] },
  } },
];

function createResearch(core, provider, opts = {}) {
  const { HttpError } = core;
  const db = () => core.db;
  const tz = opts.timeZone || 'Europe/Berlin';
  const queue = [];
  let active = 0;
  const waiters = new Set();

  // Aufträge, die ein Neustart unterbrochen hat
  db().prepare("UPDATE price_checks SET status = 'error', error = 'Abgebrochen (Server-Neustart).', finished_at = datetime('now') WHERE status IN ('pending', 'running')").run();

  const location = () => provider.getSetting('ai_location') || '';
  // Woher die Websuche kommt: OpenRouter-Web-Plugin (AI_WEB_SEARCH=1 erzwingt es, z. B. für einen kompatiblen Proxy
  // oder Tests), sonst das eingetragene Such-Tool des Gateways
  function searchMode(c) {
    let host = '';
    try { host = new URL(c.baseUrl).hostname; } catch { /* ungültig */ }
    if (process.env.AI_WEB_SEARCH === '1' || /(^|\.)openrouter\.ai$/.test(host)) return 'plugin';
    return c.searchTool ? 'gateway' : null;
  }
  function availability() {
    const c = provider.config();
    if (!c.key || !c.model) return { available: false, reason: 'Der Assistent ist noch nicht eingerichtet (Administration → Assistent).' };
    if (provider.getSetting('ai_research') === '0') return { available: false, disabled: true, reason: 'Die Preisrecherche ist in Administration → Assistent ausgeschaltet.' };
    if (!searchMode(c)) {
      return { available: false, reason: 'Die Preisrecherche braucht eine Websuche – OpenRouter als Schnittstelle oder das Such-Tool eines Gateways (z. B. LiteLLM) eintragen.' };
    }
    return { available: true, reason: '' };
  }

  const keyOf = (name, details) => `${String(name).trim().toLowerCase()}|${String(details || '').trim().toLowerCase()}`;
  const rowOut = (r) => (r ? {
    id: r.id, name: r.name, status: r.status, error: r.error || null, created_at: r.created_at, finished_at: r.finished_at,
    result: r.result ? JSON.parse(r.result) : null,
  } : null);
  const latest = (key) => db().prepare('SELECT * FROM price_checks WHERE query_key = ? ORDER BY id DESC LIMIT 1').get(key);
  const isFresh = (r) => r && r.status === 'done' && Date.parse(`${r.finished_at.replace(' ', 'T')}Z`) > Date.now() - FRESH_HOURS * 3600_000;

  // Was das Modell über das Produkt wissen soll: Name, Notiz/Beschreibung, benötigte Menge, Bestand
  function describe(entry) {
    let details = entry.note || '';
    let stock = null;
    if (entry.item_id) {
      try {
        const it = core.getItem(entry.item_id);
        details = [details, it.description].filter(Boolean).join('; ');
        stock = it.quantity;
      } catch { /* Gegenstand gelöscht */ }
    }
    return { name: String(entry.name || '').trim(), details, quantity: entry.quantity || null, stock };
  }

  // entries: [{name, note?, item_id?, quantity?}] → Zeilen (vorhandene frische werden wiederverwendet)
  function start(person, entries, { force = false } = {}) {
    const av = availability();
    if (!av.available) throw new HttpError(409, av.reason);
    const out = [];
    for (const e of entries) {
      const d = describe(e);
      if (!d.name) continue;
      const key = keyOf(d.name, d.details);
      const prev = latest(key);
      if (prev && (prev.status === 'pending' || prev.status === 'running' || (!force && isFresh(prev)))) { out.push(prev.id); continue; }
      const id = db().prepare(`INSERT INTO price_checks (query_key, name, details, quantity, stock, person_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')`).run(key, d.name, d.details, d.quantity, d.stock, person?.id ?? null).lastInsertRowid;
      queue.push(id);
      out.push(Number(id));
    }
    pump();
    return out.map((id) => rowOut(db().prepare('SELECT * FROM price_checks WHERE id = ?').get(id)));
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const id = queue.shift();
      active++;
      runOne(id).catch((e) => console.error('Preisrecherche', e)).finally(() => {
        active--;
        for (const w of waiters) w();
        pump();
      });
    }
  }

  // Warten, bis alle Zeilen fertig sind – höchstens ms
  function waitFor(ids, ms) {
    const done = () => ids.every((id) => {
      const r = db().prepare('SELECT status FROM price_checks WHERE id = ?').get(id);
      return !r || r.status === 'done' || r.status === 'error';
    });
    if (done()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (v) => { waiters.delete(check); clearTimeout(timer); resolve(v); };
      const check = () => { if (done()) finish(true); };
      const timer = setTimeout(() => finish(false), ms);
      waiters.add(check);
    });
  }

  function prompts(row, agent) {
    const today = new Date().toLocaleDateString('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
    const loc = location();
    const system = [
      agent ? 'Du recherchierst aktuelle Einkaufspreise in Deutschland mit den Werkzeugen websuche und seite_lesen.'
        : 'Du recherchierst aktuelle Einkaufspreise in Deutschland mit den Web-Suchergebnissen.',
      `Heute ist der ${today}.${loc ? ` Wohnort des Nutzers: ${loc} – bevorzuge Läden und Lieferdienste in der Nähe und nenne dann die nächste Filiale.` : ''}`,
      ...(agent ? [
        `Vorgehen: 1–${MAX_SEARCHES} gezielte Suchen auf Deutsch – Produkt mit Packungsgröße, dazu Händler oder „Angebot/Prospekt“ und der Ortsname`
          + `${/^\s*\d{5}\s*$/.test(loc) ? ' (der Wohnort ist nur als PLZ angegeben – nimm in Suchen den Ortsnamen dazu)' : ''}, `
          + 'z. B. "Butter 250 g Angebot Aldi Süd Stuttgart", "Butter Prospekt diese Woche Stuttgart", "Kaffeebohnen 1 kg Preis dm".',
        `Öffne dann mit seite_lesen die ${MAX_PAGES} vielversprechendsten Seiten (Online-Shops und Angebotsseiten der Händler, Prospektportale wie kaufDA oder marktguru) `
          + 'und antworte danach mit dem JSON. Lies nicht dieselbe Seite zweimal.',
      ] : []),
      'Antworte NUR mit einem JSON-Objekt, ohne Text davor oder danach, in dieser Form:',
      '{"angebote":[{"haendler":"Aldi Süd","filiale":"Straße, Stadtteil oder null","produkt":"genaue Bezeichnung","packung":"500 g",'
        + '"preis":0.69,"preis_je_einheit":"1,38 €/kg","pfand":null,"gueltig_bis":"TT.MM.JJJJ oder null","url":"https://…","bestaetigt":true}],'
        + '"hinweis":"kurzer Satz, z. B. ob sich eine größere Packung lohnt, oder null"}',
      'Regeln:',
      '- Nur Preise, die in einer Quelle stehen. "url" ist genau diese Quelle. Nichts schätzen oder erfinden.',
      agent ? '- "bestaetigt": true nur, wenn du den Preis auf einer mit seite_lesen gelesenen Seite gesehen hast (Händlerseite oder aktueller Prospekt) – "url" ist dann genau diese Seite; aus Suchauszügen, älteren Tests oder Preisvergleichen false.'
        : '- "bestaetigt": true nur, wenn der Preis auf der Seite des Händlers oder im aktuellen Prospekt steht; aus Suchvorschauen, älteren Tests oder Vergleichsportalen false.',
      '- "haendler" ist immer der Laden, bei dem man kauft (z. B. "Aldi Süd", "dm", "Amazon"), nie ein Vergleichs- oder Prospektportal (idealo, kaufDA, marktguru …) – die dürfen nur Quelle sein. Nennt die Quelle keinen Laden, lass das Angebot weg.',
      '- "preis" in Euro als Zahl für die genannte Packung; Pfand bei Getränken getrennt in "pfand" (Euro, Zahl).',
      `- Höchstens ${MAX_OFFERS} Angebote, das günstigste für die benötigte Menge zuerst (Preis je Einheit vergleichen). Abgelaufene Aktionen weglassen.`,
      '- Ist die Marke unklar, vergleiche passende Produkte und sag das im Hinweis.',
      '- Nichts gefunden: "angebote": [] und im Hinweis, warum.',
      '- "hinweis": höchstens zwei kurze Sätze (unter 200 Zeichen).',
    ].join('\n');
    const user = [
      `Produkt: ${row.name}`,
      row.details ? `Beschreibung/Notiz: ${row.details}` : '',
      row.quantity ? `Benötigte Menge: ${row.quantity}${row.stock != null ? ` (im Lager noch ${row.stock})` : ''}` : '',
      'Wo bekomme ich das gerade am günstigsten?',
    ].filter(Boolean).join('\n');
    return { system, user };
  }

  // „0,69 €“ → 0.69
  const euro = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
    const m = String(v ?? '').replace(/\s/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
    return m ? euro(Number(m[1].replace(',', '.'))) : null;
  };
  const text = (v, max = 120) => (v == null || v === '' || v === 'null' ? null : String(v).trim().slice(0, max));
  // Längere Texte am Satzende kürzen, sonst am Wortende mit „…“
  const sentence = (v, max) => {
    const s = text(v, 10_000);
    if (!s || s.length <= max) return s;
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.endsWith('.') ? cut.length - 1 : -1);
    return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max - 1).replace(/[\s,;:–-]+$/, '')} …`;
  };
  const norm = (u) => String(u).replace(/[#?].*$/, '').replace(/\/$/, '');
  // Steht der Preis im Seitentext? 1.19 → „1,19“/„1.19“; ganze Euro → „2,00“, „2.00“, „2,-“, „2 €“
  const priceOnPage = (preis, page) => {
    const [eur, ct] = preis.toFixed(2).split('.');
    const re = ct === '00' ? new RegExp(`(?<![\\d.,])${eur}(?:[.,]00?(?!\\d)|,-|\\s?€)`) : new RegExp(`(?<![\\d.,])${eur}[.,]${ct}(?!\\d)`);
    return re.test(page);
  };

  function parseJson(content) {
    const s = String(content || '');
    const from = s.indexOf('{');
    const to = s.lastIndexOf('}');
    if (from < 0 || to <= from) return null;
    try { return JSON.parse(s.slice(from, to + 1)); } catch { return null; }
  }

  // Antwort prüfen: nur Angebote mit Händler, Preis und Quelle; Quelle nicht unter den Suchergebnissen → unbestätigt.
  // cited: [{url, title}] (annotations bzw. Treffer und gelesene Seiten); pages: Map norm(url) → Text (nur im Agenten) –
  // dann ist ein Angebot nur bestätigt, wenn seine Seite gelesen wurde und der Preis darauf steht.
  function validate(raw, cited, pages = null) {
    const citedUrls = new Set(cited.map((c) => norm(c.url)));
    const offers = (Array.isArray(raw?.angebote) ? raw.angebote : []).map((o) => {
      const url = String(o?.url || '').trim();
      const preis = euro(o?.preis);
      if (!/^https?:\/\/\S+$/i.test(url) || !preis || !text(o?.haendler) || PORTAL.test(o.haendler)) return null;
      const inSearch = citedUrls.has(norm(url));
      const onPage = pages ? pages.has(norm(url)) && priceOnPage(preis, pages.get(norm(url))) : inSearch;
      return {
        haendler: text(o.haendler, 60), filiale: text(o.filiale), produkt: text(o.produkt), packung: text(o.packung, 60),
        preis, preis_je_einheit: text(o.preis_je_einheit, 40), pfand: euro(o.pfand), gueltig_bis: text(o.gueltig_bis, 20),
        url, bestaetigt: o.bestaetigt === true && inSearch && onPage, aus_suche: inSearch,
      };
    }).filter(Boolean).slice(0, MAX_OFFERS);
    return { angebote: offers, hinweis: sentence(raw?.hinweis, 300), quellen: cited.slice(0, 10) };
  }

  // Agent für Gateways ohne Web-Plugin: das Modell sucht und liest Seiten selbst, höchstens MAX_SEARCHES/MAX_PAGES
  async function runAgent(c, row, system, user) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const seen = new Map(); // norm(url) → {url, title}: Treffer und gelesene Seiten
    const pages = new Map(); // norm(url) → Text
    let searches = 0;
    let reads = 0;

    async function tool(call) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { return 'Die Argumente waren kein gültiges JSON.'; }
      if (call.function?.name === 'websuche') {
        if (++searches > MAX_SEARCHES) return `Limit erreicht: höchstens ${MAX_SEARCHES} Suchen. Lies Seiten oder antworte mit dem JSON.`;
        const q = String(args.anfrage || '').trim().slice(0, 300);
        if (!q) return 'Leere Suchanfrage.';
        let results;
        try { results = await provider.search(c, q, SEARCH_RESULTS, TIMEOUT_MS); } catch (e) { return e instanceof HttpError ? e.message : 'Websuche fehlgeschlagen.'; }
        for (const r of results) if (!seen.has(norm(r.url))) seen.set(norm(r.url), { url: r.url, title: text(r.title, 200) });
        return results.length ? results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`).join('\n\n') : 'Keine Treffer.';
      }
      if (call.function?.name === 'seite_lesen') {
        if (++reads > MAX_PAGES) return `Limit erreicht: höchstens ${MAX_PAGES} Seiten. Antworte jetzt mit dem JSON.`;
        try {
          const p = await fetchPage(args.url, { allowPrivate: process.env.RESEARCH_ALLOW_PRIVATE === '1' });
          for (const u of new Set([String(args.url), p.url])) {
            pages.set(norm(u), p.text);
            if (!seen.has(norm(u))) seen.set(norm(u), { url: u, title: text(p.title, 200) });
          }
          return `Titel: ${p.title || '–'}\nAdresse: ${p.url}\n\n${p.text || '(kein Text – die Seite lädt ihren Inhalt wohl erst per JavaScript; nimm eine andere Quelle)'}`;
        } catch (e) {
          return `Seite nicht lesbar: ${e.message}`;
        }
      }
      return 'Unbekanntes Werkzeug.';
    }

    for (let round = 0; ; round++) {
      const last = round >= MAX_ROUNDS - 1 || (searches >= MAX_SEARCHES && reads >= MAX_PAGES);
      if (last && round > 0) messages.push({ role: 'user', content: 'Keine weiteren Werkzeuge mehr – antworte jetzt nur mit dem JSON.' });
      const { message, usage } = await provider.complete(c, { messages, tools: AGENT_TOOLS, tool_choice: last ? 'none' : 'auto' }, TIMEOUT_MS);
      provider.logUsage(row.person_id, c.model, usage);
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length || last) {
        // gelesene Seiten zuerst als Quellen
        const cited = [...seen.entries()].sort(([a], [b]) => Number(pages.has(b)) - Number(pages.has(a))).map(([, v]) => v);
        return { message, cited, pages, steps: { suchen: Math.min(searches, MAX_SEARCHES), seiten: Math.min(reads, MAX_PAGES) } };
      }
      messages.push({ role: 'assistant', content: message.content || null, tool_calls: calls });
      const results = await Promise.all(calls.map(tool));
      calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: results[i] }));
    }
  }

  async function runOne(id) {
    const row = db().prepare('SELECT * FROM price_checks WHERE id = ?').get(id);
    if (!row || row.status !== 'pending') return;
    db().prepare("UPDATE price_checks SET status = 'running' WHERE id = ?").run(id);
    try {
      const c = provider.config();
      const agent = searchMode(c) === 'gateway';
      const { system, user } = prompts(row, agent);
      let message, cited, pages = null, steps;
      if (agent) {
        ({ message, cited, pages, steps } = await runAgent(c, row, system, user));
      } else {
        let usage;
        ({ message, usage } = await provider.complete(c, {
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          plugins: [{ id: 'web', max_results: SEARCH_RESULTS }],
        }, TIMEOUT_MS));
        provider.logUsage(row.person_id, c.model, usage);
        cited = (Array.isArray(message.annotations) ? message.annotations : [])
          .filter((a) => a?.type === 'url_citation' && a.url_citation?.url)
          .map((a) => ({ url: a.url_citation.url, title: text(a.url_citation.title, 200) }));
      }
      const raw = parseJson(message.content);
      if (!raw) throw new HttpError(502, 'Das Modell hat kein auswertbares Ergebnis geliefert.');
      const result = { ...validate(raw, cited, pages), ort: location() || null, modell: c.model, ...(steps ? { recherche: steps } : {}) };
      db().prepare("UPDATE price_checks SET status = 'done', result = ?, error = NULL, finished_at = datetime('now') WHERE id = ?").run(JSON.stringify(result), id);
    } catch (e) {
      db().prepare("UPDATE price_checks SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?")
        .run(e instanceof HttpError ? e.message : 'Interner Fehler.', id);
      if (!(e instanceof HttpError)) throw e;
    }
  }

  // Letztes Ergebnis je offenem Einkaufslisten-Eintrag
  function forShopping() {
    const checks = {};
    for (const e of core.shoppingOpen()) {
      const d = describe(e);
      const r = latest(keyOf(d.name, d.details));
      if (r) checks[e.id] = rowOut(r);
    }
    return { ...availability(), location: location(), checks };
  }

  const byIds = (ids) => ids.map((id) => rowOut(db().prepare('SELECT * FROM price_checks WHERE id = ?').get(id)));

  return { availability, start, waitFor, forShopping, byIds, location };
}

module.exports = { createResearch, FRESH_HOURS };
