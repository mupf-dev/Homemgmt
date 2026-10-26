// Lager in der App – Ansichten: Start, Suchen, Gegenstand, Einbuchen, Ausbuchen, Platz, Einkaufsliste, Haltbarkeit.
// Orte werden überall über den Hausplan beschrieben und gewählt; „Im Haus zeigen“ fährt im Planer zum Fach.

import { mountPrices } from './prices';
import { api, bindExpiry, bookedToast, esc, expiryField, expiryTag, fmtDate, itemRow, parseExpiry, pickPhoto, pickPlace, placeInfo, relDate, thumb, type ApiItem, type LagerCtx, type Target } from './core';
import { ic } from '../icons';
import { locale, tr } from '../i18n';

export type View = (el: HTMLElement, ctx: LagerCtx, params: URLSearchParams) => Promise<void> | void;

const go = (hash: string) => {
  location.hash = hash;
};

const stepper = (v = 1) =>
  `<span class="stepper"><button type="button" data-step="-1">−</button><input type="number" name="qty" value="${v}" min="1" max="9999" /><button type="button" data-step="1">+</button></span>`;
function bindStepper(root: HTMLElement, max = 9999) {
  const inp = root.querySelector<HTMLInputElement>('.stepper input')!;
  root.querySelectorAll<HTMLElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      inp.value = String(Math.max(1, Math.min(max, (Number(inp.value) || 1) + Number(b.dataset.step))));
    }),
  );
  return () => Math.max(1, Math.min(max, Number(inp.value) || 1));
}

const showBtn = (ctx: LagerCtx, x: { warehouse_id: number; col: string; row: number }) => {
  const p = placeInfo(ctx, x);
  return p.plan ? `<button class="btn" data-show="${p.plan.place.plan_item}:${p.plan.place.plan_slot}">${ic('plan')}${tr('Im Haus zeigen')}</button>` : '';
};
function bindShow(el: HTMLElement, ctx: LagerCtx) {
  el.querySelectorAll<HTMLElement>('[data-show]').forEach((b) =>
    b.addEventListener('click', () => {
      const [it, row] = b.dataset.show!.split(':');
      ctx.showInHouse(it, Number(row));
    }),
  );
}

