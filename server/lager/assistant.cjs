'use strict';
// Heimlager – KI-Assistent in der App. Spricht jede OpenAI-kompatible Chat-Completions-API an (Standard: OpenRouter)
// und nutzt dieselben Werkzeuge wie der MCP-Server (tools.js). Die Tool-Schleife läuft auf dem Server: Der API-Schlüssel
// verlässt ihn nie, und die Werkzeuge laufen mit den Rechten der angemeldeten Person.
// Buchungen werden sofort ausgeführt (mit Rückgängig in der App); ab CONFIRM_FROM Buchungen in einer Anfrage wird erst gefragt.

const crypto = require('node:crypto');
const { createTools } = require('./tools.cjs');
const { createResearch } = require('./research.cjs');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_ROUNDS = 8; // Modell-Aufrufe je Anfrage
const CONFIRM_FROM = 4; // ab so vielen Buchungen in einer Anfrage erst bestätigen lassen
const MAX_IMAGES = 4;
const MAX_HISTORY = 20; // frühere Nachrichten, die höchstens als Kontext mitgehen …
const MAX_HISTORY_CHARS = 8000; // … und höchstens so viele Zeichen (die neuesten zuerst)
const TIMEOUT_MS = 90_000;
const PENDING_MS = 10 * 60_000; // so lange bleibt eine Rückfrage gültig
// Am Wandterminal (gewählte Person ohne Passwort) nur Lesen, Buchen, Einkaufsliste und Preise – wie die Terminal-Oberfläche
const TERMINAL_TOOLS = new Set(['lager_auflisten', 'objekte_suchen', 'objekt_anzeigen', 'lagerplaetze_suchen', 'lagerplatz_anzeigen',
  'haltbarkeit_pruefen', 'einkaufsliste_anzeigen', 'code_aufloesen', 'letzte_buchungen', 'gespraech_neu_beginnen', 'einbuchen', 'ausbuchen',
  'mehrere_einbuchen', 'einkaufsliste_hinzufuegen', 'einkaufsliste_abhaken', 'buchung_rueckgaengig', 'preise_recherchieren']);
const permitted = (name, auth) => !auth.terminal || TERMINAL_TOOLS.has(name);
const RESEARCH_WAIT_MS = 45_000; // so lange wartet der Assistent auf die Preisrecherche, danach läuft sie im Hintergrund weiter

