'use strict';
// Heimlager – Werkzeuge für KI-Assistenten. Gemeinsam genutzt vom MCP-Server (mcp.js) und vom Assistenten in der App (assistant.js).
// Jedes Werkzeug: name, title, description, inputSchema (JSON Schema), write (bucht/ändert), admin (nur Admins), run(args, person, ctx).
// ctx: { source: 'mcp' | 'assistent', images: [...] } – Herkunft der Buchungen und Bilder aus dem Chat.

const INSTRUCTIONS = `Heimlager ist ein Lagersystem für zuhause.
- Es gibt ein oder mehrere Lager (z. B. Keller, Garage), jedes mit Kürzel (z. B. "K").
- Lagerplätze bestehen aus Spalte (Buchstaben) und Zeile (0–99), geschrieben mit Lager-Kürzel: "K-B12" = Lager K, Spalte B, Zeile 12.
- Plätze aus dem Hausplan: Jeder Raum ist ein Lager (z. B. „KU“ = Küche), jedes Möbel eine Spalte, jedes Fach eine Zeile. Ihr Name ist „Möbel · Fach“ (z. B. „Hochschrank Kühlschrank 60 · Kühlschrank, oben“, „Regal offen 80 · Boden 2“), die Kategorie ist der Raum. Beschreibt der Nutzer einen Ort mit Raum, Möbel und Fach („Küche Kühlschrank oben“, „Kellerregal Boden 2“), gib genau das als "platz" an.
- Viele Plätze haben Namen (z. B. „Kühlschrank“, „Regal links“). Nennt der Nutzer einen Ort in Worten, gib ihn einfach als "platz" an – der Name wird aufgelöst; zum Nachschlagen gibt es lagerplaetze_suchen. Frag erst nach einer Adresse, wenn der Name nicht gefunden wird.
- Gegenstände haben eine ID, einen 6-stelligen Code (z. B. "K7M2XQ"), eine Menge und einen Lagerplatz.
- Behälter (Tasche, Box, Kiste …) sind Gegenstände, in denen andere Gegenstände liegen – auch verschachtelt. Der Inhalt hat immer den Lagerplatz des Behälters und wandert beim Umlagern mit.
- Verbrauchsmaterial kommt beim Ausbuchen automatisch auf die Einkaufsliste.
- Gegenstände können ein Haltbarkeitsdatum haben (ein Datum je Gegenstand, bei mehreren Packungen das früheste).
- Gegenstände können per ID, Code oder Name angegeben werden. Ist ein Name nicht eindeutig, nenne dem Nutzer die Treffer und frage nach.
- Frag den Nutzer nie nach IDs oder Codes – gib Namen an oder schlag selbst nach (objekte_suchen, einkaufsliste_anzeigen). Meldet ein Werkzeug einen Fehler, lies die Meldung, korrigiere die Angaben und versuch es erneut.
- Enthält ein Ergebnis "hinweis", befolge ihn (z. B. dem Nutzer eine Rückfrage stellen).
- Alle Buchungen werden der Person zugeordnet, der der API-Schlüssel gehört.

Typische Abläufe:
- „X auf die Einkaufsliste“ → einkaufsliste_hinzufuegen mit name (gibt es X schon im Lager, wird es automatisch verknüpft).
- „X gekauft“ → einkaufsliste_abhaken mit name. Liegt X schon im Lager, direkt mit einbuchen: true auf den bisherigen Platz buchen, außer der Nutzer will es woanders hin.
  Ist X noch kein Gegenstand im Lager, frag, ob und wo es eingelagert werden soll – mit platz (oder behaelter) legt einkaufsliste_abhaken den Gegenstand gleich an.
- „X aufgebraucht / leer“ → ausbuchen (Verbrauchsmaterial kommt dabei von selbst auf die Einkaufsliste).
- Neuer Gegenstand → erst objekte_suchen, dann einbuchen mit name, menge und platz; Haltbarkeit nur, wenn genannt.`;

