#!/usr/bin/env node
'use strict';
// Prüft die Übersetzungen (siehe web/app/src/i18n.ts und server/i18n.cjs):
//   node scripts/i18n-check.cjs              → fehlende englische Einträge, falsche Platzhalter, nicht übersetzbare Aufrufe
//   node scripts/i18n-check.cjs --leftovers [Datei…] → deutsche Texte, die (noch) nicht in tr()/trn() stehen
//   node scripts/i18n-check.cjs --unused     → englische Einträge, die im Code nicht (mehr) vorkommen
// Ausgabe als Liste; Rückgabewert 1 bei Fehlern (für test/i18n.test.cjs).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DICT_DIR = path.join(ROOT, 'web/app/src/i18n/en');
const SOURCES = ['web/app/src', 'server'];
const EXT = /\.(ts|cjs|mjs)$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'node_modules') walk(rel, out); }
    else if (EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function loadDict() {
  const dict = {};
  const where = {};
  const problems = [];
  for (const f of fs.readdirSync(DICT_DIR).filter((x) => x.endsWith('.json')).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(DICT_DIR, f), 'utf8')); } catch (e) { problems.push(`${f}: kein gültiges JSON (${e.message})`); continue; }
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string' || !v.trim()) problems.push(`${f}: leere Übersetzung für „${k}“`);
      else if (k in dict && dict[k] !== v) problems.push(`${f}: „${k}“ steht schon in ${where[k]} mit anderer Übersetzung`);
      dict[k] = v;
      where[k] = f;
    }
  }
  return { dict, where, problems };
}

// Zeichenkette ab Position i lesen ('…', "…" oder `…`); liefert { value, end, dynamic }
function readString(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let out = '';
  let dynamic = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      const n = src[j + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : n;
      j += n === 'u' ? 5 : 1;
      continue;
    }
    if (q === '`' && c === '$' && src[j + 1] === '{') dynamic = true;
    if (c === q) return { value: out, end: j + 1, dynamic };
    if (c === '\n' && q !== '`') return null;
    out += c;
  }
  return null;
}

// Kommentare durch Leerzeichen ersetzen (Zeilen bleiben erhalten), Zeichenketten bleiben unangetastet
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const s = readString(src, i);
      if (s) { out += src.slice(i, s.end); i = s.end - 1; continue; }
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

// Umsetzung der Übersetzung selbst nicht prüfen
const SKIP = new Set(['web/app/src/i18n.ts', 'server/i18n.cjs']);

// Alle tr('…')- und trn(n, '…', '…')-Aufrufe mit Zeichenketten-Argumenten
function extract(file) {
  if (SKIP.has(file)) return [];
  const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const calls = [];
  const re = /\b(trn?)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 9), m.index);
    if (/function\s*$|\.\s*$/.test(before)) continue; // Definition bzw. obj.tr(…)
    const line = src.slice(0, m.index).split('\n').length;
    let i = m.index + m[0].length;
    const args = [];
    // für trn das erste Argument (n) überspringen
    if (m[1] === 'trn') {
      let depth = 0;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) { i++; break; }
      }
    }
    for (let k = 0; k < (m[1] === 'trn' ? 2 : 1); k++) {
      while (/\s/.test(src[i])) i++;
      const s = readString(src, i);
      if (!s) { args.push({ dynamicArg: true }); break; }
      args.push(s);
      i = s.end;
      while (/\s/.test(src[i])) i++;
      if (src[i] === ',') i++;
    }
    calls.push({ file, line, fn: m[1], args });
  }
  return calls;
}

const placeholders = (s) => [...new Set((s.match(/\{(\w+)\}/g) || []).sort())].join(' ');

function check() {
  const { dict, problems } = loadDict();
  const errors = [...problems];
  const used = new Set();
  for (const file of SOURCES.flatMap((d) => walk(d))) {
    for (const c of extract(file)) {
      for (const a of c.args) {
        if (a.dynamicArg) { errors.push(`${c.file}:${c.line}: ${c.fn}() mit Variable statt Text – nicht übersetzbar (Text direkt in ${c.fn}() schreiben)`); continue; }
        if (a.dynamic) { errors.push(`${c.file}:${c.line}: ${c.fn}(\`…\${…}…\`) – Platzhalter {name} und Parameter verwenden`); continue; }
        used.add(a.value);
        if (!(a.value in dict)) errors.push(`${c.file}:${c.line}: fehlt auf Englisch: ${JSON.stringify(a.value)}`);
        else if (placeholders(a.value) !== placeholders(dict[a.value])) {
          errors.push(`${c.file}:${c.line}: Platzhalter passen nicht: ${JSON.stringify(a.value)} → ${JSON.stringify(dict[a.value])}`);
        }
      }
    }
  }
  return { errors, used, dict };
}

// Deutsche Texte außerhalb von tr()/trn() finden (Hilfe beim Umbauen, kein Test)
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|nicht|kein|keine|bitte|noch|schon|wird|werden|ist|sind|der|die|das|den|dem|mit|für|auf|aus|bei|nach|vom|zum|zur|ein|eine|einen|Platz|Plätze|Lager|Haus|Speichern|Löschen|Abbrechen|Schließen|Raum|Etage|Gegenstand|Fach|Möbel|Einbuchen|Ausbuchen|Fehler|Neu|Zurück|Weiter|Fertig|Suchen|Name|Menge|Stück)\b/;
function leftovers(files) {
  const out = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = src.split('\n');
    lines.forEach((ln, idx) => {
      const code = ln.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/^\s*\/\*.*$/, '');
      if (!code.trim() || /^\s*import\b/.test(code) || /console\.(log|warn|error|info|debug)\(/.test(code)) return;
      // Inhalte von tr(…)/trn(…) entfernen, dann Zeichenketten und HTML-Text prüfen
      const rest = code.replace(/\btrn?\((?:[^()]|\([^()]*\))*\)/g, '');
      const lits = rest.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|>[^<>{}`$]{2,}</g) || [];
      for (const l of lits) {
        const t = l.replace(/\$\{[^}]*\}/g, ' ');
        if (GERMAN.test(t) && /[A-Za-zÄÖÜäöü]{3,}/.test(t)) out.push(`${file}:${idx + 1}: ${l.slice(0, 140)}`);
      }
    });
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--leftovers') {
    const files = args.length > 1 ? args.slice(1) : SOURCES.flatMap((d) => walk(d));
    const list = leftovers(files);
    for (const l of list) console.log(l);
    console.log(`\n${list.length} mögliche deutsche Texte außerhalb von tr()`);
  } else if (args[0] === '--unused') {
    const { used, dict } = check();
    const unused = Object.keys(dict).filter((k) => !used.has(k));
    for (const k of unused) console.log(JSON.stringify(k));
    console.log(`\n${unused.length} ungenutzte Einträge`);
  } else {
    const { errors, used } = check();
    for (const e of errors) console.log(e);
    console.log(errors.length ? `\n${errors.length} Probleme` : `Übersetzungen vollständig (${used.size} Texte).`);
    process.exitCode = errors.length ? 1 : 0;
  }
}

module.exports = { check, leftovers, extract, walk };
