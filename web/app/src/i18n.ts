// Sprachen der App (Deutsch und Englisch). Der deutsche Text im Code ist zugleich der Schlüssel:
//   tr('Speichern')                         → „Save“
//   tr('Platz {code} gibt es nicht.', { code }) → Platzhalter in geschweiften Klammern
//   trn(n, '{n} Platz', '{n} Plätze')       → Einzahl/Mehrzahl (n steht als {n} zur Verfügung)
// Englisch steht in i18n/en/*.json (eine Datei je Programmteil, gemeinsam mit dem Server). Fehlt ein Eintrag, bleibt
// der deutsche Text stehen; test/i18n.test.cjs meldet fehlende Übersetzungen.
// Die Sprache folgt der persönlichen Einstellung (prefs.lang: auto/de/en); „auto“ nimmt die Browsersprache. Der Server
// erfährt sie über das Cookie „zh_lang“ (Fehlermeldungen, Assistent). Beim Umschalten lädt die Seite neu, weil viele
// Texte schon beim Start (z. B. in Katalogen) festgelegt werden.

export type Lang = 'de' | 'en';
export type LangPref = 'auto' | Lang;

const files = import.meta.glob('./i18n/en/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const EN: Record<string, string> = Object.assign({}, ...Object.keys(files).sort().map((k) => files[k]));

const PREFS_KEY = 'zh.prefs'; // dieselbe Ablage wie prefs.ts

function browserLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return list.some((l) => /^de\b/i.test(l)) ? 'de' : 'en';
}
function storedPref(): LangPref {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')?.lang;
    return p === 'de' || p === 'en' ? p : 'auto';
  } catch {
    return 'auto';
  }
}
const effective = (p: LangPref): Lang => (p === 'auto' ? browserLang() : p);

let lang: Lang = effective(storedPref());

function announce() {
  document.documentElement.lang = lang;
  document.cookie = `zh_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
}
announce();

export const getLang = () => lang;
/** Gebietsschema für Datum und Zahlen (britisches Englisch: Tag vor Monat, metrisch) */
export const locale = () => (lang === 'en' ? 'en-GB' : 'de-DE');

function fill(s: string, params?: Record<string, unknown>) {
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
}

/** Text in der eingestellten Sprache (Schlüssel = deutscher Text) */
export function tr(de: string, params?: Record<string, unknown>): string {
  return fill(lang === 'en' ? (EN[de] ?? de) : de, params);
}

/** Einzahl oder Mehrzahl je nach n; {n} ist immer gesetzt */
export function trn(n: number, one: string, other: string, params?: Record<string, unknown>): string {
  return tr(n === 1 ? one : other, { n, ...params });
}

// Gespeicherte Namen (Etagen, Räume, Fächer, Möbelgruppen) entstehen in der Sprache dessen, der sie anlegt; Fächer legt
// der Server immer deutsch an. shown() zeigt sie in der eingestellten Sprache – aber nur Teile, die genau einer
// Vorgabe aus dem Wörterbuch entsprechen (auch mit Platzhaltern, z. B. „Schublade 1 (oben)“ oder „Unterschrank 60“).
// Eigene Namen bleiben, wie sie sind. Nur zur Anzeige: Eingabefelder zeigen weiter den gespeicherten Namen.
type Rule = { re: RegExp; to: string; keys: string[] };
let NAMES: { exact: Map<string, string>; rules: Rule[] } | null = null;
const shownCache = new Map<string, string>();

function nameTables() {
  if (NAMES) return NAMES;
  const pairs = Object.entries(EN).filter(([k, v]) => k.length <= 60 && !/[<>&\n]/.test(k + v));
  // Richtung: Deutsch → Englisch oder (für englisch angelegte Namen) Englisch → Deutsch
  const dir = lang === 'en' ? pairs : pairs.map(([k, v]) => [v, k] as [string, string]);
  const exact = new Map<string, string>();
  const rules: Rule[] = [];
  const quote = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  for (const [from, to] of dir) {
    if (!/\{\w+\}/.test(from)) { if (!exact.has(from)) exact.set(from, to); continue; }
    const keys: string[] = [];
    const src = quote(from).replace(/\\?\{(\w+)\\?\}/g, (_m, k: string) => { keys.push(k); return k === 'n' ? '(\\d+)' : '(.+?)'; });
    rules.push({ re: new RegExp(`^${src}$`), to, keys });
  }
  rules.sort((a, b) => b.re.source.length - a.re.source.length); // genauere Muster zuerst
  return (NAMES = { exact, rules });
}

function shownPart(s: string, depth = 0): string {
  const { exact, rules } = nameTables();
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  if (depth > 2) return s;
  for (const r of rules) {
    const m = s.match(r.re);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = k === 'n' ? m[i + 1] : shownPart(m[i + 1], depth + 1)));
    return fill(r.to, params);
  }
  // „Unterschrank 60“, „Obergeschoss 2“: Vorgabe mit angehängter Zahl
  const num = s.match(/^(.+?) (\d+)$/);
  if (num && exact.has(num[1])) return `${exact.get(num[1])} ${num[2]}`;
  return s;
}

/** Gespeicherten Namen in der eingestellten Sprache anzeigen (nur bekannte Vorgaben, Teile mit „ · “ einzeln) */
export function shown(name: string | null | undefined): string {
  const s = String(name ?? '');
  if (!s) return s;
  let out = shownCache.get(s);
  if (out === undefined) {
    out = s.split(' · ').map((p) => shownPart(p.trim())).join(' · ');
    shownCache.set(s, out);
  }
  return out;
}

/** Zahl im Format der Sprache (Dezimalkomma bzw. -punkt) */
export const num = (v: number, digits = 2) => v.toLocaleString(locale(), { maximumFractionDigits: digits });

/**
 * Spracheinstellung übernehmen (aus den persönlichen Einstellungen). Ändert sich dadurch die tatsächliche Sprache,
 * lädt die Seite neu – sonst passiert nichts.
 */
export function applyLangPref(p: LangPref | undefined) {
  const next = effective(p === 'de' || p === 'en' ? p : 'auto');
  if (next === lang) return;
  lang = next;
  announce();
  location.reload();
}