function createTools(core, opts = {}) {
  const { HttpError } = core;
  const db = () => core.db; // nach einer Wiederherstellung wird die Datenbank neu geöffnet
  const tz = opts.timeZone || 'Europe/Berlin';
  const fmtDate = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('de-DE', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }) : '');
  const loc = (x) => `${x.wh_code}-${x.col}${x.row}`;
  const lower = (s) => String(s ?? '').trim().toLocaleLowerCase('de');
  const day = (d) => d.split('-').reverse().join('.');

  // ---------- Auflösen von Angaben aus der Unterhaltung ----------
  const warehouses = () => db().prepare('SELECT * FROM warehouses ORDER BY id').all();

  function resolveWarehouse(ref) {
    const list = warehouses();
    const r = lower(ref);
    const hit = list.find((w) => lower(w.code) === r) || list.find((w) => lower(w.name) === r)
      || (list.filter((w) => lower(w.name).includes(r)).length === 1 ? list.find((w) => lower(w.name).includes(r)) : null);
    if (!hit) throw new HttpError(404, `Lager „${ref}“ nicht gefunden. Vorhanden: ${list.map((w) => `${w.code} (${w.name})`).join(', ')}.`);
    return hit;
  }

  // Benannte Lagerplätze ("Kühlschrank", "Regal links") – für die Suche nach Namen
  const namedPlaces = () => db().prepare(`SELECT pl.warehouse_id AS wid, w.code AS wh_code, w.name AS wh_name, pl.col, pl.row, pl.name, pl.category, pl.description
    FROM places pl JOIN warehouses w ON w.id = pl.warehouse_id WHERE pl.name != '' OR pl.category != '' ORDER BY w.id, LENGTH(pl.col), pl.col, pl.row`).all();
  const placeLabel = (p) => `${p.wh_code}-${p.col}${p.row}${p.name ? ` „${p.name}“` : ''}${p.category ? ` [${p.category}]` : ''} (${p.wh_name})`;
  // „in den Kühlschrank“ → „kühlschrank“
  const placeWords = (t) => lower(t).replace(/[„“"'.,!?]/g, ' ').split(/\s+/)
    .filter((w) => w && !['in', 'im', 'ins', 'in\'s', 'auf', 'aufs', 'an', 'am', 'zum', 'zur', 'den', 'dem', 'die', 'das', 'der', 'des', 'bitte', 'platz', 'lagerplatz'].includes(w));

  function placesByName(text, lagerRef) {
    const words = placeWords(text);
    if (!words.length) return [];
    let list = namedPlaces();
    if (lagerRef) { const w = resolveWarehouse(lagerRef); list = list.filter((p) => p.wid === w.id); }
    const q = words.join(' ');
    const score = (p) => {
      const name = lower(p.name), cat = lower(p.category), wh = lower(p.wh_name);
      if (name && name === q) return 4;
      // Lagername darf mitgenannt werden: „Küche Kühlschrank“
      const rest = words.filter((w) => !wh.split(/\s+/).includes(w) && w !== lower(p.wh_code)).join(' ');
      if (name && rest && name === rest) return 3;
      if (name && rest && (name.includes(rest) || rest.includes(name))) return 2;
      // Wort für Wort über Name, Raum (Kategorie) und Lager: „Küche Kühlschrank oben“ → „Hochschrank Kühlschrank 60 · Kühlschrank, oben“
      const tokens = (t) => lower(t).replace(/[„“"'.,!?·()/:;-]/g, ' ').split(/\s+/).filter(Boolean);
      const hay = tokens(`${p.name} ${p.category} ${p.wh_name} ${p.wh_code}`);
      const inHay = (w) => hay.some((h) => h === w || (w.length >= 4 && h.startsWith(w)));
      if (name && words.length > 1 && words.every((w) => tokens(w).every(inHay))) return 1.5;
      if (cat && rest && (cat === rest || cat.includes(rest))) return 1;
      return 0;
    };
    const scored = list.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...scored.map((x) => x.s));
    return scored.filter((x) => x.s === best).map((x) => x.p);
  }

  // "K-B12", "K B12", "Keller B12", "P-K-B12", "B12" (+ lager oder Standardlager) – oder ein Platzname wie "Kühlschrank"
  function resolvePlace(platz, lagerRef, fallbackWid) {
    try {
      return resolvePlaceCode(platz, lagerRef, fallbackWid);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      const hits = placesByName(platz, lagerRef);
      if (hits.length === 1) return { wid: hits[0].wid, col: hits[0].col, row: hits[0].row };
      if (hits.length > 1) throw new HttpError(409, `„${platz}“ passt zu mehreren Plätzen: ${hits.map(placeLabel).join('; ')}. Nachfragen, welcher gemeint ist.`);
      const named = namedPlaces();
      throw new HttpError(400, `${e.message}${named.length ? ` Benannte Plätze: ${named.slice(0, 30).map(placeLabel).join('; ')}.` : ''}`);
    }
  }

  function resolvePlaceCode(platz, lagerRef, fallbackWid) {
    const s = String(platz || '').trim().toUpperCase().replace(/^P-/, '').replace(/[\s/:.]+/g, '-');
    const m = s.match(/^(?:(.+?)-)?([A-Z]{1,3})-?(\d{1,2})$/);
    if (!m) throw new HttpError(400, `Lagerplatz „${platz}“ nicht verstanden. Format: Lager-Kürzel, Spalte, Zeile – z. B. "K-B12".`);
    let wid;
    if (m[1]) wid = resolveWarehouse(m[1]).id;
    else if (lagerRef) wid = resolveWarehouse(lagerRef).id;
    else if (fallbackWid) wid = fallbackWid;
    else {
      const list = warehouses();
      if (list.length > 1) {
        throw new HttpError(400, `Es gibt mehrere Lager – bitte mit Kürzel angeben (z. B. "${list[0].code}-${m[2]}${m[3]}"). Lager: ${list.map((w) => `${w.code} (${w.name})`).join(', ')}.`);
      }
      wid = list[0].id;
    }
    const { col, row } = core.normalizeLocation(m[2], m[3]);
    return { wid, col, row };
  }

  function resolveItem(ref) {
    const r = String(ref ?? '').trim();
    if (!r) throw new HttpError(400, 'Bitte einen Gegenstand angeben (ID, Code oder Name).');
    if (/^\d+$/.test(r)) return core.getItem(Number(r));
    const code = core.parseCode(r);
    if (code?.type === 'item') {
      const it = core.getItemByCode(code.code);
      if (it) return it;
    }
    const hits = core.searchItems(r, 20);
    const exact = hits.filter((i) => lower(i.name) === lower(r));
    if (exact.length === 1) return exact[0];
    if (!exact.length && hits.length === 1) return hits[0];
    if (!hits.length) throw new HttpError(404, `Kein Gegenstand „${r}“ gefunden.`);
    const cand = (exact.length ? exact : hits).slice(0, 8).map((i) => `ID ${i.id}: ${i.name} (${loc(i)}, ${i.quantity} Stück)`).join('; ');
    throw new HttpError(409, `„${r}“ ist nicht eindeutig. Treffer: ${cand}. Bitte nachfragen und mit ID angeben.`);
  }

  // ---------- Ausgabe ----------
  const itemOut = (i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    beschreibung: i.description || undefined,
    menge: i.quantity,
    platz: loc(i),
    lager: i.wh_name,
    platzname: i.place_name || undefined,
    liegt_in: i.parent_id ? `${i.parent_name} (${i.parent_code})` : undefined,
    behaelter: i.container ? true : undefined,
    inhalt: i.container ? i.contents : undefined,
    verbrauchsmaterial: i.consumable ? true : undefined,
    haltbar_bis: i.expires_on ? `${day(i.expires_on)} (${i.expires_in < 0 ? `seit ${-i.expires_in} Tagen abgelaufen` : i.expires_in === 0 ? 'läuft heute ab' : `noch ${i.expires_in} Tage`})` : undefined,
    auf_einkaufsliste: i.on_list || undefined,
    foto: i.photo_at ? true : undefined,
    letzte_buchung: i.last_type
      ? `${i.last_type === 'in' ? 'eingebucht' : 'entnommen'} von ${i.last_person}, ${fmtDate(i.last_at)}`
      : undefined,
  });
  const shopOut = (e) => ({
    eintrag_id: e.id,
    name: e.name,
    menge: e.quantity,
    notiz: e.note || undefined,
    im_lager: e.item_id ? e.stock : undefined,
    platz: e.item_id ? loc(e) : undefined,
    objekt_id: e.item_id || undefined,
  });
  const moveOut = (m) => `#${m.id} ${fmtDate(m.created_at)}: ${m.person} hat ${m.quantity}× ${m.item} (ID ${m.item_id}) ${m.type === 'in' ? 'eingebucht auf' : 'entnommen von'} ${loc(m)}`;

  // ---------- Werkzeuge ----------
  const str = (description) => ({ type: 'string', description });
  const int = (description, extra = {}) => ({ type: 'integer', minimum: 1, description, ...extra });
  const OBJ = str('Gegenstand: ID, 6-stelliger Code oder Name');
  const PLATZ = str('Lagerplatz: Adresse mit Lager-Kürzel, z. B. "K-B12" (Lager K, Spalte B, Zeile 12), oder der Name eines Platzes, z. B. "Kühlschrank"');
  const LAGER = str('Optional: Lager als Kürzel oder Name, falls nicht im Platz enthalten');
  const BOX = str('Behälter (Tasche, Box …), in den der Gegenstand gelegt wird: ID, Code oder Name. Statt "platz" – der Platz des Behälters gilt.');
  const inBox = (i) => (i.parent_id ? ` in ${i.parent_name}` : '');
  const HALTBAR = str('Haltbar bis, z. B. "31.03.2027", "2027-03-31" oder nur Monat "03/2027" (= Monatsende)');

  const tools = [
    {
      name: 'lager_auflisten', title: 'Lager auflisten', write: false,
      description: 'Listet alle Lager mit Kürzel, Name und Anzahl Plätze/Gegenstände.',
      inputSchema: { type: 'object', properties: {} },
      run: () => db().prepare(`${core.WAREHOUSE_SELECT} ORDER BY w.id`).all().map((w) => ({
        kuerzel: w.code, name: w.name, beschreibung: w.description || undefined, plaetze: w.places, gegenstaende: w.items, stueck: w.quantity,
      })),
    },
    {
      name: 'lager_anlegen', title: 'Lager anlegen', write: true, admin: true,
      description: 'Legt ein neues Lager an (z. B. Garage, Bücherregal). Lagerplätze entstehen beim Einbuchen automatisch. Nur für Admins.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str('Name des Lagers, z. B. "Garage"'),
          kuerzel: str('Kürzel: 1–4 Buchstaben/Ziffern, beginnend mit einem Buchstaben, z. B. "G"'),
          beschreibung: str('Optional: Beschreibung'),
        },
        required: ['name', 'kuerzel'],
      },
      run: (a) => {
        const w = core.createWarehouse({ name: a.name, code: a.kuerzel, description: a.beschreibung });
        return { meldung: `Lager ${w.code} (${w.name}) angelegt – Plätze z. B. "${w.code}-A1".`, kuerzel: w.code, name: w.name };
      },
    },
    {
      name: 'objekte_suchen', title: 'Gegenstände suchen', write: false,
      description: 'Sucht Gegenstände nach Name, Beschreibung, Platzname, Kategorie, Code oder Lagerplatz ("K-B12", "B12", "B"). Leerer Suchbegriff listet alles.',
      inputSchema: {
        type: 'object',
        properties: { suchbegriff: str('Suchbegriff'), lager: str('Optional: nur in diesem Lager (Kürzel oder Name)'), limit: int('Maximale Trefferzahl (Standard 25)', { maximum: 200 }) },
      },
      run: (a) => {
        const wid = a.lager ? resolveWarehouse(a.lager).id : null;
        const hits = core.searchItems(a.suchbegriff || '', Math.min(Number(a.limit) || 25, 200), wid);
        return hits.length ? hits.map(itemOut) : 'Keine Treffer.';
      },
    },
    {
      name: 'objekt_anzeigen', title: 'Gegenstand anzeigen', write: false,
      description: 'Zeigt einen Gegenstand mit Bestand, Lagerplatz und den letzten Buchungen (wer hat wann was genommen oder zurückgelegt). Bei Behältern auch den Inhalt.',
      inputSchema: { type: 'object', properties: { objekt: OBJ }, required: ['objekt'] },
      run: (a) => {
        const it = core.itemWithHistory(resolveItem(a.objekt).id, 15);
        return {
          ...itemOut(it),
          inhalt_liste: it.container ? it.items.map(itemOut) : undefined,
          verlauf: it.history.map((h) => `${fmtDate(h.created_at)}: ${h.person} ${h.type === 'in' ? 'eingebucht' : 'entnommen'} ${h.quantity}× (${h.wh_code}-${h.col}${h.row}${inBox(h)})`),
        };
      },
    },
    {
      name: 'objekt_foto', title: 'Foto eines Gegenstands', write: false,
      description: 'Liefert das Foto eines Gegenstands (falls vorhanden), z. B. um zu zeigen, wie er aussieht.',
      inputSchema: { type: 'object', properties: { objekt: OBJ, gross: { type: 'boolean', description: 'Großes Bild statt Vorschau (Standard: Vorschau)' } }, required: ['objekt'] },
      run: (a) => {
        const it = resolveItem(a.objekt);
        const row = db().prepare('SELECT thumb, image FROM item_photos WHERE item_id = ?').get(it.id);
        if (!row) return `Für ${it.name} gibt es kein Foto.`;
        const data = Buffer.from(a.gross ? row.image : row.thumb);
        return { __content: [
          { type: 'text', text: `${it.name} (${loc(it)})` },
          { type: 'image', data: data.toString('base64'), mimeType: data[0] === 0xff ? 'image/jpeg' : 'image/webp' },
        ] };
      },
    },
    {
      name: 'lagerplaetze_suchen', title: 'Lagerplätze suchen', write: false,
      description: 'Findet Lagerplätze nach Name, Kategorie oder Beschreibung (z. B. "Kühlschrank", "Werkstatt") und liefert ihre Adresse. '
        + 'Ohne Suchbegriff: alle benannten Plätze. Nützlich, wenn der Nutzer einen Ort in Worten nennt.',
      inputSchema: { type: 'object', properties: { suchbegriff: str('Optional: Name oder Teil davon'), lager: str('Optional: nur in diesem Lager (Kürzel oder Name)') } },
      run: (a) => {
        let list = a.suchbegriff ? placesByName(a.suchbegriff, a.lager) : namedPlaces();
        if (!a.suchbegriff && a.lager) { const w = resolveWarehouse(a.lager); list = list.filter((p) => p.wid === w.id); }
        if (a.suchbegriff && !list.length) {
          const t = lower(a.suchbegriff);
          list = namedPlaces().filter((p) => lower(p.description).includes(t) || lower(p.wh_name).includes(t));
        }
        return list.length
          ? list.slice(0, 100).map((p) => ({ platz: `${p.wh_code}-${p.col}${p.row}`, name: p.name || undefined, kategorie: p.category || undefined, lager: p.wh_name, beschreibung: p.description || undefined }))
          : `Kein Platz zu „${a.suchbegriff}“ gefunden. Benannte Plätze: ${namedPlaces().slice(0, 30).map(placeLabel).join('; ') || 'keine'}.`;
      },
    },
    {
      name: 'lagerplatz_anzeigen', title: 'Lagerplatz anzeigen', write: false,
      description: 'Zeigt einen Lagerplatz mit Name, Kategorie und allen Gegenständen darauf.',
      inputSchema: { type: 'object', properties: { platz: PLATZ, lager: LAGER }, required: ['platz'] },
      run: (a) => {
        const p = resolvePlace(a.platz, a.lager);
        const place = core.getPlace(p.wid, p.col, p.row);
        if (!place) throw new HttpError(404, 'Dieser Lagerplatz ist nicht angelegt.');
        return {
          platz: loc(place), lager: place.wh_name, name: place.name || undefined, kategorie: place.category || undefined,
          beschreibung: place.description || undefined, gegenstaende: core.placeItems(p.wid, p.col, p.row).map(itemOut),
        };
      },
    },
    {
      name: 'einbuchen', title: 'Einbuchen', write: true,
      description: 'Bucht einen vorhandenen Gegenstand ein (Menge erhöhen, optional an neuen Platz) oder legt einen neuen Gegenstand an. '
        + 'Vorhandener Gegenstand: "objekt" angeben. Neuer Gegenstand: "name" und "platz" (oder "behaelter") angeben.',
      inputSchema: {
        type: 'object',
        properties: {
          objekt: str('Vorhandener Gegenstand: ID, Code oder Name'),
          name: str('Nur für neue Gegenstände: Bezeichnung'),
          menge: int('Menge (Standard 1)'),
          platz: str('Lagerplatz: Adresse wie "K-B12" oder Platzname wie "Kühlschrank". Bei vorhandenen Gegenständen optional (sonst bisheriger Platz).'),
          lager: LAGER,
          behaelter: BOX,
          haltbar_bis: str('Optional: Haltbarkeitsdatum, z. B. "31.03.2027" oder "03/2027". Bei vorhandenen Gegenständen (neue Packung) wird es ersetzt.'),
          code: str('Nur für neue Gegenstände: vorhandenes, noch freies Etikett (6-stelliger Code), das dem Gegenstand zugeordnet wird'),
          ist_behaelter: { type: 'boolean', description: 'Nur für neue Gegenstände: ist selbst ein Behälter (Tasche, Box …), in den später Dinge gelegt werden' },
          beschreibung: str('Nur für neue Gegenstände: Beschreibung'),
          verbrauchsmaterial: { type: 'boolean', description: 'Nur für neue Gegenstände: Verbrauchsmaterial (kommt beim Ausbuchen auf die Einkaufsliste)' },
        },
      },
      run: (a, person, ctx = {}) => {
        const quantity = a.menge ?? 1;
        let res;
        if (a.objekt) {
          const it = resolveItem(a.objekt);
          const body = { item_id: it.id, quantity, expires_on: a.haltbar_bis };
          if (a.behaelter) body.container_id = resolveItem(a.behaelter).id;
          else if (a.platz) {
            const p = resolvePlace(a.platz, a.lager, it.warehouse_id);
            Object.assign(body, { warehouse_id: p.wid, col: p.col, row: p.row });
          }
          res = core.checkin(person, { ...body, source: ctx.source });
        } else if (a.name) {
          const body = { name: a.name, code: a.code, description: a.beschreibung, consumable: !!a.verbrauchsmaterial, container: !!a.ist_behaelter, expires_on: a.haltbar_bis, quantity };
          if (a.behaelter) body.container_id = resolveItem(a.behaelter).id;
          else if (a.platz) {
            const p = resolvePlace(a.platz, a.lager);
            Object.assign(body, { warehouse_id: p.wid, col: p.col, row: p.row });
          } else throw new HttpError(400, 'Für einen neuen Gegenstand bitte einen Lagerplatz (z. B. "K-B12") oder einen Behälter angeben.');
          res = core.checkin(person, { ...body, source: ctx.source });
        } else throw new HttpError(400, 'Bitte "objekt" (vorhandener Gegenstand) oder "name" (neuer Gegenstand) angeben.');
        return { meldung: `${quantity}× ${res.name} eingebucht auf ${loc(res)}${inBox(res)}. Bestand jetzt ${res.quantity}.`, buchung_id: res.movement_id, gegenstand: itemOut(res) };
      },
    },
    {
      name: 'ausbuchen', title: 'Ausbuchen', write: true,
      description: 'Entnimmt eine Menge eines Gegenstands aus dem Lager. Verbrauchsmaterial kommt dabei automatisch auf die Einkaufsliste.',
      inputSchema: { type: 'object', properties: { objekt: OBJ, menge: int('Menge (Standard 1)') }, required: ['objekt'] },
      run: (a, person, ctx = {}) => {
        const it = resolveItem(a.objekt);
        const res = core.checkout(person, { item_id: it.id, quantity: a.menge ?? 1, source: ctx.source });
        return {
          meldung: `${a.menge ?? 1}× ${res.name} ausgebucht von ${loc(res)}. Noch ${res.quantity} Stück.`
            + (res.shopping_added ? ` ${res.shopping_added}× auf die Einkaufsliste gesetzt.` : ''),
          buchung_id: res.movement_id,
          gegenstand: itemOut(res),
        };
      },
    },
    {
      name: 'umlagern', title: 'Umlagern', write: true,
      description: 'Verschiebt einen Gegenstand (komplett) an einen anderen Lagerplatz, auch in ein anderes Lager, oder legt ihn in einen Behälter. '
        + 'Mit "platz" wird er aus seinem Behälter genommen (auch am selben Platz). Ein Behälter nimmt seinen Inhalt mit.',
      inputSchema: { type: 'object', properties: { objekt: OBJ, platz: PLATZ, lager: LAGER, behaelter: BOX }, required: ['objekt'] },
      run: (a) => {
        const it = resolveItem(a.objekt);
        let body;
        if (a.behaelter) body = { container_id: resolveItem(a.behaelter).id };
        else if (a.platz) {
          const p = resolvePlace(a.platz, a.lager, it.warehouse_id);
          body = { warehouse_id: p.wid, col: p.col, row: p.row, container_id: null };
        } else throw new HttpError(400, 'Bitte "platz" oder "behaelter" angeben.');
        const res = core.updateItem(it.id, body);
        const mit = res.contents ? ` Der Inhalt (${res.contents} Gegenstände) ist mitgewandert.` : '';
        return { meldung: `${res.name} liegt jetzt auf ${loc(res)}${inBox(res)} (${res.wh_name}).${mit}`, gegenstand: itemOut(res) };
      },
    },
    {
      name: 'haltbarkeit_pruefen', title: 'Haltbarkeit prüfen', write: false,
      description: 'Listet Gegenstände, die abgelaufen sind oder in den nächsten Tagen ablaufen (nur was noch im Lager ist), sortiert nach Datum.',
      inputSchema: { type: 'object', properties: { tage: int('Zeitraum in Tagen ab heute (Standard 30)', { minimum: 0, maximum: 3650 }), lager: str('Optional: nur in diesem Lager (Kürzel oder Name)') } },
      run: (a) => {
        const list = core.expiringItems(a.tage ?? 30, a.lager ? resolveWarehouse(a.lager).id : null);
        return list.length ? list.map(itemOut) : `Nichts abgelaufen und nichts, was in den nächsten ${a.tage ?? 30} Tagen abläuft.`;
      },
    },
    {
      name: 'haltbarkeit_setzen', title: 'Haltbarkeitsdatum setzen', write: true,
      description: 'Setzt oder entfernt das Haltbarkeitsdatum eines Gegenstands, ohne die Menge zu ändern.',
      inputSchema: { type: 'object', properties: { objekt: OBJ, haltbar_bis: str('Datum, z. B. "31.03.2027" oder "03/2027"; leer = Datum entfernen') }, required: ['objekt'] },
      run: (a) => {
        const res = core.updateItem(resolveItem(a.objekt).id, { expires_on: a.haltbar_bis ?? '' });
        return { meldung: res.expires_on ? `${res.name} ist haltbar bis ${day(res.expires_on)}.` : `${res.name} hat kein Haltbarkeitsdatum mehr.`, gegenstand: itemOut(res) };
      },
    },
    {
      name: 'einkaufsliste_anzeigen', title: 'Einkaufsliste anzeigen', write: false,
      description: 'Zeigt alle offenen Einträge der Einkaufsliste.',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const list = core.shoppingOpen();
        return list.length ? list.map(shopOut) : 'Die Einkaufsliste ist leer.';
      },
    },
    {
      name: 'einkaufsliste_hinzufuegen', title: 'Auf die Einkaufsliste', write: true,
      description: 'Setzt etwas auf die Einkaufsliste: einen vorhandenen Gegenstand ("objekt") oder einen freien Eintrag ("name", z. B. "Milch"). Steht der Gegenstand schon drauf, wird die Menge erhöht.',
      inputSchema: {
        type: 'object',
        properties: { objekt: str('Vorhandener Gegenstand: ID, Code oder Name'), name: str('Freier Eintrag, z. B. "Milch"'), menge: int('Menge (Standard 1)'), notiz: str('Optional: Notiz, z. B. Marke oder Größe') },
      },
      run: (a, person) => {
        const body = { quantity: a.menge ?? 1, note: a.notiz };
        if (a.objekt) body.item_id = resolveItem(a.objekt).id;
        else if (a.name) body.name = a.name;
        else throw new HttpError(400, 'Bitte "objekt" oder "name" angeben.');
        const e = core.shoppingAdd(person, body);
        return {
          meldung: `${e.name} steht jetzt mit ${e.quantity}× auf der Einkaufsliste.`, eintrag: shopOut(e),
          im_lager: e.item_id ? `ja, ${e.stock} Stück auf ${loc(e)}` : 'nein – beim Abhaken kann es mit platz neu angelegt werden',
        };
      },
    },
    {
      name: 'einkaufsliste_abhaken', title: 'Einkaufsliste abhaken', write: true,
      description: 'Hakt einen Eintrag der Einkaufsliste als gekauft ab – angegeben per Name (z. B. "Fladenbrot"), eine ID ist nicht nötig. '
        + 'Optional gleich einlagern: einbuchen: true bucht die Menge auf den bisherigen Platz (nur wenn es den Gegenstand im Lager schon gibt); '
        + 'mit platz oder behaelter wird dorthin eingebucht – ist der Eintrag noch kein Gegenstand, wird er dabei neu angelegt (als Verbrauchsmaterial). '
        + 'Ohne diese Angaben wird nur abgehakt.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str('Name des Eintrags, z. B. "Fladenbrot" (Groß-/Kleinschreibung egal, Teilwort genügt)'),
          eintrag_id: int('Nur falls mehrere Einträge zum Namen passen: ID aus einkaufsliste_anzeigen'),
          einbuchen: { type: 'boolean', description: 'Gekaufte Menge gleich auf den bisherigen Platz einbuchen (vorhandener Gegenstand)' },
          platz: str('Einlagern auf diesen Lagerplatz – Adresse wie "K-B12" oder Platzname wie "Kühlschrank"; legt einen neuen Gegenstand an, falls es noch keinen gibt'),
          lager: LAGER,
          behaelter: str('Einlagern in diesen Behälter (ID, Code oder Name) statt auf einen Platz'),
          menge: int('Tatsächlich gekaufte Menge (Standard: Menge auf der Liste)'),
          haltbar_bis: str('Optional: Haltbarkeitsdatum der gekauften Ware, z. B. "31.03.2027"'),
          verbrauchsmaterial: { type: 'boolean', description: 'Nur beim Neuanlegen: Verbrauchsmaterial (Standard ja)' },
        },
      },
      run: (a, person, ctx = {}) => {
        let id = a.eintrag_id;
        if (!id) {
          const q = lower(a.name);
          if (!q) throw new HttpError(400, 'Bitte den Namen des Eintrags angeben, z. B. "Fladenbrot".');
          const open = core.shoppingOpen();
          const exact = open.filter((e) => lower(e.name) === q);
          const hits = exact.length ? exact : open.filter((e) => lower(e.name).includes(q) || q.includes(lower(e.name)));
          if (hits.length !== 1) {
            throw new HttpError(hits.length ? 409 : 404, hits.length
              ? `Mehrere Einträge passen: ${hits.map((e) => `${e.name} (eintrag_id ${e.id})`).join('; ')}. Nachfragen, welcher gemeint ist.`
              : `„${a.name}“ steht nicht auf der Einkaufsliste. Offen: ${open.map((e) => e.name).join(', ') || 'nichts'}.`);
          }
          id = hits[0].id;
        }
        const store = a.einbuchen || a.platz || a.behaelter;
        if (store) {
          const body = { quantity: a.menge, expires_on: a.haltbar_bis, consumable: a.verbrauchsmaterial, source: ctx.source };
          if (a.behaelter) body.container_id = resolveItem(a.behaelter).id;
          else if (a.platz) Object.assign(body, (({ wid, col, row }) => ({ warehouse_id: wid, col, row }))(resolvePlace(a.platz, a.lager)));
          const r = core.shoppingStore(person, id, body);
          return {
            meldung: `${r.entry.name} abgehakt und ${r.created ? 'neu angelegt' : 'eingebucht'} – jetzt ${r.item.quantity} Stück auf ${loc(r.item)}${r.item.parent_id ? ` in ${r.item.parent_name}` : ''}.`,
            buchung_id: r.movement_id, gegenstand: itemOut(r.item),
          };
        }
        const e = core.shoppingUpdate(id, { done: true });
        return {
          meldung: `${e.name} abgehakt.`,
          hinweis: e.item_id
            ? `Frag den Nutzer, ob ${e.name} gleich wieder auf ${loc(e)} eingebucht werden soll – dann einbuchen mit objekt "${e.name}" und menge ${e.quantity}.`
            : `${e.name} ist noch kein Gegenstand im Lager. Frag den Nutzer, ob und wo es eingelagert werden soll – dann einbuchen mit name "${e.name}", menge ${e.quantity}, platz und verbrauchsmaterial: true.`,
        };
      },
    },
    {
      name: 'mehrere_einbuchen', title: 'Mehrere einbuchen', write: true,
      count: (a) => (Array.isArray(a.gegenstaende) ? a.gegenstaende.length : 1),
      description: 'Bucht mehrere Gegenstände in einem Schritt ein (z. B. alles, was auf einem Foto zu sehen ist). Jeder Eintrag wie bei "einbuchen"; '
        + '"platz" oder "behaelter" oben gelten für alle Einträge ohne eigene Angabe. Fehler bei einzelnen Einträgen brechen die anderen nicht ab.',
      inputSchema: {
        type: 'object',
        properties: {
          platz: str('Optional: gemeinsamer Lagerplatz, z. B. "K-B12"'),
          behaelter: str('Optional: gemeinsamer Behälter (ID, Code oder Name)'),
          gegenstaende: {
            type: 'array', minItems: 1, maxItems: 50,
            items: {
              type: 'object',
              properties: {
                objekt: str('Vorhandener Gegenstand (ID, Code oder Name)'), name: str('Neuer Gegenstand: Bezeichnung'), menge: int('Menge (Standard 1)'),
                platz: str('Lagerplatz'), behaelter: str('Behälter'), beschreibung: str('Beschreibung'), haltbar_bis: str('Haltbarkeitsdatum'),
                verbrauchsmaterial: { type: 'boolean', description: 'Verbrauchsmaterial' }, ist_behaelter: { type: 'boolean', description: 'Ist selbst ein Behälter' },
              },
            },
          },
        },
        required: ['gegenstaende'],
      },
      run: (a, person, ctx = {}) => {
        if (!Array.isArray(a.gegenstaende) || !a.gegenstaende.length) throw new HttpError(400, 'Bitte mindestens einen Gegenstand angeben.');
        const einbuchen = toolByName.get('einbuchen');
        const ergebnisse = a.gegenstaende.slice(0, 50).map((g) => {
          const args = { ...g };
          if (!args.platz && !args.behaelter) Object.assign(args, a.behaelter ? { behaelter: a.behaelter } : a.platz ? { platz: a.platz } : {});
          try { return einbuchen.run(args, person, ctx); } catch (e) {
            if (!(e instanceof HttpError)) throw e;
            return { fehler: `${g.name || g.objekt || '?'}: ${e.message}` };
          }
        });
        const ok = ergebnisse.filter((r) => !r.fehler).length;
        return { meldung: `${ok} von ${ergebnisse.length} eingebucht.`, ergebnisse };
      },
    },
    {
      name: 'objekt_bearbeiten', title: 'Gegenstand bearbeiten', write: true,
      description: 'Ändert Bezeichnung, Beschreibung, Verbrauchsmaterial oder Behälter-Eigenschaft eines Gegenstands (nicht Menge oder Platz – dafür einbuchen/ausbuchen/umlagern).',
      inputSchema: {
        type: 'object',
        properties: {
          objekt: OBJ, name: str('Neue Bezeichnung'), beschreibung: str('Neue Beschreibung (leer = entfernen)'),
          verbrauchsmaterial: { type: 'boolean', description: 'Verbrauchsmaterial ja/nein' }, ist_behaelter: { type: 'boolean', description: 'Behälter ja/nein' },
        },
        required: ['objekt'],
      },
      run: (a) => {
        const it = resolveItem(a.objekt);
        const res = core.updateItem(it.id, { name: a.name, description: a.beschreibung, consumable: a.verbrauchsmaterial, container: a.ist_behaelter });
        return { meldung: `${res.name} gespeichert.`, gegenstand: itemOut(res) };
      },
    },
    {
      name: 'lagerplatz_benennen', title: 'Lagerplatz benennen', write: true,
      description: 'Gibt einem Lagerplatz Name, Kategorie oder Beschreibung (z. B. "Regal links, oberstes Fach"). Legt den Platz an, falls es ihn noch nicht gibt.',
      inputSchema: { type: 'object', properties: { platz: PLATZ, lager: LAGER, name: str('Name'), kategorie: str('Kategorie'), beschreibung: str('Beschreibung') }, required: ['platz'] },
      run: (a) => {
        const p = resolvePlace(a.platz, a.lager);
        const pl = core.savePlace(p.wid, p.col, p.row, { name: a.name, category: a.kategorie, description: a.beschreibung });
        return { meldung: `Platz ${loc(pl)} gespeichert${pl.name ? `: ${pl.name}` : ''}.`, platz: loc(pl), name: pl.name || undefined, kategorie: pl.category || undefined };
      },
    },
    {
      name: 'lagerplatz_loeschen', title: 'Lagerplatz löschen', write: true,
      description: 'Löscht einen leeren Lagerplatz samt Name, Kategorie und Beschreibung. Nur wenn der Nutzer das ausdrücklich möchte. '
        + 'Liegt dort noch etwas, schlägt es fehl – dann erst umlagern oder ausbuchen (nach Rückfrage).',
      inputSchema: { type: 'object', properties: { platz: PLATZ, lager: LAGER }, required: ['platz'] },
      run: (a) => {
        const p = resolvePlace(a.platz, a.lager);
        const pl = core.deletePlace(p.wid, p.col, p.row);
        return { meldung: `Platz ${loc(pl)}${pl.name ? ` (${pl.name})` : ''} gelöscht.`, platz: loc(pl) };
      },
    },
    {
      name: 'code_aufloesen', title: 'Code auflösen', write: false,
      description: 'Löst einen gescannten oder abgelesenen Code auf: Platz-Etikett ("P-K-B12"), Objekt-Code ("K7M2XQ", "O-K7M2XQ") oder QR-Link (".../q/…").',
      inputSchema: { type: 'object', properties: { code: str('Code oder QR-Inhalt') }, required: ['code'] },
      run: (a) => {
        const r = core.resolveCode(a.code);
        if (r.type === 'place') return { typ: 'Lagerplatz', platz: loc(r.place), name: r.place.name || undefined, gegenstaende: r.place.items.map(itemOut) };
        if (r.type === 'item') return { typ: 'Gegenstand', gegenstand: itemOut(r.item) };
        if (r.type === 'unknown') return `Code ${r.code} ist noch keinem Gegenstand zugeordnet – beim Einbuchen eines neuen Gegenstands kann er mitgegeben werden (Feld "code").`;
        return r.reason || 'Das ist kein Heimlager-Code.';
      },
    },
    {
      name: 'foto_zuordnen', title: 'Foto zuordnen', write: true, assistant: true,
      description: 'Speichert ein Foto aus dieser Unterhaltung als Bild eines Gegenstands (z. B. nachdem er neu eingebucht wurde). Ersetzt ein vorhandenes Foto.',
      inputSchema: { type: 'object', properties: { objekt: OBJ, bild: int('Nummer des Bildes in dieser Nachricht (1 = erstes Bild)') }, required: ['objekt', 'bild'] },
      run: (a, person, ctx = {}) => {
        const img = (ctx.images || [])[Number(a.bild) - 1];
        if (!img) throw new HttpError(400, `Bild ${a.bild} gibt es in dieser Nachricht nicht.`);
        const it = resolveItem(a.objekt);
        const res = core.saveItemPhoto(it.id, img);
        return { meldung: `Foto bei ${res.name} gespeichert.`, gegenstand: itemOut(res) };
      },
    },
    {
      name: 'gespraech_neu_beginnen', title: 'Neues Gespräch', write: false, assistant: true,
      description: 'Löscht den bisherigen Gesprächsverlauf, damit ein neues Gespräch ohne alten Kontext beginnt. Nur aufrufen, wenn der Nutzer das ausdrücklich möchte '
        + '(z. B. „vergiss das“, „neues Gespräch“, „Verlauf löschen“). Buchungen bleiben davon unberührt.',
      inputSchema: { type: 'object', properties: {} },
      run: (a, person, ctx = {}) => {
        ctx.reset = true;
        return 'Der Verlauf wird nach dieser Antwort gelöscht. Bestätige das dem Nutzer kurz.';
      },
    },
    {
      name: 'buchung_rueckgaengig', title: 'Buchung rückgängig machen', write: true,
      description: 'Macht eine Ein- oder Ausbuchung rückgängig (z. B. wenn sich der Nutzer verhört oder vertan hat). Ohne buchung_id wird die letzte eigene Buchung zurückgenommen. '
        + 'Es kann nur die jeweils letzte Buchung eines Gegenstands rückgängig gemacht werden. Eine Einbuchung, die den Gegenstand neu angelegt hat, entfernt ihn wieder.',
      inputSchema: { type: 'object', properties: { buchung_id: int('ID der Buchung (aus einbuchen/ausbuchen oder letzte_buchungen, z. B. 42 für "#42")') } },
      run: (a, person) => {
        let id = a.buchung_id;
        if (!id) {
          const last = db().prepare('SELECT id FROM movements WHERE person_id = ? ORDER BY id DESC LIMIT 1').get(person.id);
          if (!last) throw new HttpError(404, 'Es gibt keine eigene Buchung, die rückgängig gemacht werden könnte.');
          id = last.id;
        }
        const r = core.undoMovement({ person, via: 'key' }, id);
        return { meldung: r.message, gegenstand: r.item ? itemOut(r.item) : undefined };
      },
    },
    {
      name: 'letzte_buchungen', title: 'Letzte Buchungen', write: false,
      description: 'Zeigt die letzten Ein- und Ausbuchungen (wer hat was wann genommen oder zurückgelegt), optional nur für ein Lager.',
      inputSchema: { type: 'object', properties: { lager: str('Optional: Lager (Kürzel oder Name)'), anzahl: int('Anzahl (Standard 20)', { maximum: 100 }) } },
      run: (a) => {
        const list = core.recentMovements(a.lager ? resolveWarehouse(a.lager).id : null, Math.min(Number(a.anzahl) || 20, 100));
        return list.length ? list.map(moveOut) : 'Noch keine Buchungen.';
      },
    },
  ];
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  // Buchende Werkzeuge nur mit Schreibrecht, Verwaltungswerkzeuge nur für Admins
  const allowed = (t, auth) => (!t.write || auth.scope === 'write') && (!t.admin || auth.person.role === 'admin');
  const list = (auth, { assistant = false } = {}) => tools.filter((t) => allowed(t, auth) && (!t.assistant || assistant));

  // Werkzeug ausführen → { content: [{type:'text'|'image', …}], isError }
  function call(name, args, auth, ctx = {}) {
    const tool = toolByName.get(name);
    if (!tool) return { unknown: true, content: [{ type: 'text', text: `Unbekanntes Werkzeug: ${name}` }], isError: true };
    if (tool.write && auth.scope !== 'write') return { content: [{ type: 'text', text: 'Dieser API-Schlüssel darf nur lesen.' }], isError: true };
    if (tool.admin && auth.person.role !== 'admin') return { content: [{ type: 'text', text: 'Nur für Admins.' }], isError: true };
    try {
      const out = tool.run(args || {}, auth.person, ctx);
      if (out?.__content) return { content: out.__content, isError: false, data: out };
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }], isError: false, data: out };
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('Werkzeug', name, e);
      return { content: [{ type: 'text', text: e instanceof HttpError ? e.message : 'Interner Fehler.' }], isError: true };
    }
  }

  const instructions = (auth) => `${INSTRUCTIONS}\n- Angemeldet als: ${auth.person.name}${auth.scope === 'read' ? ' (nur lesen)' : ''}.`;
  return { tools, list, call, get: (name) => toolByName.get(name), instructions };
}

module.exports = { createTools, INSTRUCTIONS };
