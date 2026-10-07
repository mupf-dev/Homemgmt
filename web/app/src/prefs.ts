// Persönliche Einstellungen (pro Person auf dem Server, siehe PATCH /api/auth/me/prefs): Startseite, Ansicht im Haus,
// Hell/Dunkel und Schriftgröße. Ohne Anmeldung gelten die Standardwerte; zuletzt bekannte Werte merkt sich der
// Browser, damit die App beim Start nicht kurz in der falschen Darstellung erscheint.

export interface Prefs {
  start: 'overview' | 'house' | 'assistant';
  houseView: '2d' | '3d';
  theme: 'auto' | 'light' | 'dark';
  fontSize: 'normal' | 'large' | 'xlarge';
}

export const DEFAULT_PREFS: Prefs = { start: 'overview', houseView: '2d', theme: 'auto', fontSize: 'normal' };
const KEY = 'zh.prefs';

let current: Prefs = { ...DEFAULT_PREFS, ...read() };
const listeners = new Set<(p: Prefs) => void>();

function read(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export const prefs = () => current;

/** Darstellung anwenden (Theme, Schrift) */
function apply() {
  const root = document.documentElement;
  if (current.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = current.theme;
  if (current.fontSize === 'normal') delete root.dataset.font;
  else root.dataset.font = current.fontSize;
}

/** Werte vom Server (oder nach dem Abmelden die Standardwerte) übernehmen */
export function setPrefs(p: Partial<Prefs> | null | undefined) {
  current = { ...DEFAULT_PREFS, ...(p ?? {}) };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* egal */
  }
  apply();
  listeners.forEach((l) => l(current));
}

export function onPrefs(fn: (p: Prefs) => void) {
  listeners.add(fn);
}

/** Einstellung ändern und speichern */
export async function savePrefs(patch: Partial<Prefs>) {
  const before = current;
  setPrefs({ ...current, ...patch });
  const r = await fetch('/api/auth/me/prefs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), credentials: 'same-origin' });
  if (!r.ok) {
    setPrefs(before);
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error ?? 'Einstellung konnte nicht gespeichert werden.');
  }
  setPrefs(await r.json());
}

apply();