/** Suchfeld mit Trefferliste (Gegenstände) */
function attachSearch(input: HTMLInputElement, list: HTMLElement, render: (items: ApiItem[]) => string, onReady?: (items: ApiItem[]) => void) {
  let t = 0;
  let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    const items = await api<ApiItem[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=60`).catch(() => []);
    if (my !== seq) return;
    list.innerHTML = items.length ? render(items) : `<p class="hint">${q ? tr('Nichts gefunden.') : tr('Noch nichts im Lager.')}</p>`;
    onReady?.(items);
  };
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(run, 180);
  });
  run();
}

// ---------------------------------------------------------------------------

export const viewSearch: View = (el, ctx, params) => {
  el.innerHTML = `<h1>${tr('Suchen')}</h1>
    <div class="l-searchbar"><input type="search" id="q" placeholder="${tr('Name, Code, Platz (KU-B2), Platzname …')}" value="${esc(params.get('q') ?? sessionStorage.getItem('zh.q') ?? '')}" autofocus />
    <button class="btn" id="inHouse" hidden>${ic('plan')}${tr('Treffer im Haus zeigen')}</button></div>
    <div class="l-list" id="res"></div>`;
  const input = el.querySelector<HTMLInputElement>('#q')!;
  input.addEventListener('input', () => sessionStorage.setItem('zh.q', input.value));
  const btn = el.querySelector<HTMLButtonElement>('#inHouse')!;
  let hits: ApiItem[] = [];
  attachSearch(input, el.querySelector('#res')!, (items) => items.map((i) => itemRow(ctx, i)).join(''), (items) => {
    hits = items.filter((i) => placeInfo(ctx, i).plan);
    btn.hidden = !input.value.trim() || !hits.length;
  });
  btn.addEventListener('click', () => {
    const p = placeInfo(ctx, hits[0]).plan!;
    sessionStorage.setItem('zh.highlight', JSON.stringify(hits.map((h) => placeInfo(ctx, h).plan).filter(Boolean).map((x) => `${x!.place.plan_item}:${x!.place.plan_slot}`)));
    ctx.showInHouse(p.place.plan_item, p.place.plan_slot);
  });
};

export const viewItem: View = async (el, ctx, params) => {
  const id = Number(params.get('id'));
  const it = await api<ApiItem & { history: any[]; items: ApiItem[] }>('GET', `/api/items/${id}`);
  const p = placeInfo(ctx, it);
  const me = ctx.user();
  // Rückgängig nur für die eigene letzte Buchung (am Wandterminal gibt es keine angemeldete Person)
  const lastOwn = !!me && it.history[0] && (it.history[0].person_id === me.id || me.role === 'admin');
  el.innerHTML = `
    <a class="l-back" href="javascript:history.back()">← ${tr('Zurück')}</a>
    <div class="l-item-head">
      <button class="l-photo" id="photo" title="${tr('Foto aufnehmen oder ändern')}">${it.photo_at ? `<img src="/api/items/${it.id}/photo?v=${encodeURIComponent(it.photo_at)}" alt="">` : `<span>${ic('camera')}<br>${tr('Foto')}</span>`}</button>
      <div>
        <h1>${esc(it.name)} ${it.container ? `<span class="tag">${tr('Behälter')}</span>` : ''}${it.consumable ? `<span class="tag">${tr('Verbrauch')}</span>` : ''}</h1>
        <p class="l-qty">${tr('<b>{n}</b> Stück', { n: it.quantity })} ${expiryTag(it, true)}</p>
        <p class="hint">${tr('Code')} <code>${esc(it.code)}</code>${it.description ? ` · ${esc(it.description)}` : ''}</p>
      </div>
    </div>
    <div class="l-card l-where">
      <div><small>${tr('Liegt in')}</small><b>${esc(p.title)}</b><span>${esc(p.sub)}</span>${it.parent_name ? `<span>${tr('im Behälter {box}', { box: `<a class="link" href="#/item/${it.parent_id}">${ic('box')} ${esc(it.parent_name)}</a>` })}</span>` : ''}</div>
      <code>${esc(p.address)}</code>
    </div>
    <div class="l-actions">
      <button class="btn out" id="take" ${it.quantity ? '' : 'disabled'}>${ic('out')}${tr('Entnehmen')}</button>
      <button class="btn in" id="add">${ic('in')}${tr('Einbuchen')}</button>
      <button class="btn" id="move">↔ ${tr('Umlagern')}</button>
      ${showBtn(ctx, it)}
      <a class="btn" href="#/assistent?item=${it.id}">${ic('spark')}${tr('Assistent')}</a>
      <a class="btn" href="#/etiketten?obj=${it.id}">${ic('tag')}${tr('Etikett')}</a>
      <button class="btn" id="shop">${it.on_list ? `${ic('cart')}${tr('{n} auf der Liste', { n: it.on_list })}` : `${ic('cart')}${tr('Auf Einkaufsliste')}`}</button>
      <button class="btn" id="edit">✎ ${tr('Bearbeiten')}</button>
    </div>
    ${it.container ? `<h2>${ic('box')} ${tr('Inhalt')}</h2><div class="l-actions"><button class="btn primary" id="boxPut">${tr('Gegenstand hineinlegen')}</button><a class="btn in" href="#/ein?box=${it.id}&back=${encodeURIComponent(`#/item/${it.id}`)}">${tr('Neuen Gegenstand hinein einbuchen')}</a><a class="btn" href="#/scan?box=${it.id}">📷 ${tr('Einräumen per Scan')}</a></div>
      <div class="l-list">${it.items?.length ? it.items.map((c) => itemRow(ctx, c)).join('') : `<p class="hint">${tr('Der Behälter ist leer.')}</p>`}</div>` : ''}
    <h2>${tr('Verlauf')}</h2>
    <ul class="l-history">${it.history
      .map((h, i) => `<li><span class="tag ${h.type}">${h.type === 'in' ? tr('ein') : tr('aus')}</span><span>${h.quantity}× · ${esc(h.wh_code ?? '')}-${esc(h.col)}${h.row} · <b style="color:${esc(h.person_color)}">${esc(h.person)}</b>${h.source !== 'app' ? ` <small>${h.source === 'mcp' ? tr('per MCP') : tr('per Assistent')}</small>` : ''}</span><span class="when" title="${fmtDate(h.created_at)}">${relDate(h.created_at)}</span>${i === 0 && lastOwn ? `<button class="btn mini" data-undo="${h.id}">${tr('rückgängig')}</button>` : ''}</li>`)
      .join('') || `<li class="hint">${tr('Noch keine Buchungen.')}</li>`}</ul>
    <p><button class="btn danger" id="del">${tr('Gegenstand löschen')}</button></p>`;
  const reload = () => viewItem(el, ctx, params);
  bindShow(el, ctx);
  el.querySelector('#boxPut')?.addEventListener('click', () => {
    const m = ctx.modal(tr('In {name} legen', { name: it.name }), `<input type="search" class="fach-search" placeholder="${tr('Gegenstand suchen …')}" autofocus /><div class="l-list" id="boxRes"></div>`);
    const inp = m.el.querySelector<HTMLInputElement>('input')!;
    const res = m.el.querySelector<HTMLElement>('#boxRes')!;
    attachSearch(inp, res, (items) => items.filter((i) => i.id !== it.id && i.parent_id !== it.id).map((i) => `<button class="l-item" data-put="${i.id}">${thumb(i)}<span class="l-main"><b>${esc(i.name)}</b><small>${esc(placeInfo(ctx, i).address)}</small></span></button>`).join(''), (items) => {
      res.querySelectorAll<HTMLElement>('[data-put]').forEach((b) => b.addEventListener('click', async () => {
        const i = items.find((x) => x.id === Number(b.dataset.put))!;
        try {
          await api('PATCH', `/api/items/${i.id}`, { container_id: it.id });
          ctx.toast(tr('{name} liegt jetzt in {where}.', { name: i.name, where: it.name }));
          m.close();
          await ctx.sync.loadStorage();
          reload();
        } catch (e) {
          ctx.toast((e as Error).message);
        }
      }));
    });
  });
  el.querySelector('#photo')!.addEventListener('click', async () => {
    const ph = await pickPhoto();
    if (!ph) return;
    await api('PUT', `/api/items/${it.id}/photo`, { image: ph.image, thumb: ph.thumb }).catch((e) => ctx.toast(e.message));
    reload();
  });
  const qtyDialog = (title: string, max: number, ok: string, run: (q: number) => Promise<void>) => {
    const m = ctx.modal(title, `<div class="l-form">${stepper(1)}</div>`, `<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${ok}</button>`);
    m.el.querySelector('.modal')!.classList.add('narrow');
    const get = bindStepper(m.el, max);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      m.close();
      await run(get());
    });
  };
  el.querySelector('#take')!.addEventListener('click', () =>
    qtyDialog(tr('{name} entnehmen', { name: it.name }), it.quantity, tr('Entnehmen'), async (q) => {
      try {
        const r = await api<ApiItem>('POST', '/api/checkout', { item_id: it.id, quantity: q });
        bookedToast(ctx, `${tr('{q}× {name} entnommen – noch {n}.', { q, name: it.name, n: r.quantity })}${r.shopping_added ? ` ${tr('Steht auf der Einkaufsliste.')}` : ''}`, r.movement_id, reload);
        await ctx.sync.loadStorage();
        reload();
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    }),
  );
  el.querySelector('#add')!.addEventListener('click', () =>
    qtyDialog(tr('{name} einbuchen', { name: it.name }), 9999, tr('Einbuchen'), async (q) => {
      try {
        const r = await api<ApiItem>('POST', '/api/checkin', { item_id: it.id, quantity: q, warehouse_id: it.warehouse_id, col: it.col, row: it.row, ...(it.parent_id ? { container_id: it.parent_id } : {}) });
        bookedToast(ctx, tr('{q}× {name} eingebucht – jetzt {n}.', { q, name: it.name, n: r.quantity }), r.movement_id, reload);
        await ctx.sync.loadStorage();
        reload();
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    }),
  );
  el.querySelector('#move')!.addEventListener('click', async () => {
    const t = await pickPlace(ctx, tr('{name} umlagern – wohin?', { name: it.name }), it);
    if (!t) return;
    try {
      await api('PATCH', `/api/items/${it.id}`, { warehouse_id: t.warehouse_id, col: t.col, row: t.row, container_id: null });
      ctx.toast(tr('{name} liegt jetzt in {where}.', { name: it.name, where: `${t.address} (${t.label})` }));
      await ctx.sync.loadStorage();
      reload();
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  });
  el.querySelector('#shop')!.addEventListener('click', async () => {
    try {
      await api('POST', '/api/shopping', { item_id: it.id, quantity: 1 });
      ctx.toast(tr('{name} steht auf der Einkaufsliste.', { name: it.name }));
      reload();
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  });
  el.querySelector('#edit')!.addEventListener('click', () => {
    const m = ctx.modal(tr('{name} bearbeiten', { name: it.name }), `<form class="l-form">
      <label>${tr('Bezeichnung')}<input name="name" value="${esc(it.name)}" required maxlength="100" /></label>
      <label>${tr('Beschreibung')}<input name="description" value="${esc(it.description)}" maxlength="200" /></label>
      <label>${tr('Haltbar bis')}${expiryField('expires_on', it.expires_on ?? '')}</label>
      <label class="l-check"><input type="checkbox" name="consumable" ${it.consumable ? 'checked' : ''} /> ${tr('Verbrauchsmaterial (beim Entnehmen auf die Einkaufsliste)')}</label>
      <label class="l-check"><input type="checkbox" name="container" ${it.container ? 'checked' : ''} /> ${tr('Behälter (Tasche, Box – andere Dinge liegen darin)')}</label>
    </form>`, `<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${tr('Speichern')}</button>`);
    bindExpiry(m.el);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      try {
        await api('PATCH', `/api/items/${it.id}`, { name: fd.get('name'), description: fd.get('description'), expires_on: parseExpiry(fd.get('expires_on')), consumable: !!fd.get('consumable'), container: !!fd.get('container') });
        m.close();
        reload();
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    });
  });
  el.querySelectorAll<HTMLElement>('[data-undo]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('POST', `/api/movements/${b.dataset.undo}/undo`);
        ctx.toast(tr('Buchung zurückgenommen.'));
        await ctx.sync.loadStorage();
        if (await api('GET', `/api/items/${it.id}`).then(() => true).catch(() => false)) reload();
        else go('#/suche');
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    }),
  );
  el.querySelector('#del')!.addEventListener('click', async () => {
    if (!confirm(tr('„{name}“ mit Verlauf endgültig löschen?', { name: it.name }))) return;
    try {
      await api('DELETE', `/api/items/${it.id}`);
      await ctx.sync.loadStorage();
      ctx.toast(tr('{name} gelöscht.', { name: it.name }));
      history.back();
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  });
};

/** Einbuchen: vorhandenen Gegenstand suchen oder neu anlegen, Fach im Haus wählen */
export const viewCheckin: View = async (el, ctx, params) => {
  let target: Target | null = null;
  let box: ApiItem | null = params.get('box') ? await api<ApiItem>('GET', `/api/items/${params.get('box')}`).catch(() => null) : null;
  let existing: ApiItem | null = null;
  const presetPlace = params.get('wh') ? { warehouse_id: Number(params.get('wh')), col: params.get('col')!, row: Number(params.get('row')) } : null;
  el.innerHTML = `<a class="l-back" href="javascript:history.back()">← ${tr('Zurück')}</a><h1>${tr('Einbuchen')}</h1>
    <form class="l-form" id="f">
      <label>${tr('Was?')}<input name="name" id="name" placeholder="${tr('Name eingeben – vorhandene Gegenstände werden vorgeschlagen')}" autocomplete="off" required maxlength="100" value="${esc(params.get('name') ?? '')}" /></label>
      <div class="l-suggest" id="sug"></div>
      <div id="picked"></div>
      <label>${tr('Wohin?')}</label>
      <button type="button" class="btn l-target" id="where">${ic('plan')}${tr('Fach im Haus wählen …')}</button>
      <button type="button" class="btn" id="inBox">${ic('box')}${tr('Oder in einen Behälter …')}</button>
      <label>${tr('Menge')} ${stepper(Number(params.get('qty')) || 1)}</label>
      <details id="more"><summary>${tr('Mehr: Haltbarkeit, Verbrauch, Code')}</summary>
        <label>${tr('Haltbar bis')}${expiryField()}</label>
        <label class="l-check"><input type="checkbox" name="consumable" /> ${tr('Verbrauchsmaterial')}</label>
        <label>${tr('Etikett-Code (vorgedruckt)')}<input name="code" value="${esc(params.get('code') ?? '')}" placeholder="${tr('optional, z. B. O-K7M2XQ')}" /></label>
      </details>
      <button class="btn primary big" type="submit">${tr('Einbuchen')}</button>
    </form>`;
  const getQty = bindStepper(el);
  bindExpiry(el);
  const whereBtn = el.querySelector<HTMLButtonElement>('#where')!;
  const setTarget = (t: Target | null) => {
    target = t;
    if (t) box = null;
    whereBtn.innerHTML = box ? `${ic('box')} ${tr('in {name}', { name: `<b>${esc(box.name)}</b>` })} <small>(${esc(placeInfo(ctx, box).address)}) ${tr('ändern')}</small>` : t ? `<code>${esc(t.address)}</code> ${esc(t.label)} <small>${tr('ändern')}</small>` : `${ic('plan')} ${tr('Fach im Haus wählen …')}`;
    whereBtn.classList.toggle('set', !!t || !!box);
  };
  if (box) setTarget(null);
  el.querySelector('#inBox')!.addEventListener('click', async () => {
    const boxes = await api<ApiItem[]>('GET', '/api/containers');
    if (!boxes.length) return ctx.toast(tr('Es gibt noch keine Behälter (Gegenstand bearbeiten → „Behälter“).'));
    const m = ctx.modal(tr('In welchen Behälter?'), `<div class="l-list">${boxes.map((b) => `<button class="l-item" data-b="${b.id}">${thumb(b)}<span class="l-main"><b>${ic('box')} ${esc(b.name)}</b><small>${esc(placeInfo(ctx, b).title)} · ${esc(placeInfo(ctx, b).address)}</small></span></button>`).join('')}</div>`);
    m.el.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      box = boxes.find((x) => x.id === Number(b.dataset.b))!;
      target = null;
      setTarget(null);
      m.close();
    }));
  });
  if (presetPlace) {
    const info = placeInfo(ctx, presetPlace);
    setTarget({ ...presetPlace, address: info.address, label: `${info.title} · ${info.plan?.fach ?? ''}` });
  }
  whereBtn.addEventListener('click', async () => {
    const t = await pickPlace(ctx, tr('Wohin einbuchen?'), target ?? undefined);
    if (t) setTarget(t);
  });
  const name = el.querySelector<HTMLInputElement>('#name')!;
  const sug = el.querySelector<HTMLElement>('#sug')!;
  const picked = el.querySelector<HTMLElement>('#picked')!;
  let t = 0;
  name.addEventListener('input', () => {
    existing = null;
    picked.innerHTML = '';
    clearTimeout(t);
    t = window.setTimeout(async () => {
      const q = name.value.trim();
      if (q.length < 2) return (sug.innerHTML = '');
      const items = await api<ApiItem[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=6`).catch(() => []);
      sug.innerHTML = items.map((i) => `<button type="button" data-id="${i.id}">${thumb(i)}<span><b>${esc(i.name)}</b><small>${i.quantity}× · ${esc(placeInfo(ctx, i).address)}</small></span></button>`).join('');
      sug.querySelectorAll<HTMLElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          existing = items.find((i) => i.id === Number(b.dataset.id))!;
          name.value = existing.name;
          sug.innerHTML = '';
          const info = placeInfo(ctx, existing);
          picked.innerHTML = `<p class="hint">${tr('Vorhandener Gegenstand – Zugang wird gebucht. Liegt bisher in <b>{address}</b> ({title}).', { address: esc(info.address), title: esc(info.title) })}</p>`;
          if (!target) setTarget({ warehouse_id: existing.warehouse_id, col: existing.col, row: existing.row, address: info.address, label: `${info.title} · ${info.plan?.fach ?? ''}` });
        }),
      );
    }, 180);
  });
  el.querySelector<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!target && !box) return ctx.toast(tr('Bitte ein Fach oder einen Behälter wählen.'));
    const fd = new FormData(e.target as HTMLFormElement);
    const q = getQty();
    try {
      const r = await api<ApiItem>('POST', '/api/checkin', {
        ...(existing ? { item_id: existing.id } : { name: name.value.trim(), consumable: !!fd.get('consumable'), ...(fd.get('code') ? { code: String(fd.get('code')).replace(/^O-/i, '') } : {}) }),
        ...(box ? { container_id: box.id } : { warehouse_id: target!.warehouse_id, col: target!.col, row: target!.row, container_id: null }), quantity: q,
        ...(fd.get('expires_on') ? { expires_on: parseExpiry(fd.get('expires_on')) } : {}),
      });
      await ctx.sync.loadStorage();
      bookedToast(ctx, tr('{q}× {name} liegt jetzt in {where}.', { q, name: r.name, where: box ? box.name : target!.address }), r.movement_id);
      const back = params.get('back');
      if (back) go(back);
      else go(`#/item/${r.id}`);
    } catch (ex) {
      ctx.toast((ex as Error).message);
    }
  });
};

export const viewCheckout: View = (el, ctx) => {
  el.innerHTML = `<a class="l-back" href="javascript:history.back()">← ${tr('Zurück')}</a><h1>${tr('Ausbuchen')}</h1>
    <div class="l-searchbar"><input type="search" id="q" placeholder="${tr('Was nimmst du heraus?')}" autofocus /></div>
    <div class="l-list" id="res"></div>`;
  const list = el.querySelector<HTMLElement>('#res')!;
  attachSearch(el.querySelector('#q')!, list, (items) =>
    items.filter((i) => i.quantity > 0).map((i) => {
      const p = placeInfo(ctx, i);
      return `<div class="l-item">${thumb(i)}<span class="l-main"><b>${esc(i.name)}</b><small>${esc(p.title)} · ${esc(p.plan?.fach ?? '')}</small></span>
        <span class="l-side"><b>${i.quantity}×</b><code>${esc(p.address)}</code></span><button class="btn out" data-out="${i.id}">−1</button></div>`;
    }).join(''), (items) => {
    list.querySelectorAll<HTMLElement>('[data-out]').forEach((b) =>
      b.addEventListener('click', async () => {
        const i = items.find((x) => x.id === Number(b.dataset.out))!;
        try {
          const r = await api<ApiItem>('POST', '/api/checkout', { item_id: i.id, quantity: 1 });
          i.quantity = r.quantity;
          bookedToast(ctx, `${tr('{q}× {name} entnommen – noch {n}.', { q: 1, name: i.name, n: r.quantity })}${r.shopping_added ? ` ${tr('Steht auf der Einkaufsliste.')}` : ''}`, r.movement_id);
          await ctx.sync.loadStorage();
          el.querySelector<HTMLInputElement>('#q')!.dispatchEvent(new Event('input'));
        } catch (e) {
          ctx.toast((e as Error).message);
        }
      }),
    );
  });
};

/** Platz (Fach) mit Inhalt – Ziel von QR-Codes P-… und Links aus der Suche */
export const viewPlace: View = async (el, ctx, params) => {
  const wid = Number(params.get('wh'));
  const m = String(params.get('p') ?? '').match(/^([A-Z]{1,3})(\d{1,2})$/i);
  if (!m) return void (el.innerHTML = `<p>${tr('Ungültige Platzadresse.')}</p>`);
  const pl = await api<any>('GET', `/api/places/${m[1].toUpperCase()}/${m[2]}?wh=${wid}`);
  const p = placeInfo(ctx, pl);
  el.innerHTML = `<a class="l-back" href="javascript:history.back()">← ${tr('Zurück')}</a>
    <h1>${esc(p.title)}</h1><p class="hint">${esc(p.sub)} · <code>${esc(p.address)}</code></p>
    <div class="l-actions"><a class="btn in" href="#/ein?wh=${wid}&col=${pl.col}&row=${pl.row}&back=${encodeURIComponent(location.hash)}">${ic('in')}${tr('Hier einbuchen')}</a>${showBtn(ctx, pl)}</div>
    <div class="l-list">${(pl.items as ApiItem[]).map((i) => itemRow(ctx, i)).join('') || `<p class="hint">${tr('Hier liegt nichts.')}</p>`}</div>`;
  bindShow(el, ctx);
};

export const viewShopping: View = async (el, ctx, params) => {
  const r = await api<{ open: any[]; done: any[] }>('GET', '/api/shopping');
  const text = () => [`🛒 ${tr('Einkaufsliste – {date}', { date: new Date().toLocaleDateString(locale()) })}`, '', ...r.open.map((e) => `• ${e.quantity}× ${e.name}${e.note ? ` (${e.note})` : ''}`)].join('\n');
  el.innerHTML = `<a class="l-back" href="#/lager">${ic('back')}${tr('Übersicht')}</a><h1>${tr('Einkaufsliste')}</h1>
    <form class="l-add" id="add"><input name="name" placeholder="${tr('Was fehlt? (z. B. Milch)')}" required maxlength="100" /><input name="qty" type="number" value="1" min="1" /><button class="btn primary">${tr('Hinzufügen')}</button></form>
    <div class="l-card price-card" id="price-card" hidden></div>
    <div class="l-list">${r.open.map((e) => `<div class="l-shop" data-id="${e.id}">
      <button class="l-tick" data-done title="${tr('Gekauft')}">○</button>
      <span class="l-main"><b>${esc(e.name)}</b><small>${e.note ? esc(e.note) + ' · ' : ''}${e.item_id ? tr('liegt sonst in {address}', { address: `<code>${esc(e.wh_code ?? '')}-${esc(e.col ?? '')}${e.row ?? ''}</code>` }) : tr('noch kein Gegenstand')}</small><div class="price" data-price="${e.id}"></div></span>
      <span class="stepper small"><button data-q="-1">−</button><b>${e.quantity}</b><button data-q="1">+</button></span>
      <button class="btn in mini" data-restock title="${e.item_id ? tr('Gekauft und wieder an den bisherigen Platz') : tr('Gekauft und in ein Fach einlagern')}">${ic('in')}${e.item_id ? tr('einbuchen') : tr('einlagern')}</button>
      <button class="btn mini" data-del title="${tr('Entfernen')}">✕</button>
    </div>`).join('') || `<p class="hint">${tr('Die Liste ist leer.')}</p>`}</div>
    ${r.open.length ? `<div class="l-actions"><a class="btn" href="https://wa.me/?text=${encodeURIComponent(text())}" target="_blank" rel="noopener">WhatsApp</a><button class="btn" id="copy">${tr('Kopieren')}</button>${'share' in navigator ? `<button class="btn" id="share">${tr('Teilen …')}</button>` : ''}</div>` : ''}
    ${r.done.length ? `<h2>${tr('Zuletzt gekauft')}</h2><div class="l-list">${r.done.map((e) => `<div class="l-shop done" data-id="${e.id}"><button class="l-tick" data-undone title="${tr('Zurück auf die Liste')}">✓</button><span class="l-main"><b>${esc(e.name)}</b></span><span>${e.quantity}×</span></div>`).join('')}</div>` : ''}`;
  const reload = () => viewShopping(el, ctx, params);
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) ctx.toast(msg);
      reload();
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  };
  el.querySelector<HTMLFormElement>('#add')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    act(() => api('POST', '/api/shopping', { name: fd.get('name'), quantity: Number(fd.get('qty')) || 1 }));
  });
  el.querySelectorAll<HTMLElement>('.l-shop').forEach((row) => {
    const id = Number(row.dataset.id);
    const e = r.open.find((x) => x.id === id) ?? r.done.find((x) => x.id === id);
    row.querySelector('[data-done]')?.addEventListener('click', () => act(() => api('PATCH', `/api/shopping/${id}`, { done: true }), tr('{name} abgehakt.', { name: e.name })));
    row.querySelector('[data-undone]')?.addEventListener('click', () => act(() => api('PATCH', `/api/shopping/${id}`, { done: false })));
    row.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.addEventListener('click', () => act(() => api('PATCH', `/api/shopping/${id}`, { quantity: Math.max(1, e.quantity + Number(b.dataset.q)) }))));
    row.querySelector('[data-del]')?.addEventListener('click', () => act(() => api('DELETE', `/api/shopping/${id}`)));
    row.querySelector('[data-restock]')?.addEventListener('click', async () => {
      let body: Record<string, unknown> = {};
      if (!e.item_id) {
        const t = await pickPlace(ctx, tr('{name} einlagern – wohin?', { name: e.name }));
        if (!t) return;
        body = { warehouse_id: t.warehouse_id, col: t.col, row: t.row };
      }
      act(async () => {
        const res = await api<any>('POST', `/api/shopping/${id}/restock`, body);
        await ctx.sync.loadStorage();
        bookedToast(ctx, tr('{name} eingebucht.', { name: e.name }), res.movement_id);
      });
    });
  });
  el.querySelector('#copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text());
      ctx.toast(tr('Liste kopiert.'));
    } catch {
      ctx.toast(tr('Kopieren geht nur über HTTPS.'));
    }
  });
  el.querySelector('#share')?.addEventListener('click', () => navigator.share({ text: text() }).catch(() => {}));
  mountPrices(el, ctx, r.open);
};

