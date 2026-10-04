// Das Haus auf dem Server: laden, automatisch speichern (Admins), Konflikte beim gleichzeitigen Bearbeiten erkennen und
// den Inhalt der Fächer (Lager) bereitstellen. Ohne Anmeldung bleibt alles ein Entwurf im Browser.

import { store } from './state';
import type { House } from './model/types.ts';

export interface StoredItem {
  id: number;
  name: string;
  code: string;
  quantity: number;
  consumable: number;
  container: number;
  parent_id: number | null;
  expires_on: string | null;
  expires_in: number | null;
  photo_at: string | null;
}

export interface StoragePlace {
  plan_item: string;
  plan_slot: number;
  warehouse_id: number;
  wh_code: string;
  col: string;
  row: number;
  name: string;
  address: string;
  items: StoredItem[];
}

type Status = 'local' | 'loading' | 'saved' | 'saving' | 'pending' | 'error' | 'conflict' | 'readonly';

const STATUS_TEXT: Record<Status, [string, string, boolean]> = {
  local: ['Nur in diesem Browser', 'Nicht angemeldet – der Plan wird nur in diesem Browser gespeichert.', true],
  loading: ['Lade …', 'Hausplan wird geladen.', false],
  saved: ['Gespeichert ✓', 'Der Hausplan ist auf dem Server gespeichert; Fächer und Lagerplätze sind abgeglichen.', false],
  saving: ['Speichert …', 'Hausplan wird gespeichert und mit dem Lager abgeglichen.', false],
  pending: ['Änderungen …', 'Wird gleich gespeichert.', false],
  error: ['Nicht gespeichert', 'Speichern fehlgeschlagen – wird bei der nächsten Änderung erneut versucht.', true],
  conflict: ['Konflikt', 'Jemand anderes hat den Hausplan geändert.', true],
  readonly: ['Nur ansehen', 'Den Hausplan ändern nur Admins. Änderungen hier werden nicht gespeichert.', true],
};

interface Helpers {
  toast: (msg: string) => void;
  modal: (title: string, body: string, footer?: string) => { el: HTMLElement; close: () => void };
  statusEl: () => HTMLElement | null;
  afterLoad: () => void;
}

async function req<T = any>(method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data: any = null;
  try {
    data = await r.json();
  } catch {
    /* leer */
  }
  return { status: r.status, data };
}

export class HouseSync {
  version = 0;
  canEdit = false;
  online = false;
  status: Status = 'local';
  /** Fächer mit Inhalt, Schlüssel „<Möbel-ID>:<Fach>“ */
  storage = new Map<string, StoragePlace>();
  private timer = 0;
  private saving = false;
  private again = false;
  private storageListeners = new Set<() => void>();

  constructor(private h: Helpers) {
    store.onCommit(() => this.changed());
    document.addEventListener('zh-account-render', () => this.renderStatus());
    window.addEventListener('beforeunload', (e) => {
      if (this.status === 'pending' || this.status === 'saving') {
        this.flush();
        e.preventDefault();
      }
    });
  }

  onStorage(fn: () => void) {
    this.storageListeners.add(fn);
    return () => this.storageListeners.delete(fn);
  }

  fach(itemId: string, row: number) {
    return this.storage.get(`${itemId}:${row}`);
  }

  private setStatus(s: Status) {
    this.status = s;
    this.renderStatus();
  }

  renderStatus() {
    const el = this.h.statusEl();
    if (!el) return;
    const [text, title, warn] = STATUS_TEXT[this.status];
    el.textContent = text;
    el.title = title;
    el.classList.toggle('warn', warn);
  }

  /** Nach der Anmeldung (oder beim Start): Haus vom Server holen */
  async start(loggedIn: boolean) {
    this.online = loggedIn;
    this.storage.clear();
    if (!loggedIn) {
      this.canEdit = false;
      this.setStatus('local');
      this.storageListeners.forEach((l) => l());
      return;
    }
    this.setStatus('loading');
    const r = await req<{ house: House | null; version: number; can_edit: boolean; reserved: string[] }>('GET', '/api/house');
    if (r.status !== 200) {
      this.online = false;
      this.setStatus('local');
      return;
    }
    this.canEdit = r.data.can_edit;
    this.version = r.data.version;
    store.reservedCodes = new Set(r.data.reserved ?? []);
    if (r.data.house) {
      store.savedHouse = r.data.house;
      store.replace(r.data.house, { notify: false });
      this.h.afterLoad();
      this.setStatus(this.canEdit ? 'saved' : 'readonly');
    } else if (this.canEdit) {
      await this.firstSave();
    } else {
      this.setStatus('readonly');
      this.h.toast('Es gibt noch keinen Hausplan. Ein Admin legt ihn an.');
    }
    await this.loadStorage();
  }

