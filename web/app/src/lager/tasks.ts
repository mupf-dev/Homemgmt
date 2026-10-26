// Aufgaben des Haushalts (#/aufgaben): einmalig oder wiederkehrend, einer Person zugeordnet, optional an einem Fach
// („Filter Dunstabzug tauschen“). Abhaken geht überall – in der Liste, auf der Übersicht und am Wandterminal (dort mit
// „Wer bucht?“). Anlegen, Ändern und Löschen ebenso – am Wandterminal ebenfalls mit „Wer bucht?“.

import { ic } from '../icons';
import { terminal } from '../terminal';
import { api, esc, pickPlace, placeInfo, type LagerCtx } from './core';
import type { View } from './views';
import { locale, tr } from '../i18n';

export interface Task {
  id: number;
  title: string;
  note: string;
  assignee_id: number | null;
  assignee: string | null;
  assignee_color: string | null;
  due_on: string | null;
  repeat_unit: 'day' | 'week' | 'month' | 'year' | null;
  repeat_every: number;
  repeat_from_done: number;
  warehouse_id: number | null;
  col: string | null;
  row: number | null;
  wh_code: string | null;
  wh_name: string | null;
  place_name: string | null;
  overdue?: boolean;
  due_today?: boolean;
}
export type TaskList = { today: string; open: Task[]; done: { log_id: number; id: number; title: string; done_at: string; done_by_name: string | null; repeat_unit: string | null }[] };

const UNIT: Record<string, [string, string]> = { day: [tr('Tag'), tr('Tage')], week: [tr('Woche'), tr('Wochen')], month: [tr('Monat'), tr('Monate')], year: [tr('Jahr'), tr('Jahre')] };
const SIMPLE: Record<string, string> = { day: tr('täglich'), week: tr('wöchentlich'), month: tr('monatlich'), year: tr('jährlich') };
/** „alle 3 Monate“ – je Einheit ein ganzer Satzteil (Wortstellung im Englischen) */
const EVERY: Record<string, (n: number) => string> = {
  day: (n) => tr('alle {n} Tage', { n }),
  week: (n) => tr('alle {n} Wochen', { n }),
  month: (n) => tr('alle {n} Monate', { n }),
  year: (n) => tr('alle {n} Jahre', { n }),
};
/** „wöchentlich“, „alle 3 Monate“ */
export function repeatText(t: Pick<Task, 'repeat_unit' | 'repeat_every' | 'repeat_from_done'>) {
  if (!t.repeat_unit) return '';
  const base = t.repeat_every === 1 ? SIMPLE[t.repeat_unit] : EVERY[t.repeat_unit](t.repeat_every);
  return t.repeat_from_done ? tr('{repeat} ab Erledigung', { repeat: base }) : base;
}
const DAY = 86400000;
const dateOf = (iso: string) => new Date(`${iso}T12:00:00`);
/** „überfällig seit 3 Tagen“, „heute“, „morgen“, „Fr, 9. Okt.“ */
export function dueText(t: Task, today: string) {
  if (!t.due_on) return '';
  const d = Math.round((dateOf(t.due_on).getTime() - dateOf(today).getTime()) / DAY);
  if (d < 0) return d === -1 ? tr('seit gestern fällig') : tr('seit {n} Tagen fällig', { n: -d });
  if (d === 0) return tr('heute');
  if (d === 1) return tr('morgen');
  if (d < 7) return dateOf(t.due_on).toLocaleDateString(locale(), { weekday: 'long' });
  return dateOf(t.due_on).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', ...(d > 300 ? { year: 'numeric' } : {}) });
}
const avatar = (name: string, color: string | null) => `<span class="avatar mini" style="background:${esc(color ?? '#888')}" title="${esc(name)}">${esc(name.slice(0, 1).toUpperCase())}</span>`;

