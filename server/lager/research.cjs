'use strict';
// Heimlager – Preisrecherche für die Einkaufsliste. Je Produkt ein Modell-Aufruf mit der Websuche von OpenRouter
// (plugins: [{ id: 'web' }]); die Quellen kommen als annotations zurück. Läuft als Auftrag im Hintergrund,
// Ergebnisse werden in price_checks gespeichert und 24 Stunden wiederverwendet.

const FRESH_HOURS = 24;
const CONCURRENCY = 3;
const TIMEOUT_MS = 120_000;
const MAX_OFFERS = 4;

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
  // Nur OpenRouter kennt das Web-Plugin; AI_WEB_SEARCH=1 erzwingt es (z. B. für einen kompatiblen Proxy oder Tests)
  function availability() {
    const c = provider.config();
    if (!c.key || !c.model) return { available: false, reason: 'Der Assistent ist noch nicht eingerichtet (Administration → Assistent).' };
    if (provider.getSetting('ai_research') === '0') return { available: false, disabled: true, reason: 'Die Preisrecherche ist in Administration → Assistent ausgeschaltet.' };
    let host = '';
    try { host = new URL(c.baseUrl).hostname; } catch { /* ungültig */ }
    if (process.env.AI_WEB_SEARCH !== '1' && !/(^|\.)openrouter\.ai$/.test(host)) {
      return { available: false, reason: 'Die Preisrecherche nutzt die Websuche von OpenRouter – dafür OpenRouter als Schnittstelle eintragen.' };
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

  function prompts(row) {
    const today = new Date().toLocaleDateString('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
    const loc = location();
    const system = [
      'Du recherchierst aktuelle Einkaufspreise in Deutschland mit den Web-Suchergebnissen.',
      `Heute ist der ${today}.${loc ? ` Wohnort des Nutzers: ${loc} – bevorzuge Läden und Lieferdienste in der Nähe und nenne dann die nächste Filiale.` : ''}`,
      'Antworte NUR mit einem JSON-Objekt, ohne Text davor oder danach, in dieser Form:',
      '{"angebote":[{"haendler":"Aldi Süd","filiale":"Straße, Stadtteil oder null","produkt":"genaue Bezeichnung","packung":"500 g",'
        + '"preis":0.69,"preis_je_einheit":"1,38 €/kg","pfand":null,"gueltig_bis":"TT.MM.JJJJ oder null","url":"https://…","bestaetigt":true}],'
        + '"hinweis":"kurzer Satz, z. B. ob sich eine größere Packung lohnt, oder null"}',
      'Regeln:',
      '- Nur Preise, die in einer Quelle stehen. "url" ist genau diese Quelle. Nichts schätzen oder erfinden.',
      '- "bestaetigt": true nur, wenn der Preis auf der Seite des Händlers oder im aktuellen Prospekt steht; aus Suchvorschauen, älteren Tests oder Vergleichsportalen false.',
      '- "preis" in Euro als Zahl für die genannte Packung; Pfand bei Getränken getrennt in "pfand" (Euro, Zahl).',
      `- Höchstens ${MAX_OFFERS} Angebote, das günstigste für die benötigte Menge zuerst (Preis je Einheit vergleichen). Abgelaufene Aktionen weglassen.`,
      '- Ist die Marke unklar, vergleiche passende Produkte und sag das im Hinweis.',
      '- Nichts gefunden: "angebote": [] und im Hinweis, warum.',
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

  function parseJson(content) {
    const s = String(content || '');
    const from = s.indexOf('{');
    const to = s.lastIndexOf('}');
    if (from < 0 || to <= from) return null;
    try { return JSON.parse(s.slice(from, to + 1)); } catch { return null; }
  }

  // Antwort prüfen: nur Angebote mit Preis und Quelle; Quelle nicht unter den Suchergebnissen → unbestätigt
  function validate(raw, annotations) {
    const cited = (Array.isArray(annotations) ? annotations : [])
      .filter((a) => a?.type === 'url_citation' && a.url_citation?.url)
      .map((a) => ({ url: a.url_citation.url, title: text(a.url_citation.title, 200) }));
    const citedUrls = new Set(cited.map((c) => c.url.replace(/[#?].*$/, '').replace(/\/$/, '')));
    const offers = (Array.isArray(raw?.angebote) ? raw.angebote : []).map((o) => {
      const url = String(o?.url || '').trim();
      const preis = euro(o?.preis);
      if (!/^https?:\/\/\S+$/i.test(url) || !preis || !text(o?.haendler)) return null;
      const inSearch = citedUrls.has(url.replace(/[#?].*$/, '').replace(/\/$/, ''));
      return {
        haendler: text(o.haendler, 60), filiale: text(o.filiale), produkt: text(o.produkt), packung: text(o.packung, 60),
        preis, preis_je_einheit: text(o.preis_je_einheit, 40), pfand: euro(o.pfand), gueltig_bis: text(o.gueltig_bis, 20),
        url, bestaetigt: o.bestaetigt === true && inSearch, aus_suche: inSearch,
      };
    }).filter(Boolean).slice(0, MAX_OFFERS);
    return { angebote: offers, hinweis: text(raw?.hinweis, 300), quellen: cited.slice(0, 10) };
  }

  async function runOne(id) {
    const row = db().prepare('SELECT * FROM price_checks WHERE id = ?').get(id);
    if (!row || row.status !== 'pending') return;
    db().prepare("UPDATE price_checks SET status = 'running' WHERE id = ?").run(id);
    try {
      const c = provider.config();
      const { system, user } = prompts(row);
      const { message, usage } = await provider.complete(c, {
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        plugins: [{ id: 'web', max_results: 6 }],
      }, TIMEOUT_MS);
      provider.logUsage(row.person_id, c.model, usage);
      const raw = parseJson(message.content);
      if (!raw) throw new HttpError(502, 'Das Modell hat kein auswertbares Ergebnis geliefert.');
      const result = { ...validate(raw, message.annotations), ort: location() || null, modell: c.model };
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
