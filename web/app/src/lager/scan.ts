// Scannen mit der Kamera: Fach-Code (P-…) + Gegenstand (O-…) = einbuchen, Gegenstand zweimal = ausbuchen,
// unbekanntes Etikett = neu anlegen. Erkennung über BarcodeDetector, sonst jsQR (aus der Lager-App, /vendor/jsQR.js).

import { api, bookedToast, esc, placeInfo, thumb, type ApiItem } from './core';
import type { View } from './views';

declare global {
  interface Window {
    jsQR?: (data: Uint8ClampedArray, w: number, h: number, o?: object) => { data: string } | null;
    BarcodeDetector?: any;
  }
}

export class Scanner {
  private stream: MediaStream | null = null;
  private timer = 0;
  private seen = new Map<string, number>();
  private canvas = document.createElement('canvas');
  private detector: any = null;
  constructor(private video: HTMLVideoElement, private onCode: (c: string) => void, private onStatus: (m: string, err: boolean) => void) {}

  async start() {
    if (!window.isSecureContext) return this.onStatus('Die Kamera geht nur über HTTPS (oder localhost). Codes lassen sich unten eingeben.', true);
    if (!navigator.mediaDevices?.getUserMedia) return this.onStatus('Dieser Browser unterstützt keinen Kamerazugriff.', true);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      return this.onStatus(`Kamera nicht verfügbar: ${(e as Error).message}`, true);
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if (window.BarcodeDetector) {
      try {
        if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        /* Fallback */
      }
    }
    if (!this.detector && !window.jsQR) {
      await new Promise<void>((res) => {
        const s = Object.assign(document.createElement('script'), { src: `${import.meta.env.BASE_URL}vendor/jsQR.js`, onload: () => res(), onerror: () => res() });
        document.head.appendChild(s);
      });
    }
    this.onStatus(this.detector ? 'Kamera aktiv' : window.jsQR ? 'Kamera aktiv (Software-Erkennung)' : 'Keine QR-Erkennung verfügbar', false);
    this.loop();
  }