function createAssistant(core, opts = {}) {
  const { HttpError } = core;
  const db = () => core.db;
  const kit = createTools(core, opts);
  const tz = opts.timeZone || 'Europe/Berlin';
  const pending = new Map(); // token → { personId, actions, expires }

  // ---------- Einstellungen ----------
  const getSetting = (key) => db().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  const setSetting = (key, value) => {
    if (value === null || value === '') db().prepare('DELETE FROM settings WHERE key = ?').run(key);
    else db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  };
  // Umgebungsvariablen haben Vorrang (Schlüssel dann nicht in Datenbank und Backups)
  function config() {
    const envKey = process.env.AI_API_KEY || '';
    const key = envKey || getSetting('ai_api_key') || '';
    return {
      baseUrl: (process.env.AI_BASE_URL || getSetting('ai_base_url') || DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: process.env.AI_MODEL || getSetting('ai_model') || '',
      key,
      keyFromEnv: !!envKey,
      // Such-Tool eines Gateways (z. B. LiteLLM search_tools) für die Preisrecherche ohne OpenRouter
      searchTool: process.env.AI_SEARCH_TOOL || getSetting('ai_search_tool') || '',
    };
  }
  const enabled = () => { const c = config(); return !!(c.key && c.model); };
  const keyHint = (k) => (k ? `${k.slice(0, 5)}…${k.slice(-4)}` : '');

  function publicSettings() {
    const c = config();
    const usage = db().prepare(`SELECT COUNT(*) AS requests, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens, SUM(cost) AS cost
      FROM assistant_log WHERE created_at >= datetime('now', '-30 days')`).get();
    return {
      base_url: c.baseUrl, model: c.model, key_set: !!c.key, key_hint: keyHint(c.key), key_from_env: c.keyFromEnv,
      base_url_from_env: !!process.env.AI_BASE_URL, model_from_env: !!process.env.AI_MODEL, enabled: enabled(), usage_30d: usage,
      location: getSetting('ai_location') || '', research_enabled: getSetting('ai_research') !== '0', research: research.availability(),
      search_tool: c.searchTool, search_tool_from_env: !!process.env.AI_SEARCH_TOOL,
    };
  }

  function saveSettings(body) {
    if (body.base_url !== undefined) {
      const u = String(body.base_url || '').trim();
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'Die Adresse muss mit http:// oder https:// beginnen.');
      setSetting('ai_base_url', u);
    }
    if (body.model !== undefined) setSetting('ai_model', String(body.model || '').trim().slice(0, 200));
    if (body.location !== undefined) setSetting('ai_location', String(body.location || '').trim().slice(0, 120));
    if (body.research_enabled !== undefined) setSetting('ai_research', body.research_enabled ? '' : '0'); // Standard: an
    if (body.search_tool !== undefined) {
      const t = String(body.search_tool || '').trim();
      if (!/^[\w.-]{0,64}$/.test(t)) throw new HttpError(400, 'Der Name des Such-Tools darf nur Buchstaben, Ziffern, ".", "_" und "-" enthalten.');
      setSetting('ai_search_tool', t);
    }
    // Schlüssel nur ändern, wenn mitgeschickt; leer = entfernen
    if (body.api_key !== undefined) setSetting('ai_api_key', String(body.api_key || '').trim());
    return publicSettings();
  }

  // ---------- Anbieter ----------
  async function complete(c, payload, timeoutMs = TIMEOUT_MS) {
    let res;
    try {
      res = await fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json',
          'X-Title': 'Heimlager', ...(opts.publicUrl ? { 'HTTP-Referer': opts.publicUrl } : {}),
        },
        body: JSON.stringify({ model: c.model, ...payload }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? 'Der KI-Anbieter antwortet nicht (Zeitüberschreitung).' : `KI-Anbieter nicht erreichbar: ${e.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* unten */ }
    if (!res.ok || !data || data.error) {
      const msg = data?.error?.message || data?.message || text.slice(0, 200) || res.statusText;
      throw new HttpError(502, `KI-Anbieter: ${msg}${res.ok ? '' : ` (HTTP ${res.status})`}`);
    }
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new HttpError(502, 'KI-Anbieter: leere Antwort.');
    return { message: choice, usage: data.usage || {} };
  }

  // Websuche über das Such-Tool eines Gateways: POST {baseUrl}/search/{tool} (LiteLLM-Format: {results: [{title, url, snippet}]})
  async function search(c, query, maxResults, timeoutMs = TIMEOUT_MS) {
    let res;
    try {
      res = await fetch(`${c.baseUrl}/search/${encodeURIComponent(c.searchTool)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, max_results: maxResults, country: 'DE' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new HttpError(502, e.name === 'TimeoutError' ? 'Die Websuche antwortet nicht (Zeitüberschreitung).' : `Websuche nicht erreichbar: ${e.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* unten */ }
    if (!res.ok || !data || data.error || !Array.isArray(data.results)) {
      const msg = data?.error?.message || data?.detail || data?.message || text.slice(0, 200) || res.statusText;
      throw new HttpError(502, `Websuche: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}${res.ok ? '' : ` (HTTP ${res.status})`}`);
    }
    return data.results
      .filter((r) => r && /^https?:\/\/\S+$/i.test(String(r.url || '')))
      .map((r) => ({ url: String(r.url), title: String(r.title || '').slice(0, 200), snippet: String(r.snippet || '').slice(0, 1500) }));
  }

  function logUsage(personId, model, usage) {
    db().prepare('INSERT INTO assistant_log (person_id, model, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?)')
      .run(personId, model, usage.prompt_tokens || 0, usage.completion_tokens || 0, typeof usage.cost === 'number' ? usage.cost : null);
  }

  const research = createResearch(core, { config, complete, search, logUsage, getSetting }, opts);

  // Werkzeuge, die auf das Netz warten (nicht in tools.js, weil dort alles synchron läuft) – nur im Assistenten
  const asyncTools = [{
    name: 'preise_recherchieren',
    description: 'Recherchiert im Internet, wo es Produkte gerade am günstigsten gibt (Preis, Händler, nahe Filiale, Quelle). '
      + 'Ohne "produkte" wird die ganze Einkaufsliste geprüft. Ergebnisse werden 24 Stunden gespeichert und stehen mit Quellen auch in der Einkaufsliste.',
    inputSchema: {
      type: 'object',
      properties: {
        produkte: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Optional: einzelne Produkte statt der Einkaufsliste, z. B. ["Batterien AA"]' },
        neu: { type: 'boolean', description: 'Gespeicherte Ergebnisse ignorieren und neu suchen (nur wenn der Nutzer das will)' },
      },
    },
    available: () => research.availability().available,
    run: async (a, auth) => {
      const entries = Array.isArray(a.produkte) && a.produkte.length
        ? a.produkte.slice(0, 10).map((name) => ({ name: String(name) }))
        : core.shoppingOpen();
      if (!entries.length) return 'Die Einkaufsliste ist leer – nichts zu recherchieren.';
      const rows = research.start(auth.person, entries, { force: !!a.neu });
      await research.waitFor(rows.map((r) => r.id), RESEARCH_WAIT_MS);
      const list = research.byIds(rows.map((r) => r.id));
      const running = list.filter((r) => r.status === 'pending' || r.status === 'running').map((r) => r.name);
      return {
        ort: research.location() || 'unbekannt (in den Assistent-Einstellungen eintragen)',
        ergebnisse: list.filter((r) => r.status === 'done' || r.status === 'error').map((r) => (r.status === 'error'
          ? { produkt: r.name, fehler: r.error }
          : { produkt: r.name, angebote: r.result.angebote.slice(0, 2).map(({ url, aus_suche, ...o }) => o), hinweis: r.result.hinweis || undefined })),
        ...(running.length ? { noch_in_arbeit: running } : {}),
        hinweis: 'Nenne je Produkt kurz das günstigste Angebot (Händler, Preis, ggf. „unbestätigt“) und verweise für Quellen auf die Einkaufsliste.'
          + (running.length ? ' Sag, dass die übrigen Produkte noch recherchiert werden und gleich in der Einkaufsliste erscheinen.' : ''),
      };
    },
  }];
  const asyncTool = (name) => asyncTools.find((t) => t.name === name && t.available());

  // Werkzeuge im Function-Calling-Format
  const toolSpecs = (auth) => [...kit.list(auth, { assistant: true }), ...asyncTools.filter((t) => t.available())].filter((t) => permitted(t.name, auth)).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  async function callTool(name, args, auth, ctx) {
    if (!permitted(name, auth)) return { content: [{ type: 'text', text: 'Am Wandterminal nicht möglich.' }], isError: true };
    const t = asyncTool(name);
    if (!t) return kit.call(name, args, auth, ctx);
    try {
      const out = await t.run(args || {}, auth, ctx);
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }], isError: false, data: out };
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('Werkzeug', name, e);
      return { content: [{ type: 'text', text: e instanceof HttpError ? e.message : 'Interner Fehler.' }], isError: true };
    }
  }

  // ---------- Systemprompt ----------
  function systemPrompt(auth, context, codes) {
    const today = new Date().toLocaleDateString('de-DE', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const whs = db().prepare('SELECT code, name FROM warehouses ORDER BY id').all().map((w) => `${w.code} (${w.name})`).join(', ');
    const named = db().prepare(`SELECT w.code, pl.col, pl.row, pl.name FROM places pl JOIN warehouses w ON w.id = pl.warehouse_id
      WHERE pl.name != '' ORDER BY w.id, LENGTH(pl.col), pl.col, pl.row LIMIT 80`).all().map((p) => `${p.code}-${p.col}${p.row} „${p.name}“`).join(', ');
    const lines = [
      kit.instructions(auth),
      '',
      'Du bist der Assistent in der Heimlager-App. Antworte auf Deutsch, kurz und freundlich (1–3 Sätze), ohne Markdown-Tabellen.',
      `Heute ist ${today}. Lager: ${whs}.`,
      ...(named ? [`Benannte Lagerplätze: ${named}. Als "platz" genügt auch der Name.`] : []),
      '- Führe Wünsche direkt mit den Werkzeugen aus, statt nur zu beschreiben, was man tun könnte. Buchungen können in der App rückgängig gemacht werden.',
      '- Suche vor dem Anlegen eines neuen Gegenstands mit objekte_suchen, ob es ihn schon gibt – dann den vorhandenen einbuchen.',
      '- Mehrere Gegenstände auf einmal: alle Buchungen in EINEM Schritt ausführen (mehrere_einbuchen oder parallele Werkzeugaufrufe). '
        + `Ab ${CONFIRM_FROM} Buchungen fragt die App den Nutzer automatisch – frag deshalb nicht selbst nach.`,
      '- Fehlt der Lagerplatz oder ist etwas unklar (mehrere Treffer), frag kurz nach, statt zu raten.',
      '- Fotos: Erkenne, was darauf ist (Gegenstand, Etikett, Regal). Wenn ein Gegenstand neu angelegt wird und ein Foto dabei ist, speichere es mit foto_zuordnen.',
      '- Sprachnachrichten können Erkennungsfehler enthalten – deute sie sinnvoll (z. B. "Keller Be zwölf" = K-B12).',
      '- Nenne nach Buchungen Gegenstand, Menge und Platz, keine IDs.',
      ...(research.availability().available ? ['- Fragt der Nutzer nach Preisen oder wo etwas am günstigsten ist, nutze preise_recherchieren. '
        + 'Dafür darfst du je Produkt eine kurze Zeile schreiben (ohne Tabelle).'] : []),
    ];
    if (auth.terminal) lines.push(`Du läufst am Wandterminal im Flur; ${auth.person.name} spricht mit dir. Die Antwort wird vorgelesen – antworte in ein bis zwei kurzen Sätzen. Verwaltung, Bearbeiten und Fotos gehen hier nicht.`);
    if (context?.place) lines.push(`Der Nutzer hat den Assistenten auf dem Lagerplatz ${context.place} geöffnet – "hier" meint diesen Platz.`);
    if (context?.item) lines.push(`Der Nutzer hat den Assistenten beim Gegenstand „${context.item.name}“ (Code ${context.item.code}, ${context.item.wh_code}-${context.item.col}${context.item.row}) geöffnet – "das" meint ihn, falls nichts anderes gesagt wird.`);
    if (codes.length) lines.push(`Auf den Fotos erkannte QR-Codes: ${codes.join('; ')}.`);
    return lines.join('\n');
  }

  // Kontext aus der App: {item_id} oder {place: {warehouse_id, col, row}}
  function resolveContext(ctx) {
    try {
      if (ctx?.item_id) return { item: core.getItem(Number(ctx.item_id)) };
      if (ctx?.place) {
        const w = db().prepare('SELECT code FROM warehouses WHERE id = ?').get(Number(ctx.place.warehouse_id));
        if (w) { const l = core.normalizeLocation(ctx.place.col, ctx.place.row); return { place: `${w.code}-${l.col}${l.row}` }; }
      }
    } catch { /* ungültiger Kontext → ohne */ }
    return {};
  }

  // Bilder: [{image, thumb, codes?}] – image/thumb Base64-JPEG/WebP aus der App (schon verkleinert)
  function readImages(list) {
    if (!Array.isArray(list)) return [];
    if (list.length > MAX_IMAGES) throw new HttpError(400, `Höchstens ${MAX_IMAGES} Fotos je Nachricht.`);
    return list.map((x, i) => {
      const b64 = String(x?.image || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(b64, 'base64');
      const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const webp = buf.subarray(8, 12).toString('latin1') === 'WEBP';
      if (!jpeg && !webp) throw new HttpError(400, `Foto ${i + 1}: nur JPEG oder WebP.`);
      if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, `Foto ${i + 1} ist zu groß.`);
      return { image: b64, thumb: String(x?.thumb || b64).replace(/^data:[^,]*,/, ''), type: jpeg ? 'image/jpeg' : 'image/webp',
        codes: Array.isArray(x?.codes) ? x.codes.slice(0, 10).map(String) : [] };
    });
  }

  // QR-Inhalte der Fotos in lesbaren Text übersetzen
  function describeCodes(images) {
    const out = [];
    images.forEach((img, i) => {
      for (const raw of img.codes) {
        const r = core.resolveCode(raw);
        const what = r.type === 'place' ? `Lagerplatz ${r.place.wh_code}-${r.place.col}${r.place.row}${r.place.name ? ` (${r.place.name})` : ''}`
          : r.type === 'item' ? `Gegenstand „${r.item.name}“ (Code ${r.item.code})`
            : r.type === 'unknown' ? `freies Etikett ${r.code} (noch keinem Gegenstand zugeordnet)` : `unbekannter Code „${raw.slice(0, 40)}“`;
        out.push(`Bild ${i + 1}: ${what}`);
      }
    });
    return out;
  }

  // Ergebnis eines Werkzeugs → Einträge für die Buchungskarten in der App
  function bookingsOf(name, data) {
    if (!data || typeof data !== 'object') return [];
    const list = Array.isArray(data.ergebnisse) ? data.ergebnisse : [data];
    return list.filter((r) => r && !r.fehler && (r.gegenstand || r.buchung_id)).map((r) => ({
      tool: name, text: r.meldung || '', movement_id: r.buchung_id || null,
      item_id: r.gegenstand?.id ?? null, item: r.gegenstand?.name ?? null, platz: r.gegenstand?.platz ?? null,
    }));
  }

  // Alle Lagerplätze („K-B12“), die in einem Werkzeug-Ergebnis vorkommen – für die 3D-Ansicht in der Antwort
  const PLACE_RE = /^[A-Z][A-Z0-9]{0,3}-[A-Z]{1,3}\d{1,2}$/;
  function placesOf(data, out = new Set()) {
    if (!data || typeof data !== 'object' || out.size >= 20) return out;
    if (Array.isArray(data)) { for (const x of data) placesOf(x, out); return out; }
    for (const [k, v] of Object.entries(data)) {
      if (k === 'platz' && typeof v === 'string' && PLACE_RE.test(v)) out.add(v);
      else if (v && typeof v === 'object') placesOf(v, out);
    }
    return out;
  }

  const toolCount = (tool, args) => (tool?.write ? (tool.count ? tool.count(args) : 1) : 0);
  function parseArgs(call) {
    try { return JSON.parse(call.function?.arguments || '{}') || {}; } catch { return null; }
  }
  const describeAction = (name, a) => {
    const t = kit.get(name);
    if (name === 'mehrere_einbuchen') return (a.gegenstaende || []).map((g) => `${g.menge ?? 1}× ${g.name || g.objekt} → ${g.behaelter || g.platz || a.behaelter || a.platz || '?'}`);
    const what = a.name || a.objekt || '';
    const where = a.behaelter ? ` → in ${a.behaelter}` : a.platz ? ` → ${a.platz}` : '';
    return [`${t?.title || name}: ${a.menge ? `${a.menge}× ` : ''}${what}${where}`.trim()];
  };

  // Verlauf aus der App begrenzen: nur Text, die neuesten Nachrichten bis MAX_HISTORY / MAX_HISTORY_CHARS
  function trimHistory(list) {
    const clean = (Array.isArray(list) ? list : [])
      .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      .slice(-MAX_HISTORY);
    let budget = MAX_HISTORY_CHARS;
    let from = clean.length;
    while (from > 0 && budget - clean[from - 1].content.length >= 0) budget -= clean[--from].content.length;
    const kept = clean.slice(from);
    while (kept[0]?.role === 'assistant') kept.shift(); // mit einer Nutzer-Nachricht beginnen
    return kept;
  }

  // ---------- Anfrage ----------
  // body: { message, history: [{role, content}], images: [{image, thumb, codes}], context }
  async function chat(auth, body) {
    const c = config();
    if (!c.key || !c.model) throw new HttpError(409, 'Der Assistent ist noch nicht eingerichtet (Administration → Assistent).');
    const text = String(body.message || '').trim().slice(0, 4000);
    const images = readImages(body.images);
    if (!text && !images.length) throw new HttpError(400, 'Bitte eine Nachricht, ein Foto oder beides schicken.');
    const context = resolveContext(body.context);
    const codes = describeCodes(images);

    const history = trimHistory(body.history);
    const userContent = images.length
      ? [{ type: 'text', text: text || 'Was ist auf dem Foto? Bitte entsprechend buchen oder nachfragen.' },
        ...images.map((img, i) => [{ type: 'text', text: `Bild ${i + 1}:` }, { type: 'image_url', image_url: { url: `data:${img.type};base64,${img.image}` } }]).flat()]
      : text;
    const messages = [{ role: 'system', content: systemPrompt(auth, context, codes) }, ...history, { role: 'user', content: userContent }];
    const tools = toolSpecs(auth);
    const ctx = { source: 'assistent', images, reset: false };
    const bookings = [];
    const places = new Set();
    let writes = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { message, usage } = await complete(c, { messages, tools, tool_choice: 'auto' });
      logUsage(auth.person.id, c.model, usage);
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length) return { reply: String(message.content || '').trim() || 'Erledigt.', bookings, places: [...places], reset: ctx.reset };

      messages.push({ role: 'assistant', content: message.content || null, tool_calls: calls });
      // Buchungen dieses Schritts zählen – ab CONFIRM_FROM erst nachfragen
      const planned = calls.map((call) => ({ call, tool: kit.get(call.function?.name), args: parseArgs(call) }));
      const newWrites = planned.reduce((n, p) => n + toolCount(p.tool, p.args || {}), 0);
      const deferred = newWrites && writes + newWrites >= CONFIRM_FROM;

      const actions = [];
      for (const p of planned) {
        const name = p.call.function?.name;
        let result;
        if (!p.args) result = 'Die Argumente waren kein gültiges JSON.';
        else if (!permitted(name, auth)) result = 'Am Wandterminal nicht möglich.';
        else if (deferred && p.tool?.write) {
          actions.push({ name, args: p.args });
          result = 'Zurückgestellt: Der Nutzer muss diese Buchungen erst bestätigen.';
        } else {
          const r = await callTool(name, p.args, auth, ctx);
          result = r.content.map((x) => (x.type === 'text' ? x.text : '[Bild]')).join('\n');
          if (!r.isError) { bookings.push(...bookingsOf(name, r.data)); placesOf(r.data, places); }
        }
        messages.push({ role: 'tool', tool_call_id: p.call.id, content: result });
      }
      if (deferred) {
        const token = crypto.randomBytes(16).toString('hex');
        const count = actions.reduce((n, a) => n + toolCount(kit.get(a.name), a.args), 0);
        pending.set(token, { personId: auth.person.id, actions, images, expires: Date.now() + PENDING_MS });
        return {
          reply: String(message.content || '').trim() || `Das sind ${count} Buchungen – soll ich sie ausführen?`,
          bookings, places: [...places], reset: ctx.reset,
          confirm: { token, count, actions: actions.flatMap((a) => describeAction(a.name, a.args)) },
        };
      }
      writes += newWrites;
    }
    return { reply: 'Das war mir zu verschachtelt – bitte in kleineren Schritten versuchen.', bookings, places: [...places], reset: ctx.reset };
  }

  // Zurückgestellte Buchungen ausführen (ohne erneuten Modell-Aufruf)
  function confirm(auth, token) {
    for (const [t, p] of pending) if (p.expires < Date.now()) pending.delete(t);
    const p = pending.get(String(token || ''));
    if (!p || p.personId !== auth.person.id) throw new HttpError(404, 'Diese Rückfrage ist abgelaufen – bitte noch einmal sagen, was gebucht werden soll.');
    pending.delete(token);
    const bookings = [];
    const errors = [];
    for (const a of p.actions.filter((x) => permitted(x.name, auth))) {
      const r = kit.call(a.name, a.args, auth, { source: 'assistent', images: p.images });
      if (r.isError) errors.push(r.content[0]?.text);
      else {
        bookings.push(...bookingsOf(a.name, r.data));
        for (const e of r.data?.ergebnisse || []) if (e.fehler) errors.push(e.fehler);
      }
    }
    const reply = `${bookings.length} ${bookings.length === 1 ? 'Buchung' : 'Buchungen'} ausgeführt.${errors.length ? ` Nicht geklappt: ${errors.join('; ')}` : ''}`;
    return { reply, bookings };
  }
  const cancel = (auth, token) => {
    const p = pending.get(String(token || ''));
    if (p && p.personId === auth.person.id) pending.delete(token);
    return { reply: 'Okay, nichts gebucht.' };
  };

  // Verbindung testen: kleiner Aufruf mit einem Werkzeug
  async function test() {
    const c = config();
    if (!c.key || !c.model) throw new HttpError(409, 'Bitte zuerst Adresse, Modell und API-Schlüssel eintragen.');
    const probe = { type: 'function', function: { name: 'ping', description: 'Test: immer aufrufen.', parameters: { type: 'object', properties: { ok: { type: 'boolean' } } } } };
    const { message, usage } = await complete(c, {
      messages: [{ role: 'user', content: 'Verbindungstest. Rufe bitte das Werkzeug ping mit ok=true auf.' }],
      tools: [probe], tool_choice: 'auto', max_tokens: 50,
    });
    logUsage(null, c.model, usage);
    const tools = Array.isArray(message.tool_calls) && message.tool_calls.some((t) => t.function?.name === 'ping');
    return {
      ok: true, model: c.model, tools,
      message: tools ? `Verbindung klappt, ${c.model} kann Werkzeuge nutzen.`
        : `Verbindung klappt, aber ${c.model} hat das Werkzeug nicht aufgerufen – für den Assistenten ein Modell mit Tool-Calling wählen.`,
    };
  }

  return { enabled, publicSettings, saveSettings, chat, confirm, cancel, test, research, CONFIRM_FROM };
}

module.exports = { createAssistant, DEFAULT_BASE_URL };