/** Zeile einer Aufgabe (Liste, Übersicht, Terminal) */
export function taskRow(ctx: LagerCtx, t: Task, today: string, opts: { edit?: boolean; compact?: boolean } = {}) {
  const place = t.warehouse_id != null && t.col ? placeInfo(ctx, { warehouse_id: t.warehouse_id, col: t.col, row: t.row ?? 0, wh_code: t.wh_code ?? undefined, wh_name: t.wh_name ?? undefined, place_name: t.place_name }) : null;
  const meta = [
    t.due_on ? `<span class="${t.overdue ? 'tk-late' : t.due_today ? 'tk-today' : ''}">${esc(dueText(t, today))}</span>` : '',
    t.repeat_unit ? `<span>${ic('clock')}${esc(repeatText(t))}</span>` : '',
    place ? `<span>${place.plan ? `<button class="link tk-place" data-show="${esc(place.plan.item.id)}:${place.plan.place.plan_slot}" title="${tr('Im Haus zeigen')}">` : ''}<code>${esc(place.address)}</code>${opts.compact ? '' : ` ${esc(place.plan?.fach || place.title)}`}${place.plan ? '</button>' : ''}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="tk-row ${t.overdue ? 'late' : ''}" data-task="${t.id}">
    <button class="ov-tick" data-tick="${t.id}" aria-label="${tr('{title} erledigt', { title: esc(t.title) })}" title="${tr('Erledigt')}"></button>
    <span class="grow"><b>${esc(t.title)}</b>${meta ? `<small class="tk-meta">${meta}</small>` : ''}${t.note && !opts.compact ? `<small class="tk-note">${esc(t.note)}</small>` : ''}</span>
    ${t.assignee ? avatar(t.assignee, t.assignee_color) : ''}
    ${opts.edit ? `<button class="btn mini" data-edit="${t.id}" aria-label="${tr('Bearbeiten')}">${ic('pencil')}</button>` : ''}
  </div>`;
}

/** Abhaken und „Im Haus zeigen“ in einem Bereich verdrahten */
export function bindTaskRows(ctx: LagerCtx, root: HTMLElement, tasks: Task[], after: () => void) {
  root.querySelectorAll<HTMLElement>('[data-tick]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.tick))!;
      b.classList.add('on');
      try {
        const r = await api<{ task: Task }>('POST', `/api/tasks/${t.id}/done`, {});
        ctx.toast(t.repeat_unit ? tr('„{title}“ erledigt – wieder fällig: {due}', { title: t.title, due: dueText(r.task, todayIso()) }) : tr('„{title}“ erledigt.', { title: t.title }), {
          label: tr('Rückgängig'),
          run: async () => {
            await api('POST', `/api/tasks/${t.id}/undo`, {}).catch((e) => ctx.toast((e as Error).message));
            after();
            document.dispatchEvent(new CustomEvent('zh-tasks'));
          },
        });
        after();
        document.dispatchEvent(new CustomEvent('zh-tasks'));
      } catch (e) {
        b.classList.remove('on');
        ctx.toast((e as Error).message);
      }
    }),
  );
  root.querySelectorAll<HTMLElement>('[data-show]').forEach((b) =>
    b.addEventListener('click', () => {
      const [item, row] = b.dataset.show!.split(':');
      ctx.showInHouse(item, Number(row));
    }),
  );
}
const todayIso = () => new Date().toLocaleDateString('sv-SE');

/** offene Aufgaben, die jetzt zählen: überfällig, heute, in den nächsten Tagen (meine zuerst) */
export function upcoming(list: TaskList, days: number, me?: number) {
  const until = new Date(dateOf(list.today).getTime() + days * DAY).toLocaleDateString('sv-SE');
  return list.open
    .filter((t) => !t.due_on || t.due_on <= until)
    .sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || Number(b.assignee_id === me) - Number(a.assignee_id === me));
}

