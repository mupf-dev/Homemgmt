/* Heimlager – Export/Import als CSV oder Excel (.xlsx), komplett im Browser und ohne Bibliotheken.
   Schreiben: CSV (Semikolon, UTF-8 mit BOM – öffnet in deutschem Excel direkt richtig) und XLSX (SpreadsheetML im ZIP).
   Lesen: CSV (Trennzeichen wird erkannt) und XLSX (ZIP entpacken mit DecompressionStream). */
(() => {
  'use strict';

  // ---------- CSV ----------
  function toCsv(rows, sep = ';') {
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\r\n,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return `﻿${rows.map((r) => r.map(cell).join(sep)).join('\r\n')}\r\n`;
  }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
      } else if (c === '"' && field === '') quoted = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  // ---------- XLSX schreiben ----------
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function toXlsx(rows, { sheet = 'Tabelle1', widths = [] } = {}) {
    const enc = new TextEncoder();
    const cells = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => {
      const ref = `${colName(x)}${y + 1}`;
      const style = y === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === '') return '';
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const NS = 'http://schemas.openxmlformats.org';
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheet.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''}<sheetData>${cells}</sheetData></worksheet>`,
    };
    return window.QR3D.zip(Object.entries(files).map(([name, text]) => ({ name, data: enc.encode(text) })));
  }

  // ---------- XLSX lesen ----------
  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Keine gültige Excel-Datei (ZIP).');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const size = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commentLen = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + size);
      out.set(name, { method, raw });
      off += 46 + nameLen + extraLen + commentLen;
    }
    const read = async (name) => {
      const e = out.get(name);
      if (!e) return null;
      if (e.method === 0) return dec.decode(e.raw);
      if (e.method !== 8) throw new Error('Unbekannte Kompression in der Excel-Datei.');
      const stream = new Blob([e.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    };
    return { names: [...out.keys()], read };
  }

  async function parseXlsx(buf) {
    const zip = await unzip(buf);
    const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
    const texts = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');
    const shared = [];
    const ss = await zip.read('xl/sharedStrings.xml');
    if (ss) for (const si of parse(ss).getElementsByTagName('si')) shared.push(texts(si));
    // erstes Tabellenblatt laut workbook.xml
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await zip.read('xl/workbook.xml');
    const rels = await zip.read('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = parse(wb).getElementsByTagName('sheet')[0];
      const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = [...parse(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) sheetPath = `xl/${rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '')}`;
    }
    const sheetXml = await zip.read(sheetPath);
    if (!sheetXml) throw new Error('Kein Tabellenblatt gefunden.');
    const rows = [];
    for (const c of parse(sheetXml).getElementsByTagName('c')) {
      const m = String(c.getAttribute('r') || '').match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const x = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const y = Number(m[2]) - 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const val = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? texts(c) : t === 'b' ? (v === '1' ? 'ja' : 'nein') : v;
      (rows[y] ||= [])[x] = val;
    }
    return Array.from(rows, (r) => Array.from(r || [], (v) => v ?? '')).filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b) return parseXlsx(buf); // „PK“ = ZIP = xlsx
    return parseCsv(new TextDecoder('utf-8').decode(buf));
  }

  // ---------- Spalten ----------
  // Export- und Importformat sind gleich, damit man exportieren, in Excel bearbeiten und wieder importieren kann.
  const HEADERS = ['Code', 'Name', 'Beschreibung', 'Lager', 'Platz', 'Menge', 'Verbrauchsmaterial', 'Haltbar bis', 'Platzname', 'Kategorie', 'Zuletzt gebucht', 'Von'];
  const ALIASES = {
    code: ['code', 'objekt-code', 'objektcode', 'id-code'],
    name: ['name', 'bezeichnung', 'gegenstand', 'objekt'],
    beschreibung: ['beschreibung', 'notiz', 'details'],
    lager: ['lager', 'lager-kürzel', 'lagerkürzel', 'kürzel'],
    platz: ['platz', 'lagerplatz', 'ort'],
    menge: ['menge', 'anzahl', 'bestand', 'stück'],
    verbrauchsmaterial: ['verbrauchsmaterial', 'verbrauch', 'verbrauchbar'],
    haltbar_bis: ['haltbar bis', 'haltbarkeit', 'mhd', 'mindesthaltbarkeit', 'ablaufdatum', 'verfallsdatum'],
  };
  function rowsToObjects(rows) {
    if (rows.length < 2) throw new Error('Die Datei enthält keine Datenzeilen (erste Zeile = Überschriften).');
    const head = rows[0].map((h) => String(h).trim().toLowerCase());
    const idx = {};
    for (const [key, names] of Object.entries(ALIASES)) {
      const i = head.findIndex((h) => names.includes(h));
      if (i >= 0) idx[key] = i;
    }
    if (idx.name === undefined && idx.code === undefined) throw new Error('Spalte „Name“ (oder „Code“) nicht gefunden.');
    return { columns: Object.keys(idx), objects: rows.slice(1).map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i] ?? '']))) };
  }

  window.Transfer = { toCsv, parseCsv, toXlsx, parseXlsx, parseFile, HEADERS, rowsToObjects };
})();
