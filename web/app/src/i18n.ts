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