export const viewTasks: View = async (el, ctx, params) => {
  const me = ctx.user()?.id;
  const filter = params.get('f') ?? 'alle';
  const list = await api<TaskList>('GET', '/api/tasks');
  const open = list.open.filter((t) => filter !== 'meine' || t.assignee_id === me || !t.assignee_id);
  const until = (d: number) => new Date(dateOf(list.today).getTime() + d * DAY).toLocaleDateString('sv-SE');
  const groups: [string, Task[]][] = [
    [tr('Überfällig'), open.filter((t) => t.overdue)],
    [tr('Heute'), open.filter((t) => t.due_today)],
    [tr('Nächste 7 Tage'), open.filter((t) => t.due_on && t.due_on > list.today && t.due_on <= until(7))],
    [tr('Später'), open.filter((t) => t.due_on && t.due_on > until(7))],
    [tr('Ohne Termin'), open.filter((t) => !t.due_on)],
  ];
  const canEdit = true; // auch am Wandterminal (mit „Wer bucht?“)
  el.innerHTML = `<a class="l-back" href="#/${terminal() ? 'haus' : 'lager'}">${ic('back')}${terminal() ? tr('Haus') : tr('Übersicht')}</a>
    <div class="ob-head"><h1>${tr('Aufgaben')}</h1><span class="spacer"></span>${canEdit ? `<button class="btn primary" id="tkNew">${ic('plus')}${tr('Neue Aufgabe')}</button>` : ''}</div>
    ${me ? `<div class="seg tk-filter">${[['alle', tr('Alle')], ['meine', tr('Meine')]].map(([k, l]) => `<a href="#/aufgaben?f=${k}" class="${k === filter ? 'on' : ''}">${l}</a>`).join('')}</div>` : ''}
    ${open.length ? groups.filter(([, g]) => g.length).map(([h, g]) => `<h2 class="tk-h">${h} <small>${g.length}</small></h2><div class="tk-list">${g.map((t) => taskRow(ctx, t, list.today, { edit: canEdit })).join('')}</div>`).join('')
      : `<p class="hint">${filter === 'meine' ? tr('Für dich ist nichts offen.') : tr('Keine offenen Aufgaben.')}${canEdit ? ` ${tr('Mit „Neue Aufgabe“ anlegen – z. B. „Filter Dunstabzug tauschen“ alle 3 Monate.')}` : ''}</p>`}
    ${list.done.length ? `<h2 class="tk-h">${tr('Zuletzt erledigt')}</h2><div class="tk-list done">${list.done.slice(0, 10).map((d) => `<div class="tk-row"><span class="ov-tick on"></span><span class="grow"><b>${esc(d.title)}</b><small class="tk-meta"><span>${esc(d.done_by_name ?? '')}</span><span>${new Date(d.done_at.replace(' ', 'T') + 'Z').toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></small></span></div>`).join('')}</div>` : ''}`;
  const reload = () => viewTasks(el, ctx, params);
  bindTaskRows(ctx, el, list.open, reload);
  el.querySelector('#tkNew')?.addEventListener('click', () => openTaskEditor(ctx, null, reload));
  el.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => openTaskEditor(ctx, list.open.find((t) => t.id === Number(b.dataset.edit))!, reload)));
};

const REPEATS: [string, string, Task['repeat_unit'], number][] = [
  ['', tr('Nicht wiederholen'), null, 1],
  ['day', tr('Täglich'), 'day', 1],
  ['week', tr('Wöchentlich'), 'week', 1],
  ['2week', tr('Alle 2 Wochen'), 'week', 2],
  ['month', tr('Monatlich'), 'month', 1],
  ['3month', tr('Alle 3 Monate'), 'month', 3],
  ['6month', tr('Halbjährlich'), 'month', 6],
  ['year', tr('Jährlich'), 'year', 1],
  ['custom', tr('Eigener Rhythmus …'), 'week', 1],
];