  /** Noch kein Haus auf dem Server: den aktuellen Entwurf übernehmen oder leer beginnen */
  private firstSave(): Promise<void> {
    return new Promise((resolve) => {
      const f = store.house.floors;
      const walls = f.reduce((n, x) => n + x.walls.length, 0);
      const items = f.reduce((n, x) => n + x.items.length, 0);
      const m = this.h.modal(
        'Hausplan anlegen',
        `<p>Auf dem Server gibt es noch keinen Hausplan. Er wird von allen geteilt und ist die Grundlage für das Lager: <b>jeder Raum wird ein Lager, jedes Fach eines Möbels ein Lagerplatz</b>.</p>
         <div class="choice-grid">
           <button class="choice" data-c="draft"><b>Diesen Entwurf übernehmen</b><span>${f.length} Etage(n), ${walls} Wände, ${items} Möbel aus diesem Browser.</span></button>
           <button class="choice" data-c="empty"><b>Leeres Haus</b><span>Mit einer leeren Etage beginnen. Frühere Küchenplanungen lassen sich danach über das Kontomenü als Etage übernehmen.</span></button>
         </div>`,
      );
      let done = false;
      const finish = async (choice: string | null) => {
        if (done) return;
        done = true;
        m.close();
        if (choice === 'empty') store.reset(true);
        await this.save();
        resolve();
      };
      m.el.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.c!)));
      new MutationObserver((_, obs) => {
        if (!m.el.isConnected) {
          obs.disconnect();
          finish('draft');
        }
      }).observe(document.body, { childList: true });
    });
  }

  private changed() {
    if (!this.online) return;
    if (!this.canEdit) {
      this.setStatus('readonly');
      return;
    }
    if (this.status === 'conflict') return;
    this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.save(), 1200);
  }

  /** Sofort speichern (z. B. beim Verlassen der Seite) */
  flush() {
    if (this.status !== 'pending') return;
    clearTimeout(this.timer);
    this.save();
  }

  async save(force = false): Promise<boolean> {
    if (!this.online || !this.canEdit) return false;
    if (this.saving) {
      this.again = true;
      return false;
    }
    this.saving = true;
    this.setStatus('saving');
    const sent = JSON.parse(JSON.stringify(store.house)) as House;
    let ok = false;
    try {
      const r = await req<{ house: House; version: number; error?: string }>('PUT', '/api/house', force ? { house: sent } : { house: sent, base_version: this.version });
      if (r.status === 200) {
        this.version = r.data.version;
        store.savedHouse = r.data.house;
        store.applyServerNormalization(r.data.house);
        this.setStatus('saved');
        ok = true;
        this.loadStorage();
      } else if (r.status === 409 && /geändert/.test(r.data?.error ?? '')) {
        this.setStatus('conflict');
        this.conflict(r.data.error!);
      } else if (r.status === 403) {
        this.canEdit = false;
        this.setStatus('readonly');
      } else {
        this.setStatus('error');
        this.h.toast(r.data?.error ?? `Speichern fehlgeschlagen (${r.status}).`);
      }
    } catch {
      this.setStatus('error');
    } finally {
      this.saving = false;
    }
    if (this.again && ok) {
      this.again = false;
      return this.save();
    }
    return ok;
  }

  private conflict(msg: string) {
    const m = this.h.modal(
      'Hausplan wurde geändert',
      `<p>${msg}</p><p class="hint">„Neu laden“ übernimmt den Stand vom Server (deine letzten Änderungen gehen verloren). „Meinen Stand speichern“ überschreibt die Änderungen der anderen Person.</p>`,
      '<button class="btn" data-c="reload">Neu laden</button><button class="btn danger" data-c="force">Meinen Stand speichern</button>',
    );
    m.el.querySelector('[data-c="reload"]')!.addEventListener('click', () => {
      m.close();
      this.start(true);
    });
    m.el.querySelector('[data-c="force"]')!.addEventListener('click', () => {
      m.close();
      this.status = 'pending';
      this.save(true);
    });
  }

  /** Inhalt aller Fächer neu laden (nach Speichern, Buchungen) */
  async loadStorage() {
    if (!this.online) return;
    const r = await req<{ places: StoragePlace[] }>('GET', '/api/house/storage');
    if (r.status !== 200) return;
    this.storage = new Map(r.data.places.map((p) => [`${p.plan_item}:${p.plan_slot}`, p]));
    this.storageListeners.forEach((l) => l());
  }
}