  private async loop() {
    if (!this.stream) return;
    const t0 = performance.now();
    try {
      const v = this.video;
      if (v.readyState >= 2 && v.videoWidth) {
        let texts: string[] = [];
        if (this.detector) texts = (await this.detector.detect(v)).map((b: any) => b.rawValue);
        else if (window.jsQR) {
          const scale = Math.min(1, 640 / v.videoWidth);
          const w = Math.round(v.videoWidth * scale);
          const h = Math.round(v.videoHeight * scale);
          this.canvas.width = w;
          this.canvas.height = h;
          const c = this.canvas.getContext('2d', { willReadFrequently: true })!;
          c.drawImage(v, 0, 0, w, h);
          const r = window.jsQR(c.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          if (r?.data) texts = [r.data];
        }
        const now = performance.now();
        for (const t of texts) {
          const last = this.seen.get(t) ?? 0;
          this.seen.set(t, now);
          if (now - last > 1500) this.onCode(t); // erst nach 1,5 s ohne diesen Code gilt er als neu gescannt
        }
      }
    } catch {
      /* einzelne Bilder dürfen fehlschlagen */
    }
    this.timer = window.setTimeout(() => this.loop(), Math.max(80, 200 - (performance.now() - t0)));
  }

  stop() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export function parseCode(raw: string) {
  let s = String(raw || '').trim();
  const m = s.match(/\/q\/([^/?#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/\s+/g, '');
  let x = s.match(/^P-([A-Z][A-Z0-9]{0,3})-([A-Z]{1,3})(\d{1,2})$/);
  if (x) return { type: 'place' as const, key: `P-${x[1]}-${x[2]}${x[3]}` };
  x = s.match(/^P-?([A-Z]{1,3})-?(\d{1,2})$/);
  if (x) return { type: 'place' as const, key: `P-${x[1]}${x[2]}` };
  x = s.match(/^(?:O-?)?([2-9A-HJ-NP-Z]{6})$/);
  if (x) return { type: 'item' as const, key: `O-${x[1]}` };
  return null;
}

let active: Scanner | null = null;
export const stopScanner = () => {
  active?.stop();
  active = null;
};

function beep(ok = true) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const c = (beep as any).ctx || ((beep as any).ctx = new AC());
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.setValueAtTime(0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.15);
  } catch {
    /* kein Ton */
  }
  navigator.vibrate?.(ok ? 40 : [60, 40, 60]);
}

export const viewScan: View = async (el, ctx, params) => {
  const flow: { place: any | null; box: ApiItem | null; pending: ApiItem | null; pendingAt: number; log: { item: ApiItem; type: 'in' | 'out'; qty: number }[] } = { place: null, box: params.get('box') ? await api<ApiItem>('GET', `/api/items/${params.get('box')}`).catch(() => null) : null, pending: null, pendingAt: 0, log: [] };
  el.innerHTML = `<a class="l-back" href="#/lager">← Lager</a><h1>Scannen</h1>
    <div class="l-scan">
      <div><div class="l-video"><video id="video" muted playsinline></video><div class="frame"></div></div>
        <div class="hint" id="cam">Kamera wird gestartet …</div>
        <form class="l-add" id="manual"><input id="code" placeholder="Code eingeben oder Handscanner …" autocapitalize="characters" autocomplete="off" /><button class="btn">OK</button></form></div>
      <div><div class="l-card" id="state"></div>
        <div class="l-card"><label>Menge je Buchung <input type="number" id="qty" value="1" min="1" max="999" /></label></div>
        <div id="log"></div></div>
    </div>`;
  const stateEl = el.querySelector<HTMLElement>('#state')!;
  const qty = () => Math.max(1, Number(el.querySelector<HTMLInputElement>('#qty')!.value) || 1);
  const render = () => {
    if (flow.box) {
      const b = flow.box;
      stateEl.className = 'l-card mode-in';
      stateEl.innerHTML = `<b>📦 Einräumen in ${esc(b.name)}</b><p>liegt in ${esc(placeInfo(ctx, b).title)} <code>${esc(placeInfo(ctx, b).address)}</code></p><p>Jetzt die <b>Gegenstände</b> scannen – jeder kommt sofort in den Behälter.</p><button class="btn" id="leaveBox">Einräumen beenden</button>`;
      stateEl.querySelector('#leaveBox')!.addEventListener('click', () => {
        flow.box = null;
        render();
      });
    } else if (flow.place) {
      const p = placeInfo(ctx, flow.place);
      stateEl.className = 'l-card mode-in';
      stateEl.innerHTML = `<b>Einbuchen in ${esc(p.title)}</b><p><code>${esc(p.address)}</code> ${esc(p.plan?.fach ?? '')}</p><p>Jetzt die <b>Gegenstände</b> scannen – jeder wird sofort hier eingebucht.</p><button class="btn" id="leave">Fach verlassen</button>`;
      stateEl.querySelector('#leave')!.addEventListener('click', () => {
        flow.place = null;
        render();
      });
    } else if (flow.pending) {
      const it = flow.pending;
      const p = placeInfo(ctx, it);
      stateEl.className = 'l-card mode-out';
      stateEl.innerHTML = `<b>${thumb(it, 'thumb small')} ${esc(it.name)}</b><p>liegt in ${esc(p.title)} · ${esc(p.plan?.fach ?? '')} <code>${esc(p.address)}</code> · ${it.quantity} Stück</p>
        <p><b>Zum Ausbuchen erneut scannen.</b> Oder zuerst ein Fach scannen, um es dort einzubuchen.</p>
        <div class="l-actions">${it.container ? `<button class="btn in" id="intoBox">📦 Einräumen (${it.contents ?? 0} drin)</button>` : ''}<button class="btn out" id="out" ${it.quantity ? '' : 'disabled'}>Jetzt ausbuchen</button><a class="btn" href="#/item/${it.id}">Details</a><button class="btn" id="cancel">Abbrechen</button></div>`;
      stateEl.querySelector('#out')!.addEventListener('click', () => checkout(it));
      stateEl.querySelector('#intoBox')?.addEventListener('click', () => {
        flow.box = it;
        flow.pending = null;
        render();
      });
      stateEl.querySelector('#cancel')!.addEventListener('click', () => {
        flow.pending = null;
        render();
      });
    } else {
      stateEl.className = 'l-card';
      stateEl.innerHTML = `<b>Bereit</b><ul class="hint"><li><b>Einbuchen:</b> erst das <b>Fach</b> scannen, dann den <b>Gegenstand</b>.</li><li><b>Ausbuchen:</b> den Gegenstand <b>zweimal</b> scannen.</li><li>Unbekanntes Etikett: Der Gegenstand wird neu angelegt.</li></ul>`;
    }
  };
  const log = () => {
    el.querySelector('#log')!.innerHTML = flow.log.length ? `<h2>In dieser Sitzung</h2><ul class="l-history">${flow.log.map((l) => `<li><span class="tag ${l.type}">${l.type === 'in' ? 'ein' : 'aus'}</span><span>${l.qty}× <a href="#/item/${l.item.id}">${esc(l.item.name)}</a> · jetzt ${l.item.quantity}</span></li>`).join('')}</ul>` : '';
  };
  const checkin = async (item: ApiItem) => {
    try {
      const r = await api<ApiItem>('POST', '/api/checkin', flow.box
        ? { item_id: item.id, container_id: flow.box.id, quantity: qty() }
        : { item_id: item.id, warehouse_id: flow.place.warehouse_id, col: flow.place.col, row: flow.place.row, container_id: null, quantity: qty() });
      beep();
      bookedToast(ctx, `${r.name} ${flow.box ? `in ${flow.box.name}` : `in ${placeInfo(ctx, r).address}`} eingebucht (${r.quantity}).`, r.movement_id);
      flow.log.unshift({ item: r, type: 'in', qty: qty() });
      log();
      ctx.sync.loadStorage();
    } catch (e) {
      beep(false);
      ctx.toast((e as Error).message);
    }
  };
  const checkout = async (item: ApiItem) => {
    try {
      const r = await api<ApiItem>('POST', '/api/checkout', { item_id: item.id, quantity: qty() });
      beep();
      bookedToast(ctx, `${r.name} ausgebucht – noch ${r.quantity}.${r.shopping_added ? ' Steht auf der Einkaufsliste.' : ''}`, r.movement_id);
      flow.log.unshift({ item: r, type: 'out', qty: qty() });
      flow.pending = null;
      log();
      render();
      ctx.sync.loadStorage();
    } catch (e) {
      beep(false);
      ctx.toast((e as Error).message);
    }
  };
  let busy = false;
  const onCode = async (raw: string) => {
    const parsed = parseCode(raw);
    if (!parsed) {
      beep(false);
      return ctx.toast(`Kein Lager-Code: ${String(raw).slice(0, 40)}`);
    }
    if (busy) return;
    busy = true;
    try {
      const r = await api<any>('GET', `/api/resolve?code=${encodeURIComponent(parsed.key)}`);
      if (r.type === 'place') {
        flow.place = r.place;
        flow.box = null;
        flow.pending = null;
        beep();
      } else if (r.type === 'item') {
        if (flow.box && flow.box.id === r.item.id) ctx.toast(`Das ist ${r.item.name} selbst – jetzt die Gegenstände scannen, die hinein sollen.`);
        else if (flow.box || flow.place) await checkin(r.item);
        else if (flow.pending?.id === r.item.id && Date.now() - flow.pendingAt < 60000) await checkout(r.item);
        else {
          flow.pending = r.item;
          flow.pendingAt = Date.now();
          beep();
        }
      } else if (r.type === 'unknown') {
        beep();
        stopScanner();
        const p = flow.place;
        location.hash = `#/ein?code=${encodeURIComponent(r.code)}&qty=${qty()}${flow.box ? `&box=${flow.box.id}` : p ? `&wh=${p.warehouse_id}&col=${p.col}&row=${p.row}` : ''}&back=${encodeURIComponent(flow.box ? `#/scan?box=${flow.box.id}` : '#/scan')}`;
        return;
      } else {
        beep(false);
        ctx.toast(r.reason ?? 'Code nicht erkannt.');
      }
      render();
    } catch (e) {
      ctx.toast((e as Error).message);
    } finally {
      busy = false;
    }
  };
  el.querySelector<HTMLFormElement>('#manual')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = el.querySelector<HTMLInputElement>('#code')!;
    if (inp.value.trim()) onCode(inp.value);
    inp.value = '';
  });
  render();
  stopScanner();
  const cam = el.querySelector<HTMLElement>('#cam')!;
  active = new Scanner(el.querySelector('#video')!, onCode, (m, err) => {
    cam.textContent = m;
    cam.classList.toggle('form-error', err);
  });
  active.start();
};