export const viewExpiry: View = async (el, ctx, params) => {
  const days = Number(params.get('tage') ?? 30);
  const list = await api<ApiItem[]>('GET', `/api/expiring?days=${days}`);
  el.innerHTML = `<a class="l-back" href="#/lager">${ic('back')}${tr('Übersicht')}</a><h1>${tr('Haltbarkeit')}</h1>
    <div class="seg">${[[7, tr('7 Tage')], [30, tr('30 Tage')], [90, tr('3 Monate')], [365, tr('1 Jahr')]].map(([d, l]) => `<a href="#/haltbarkeit?tage=${d}" class="${d === days ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${list.length ? `<div class="l-list">${list.map((i) => itemRow(ctx, i)).join('')}</div>
      <div class="l-actions"><button class="btn" id="inHouse">${ic('plan')}${tr('Alle im Haus zeigen')}</button></div>` : `<p class="hint">${tr('Nichts läuft in diesem Zeitraum ab.')}</p>`}`;
  el.querySelector('#inHouse')?.addEventListener('click', () => {
    const plans = list.map((i) => placeInfo(ctx, i).plan).filter(Boolean);
    if (!plans.length) return ctx.toast(tr('Keiner der Gegenstände liegt in einem Fach des Hausplans.'));
    sessionStorage.setItem('zh.highlight', JSON.stringify(plans.map((p) => `${p!.place.plan_item}:${p!.place.plan_slot}`)));
    ctx.showInHouse(plans[0]!.place.plan_item, plans[0]!.place.plan_slot);
  });
};