/** Aufgabe anlegen bzw. bearbeiten */
export async function openTaskEditor(ctx: LagerCtx, t: Task | null, after: () => void) {
  const users: { id: number; name: string }[] = (await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ users: [] }))).users ?? [];
  let place: { warehouse_id: number; col: string; row: number } | null = t?.warehouse_id != null && t.col ? { warehouse_id: t.warehouse_id, col: t.col, row: t.row ?? 0 } : null;
  const preset = t?.repeat_unit ? REPEATS.find(([, , u, n]) => u === t.repeat_unit && n === t.repeat_every)?.[0] ?? 'custom' : '';
  const m = ctx.modal(t ? tr('Aufgabe bearbeiten') : tr('Neue Aufgabe'), `<form class="l-form tk-form" autocomplete="off">
      <label>${tr('Was ist zu tun?')}<input name="title" value="${esc(t?.title ?? '')}" maxlength="120" required placeholder="${tr('z. B. Filter Dunstabzug tauschen')}" /></label>
      <div class="grid2"><label>${tr('Fällig am')}<input name="due_on" type="date" value="${esc(t?.due_on ?? '')}" /></label>
      <label>${tr('Wer?')}<select name="assignee_id"><option value="">${tr('Alle / niemand Bestimmtes')}</option>${users.map((u) => `<option value="${u.id}" ${t?.assignee_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label></div>
      <label>${tr('Wiederholen')}<select name="repeat">${REPEATS.map(([k, l]) => `<option value="${k}" ${k === preset ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="grid2 tk-custom" ${preset === 'custom' ? '' : 'hidden'}><label>${tr('Alle')}<input name="every" type="number" min="1" max="366" value="${t?.repeat_every ?? 1}" /></label>
        <label>${tr('Einheit')}<select name="unit">${Object.entries(UNIT).map(([k, [, pl]]) => `<option value="${k}" ${t?.repeat_unit === k ? 'selected' : ''}>${pl}</option>`).join('')}</select></label></div>
      <label class="l-check tk-from" ${preset ? '' : 'hidden'}><input type="checkbox" name="from_done" ${t?.repeat_from_done ? 'checked' : ''} /> ${tr('ab Erledigung zählen')} <small class="hint">${tr('(sonst fester Rhythmus nach Termin)')}</small></label>
      <div class="tk-place-row"><span>${tr('Ort')}</span><span class="grow" id="tkPlace"></span><button type="button" class="btn mini" id="tkPick">${ic('box')}${tr('Fach wählen')}</button><button type="button" class="btn mini" id="tkNoPlace" aria-label="${tr('Ort entfernen')}">${ic('x')}</button></div>
      <label>${tr('Notiz')}<textarea name="note" rows="2" maxlength="1000">${esc(t?.note ?? '')}</textarea></label>
    </form>`,
    `${t ? `<button class="btn danger" data-del>${ic('trash')}${tr('Löschen')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${ic('check')}${tr('Speichern')}</button>`);
  const form = m.el.querySelector<HTMLFormElement>('form')!;
  const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  const showPlace = () => {
    const info = place && placeInfo(ctx, place);
    m.el.querySelector('#tkPlace')!.innerHTML = info ? `<code>${esc(info.address)}</code> ${esc(info.plan ? `${info.title} · ${info.plan.fach}` : info.title)}` : `<span class="hint">${tr('kein Ort')}</span>`;
    m.el.querySelector<HTMLElement>('#tkNoPlace')!.hidden = !place;
  };
  showPlace();
  m.el.querySelector('#tkPick')!.addEventListener('click', async () => {
    const p = await pickPlace(ctx, tr('Zu welchem Fach gehört die Aufgabe?'), place ?? undefined);
    if (p) place = { warehouse_id: p.warehouse_id, col: p.col, row: p.row };
    showPlace();
  });
  m.el.querySelector('#tkNoPlace')!.addEventListener('click', () => {
    place = null;
    showPlace();
  });
  f('repeat').addEventListener('change', () => {
    const v = f('repeat').value;
    m.el.querySelector<HTMLElement>('.tk-custom')!.hidden = v !== 'custom';
    m.el.querySelector<HTMLElement>('.tk-from')!.hidden = !v;
  });
  const save = async () => {
    if (!form.reportValidity()) return;
    const sel = REPEATS.find(([k]) => k === f('repeat').value)!;
    const custom = sel[0] === 'custom';
    const body = {
      title: f('title').value,
      note: f('note').value,
      due_on: f('due_on').value || null,
      assignee_id: f('assignee_id').value ? Number(f('assignee_id').value) : null,
      repeat_unit: custom ? f('unit').value : sel[2],
      repeat_every: custom ? Number(f('every').value) : sel[3],
      repeat_from_done: !!sel[2] || custom ? f('from_done').checked : false,
      place,
    };
    try {
      await api(t ? 'PATCH' : 'POST', t ? `/api/tasks/${t.id}` : '/api/tasks', body);
      m.close();
      ctx.toast(t ? tr('Aufgabe gespeichert.') : tr('„{title}“ angelegt.', { title: body.title.trim() }));
      after();
      document.dispatchEvent(new CustomEvent('zh-tasks'));
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  m.el.querySelector('[data-ok]')!.addEventListener('click', save);
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(tr('„{title}“ löschen?', { title: t!.title }))) return;
    await api('DELETE', `/api/tasks/${t!.id}`).catch((e) => ctx.toast((e as Error).message));
    m.close();
    after();
    document.dispatchEvent(new CustomEvent('zh-tasks'));
  });
}
