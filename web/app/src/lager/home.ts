// Übersicht (Startseite), „Mehr“ und persönliche Einstellungen. Die Übersicht zeigt die häufigsten Handgriffe und was
// heute zählt: Einkaufsliste, was bald abläuft, wie voll die Etagen sind und was zuletzt bewegt wurde.

import { ic, type IconName } from '../icons';
import { prefs, savePrefs, type Prefs } from '../prefs';
import { tr } from '../i18n';
import { compartments } from '../model/storage.ts';
import { api, esc, expiryTag, relDate, type ApiItem, type LagerCtx } from './core';
import type { View } from './views';
import { bindTaskRows, openTaskEditor, taskRow, upcoming, type TaskList } from './tasks';

/** Belegte und alle Fächer je Etage (aus Hausplan und Lagerinhalt) */
function floorFill(ctx: LagerCtx) {
  const h = ctx.house();
  return h.floors.map((f) => {
    let all = 0;
    let used = 0;
    for (const it of f.items) {
      const n = compartments(it, h.settings).length;
      all += n;
      for (let r = 0; r < n; r++) if (ctx.sync.fach(it.id, r)?.items.length) used++;
    }
    return { f, all, used };
  });
}

export const viewHome: View = async (el, ctx) => {
  const u = ctx.user()!;
  const hour = new Date().getHours();
  const hello = hour < 11 ? tr('Guten Morgen, {name}', { name: esc(u.name) }) : hour < 18 ? tr('Hallo, {name}', { name: esc(u.name) }) : tr('Guten Abend, {name}', { name: esc(u.name) });
  const qa = (href: string, icon: IconName, title: string, sub: string, cls = '') => `<a class="qa ${cls}" href="${href}">${ic(icon)}<b>${title}</b><small>${sub}</small></a>`;
  el.innerHTML = `<div class="ov">
    <h1>${hello}</h1>
    <div class="ov-quick">
      ${qa('#/scan', 'scan', tr('Scannen'), tr('Fach-Code, dann Gegenstand'), 'main')}
      ${qa('#/ein', 'in', tr('Einbuchen'), tr('Etwas in ein Fach legen'), 'in')}
      ${qa('#/aus', 'out', tr('Ausbuchen'), tr('Etwas herausnehmen'), 'out')}
      ${qa('#/suche', 'search', tr('Suchen'), tr('Wo liegt was?'))}
    </div>
    <div class="ov-cards">
      <section class="ov-card" id="ov-shop"><div class="ov-h">${ic('cart')}<h2>${tr('Einkaufsliste')}</h2><a href="#/einkauf">${tr('Öffnen')}</a></div><div class="ov-rows"><p class="hint">${tr('Lade …')}</p></div></section>
      <section class="ov-card" id="ov-tasks"><div class="ov-h">${ic('check')}<h2>${tr('Aufgaben')}</h2><button class="link" id="ov-task-new" title="${tr('Neue Aufgabe')}">${ic('plus')}</button><a href="#/aufgaben">${tr('Alle')}</a></div><div class="ov-rows"><p class="hint">${tr('Lade …')}</p></div></section>
      <section class="ov-card" id="ov-exp"><div class="ov-h">${ic('clock')}<h2>${tr('Läuft bald ab')}</h2><a href="#/haltbarkeit">${tr('Alle')}</a></div><div class="ov-rows"><p class="hint">${tr('Lade …')}</p></div></section>
      <section class="ov-card" id="ov-house"><div class="ov-h">${ic('layers')}<h2>${tr('Haus')}</h2><a href="#/haus">${tr('Öffnen')}</a></div><div class="ov-rows"></div></section>
      <section class="ov-card" id="ov-moves"><div class="ov-h">${ic('users')}<h2>${tr('Zuletzt bewegt')}</h2></div><div class="ov-rows"><p class="hint">${tr('Lade …')}</p></div></section>
    </div></div>`;
  const rows = (id: string) => el.querySelector<HTMLElement>(`#${id} .ov-rows`)!;

  // Einkaufsliste: offene Einträge, abhaken direkt hier
  const shop = async () => {
    const r = await api<{ open: any[] }>('GET', '/api/shopping').catch(() => ({ open: [] }));
    const box = rows('ov-shop');
    box.innerHTML = r.open.length
      ? r.open.slice(0, 6).map((e) => `<div class="ov-row"><button class="ov-tick" data-done="${e.id}" aria-label="${tr('{name} abhaken', { name: esc(e.name) })}" title="${tr('Gekauft')}"></button><span class="grow"><b>${esc(e.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</span><span class="muted">${e.quantity}×</span></div>`).join('') +
        (r.open.length > 6 ? `<a class="ov-more" href="#/einkauf">${tr('und {n} weitere', { n: r.open.length - 6 })}</a>` : '')
      : `<p class="hint">${tr('Nichts zu kaufen.')}</p>`;
    box.querySelectorAll<HTMLElement>('[data-done]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.classList.add('on');
        await api('PATCH', `/api/shopping/${b.dataset.done}`, { done: true }).catch((e) => ctx.toast((e as Error).message));
        shop();
        document.dispatchEvent(new CustomEvent('zh-shopping'));
      }),
    );
  };
  shop();

  // Aufgaben: überfällig, heute und die nächsten 7 Tage (meine zuerst); abhaken direkt hier
  const tasks = async () => {
    const list = await api<TaskList>('GET', '/api/tasks').catch(() => null);
    const box = rows('ov-tasks');
    if (!list) return void (box.innerHTML = '');
    const soon = upcoming(list, 7, u.id);
    box.innerHTML = soon.length
      ? soon.slice(0, 6).map((t) => taskRow(ctx, t, list.today, { compact: true })).join('') + (soon.length > 6 ? `<a class="ov-more" href="#/aufgaben">${tr('und {n} weitere', { n: soon.length - 6 })}</a>` : '')
      : `<p class="hint">${tr('Diese Woche ist nichts fällig.')}</p>`;
    bindTaskRows(ctx, box, list.open, tasks);
  };
  tasks();
  el.querySelector('#ov-task-new')!.addEventListener('click', () => openTaskEditor(ctx, null, tasks));

  api<ApiItem[]>('GET', '/api/expiring?days=30').then((list) => {
    rows('ov-exp').innerHTML = list.length
      ? list.slice(0, 5).map((i) => `<a class="ov-row" href="#/item/${i.id}"><span class="grow"><b>${esc(i.name)}</b><small>${i.quantity}× · <code>${esc(i.wh_code)}-${esc(i.col)}${i.row}</code></small></span>${expiryTag(i)}</a>`).join('')
      : `<p class="hint">${tr('In den nächsten 30 Tagen läuft nichts ab.')}</p>`;
  }).catch(() => (rows('ov-exp').innerHTML = ''));

  const house = () => {
    const ff = floorFill(ctx).filter((x) => x.all);
    rows('ov-house').innerHTML = ff.length
      ? ff.map(({ f, all, used }) => `<a class="ov-floor" href="#/haus?etage=${encodeURIComponent(f.id)}"><span>${esc(f.name)}</span><span class="bar"><i style="width:${Math.round((used / all) * 100)}%"></i></span><small>${tr('{used} von {all} Fächern', { used, all })}</small></a>`).join('')
      : `<p class="hint">${tr('Noch keine Fächer im Hausplan.')}</p>`;
  };
  house();
  // Lagerinhalt kommt evtl. erst nach dem ersten Zeichnen; Abmelden des Zuhörers, sobald die Seite weg ist
  const off = ctx.sync.onStorage(() => (el.isConnected ? house() : off()));

  api<any[]>('GET', '/api/movements/recent?limit=5').then((list) => {
    rows('ov-moves').innerHTML = list.length
      ? list.map((m) => `<a class="ov-row" href="#/item/${m.item_id}"><span class="tag ${m.type}">${m.type === 'in' ? tr('ein') : tr('aus')}</span><span class="grow"><b>${m.quantity}× ${esc(m.item)}</b><small>${esc(m.person)} · ${relDate(m.created_at)}</small></span><code>${esc(m.wh_code ?? '')}-${esc(m.col)}${m.row}</code></a>`).join('')
      : `<p class="hint">${tr('Noch keine Buchungen.')}</p>`;
  }).catch(() => (rows('ov-moves').innerHTML = ''));
};

