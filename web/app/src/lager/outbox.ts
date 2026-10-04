// Buchungen bei schlechtem WLAN: Ein- und Ausbuchen, das den Server nicht erreicht, wird im Browser vorgemerkt und
// automatisch nachgebucht, sobald die Verbindung wieder da ist. Jede Buchung trägt eine request_id – kam sie doch an
// (nur die Antwort ging verloren), erkennt der Server die Wiederholung und bucht nicht doppelt.

export interface OutboxEntry {
  id: string;
  method: string;
  url: string;
  body: Record<string, unknown>;
  label: string;
  at: number;
}
export interface OutboxFailure {
  label: string;
  error: string;
  at: number;
}

const KEY = 'zh.outbox';
const FAIL_KEY = 'zh.outbox.failed';
const listeners = new Set<() => void>();

/** Fehler „vorgemerkt“: Aufrufer zeigen die Meldung wie jeden Fehler, die Buchung ist aber nicht verloren */
export class QueuedError extends Error {
  readonly queued = true;
}

const read = <T>(k: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]') ?? [];
  } catch {
    return [];
  }
};
const write = (k: string, v: unknown[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher voll oder gesperrt – dann eben nicht */
  }
};

export const pending = () => read<OutboxEntry>(KEY);
export const failures = () => read<OutboxFailure>(FAIL_KEY);
export const clearFailures = () => {
  write(FAIL_KEY, []);
  notify();
};
export function onOutbox(fn: () => void) {
  listeners.add(fn);
}
const notify = () => listeners.forEach((l) => l());

/** Nur Buchungen werden vorgemerkt – alles andere braucht die Antwort des Servers sofort */
export const queueable = (method: string, url: string) => method === 'POST' && /^\/api\/(checkin|checkout)$/.test(url);

export const requestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function enqueue(method: string, url: string, body: Record<string, unknown>, label: string) {
  const list = pending();
  list.push({ id: String(body.request_id ?? requestId()), method, url, body, label, at: Date.now() });
  write(KEY, list);
  notify();
  schedule();
}

/** Text für Meldungen: „2× Mehl einbuchen“ */
export function describe(url: string, body: Record<string, unknown>, label?: string) {
  const what = label || (body.name ? String(body.name) : 'Gegenstand');
  return `${body.quantity ?? 1}× ${what} ${url.endsWith('checkout') ? 'ausbuchen' : 'einbuchen'}`;
}

let flushing = false;
/** Vorgemerkte Buchungen der Reihe nach senden; bricht ab, sobald die Verbindung wieder fehlt */
export async function flush(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const e of pending()) {
      let r: Response;
      try {
        r = await fetch(e.url, { method: e.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(e.body), credentials: 'same-origin' });
      } catch {
        break; // weiter offline
      }
      if (r.status >= 502 && r.status <= 504) break;
      if (r.status === 401) break; // abgemeldet – nach der Anmeldung erneut
      write(KEY, pending().filter((x) => x.id !== e.id));
      if (r.ok) sent++;
      else {
        failed++;
        const d = await r.json().catch(() => ({}));
        write(FAIL_KEY, [...failures(), { label: e.label, error: d.error ?? `Fehler ${r.status}`, at: Date.now() }].slice(-30));
      }
      notify();
    }
  } finally {
    flushing = false;
  }
  if (pending().length) schedule();
  return { sent, failed };
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    flush().then((r) => r.sent + r.failed && document.dispatchEvent(new CustomEvent('zh-outbox-flushed', { detail: r })));
  }, 15000);
}
window.addEventListener('online', () => {
  flush().then((r) => r.sent + r.failed && document.dispatchEvent(new CustomEvent('zh-outbox-flushed', { detail: r })));
});
if (pending().length) schedule();
