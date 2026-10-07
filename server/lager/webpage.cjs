'use strict';
// Heimlager – Webseiten für die Preisrecherche lesen: lädt eine öffentliche Seite und macht daraus kurzen Text,
// Preisangaben aus JSON-LD/Meta-Tags vorneweg. Nur öffentliche Adressen: private Netze (Docker, localhost, LAN,
// Cloud-Metadaten) sind gesperrt, auch nach Weiterleitungen.

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15_000;
const MAX_TEXT = 10_000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return v === '::' || v === '::1' || /^(f[cd]|fe[89ab]|ff)/.test(v) || v.startsWith('::ffff:');
}

// Adresse prüfen: http(s) und öffentlich (Rest-Risiko DNS-Rebinding zwischen Prüfung und Abruf nehmen wir hin)
async function assertPublic(u, allowPrivate) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('nur http(s)-Adressen');
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let ips;
  if (net.isIP(host)) ips = [host];
  else {
    try { ips = (await dns.lookup(host, { all: true })).map((a) => a.address); } catch { throw new Error('Adresse nicht gefunden'); }
  }
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('private Adressen sind gesperrt');
}

async function readBody(res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) break;
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  const charset = (String(res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(charset).decode(buf); } catch { return buf.toString('utf8'); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', shy: '', ndash: '–', mdash: '—', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    try { return String.fromCodePoint(n); } catch { return m; }
  }
  return ENTITIES[e] ?? m;
});

// Preisangaben aus JSON-LD (schema.org Product/Offer) als kurze Zeilen
function structuredPrices(html) {
  const lines = [];
  const walk = (node, name) => {
    if (!node || typeof node !== 'object' || lines.length >= 20) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, name));
    const own = typeof node.name === 'string' ? decode(node.name) : name;
    const price = node.price ?? node.lowPrice;
    if (price != null && typeof price !== 'object' && Number(String(price).replace(',', '.')) > 0) {
      lines.push(`${own ? `${own}: ` : ''}${price} ${node.priceCurrency || ''}`.trim()
        + (node.priceValidUntil ? ` (gültig bis ${node.priceValidUntil})` : '') + (node.seller?.name ? ` – ${node.seller.name}` : ''));
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, own);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim()), null); } catch { /* kaputtes JSON-LD */ }
  }
  for (const m of html.matchAll(/<meta[^>]+(?:property|itemprop|name)=["'](?:product:price:amount|og:price:amount|price)["'][^>]*>/gi)) {
    const v = m[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (v) lines.push(`Preis (Meta): ${v}`);
  }
  return [...new Set(lines)];
}

function htmlToText(html) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|title|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(br|p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<\/?(td|th|span)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  const lines = [];
  for (const raw of decode(body).split('\n')) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (l && l !== lines[lines.length - 1]) lines.push(l);
  }
  return { title, lines };
}

// Langer Text: Anfang plus die Zeilen mit Preisen (samt zwei Zeilen davor – dort steht meist das Produkt)
const PRICE = /\d+[.,]\d{2}\s*(€|EUR)|€\s*\d|\d+,-/i;
function excerpt(lines, max = MAX_TEXT) {
  const all = lines.join('\n');
  if (all.length <= max) return all;
  const keep = new Set();
  let size = 0;
  for (let i = 0; i < lines.length && size < 1500; i++) { keep.add(i); size += lines[i].length + 1; }
  for (let i = 0; i < lines.length && size < max; i++) {
    if (!PRICE.test(lines[i])) continue;
    for (let j = Math.max(0, i - 2); j <= i; j++) if (!keep.has(j)) { keep.add(j); size += lines[j].length + 1; }
  }
  let out = '';
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    out += (prev >= 0 && i !== prev + 1 ? '\n…\n' : prev >= 0 ? '\n' : '') + lines[i];
    prev = i;
  }
  return out.slice(0, max);
}

// → { url (nach Weiterleitungen), title, text }; Fehler als Error mit kurzer deutscher Meldung
async function fetchPage(address, { allowPrivate = false, timeoutMs = TIMEOUT_MS } = {}) {
  let u;
  try { u = new URL(String(address)); } catch { throw new Error('ungültige Adresse'); }
  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  for (let hop = 0; ; hop++) {
    await assertPublic(u, allowPrivate);
    try {
      res = await fetch(u, {
        redirect: 'manual', signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5', 'Accept-Language': 'de-DE,de;q=0.9' },
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'Zeitüberschreitung' : 'nicht erreichbar');
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= MAX_REDIRECTS) throw new Error('zu viele Weiterleitungen');
      res.body?.cancel().catch(() => {});
      u = new URL(loc, u);
      continue;
    }
    break;
  }
  if (!res.ok) { res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
  const type = String(res.headers.get('content-type') || '').toLowerCase();
  if (type && !/text\/|xhtml|json/.test(type)) { res.body?.cancel().catch(() => {}); throw new Error(`keine Textseite (${type.split(';')[0]})`); }
  const html = await readBody(res);
  const { title, lines } = htmlToText(html);
  const prices = structuredPrices(html);
  const text = [prices.length ? `Strukturierte Preisangaben der Seite:\n${prices.join('\n')}` : '', excerpt(lines)].filter(Boolean).join('\n\n');
  return { url: u.href, title, text };
}

module.exports = { fetchPage, isPrivateIp, htmlToText, structuredPrices };