export const viewMore: View = (el, ctx) => {
  const u = ctx.user()!;
  const tile = (href: string, icon: IconName, title: string, sub: string) => `<a class="ov-tile" href="${href}">${ic(icon)}<b>${title}</b><small>${sub}</small></a>`;
  el.innerHTML = `<h1>${tr('Mehr')}</h1>
    <div class="ov-tiles">
      ${tile('#/aufgaben', 'check', tr('Aufgaben'), tr('Was im Haushalt zu tun ist'))}
      ${tile('#/haltbarkeit', 'clock', tr('Haltbarkeit'), tr('Was bald abläuft'))}
      ${tile('#/assistent', 'spark', tr('Assistent'), tr('Fragen und buchen in normaler Sprache'))}
      ${tile('#/auswertung', 'chart', tr('Auswertung'), tr('Verbrauch, Heatmap im Haus'))}
      ${tile('#/etiketten', 'tag', tr('Etiketten'), tr('QR-Schilder für Fächer'))}
      ${tile('#/objekte', 'box', tr('Objektbibliothek'), tr('Möbelarten: eigene und aus der Community'))}
      ${tile('#/einstellungen', 'gear', tr('Einstellungen'), tr('Startseite, Ansicht, Darstellung'))}
      ${tile('#/hilfe', 'help', tr('Anleitung'), tr('So funktioniert homemgmt-ng'))}
      ${u.role === 'admin' ? tile('#/verwaltung', 'users', tr('Verwaltung'), tr('Personen, Rechte, Sicherungen')) : ''}
    </div>`;
};