/** Auswertung: Kennzahlen, meistgenutzt, wer bucht, lange nicht angefasst – mit Heatmaps im Haus */
export const viewStats: View = async (el, ctx, params) => {
  const stale = Number(params.get('tage') ?? 365);
  const s = await api<any>('GET', `/api/stats?stale_days=${stale}`);
  const t = s.totals;
  const tile = (n: number, l: string, href = '') => `<${href ? `a href="${href}"` : 'div'} class="l-kpi"><b>${n}</b><small>${l}</small></${href ? 'a' : 'div'}>`;
  const rows = (list: any[], extra: (x: any) => string) => list.map((x) => {
    const p = placeInfo(ctx, { warehouse_id: x.warehouse_id ?? 0, col: x.col, row: x.row, wh_code: x.wh_code });
    return `<a class="l-item" href="#/item/${x.id}"><span class="l-main"><b>${esc(x.name)}</b><small>${esc(p.title)} · ${esc(p.plan?.fach ?? '')}</small></span><span class="l-side">${extra(x)}<code>${esc(x.wh_code)}-${esc(x.col)}${x.row}</code></span></a>`;
  }).join('');
  el.innerHTML = `<a class="l-back" href="#/lager">${ic('back')}${tr('Übersicht')}</a><h1>${tr('Auswertung')}</h1>
    <div class="l-kpis">${tile(t.items, tr('Gegenstände'))}${tile(t.quantity, tr('Stück'))}${tile(t.places - t.empty_places, tr('von {n} Plätzen belegt', { n: t.places }))}${tile(t.movements_30d, tr('Buchungen (30 Tage)'))}${tile(t.on_list, tr('auf der Einkaufsliste'), '#/einkauf')}${tile(t.expired + t.expiring, tr('abgelaufen / läuft ab'), '#/haltbarkeit')}</div>
    <div class="l-actions"><a class="btn" href="#/haus?heat=">${ic('plan')}${tr('Füllstand im Haus')}</a><a class="btn" href="#/haus?heat=moves">${ic('plan')}${tr('Bewegung im Haus')}</a><a class="btn" href="#/haus?heat=stale">${ic('plan')}${tr('Lange unberührt im Haus')}</a></div>
    <h2>${tr('Am häufigsten genutzt (90 Tage)')}</h2><div class="l-list">${rows(s.top_used ?? s.topUsed ?? [], (x) => `<b>${x.uses}×</b>`) || `<p class="hint">${tr('Keine Buchungen.')}</p>`}</div>
    <h2>${tr('Wer bucht (30 Tage)')}</h2><div class="l-list">${(s.by_person ?? s.byPerson ?? []).map((p: any) => `<div class="l-item"><span class="l-main"><b style="color:${esc(p.color)}">${esc(p.name)}</b><small>${tr('{ins} ein · {outs} aus', { ins: p.ins, outs: p.outs })}</small></span><span class="l-side"><b>${p.n}</b></span></div>`).join('') || `<p class="hint">${tr('Keine Buchungen.')}</p>`}</div>
    <h2>${tr('Lange nicht angefasst')}</h2>
    <div class="seg">${[[180, tr('6 Monate')], [365, tr('1 Jahr')], [730, tr('2 Jahre')]].map(([d, l]) => `<a href="#/auswertung?tage=${d}" class="${d === stale ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="l-list">${rows(s.stale ?? [], (x) => `<small>${relDate(x.touched_at)}</small>`) || `<p class="hint">${tr('Alles wird genutzt.')}</p>`}</div>
    <h2>${tr('Ausverkauft')}</h2><div class="l-list">${(s.out_of_stock ?? s.outOfStock ?? []).map((i: ApiItem) => itemRow(ctx, i)).join('') || `<p class="hint">${tr('Nichts ausverkauft.')}</p>`}</div>`;
};

/** QR-Link /q/<Code>: Platz → Platzansicht, Gegenstand → Gegenstand, unbekannt → neu anlegen */
export const viewQuick: View = async (el, ctx, params) => {
  const code = params.get('code') ?? '';
  const r = await api<any>('GET', `/api/resolve?code=${encodeURIComponent(code)}`);
  if (r.type === 'place') return go(`#/platz?wh=${r.place.warehouse_id}&p=${r.place.col}${r.place.row}`);
  if (r.type === 'item') return go(`#/item/${r.item.id}`);
  if (r.type === 'unknown') return go(`#/ein?code=${encodeURIComponent(r.code)}`);
  el.innerHTML = `<p>${esc(r.reason ?? tr('Code nicht erkannt.'))}</p>`;
  void ctx;
};
