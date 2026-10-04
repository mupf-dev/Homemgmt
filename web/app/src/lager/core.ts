// Lager in der App – gemeinsame Bausteine: API, Platzbeschreibung über den Hausplan („Küche · Unterschrank · Schublade 2“),
// Fach-Auswahl im Haus, Fotos, Rückgängig. Die Ansichten (views.ts, scan.ts) bauen darauf auf.

import type { HouseSync, StoragePlace } from '../houseSync';
import type { Floor, House, Item } from '../model/types.ts';
import { compartments, itemName } from '../model/storage.ts';
import { roomOf } from '../model/house.ts';

export interface LagerCtx {
  modal: (title: string, body: string, footer?: string) => { el: HTMLElement; close: () => void };
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
  esc: (s: string) => string;
  sync: HouseSync;
  house: () => House;
  user: () => { id: number; name: string; role: string } | null;
  login: () => void;
  /** Anmeldung erneut prüfen (z. B. in einem anderen Tab per Kachel angemeldet) */
  ensureUser: () => Promise<{ id: number; name: string; role: string } | null>;
  /** Planer öffnen und auf ein Fach fahren */
  showInHouse: (planItem: string, row: number) => void;
}

export type ApiItem = {
  id: number;
  code: string;
  name: string;
  description: string;
  warehouse_id: number;
  col: string;
  row: number;
  quantity: number;
  consumable: number;
  container: number;
  parent_id: number | null;
  parent_name: string | null;
  contents: number;
  expires_on: string | null;
  expires_in: number | null;
  photo_at: string | null;
  wh_code: string;
  wh_name: string;
  place_name: string | null;
  place_category: string | null;
  on_list: number;
  last_type: string | null;
  last_at: string | null;
  last_person: string | null;
  movement_id?: number;
  shopping_added?: number;
};

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Fehler ${r.status}`);
  return d as T;
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
export const relDate = (iso: string | null) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  if (s < 86400 * 30) return `vor ${Math.floor(s / 86400)} Tagen`;
  return fmtDate(iso).split(',')[0];
};

export function expiryTag(i: { expires_in: number | null; expires_on: string | null }, long = false) {
  if (i.expires_in === null || !i.expires_on) return '';
  const d = i.expires_on.split('-').reverse().join('.');
  if (i.expires_in < 0) return `<span class="tag bad">abgelaufen ${long ? d : ''}</span>`;
  if (i.expires_in <= 30) return `<span class="tag warn">${i.expires_in === 0 ? 'heute' : `in ${i.expires_in} T.`}${long ? ` (${d})` : ''}</span>`;
  return long ? `<span class="tag">bis ${d}</span>` : '';
}

/** Wo liegt etwas? – aus dem Hausplan, wenn der Platz ein Fach ist, sonst Lager + Platzname */
export interface PlaceInfo {
  address: string;
  title: string;
  sub: string;
  plan: { place: StoragePlace; floor: Floor; item: Item; room: string; fach: string } | null;
}

export function placeInfo(ctx: LagerCtx, x: { warehouse_id: number; col: string; row: number; wh_code?: string; wh_name?: string; place_name?: string | null }): PlaceInfo {
  const pl = [...ctx.sync.storage.values()].find((p) => (x.warehouse_id ? p.warehouse_id === x.warehouse_id : p.wh_code === x.wh_code) && p.col === x.col && p.row === x.row);
  const address = pl?.address ?? `${x.wh_code ?? ''}-${x.col}${x.row}`;
  if (pl) {
    for (const f of ctx.house().floors) {
      const it = f.items.find((i) => i.id === pl.plan_item);
      if (!it) continue;
      const comp = compartments(it, ctx.house().settings)[pl.plan_slot];
      const room = roomOf(f, it)?.name ?? f.name;
      return { address, title: `${room} · ${itemName(it)}`, sub: `${comp?.label ?? `Fach ${pl.plan_slot}`} · ${f.name}`, plan: { place: pl, floor: f, item: it, room, fach: comp?.label ?? '' } };
    }
  }
  return { address, title: x.place_name || `Platz ${x.col}${x.row}`, sub: x.wh_name ?? '', plan: null };
}

export function thumb(i: { id: number; photo_at: string | null; container?: number }, cls = 'thumb') {
  return i.photo_at
    ? `<img class="${cls}" src="/api/items/${i.id}/photo?size=thumb&v=${encodeURIComponent(i.photo_at)}" alt="" loading="lazy">`
    : `<span class="${cls} ph">${i.container ? '📦' : '•'}</span>`;
}

/** Listenzeile eines Gegenstands mit Ort aus dem Haus */
export function itemRow(ctx: LagerCtx, i: ApiItem) {
  const p = placeInfo(ctx, i);
  return `<a class="l-item" href="#/item/${i.id}">${thumb(i)}<span class="l-main"><b>${esc(i.name)}</b>${expiryTag(i)}
    <small>${esc(p.title)} · ${esc(p.plan?.fach ?? '')}${i.parent_name ? ` · in ${esc(i.parent_name)}` : ''}</small></span>
    <span class="l-side"><b>${i.quantity}×</b><code>${esc(p.address)}</code></span></a>`;
}

/** Foto aufnehmen/auswählen, verkleinern (1280 px + quadratisches Vorschaubild) */
export function pickPhoto(): Promise<{ image: string; thumb: string; preview: string } | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bmp = await createImageBitmap(file);
        const draw = (w: number, h: number, sx: number, sy: number, sw: number, sh: number, q: number) => {
          const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
          c.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
          return c.toDataURL('image/jpeg', q);
        };
        const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        const full = draw(Math.round(bmp.width * scale), Math.round(bmp.height * scale), 0, 0, bmp.width, bmp.height, 0.82);
        const side = Math.min(bmp.width, bmp.height);
        const th = draw(240, 240, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0.75);
        resolve({ image: full.split(',')[1], thumb: th.split(',')[1], preview: th });
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

/** Buchung mit „Rückgängig“ im Hinweis */
export function bookedToast(ctx: LagerCtx, msg: string, movementId: number | undefined, after?: () => void) {
  ctx.toast(msg, movementId ? {
    label: 'Rückgängig',
    run: async () => {
      try {
        await api('POST', `/api/movements/${movementId}/undo`);
        ctx.toast('Buchung zurückgenommen.');
        await ctx.sync.loadStorage();
        after?.();
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    },
  } : undefined);
}

export type Target = { warehouse_id: number; col: string; row: number; address: string; label: string };

/**
 * Fach im Haus wählen: Etage → Raum → Möbel → Fach (mit Belegung). Alternativ eine Platzadresse eintippen
 * (z. B. H-B12 für Lager ohne Hausplan). Liefert null bei Abbruch.
 */
export function pickPlace(ctx: LagerCtx, title = 'Wohin?', current?: { warehouse_id: number; col: string; row: number }): Promise<Target | null> {
  return new Promise((resolve) => {
    const h = ctx.house();
    const withStorage = h.floors.filter((f) => f.items.some((it) => it.storageCol));
    let floorId = (current && placeInfo(ctx, current).plan?.floor.id) ?? withStorage[0]?.id;
    const m = ctx.modal(title, '<div class="pp"></div>', '<button class="btn" data-close>Abbrechen</button>');
    m.el.querySelector('.modal')!.classList.add('pp-modal');
    const body = m.el.querySelector('.pp')!;
    let done = false;
    const finish = (t: Target | null) => {
      if (done) return;
      done = true;
      m.close();
      resolve(t);
    };
    new MutationObserver((_, obs) => {
      if (!m.el.isConnected) {
        obs.disconnect();
        finish(null);
      }
    }).observe(document.body, { childList: true });
    const draw = () => {
      const f = h.floors.find((x) => x.id === floorId);
      const rooms = new Map<string, { name: string; items: Item[] }>();
      for (const it of f?.items ?? []) {
        if (!it.storageCol) continue;
        const r = roomOf(f!, it);
        const k = r?.id ?? '-';
        if (!rooms.has(k)) rooms.set(k, { name: r?.name ?? `${f!.name} (ohne Raum)`, items: [] });
        rooms.get(k)!.items.push(it);
      }
      body.innerHTML = `
        ${withStorage.length ? `<div class="seg pp-floors">${withStorage.map((x) => `<button data-f="${x.id}" class="${x.id === floorId ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>` : '<p class="hint">Im Hausplan gibt es noch keine Möbel mit Fächern.</p>'}
        ${[...rooms.values()].map((r) => `<details class="pp-room" ${rooms.size <= 4 ? 'open' : ''}><summary>${esc(r.name)} <small>${r.items.length} Möbel</small></summary>
          ${r.items.sort((a, b) => (a.storageCol! < b.storageCol! ? -1 : 1)).map((it) => `<div class="pp-item"><div class="pp-head"><b>${esc(itemName(it))}</b></div><div class="pp-fach">${compartments(it, h.settings)
            .map((c) => {
              const pl = ctx.sync.fach(it.id, c.row);
              const n = pl?.items.length ?? 0;
              const cur = current && pl && pl.warehouse_id === current.warehouse_id && pl.col === current.col && pl.row === current.row;
              return pl ? `<button class="pp-btn ${n ? 'full' : ''} ${cur ? 'cur' : ''}" data-it="${it.id}" data-row="${c.row}"><code>${esc(pl.address)}</code><span>${esc(c.label)}</span><small>${n ? `${n} drin` : 'leer'}</small></button>` : '';
            })
            .join('')}</div></div>`).join('')}
        </details>`).join('')}
        <form class="pp-manual"><label>Anderer Lagerplatz</label><input name="addr" placeholder="z. B. H-B12" autocapitalize="characters" /><button class="btn" type="submit">Übernehmen</button></form>`;
      body.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => b.addEventListener('click', () => {
        floorId = b.dataset.f!;
        draw();
      }));
      body.querySelectorAll<HTMLElement>('.pp-btn').forEach((b) => b.addEventListener('click', () => {
        const pl = ctx.sync.fach(b.dataset.it!, Number(b.dataset.row))!;
        const info = placeInfo(ctx, pl);
        finish({ warehouse_id: pl.warehouse_id, col: pl.col, row: pl.row, address: pl.address, label: `${info.title} · ${info.plan?.fach ?? ''}` });
      }));
      body.querySelector<HTMLFormElement>('.pp-manual')!.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = String(new FormData(e.target as HTMLFormElement).get('addr') ?? '').trim().toUpperCase();
        if (!raw) return;
        try {
          const r = await api<any>('GET', `/api/resolve?code=${encodeURIComponent(raw.startsWith('P-') ? raw : `P-${raw}`)}`);
          if (r.type !== 'place') throw new Error(r.reason ?? 'Unbekannte Platzadresse – Format: Lager-Kürzel, Strich, Platz (z. B. H-B12).');
          const p = r.place;
          finish({ warehouse_id: p.warehouse_id, col: p.col, row: p.row, address: `${p.wh_code}-${p.col}${p.row}`, label: p.name || p.wh_name });
        } catch (ex) {
          ctx.toast((ex as Error).message);
        }
      });
    };
    draw();
  });
}