export const viewSettings: View = (el, ctx) => {
  const u = ctx.user()!;
  const choice = <K extends keyof Prefs>(k: K, opts: [Prefs[K], string, string][]) =>
    `<div class="set-choice" data-k="${k}">${opts.map(([v, t, s]) => `<button type="button" data-v="${v}" class="${prefs()[k] === v ? 'on' : ''}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>`;
  el.innerHTML = `<a class="l-back" href="#/mehr">${ic('back')}${tr('Mehr')}</a><h1>${tr('Einstellungen')}</h1>
    <p class="hint">${tr('Gilt für {name} auf allen Geräten.', { name: esc(u.name) })}</p>
    <section class="l-card"><h2>${tr('Beim Öffnen der App zeigen')}</h2>${choice('start', [['overview', tr('Übersicht'), tr('Scannen, Einkaufsliste, was bald abläuft')], ['house', tr('Haus'), tr('Hausplan zum Ansehen und Suchen')], ['assistant', tr('Assistent'), tr('Gleich sagen oder schreiben, was zu tun ist')]])}</section>
    <section class="l-card"><h2>${tr('Haus zuerst zeigen als')}</h2>${choice('houseView', [['2d', tr('Grundriss (2D)'), tr('Übersichtlich, schnell')], ['3d', '3D', tr('Räumlich, Fächer in Farbe')]])}</section>
    <section class="l-card"><h2>${tr('Darstellung')}</h2>${choice('theme', [['auto', tr('Automatisch'), tr('Wie das Gerät')], ['light', tr('Hell'), tr('Immer hell')], ['dark', tr('Dunkel'), tr('Immer dunkel')]])}</section>
    <section class="l-card"><h2>${tr('Schriftgröße')}</h2>${choice('fontSize', [['normal', tr('Normal'), tr('Standard')], ['large', tr('Groß'), tr('Etwa 15 % größer')], ['xlarge', tr('Sehr groß'), tr('Etwa 30 % größer')]])}</section>
    <section class="l-card"><h2>${tr('Sprache')} · Language</h2>${choice('lang', [['auto', tr('Automatisch'), tr('Wie der Browser')], ['de', 'Deutsch', 'Deutsch'], ['en', 'English', 'English']])}</section>
    <section class="l-card"><h2>${tr('Rechte')}</h2><div class="set-right">${ic(u.canPlan ? 'check' : 'lock')}<span><b>${tr('Haus planen')}</b><small>${u.role === 'admin' ? tr('Als Admin darfst du immer planen.') : u.canPlan ? tr('Du darfst Wände, Möbel und Etagen ändern.') : tr('Du kannst das Haus ansehen. Planen schaltet ein Admin unter Verwaltung → Personen frei.')}</small></span></div></section>`;
  el.querySelectorAll<HTMLElement>('.set-choice').forEach((g) =>
    g.querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', async () => {
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        try {
          await savePrefs({ [g.dataset.k!]: b.dataset.v } as Partial<Prefs>);
          ctx.toast(tr('Gespeichert.'));
        } catch (e) {
          ctx.toast((e as Error).message);
          viewSettings(el, ctx, new URLSearchParams());
        }
      }),
    ),
  );
};
