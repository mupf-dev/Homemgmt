// Wandterminal: Gerät ohne persönliche Anmeldung (Einrichtungslink aus der Verwaltung). Ausrichtung, Ansicht und
// Darstellung kommen aus dem Geräteprofil. Wer bucht, tippt seine Kachel an – die Wahl gilt 90 Sekunden. Ohne
// Bedienung kehrt das Terminal zum Haus zurück und zeigt den Ruhezustand.

import { ic } from './icons';
import { setPrefs } from './prefs';

export interface TerminalSettings {
  orientation: 'portrait' | 'landscape';
  houseView: '2d' | '3d';
  theme: 'auto' | 'light' | 'dark';
  fontSize: 'normal' | 'large' | 'xlarge';
  idleMinutes: number;
  screensaver: boolean;
  plz: string;
}
export interface TerminalInfo {
  id: number;
  name: string;
  settings: TerminalSettings;
}

let info: TerminalInfo | null = null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const terminal = () => info;

/** Seiten, die es am Terminal gibt */
export const terminalAllows = (hash: string) => /^#\/(haus|suche|einkauf|haltbarkeit|item\/\d+|platz|q\/.+)$/.test(hash);

export function setTerminal(t: TerminalInfo | null) {
  info = t;
  document.body.classList.toggle('terminal', !!t);
  document.body.classList.toggle('orient-portrait', t?.settings.orientation === 'portrait');
  document.body.classList.toggle('orient-landscape', t?.settings.orientation === 'landscape');
  if (!t) return;
  setPrefs({ start: 'house', houseView: t.settings.houseView, theme: t.settings.theme, fontSize: t.settings.fontSize });
  renderHead();
}

// ---------------------------------------------------------------------------
// Wer bucht?

type Who = { id: number; name: string; color: string };
let who: (Who & { at: number }) | null = null;
const WHO_MS = 90_000;

export function clearWho() {
  who = null;
  renderHead();
}

/** Person fürs Buchen: zuletzt gewählte (90 s), sonst Kacheln zur Auswahl. null = abgebrochen. */
export async function pickWho(): Promise<number | null> {
  if (who && Date.now() - who.at < WHO_MS) {
    who.at = Date.now();
    return who.id;
  }
  const st = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ users: [] }));
  const users: Who[] = st.users ?? [];
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'who-back';
    back.innerHTML = `<div class="who-dialog" role="dialog" aria-label="Wer bucht?"><h2>Wer bucht?</h2>
      <div class="who-grid">${users.map((u) => `<button data-id="${u.id}"><span class="avatar" style="background:${esc(u.color)}">${esc(u.name.slice(0, 1).toUpperCase())}</span>${esc(u.name)}</button>`).join('')}</div>
      <button class="btn who-cancel">Abbrechen</button></div>`;
    const done = (id: number | null) => {
      back.remove();
      resolve(id);
    };
    back.querySelectorAll<HTMLElement>('[data-id]').forEach((b) =>
      b.addEventListener('click', () => {
        const u = users.find((x) => x.id === Number(b.dataset.id))!;
        who = { ...u, at: Date.now() };
        renderHead();
        done(u.id);
      }),
    );
    back.querySelector('.who-cancel')!.addEventListener('click', () => done(null));
    back.addEventListener('click', (e) => e.target === back && done(null));
    document.body.appendChild(back);
  });
}

// ---------------------------------------------------------------------------
// Kopfzeile: Ort, wer gerade bucht, Uhrzeit

let clockTimer = 0;
let weather = '';
/** Wetter in der Kopfzeile (z. B. „12 °C · wolkig“) */
export function setTermWeather(text: string) {
  weather = text;
  const el = document.querySelector('#termHead .term-weather');
  if (el) el.textContent = text;
}
function renderHead() {
  let el = document.getElementById('termHead');
  if (!info) return el?.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = 'termHead';
    el.className = 'sh-term';
    document.getElementById('shell')?.appendChild(el);
  }
  const active = who && Date.now() - who.at < WHO_MS;
  el.innerHTML = `<span class="term-place">${ic('home')}${esc(info.name)}</span>
    ${active ? `<button class="term-who" title="Andere Person wählen"><span class="avatar" style="background:${esc(who!.color)}">${esc(who!.name.slice(0, 1).toUpperCase())}</span>${esc(who!.name)}${ic('x')}</button>` : ''}
    <span class="term-weather">${esc(weather)}</span><b class="term-clock"></b>`;
  el.querySelector('.term-who')?.addEventListener('click', clearWho);
  const clock = () => {
    const c = el!.querySelector('.term-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (who && Date.now() - who.at >= WHO_MS) clearWho();
  };
  clock();
  clearInterval(clockTimer);
  clockTimer = window.setInterval(clock, 15000);
}

// ---------------------------------------------------------------------------
// Ohne Bedienung: zurück zum Haus, dann Ruhezustand

let last = Date.now();
let resting = false;
export function initIdle(onIdle: () => void, onWake: () => void) {
  const touch = () => {
    last = Date.now();
    if (resting) {
      resting = false;
      onWake();
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, touch, { capture: true, passive: true });
  window.setInterval(() => {
    if (!info || resting) return;
    if (Date.now() - last > info.settings.idleMinutes * 60000) {
      resting = true;
      clearWho();
      onIdle();
    }
  }, 5000);
}
/** für Klicktests: Ruhezustand sofort auslösen */
export const idleNow = () => (last = 0);
