'use strict';
// Sprache der Servermeldungen (Fehler, Hinweise, Assistent). Wie in der App ist der deutsche Text der Schlüssel:
//   tr('Platz {code} gibt es nicht.', { code }) · trn(n, '{n} Platz', '{n} Plätze')
// Englisch steht in web/app/src/i18n/en/*.json – dieselben Wörterbücher wie in der App.
// Die Sprache gilt je Anfrage (AsyncLocalStorage): Cookie „zh_lang“ (setzt die App), sonst Accept-Language, sonst
// DEFAULT_LANG (Standard de). Außerhalb einer Anfrage (z. B. MCP, Hintergrundaufgaben) gilt DEFAULT_LANG.
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');

const LANGS = ['de', 'en'];
const DIR = path.join(__dirname, '..', 'web', 'app', 'src', 'i18n', 'en');
const DEFAULT = LANGS.includes(process.env.DEFAULT_LANG) ? process.env.DEFAULT_LANG : 'de';
const store = new AsyncLocalStorage();

let EN = null;
function dict() {
  if (!EN) {
    EN = {};
    let names = [];
    try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(); } catch { /* ohne Wörterbuch: Deutsch */ }
    for (const f of names) Object.assign(EN, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
  }
  return EN;
}

/** Sprache einer Anfrage: Cookie zh_lang, sonst die erste passende Sprache aus Accept-Language */
function langOf(req) {
  const cookie = String(req.headers?.cookie || '').match(/(?:^|;\s*)zh_lang=(de|en)\b/);
  if (cookie) return cookie[1];
  for (const part of String(req.headers?.['accept-language'] || '').split(',')) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(l)) return l;
  }
  return DEFAULT;
}

const lang = () => store.getStore()?.lang ?? DEFAULT;
const locale = () => (lang() === 'en' ? 'en-GB' : 'de-DE');

function fill(s, params) {
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}
function tr(de, params) {
  return fill(lang() === 'en' ? (dict()[de] ?? de) : de, params);
}
function trn(n, one, other, params) {
  return tr(n === 1 ? one : other, { n, ...params });
}

/** Express/Connect-Middleware: Sprache für die ganze Anfrage festlegen */
function middleware(req, _res, next) {
  store.run({ lang: langOf(req) }, next);
}
/** Funktion in einer bestimmten Sprache ausführen (z. B. für Tests) */
const withLang = (l, fn) => store.run({ lang: LANGS.includes(l) ? l : DEFAULT }, fn);

module.exports = { tr, trn, lang, locale, langOf, middleware, withLang, LANGS };
