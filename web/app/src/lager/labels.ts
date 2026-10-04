// Etiketten und QR-Schilder: Fächer aus dem Hausplan (Etage → Raum → Möbel), Gegenstände, leere Etiketten zum
// Vordrucken. Ausgabe über den Druckdialog oder als 3D-druckbare QR-Schilder (3MF, auf Druckplatten verteilt).
// QR-Erzeugung und 3D-Modelle kommen aus der Lager-App (/vendor/qrcode.js, /qr3d.js).

import { api, esc, placeInfo, type ApiItem, type LagerCtx } from './core';
import { compartments, itemName } from '../model/storage.ts';
import { roomOf } from '../model/house.ts';
import type { View } from './views';
import { ic } from '../icons';

declare global {
  interface Window {
    qrcode?: any;
    QR3D?: any;
  }
}

export const script = (src: string, ok: () => boolean) =>
  ok() ? Promise.resolve() : new Promise<void>((res, rej) => document.head.appendChild(Object.assign(document.createElement('script'), { src, onload: () => res(), onerror: () => rej(new Error(`${src} nicht ladbar`)) })));

export function qrSvg(text: string) {
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

type Label = { kind: 'fach' | 'item' | 'blank'; content: string; addr: string; name: string; sub: string; code?: string };
const qrUrl = (key: string) => `${location.origin}/q/${key}`;

const labelHtml = (l: Label) => `<div class="label ${l.kind}">${qrSvg(qrUrl(l.content))}<div class="txt">
  ${l.kind === 'fach' ? `<div class="addr">${esc(l.addr)}</div><div class="nm">${esc(l.name)}</div><div class="ct">${esc(l.sub)}</div>` : ''}
  ${l.kind === 'item' ? `<div class="nm">${esc(l.name)}</div><div class="ct">${esc(l.sub)}</div><div class="cd">${esc(l.code ?? '')}</div>` : ''}
  ${l.kind === 'blank' ? `<div class="line"></div><div class="line"></div><div class="cd">${esc(l.code ?? '')}</div>` : ''}
</div></div>`;

const P3D = { width: 40, margin: 3, radius: 2, base: 2, relief: 1, labelSize: 5, eyelet: false, hole: 4, colBase: '#ffffff', colCode: '#000000', plateW: 256, plateH: 256, gap: 5 };

/** QR-Schilder als 3MF (je Druckplatte eine Datei, mehrere als ZIP) */
async function download3mf(labels: Label[], o: typeof P3D, toast: (m: string) => void) {
  await script(`${import.meta.env.BASE_URL}vendor/qrcode.js`, () => !!window.qrcode);
  await script(`${import.meta.env.BASE_URL}qr3d.js`, () => !!window.QR3D);
  const Q = window.QR3D;
  const signs = labels.map((l) => ({ l, model: Q.build(qrUrl(l.content), { ...o, label: l.kind === 'fach' ? l.addr : l.code ?? l.name }) }));
  const pos = Q.arrange(signs.map((s) => Q.footprint(s.model)), { w: o.plateW, h: o.plateH, gap: o.gap, edge: 5 });
  const plates = Math.max(...pos.map((p: any) => p.plate)) + 1;
  const stamp = new Date().toISOString().slice(0, 10);
  const files: { name: string; data: Uint8Array }[] = [];
  for (let pi = 0; pi < plates; pi++) {
    const objects = signs
      .map((s, i) => ({ s, p: pos[i] }))
      .filter((x) => x.p.plate === pi)
      .map(({ s, p }) => {
        const { plate, code } = Q.meshes(s.model);
        return { name: s.l.addr || s.l.code, x: p.x, y: p.y, parts: [{ name: 'Grundplatte', mesh: plate, color: o.colBase }, { name: 'QR-Code', mesh: code, color: o.colCode }] };
      });
    const blob: Blob = await Q.threeMFMulti(objects, `Zuhause QR-Schilder – Platte ${pi + 1}`);
    files.push({ name: `qr-schilder-${stamp}-platte-${pi + 1}.3mf`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (files.length === 1) Q.download(new Blob([files[0].data as BlobPart]), files[0].name);
  else Q.download(Q.zip(files), `qr-schilder-${stamp}.zip`);
  toast(`${labels.length} Schilder auf ${plates} Druckplatte${plates > 1 ? 'n' : ''} (${o.plateW} × ${o.plateH} mm).`);
}

function fachLabels(ctx: LagerCtx, itemIds: Set<string>): Label[] {
  const h = ctx.house();
  const out: Label[] = [];
  for (const f of h.floors) {
    for (const it of f.items) {
      if (!itemIds.has(it.id)) continue;
      const room = roomOf(f, it)?.name ?? f.name;
      for (const c of compartments(it, h.settings)) {
        const pl = ctx.sync.fach(it.id, c.row);
        if (!pl) continue;
        out.push({ kind: 'fach', content: `P-${pl.wh_code}-${pl.col}${pl.row}`, addr: pl.address, name: `${itemName(it)} · ${c.label}`, sub: `${room} · ${f.name}` });
      }
    }
  }
  return out;
}

export const viewLabels: View = async (el, ctx, params) => {
  await script(`${import.meta.env.BASE_URL}vendor/qrcode.js`, () => !!window.qrcode);
  const h = ctx.house();
  const furn = h.floors.flatMap((f) => f.items.filter((it) => it.storageCol).map((it) => ({ f, it, room: roomOf(f, it)?.name ?? `${f.name} (ohne Raum)` })));
  const preset = new Set((params.get('moebel') ?? '').split(',').filter(Boolean));
  let labels: Label[] = [];
  el.innerHTML = `<div class="no-print"><a class="l-back" href="javascript:history.back()">← Zurück</a><h1>Etiketten &amp; QR-Schilder</h1>
    <div class="seg" id="tabs"><button data-t="fach" class="on">Fächer</button><button data-t="item">Gegenstände</button><button data-t="blank">Leere Etiketten</button></div>
    <div id="t-fach" class="l-card">${h.floors.filter((f) => furn.some((x) => x.f === f)).map((f) => `<details class="lab-floor" open><summary>${esc(f.name)}</summary>
      ${[...new Set(furn.filter((x) => x.f === f).map((x) => x.room))].map((room) => `<div class="lab-room"><label class="l-check"><input type="checkbox" data-room="${esc(f.id + '|' + room)}" /> <b>${esc(room)}</b></label>
        <div class="lab-items">${furn.filter((x) => x.f === f && x.room === room).map((x) => `<label class="l-check"><input type="checkbox" data-it="${x.it.id}" data-r="${esc(f.id + '|' + room)}" ${preset.has(x.it.id) ? 'checked' : ''} /> <code>${esc(x.it.storageCol!)}</code> ${esc(itemName(x.it))} <small>(${compartments(x.it, h.settings).length})</small></label>`).join('')}</div></div>`).join('')}
    </details>`).join('') || '<p class="hint">Im Hausplan gibt es noch keine Möbel mit Fächern.</p>'}
      <div class="l-actions"><button class="btn" id="allF">Alle</button><button class="btn primary" id="showF">Etiketten anzeigen</button></div></div>
    <form id="t-item" class="l-card" hidden><label>Filter (leer = alle)<input name="q" value="${esc(params.get('obj') ? '' : '')}" placeholder="Name, Platz …" /></label><button class="btn primary">Etiketten anzeigen</button></form>
    <form id="t-blank" class="l-card" hidden><label>Anzahl <input type="number" name="n" value="24" min="1" max="200" /></label><p class="hint">Vorab gedruckte Etiketten für neue Gegenstände: aufkleben, scannen, Name und Fach eingeben.</p><button class="btn primary">Etiketten erzeugen</button></form>
    <div class="l-actions"><button class="btn primary" id="print" disabled>${ic('print')}Drucken</button><button class="btn" id="p3d" disabled>${ic('cube')}3D-Schilder (3MF)</button>
      <label class="l-check"><input type="checkbox" id="small" /> kleine Etiketten</label><span class="hint" id="count"></span></div>
    <details class="l-card" id="opt3d"><summary>Einstellungen 3D-Schilder</summary><div class="lab-3d">
      <label>Breite (mm)<input type="number" name="width" value="${P3D.width}" min="20" max="120" /></label>
      <label>Plattenstärke (mm)<input type="number" name="base" value="${P3D.base}" step="0.2" min="1" max="5" /></label>
      <label>QR-Höhe (mm)<input type="number" name="relief" value="${P3D.relief}" step="0.2" min="0.4" max="3" /></label>
      <label>Druckplatte (mm)<input type="number" name="plateW" value="${P3D.plateW}" min="100" max="400" /></label>
      <label>Farbe Platte<input type="color" name="colBase" value="${P3D.colBase}" /></label><label>Farbe QR<input type="color" name="colCode" value="${P3D.colCode}" /></label>
      <label class="l-check"><input type="checkbox" name="eyelet" /> Öse zum Aufhängen</label></div></details>
  </div>
  <div class="labels" id="sheet"></div>`;
  const sheet = el.querySelector<HTMLElement>('#sheet')!;
  const show = (l: Label[]) => {
    labels = l;
    sheet.innerHTML = l.map(labelHtml).join('');
    el.querySelector<HTMLButtonElement>('#print')!.disabled = !l.length;
    el.querySelector<HTMLButtonElement>('#p3d')!.disabled = !l.length || l.some((x) => x.kind === 'blank' && false);
    el.querySelector('#count')!.textContent = l.length ? `${l.length} Etiketten` : 'Keine Etiketten.';
  };
  el.querySelectorAll<HTMLElement>('#tabs [data-t]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('#tabs [data-t]').forEach((x) => x.classList.toggle('on', x === b));
      for (const t of ['fach', 'item', 'blank']) (el.querySelector(`#t-${t}`) as HTMLElement).hidden = t !== b.dataset.t;
    }),
  );
  el.querySelectorAll<HTMLInputElement>('[data-room]').forEach((cb) =>
    cb.addEventListener('change', () => el.querySelectorAll<HTMLInputElement>(`[data-r="${CSS.escape(cb.dataset.room!)}"]`).forEach((x) => (x.checked = cb.checked))),
  );
  const chosen = () => new Set([...el.querySelectorAll<HTMLInputElement>('[data-it]:checked')].map((x) => x.dataset.it!));
  el.querySelector('#allF')?.addEventListener('click', () => el.querySelectorAll<HTMLInputElement>('[data-it],[data-room]').forEach((x) => (x.checked = true)));
  el.querySelector('#showF')?.addEventListener('click', () => show(fachLabels(ctx, chosen())));
  el.querySelector<HTMLFormElement>('#t-item')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = String(new FormData(e.target as HTMLFormElement).get('q') ?? '');
    const items = await api<ApiItem[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=1000`);
    show(items.map((i) => {
      const p = placeInfo(ctx, i);
      return { kind: 'item', content: `O-${i.code}`, addr: '', name: i.name, sub: `${p.address} · ${p.title}`, code: i.code };
    }));
  });
  el.querySelector<HTMLFormElement>('#t-blank')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Number(new FormData(e.target as HTMLFormElement).get('n')) || 24;
    const codes = await api<string[]>('GET', `/api/codes/new?n=${n}`);
    show(codes.map((c) => ({ kind: 'blank', content: `O-${c}`, addr: '', name: '', sub: '', code: c })));
  });
  el.querySelector<HTMLInputElement>('#small')!.addEventListener('change', (e) => sheet.classList.toggle('small', (e.target as HTMLInputElement).checked));
  el.querySelector('#print')!.addEventListener('click', () => window.print());
  el.querySelector('#p3d')!.addEventListener('click', async () => {
    const box = el.querySelector('#opt3d')!;
    const v = (k: string) => (box.querySelector(`[name="${k}"]`) as HTMLInputElement);
    const o = { ...P3D, width: +v('width').value, base: +v('base').value, relief: +v('relief').value, plateW: +v('plateW').value, plateH: +v('plateW').value, colBase: v('colBase').value, colCode: v('colCode').value, eyelet: v('eyelet').checked };
    try {
      await download3mf(labels, o, ctx.toast);
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  });
  // Direktaufruf: ?moebel=<ID> (aus dem Planer), ?obj=<Gegenstand>
  if (preset.size) show(fachLabels(ctx, preset));
  else if (params.get('obj')) {
    const i = await api<ApiItem>('GET', `/api/items/${params.get('obj')}`);
    const p = placeInfo(ctx, i);
    show([{ kind: 'item', content: `O-${i.code}`, addr: '', name: i.name, sub: `${p.address} · ${p.title}`, code: i.code }]);
  }
};
