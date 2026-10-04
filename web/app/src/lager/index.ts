// Lager in der App: Seiten und Router. #/haus zeigt das Haus (Ansehen/Planen), alle anderen Adressen eine Seite
// (handytauglich). Ohne Adresse entscheidet die Einstellung der Person: Übersicht oder Haus. Navigation: shell.ts.

import type { LagerCtx } from './core';
import { viewObjectEditor, viewObjects } from './objects';
import { viewTasks } from './tasks';
import { esc } from './core';
import { viewCheckin, viewCheckout, viewExpiry, viewItem, viewPlace, viewQuick, viewSearch, viewShopping, viewStats, type View } from './views';
import { viewHome, viewMore, viewSettings } from './home';
import { prefs } from '../prefs';
import { terminal, terminalAllows } from '../terminal';
import type { Shell } from '../shell';
import { viewAssistant } from './assistant';
import { viewLabels } from './labels';
import { viewHelp } from './help';
import { viewAdmin, viewAiSettings, viewBackups, viewKeys, viewPersons, viewTerminals, viewTransfer, viewWarehouses } from './admin';
import { stopScanner, viewScan } from './scan';

const ROUTES: [RegExp, View, (m: RegExpMatchArray, p: URLSearchParams) => void][] = [
  [/^#\/lager$/, viewHome, () => {}],
  [/^#\/mehr$/, viewMore, () => {}],
  [/^#\/einstellungen$/, viewSettings, () => {}],
  [/^#\/suche$/, viewSearch, () => {}],
  [/^#\/item\/(\d+)$/, viewItem, (m, p) => p.set('id', m[1])],
  [/^#\/ein$/, viewCheckin, () => {}],
  [/^#\/aus$/, viewCheckout, () => {}],
  [/^#\/scan$/, viewScan, () => {}],
  [/^#\/einkauf$/, viewShopping, () => {}],
  [/^#\/haltbarkeit$/, viewExpiry, () => {}],
  [/^#\/platz$/, viewPlace, () => {}],
  [/^#\/assistent$/, viewAssistant, () => {}],
  [/^#\/auswertung$/, viewStats, () => {}],
  [/^#\/etiketten$/, viewLabels, () => {}],
  [/^#\/hilfe$/, viewHelp, () => {}],
  [/^#\/aufgaben$/, viewTasks, () => {}],
  [/^#\/objekte$/, viewObjects, () => {}],
  [/^#\/objekte\/bearbeiten$/, viewObjectEditor, () => {}],
  [/^#\/verwaltung$/, viewAdmin, () => {}],
  [/^#\/verwaltung\/personen$/, viewPersons, () => {}],
  [/^#\/verwaltung\/lager$/, viewWarehouses, () => {}],
  [/^#\/verwaltung\/schluessel$/, viewKeys, () => {}],
  [/^#\/verwaltung\/backups$/, viewBackups, () => {}],
  [/^#\/verwaltung\/assistent$/, viewAiSettings, () => {}],
  [/^#\/verwaltung\/transfer$/, viewTransfer, () => {}],
  [/^#\/verwaltung\/terminals$/, viewTerminals, () => {}],
  [/^#\/q\/(.+)$/, viewQuick, (m, p) => p.set('code', decodeURIComponent(m[1]))],
];

export function initLager(ctx: LagerCtx, onHouse: (params: URLSearchParams) => void, shell: Shell) {
  const root = document.createElement('div');
  root.id = 'lager';
  root.hidden = true;
  root.innerHTML = `<div class="l-page" id="lPage" role="main"></div>`;
  document.body.insertBefore(root, document.getElementById('tabbar'));
  const page = root.querySelector<HTMLElement>('#lPage')!;

  const render = async () => {
    stopScanner();
    // ohne Adresse: Startseite der Person (Übersicht oder Haus); ohne Anmeldung die Anmeldung
    if (['', '#', '#/'].includes(location.hash)) {
      const u = ctx.user() ?? (await ctx.ensureUser());
      history.replaceState(null, '', terminal() || (u && prefs().start === 'house') ? '#/haus' : '#/lager');
    }
    // Wandterminal: nur Haus, Suchen, Einkauf, Haltbarkeit und Gegenstände
    if (terminal() && !terminalAllows(location.hash.split('?')[0])) history.replaceState(null, '', '#/haus');
    const [hash, qs] = location.hash.split('?');
    const params = new URLSearchParams(qs ?? '');
    shell.update(hash, !!ctx.user());
    if (hash === '#/haus') {
      root.hidden = true;
      document.body.classList.remove('mode-lager');
      onHouse(params);
      return;
    }
    root.hidden = false;
    document.body.classList.add('mode-lager');
    const u = ctx.user() ?? (await ctx.ensureUser());
    shell.update(hash, !!u || !!terminal());
    if (!u && !terminal()) return loginPage();
    for (const [re, view, fill] of ROUTES) {
      const m = hash.match(re);
      if (!m) continue;
      fill(m, params);
      window.scrollTo(0, 0);
      // eigener Container je Ansicht: verspätete Antworten einer verlassenen Ansicht schreiben ins Leere
      const box = document.createElement('div');
      page.replaceChildren(box);
      try {
        await view(box, ctx, params);
      } catch (e) {
        box.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p><p><a class="btn" href="#/lager">Zur Übersicht</a></p>`;
      }
      return;
    }
    location.hash = '#/lager';
  };
  /** Anmeldung: Kachel antippen + Passwort/PIN (wie bisher im Lager), E-Mail-Konto, beim ersten Start Ersteinrichtung */
  async function loginPage() {
    const st = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ users: [], setup: false }));
    page.innerHTML = `<h1>${st.setup ? 'Willkommen bei Zuhause' : 'Wer bist du?'}</h1>
      ${st.setup ? '<p>Ersteinrichtung: Wer wird <b>Admin</b>? Person antippen (oder neue anlegen) und ein Passwort vergeben.</p>' : ''}
      <div class="l-tiles login">${st.users.map((p: any) => `<button class="l-tile who" data-id="${p.id}"><span class="avatar big" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1).toUpperCase())}</span><b>${esc(p.name)}</b></button>`).join('')}
        ${st.setup ? '<button class="l-tile who" data-id="new"><span class="avatar big" style="background:#888">+</span><b>Neue Person</b></button>' : ''}</div>
      <form class="l-form l-card" id="pw" hidden>
        <label id="nameRow" hidden>Name<input name="name" maxlength="40" /></label>
        <label>Passwort oder PIN<input name="password" type="password" autocomplete="current-password" /></label>
        ${st.setup ? '<label>Passwort wiederholen<input name="password2" type="password" autocomplete="new-password" /></label>' : ''}
        <p class="form-error" hidden></p>
        <button class="btn primary big">${st.setup ? 'Einrichten' : 'Anmelden'}</button>
      </form>
      ${st.setup ? '' : '<p class="hint">Oder <a href="#" id="mail">mit E-Mail anmelden</a>.</p>'}`;
    let who: string | null = null;
    const form = page.querySelector<HTMLFormElement>('#pw')!;
    const err = form.querySelector<HTMLElement>('.form-error')!;
    page.querySelectorAll<HTMLElement>('.who').forEach((b) => b.addEventListener('click', () => {
      who = b.dataset.id!;
      page.querySelectorAll('.who').forEach((x) => x.classList.toggle('on', x === b));
      form.hidden = false;
      (form.querySelector('#nameRow') as HTMLElement).hidden = who !== 'new';
      form.querySelector<HTMLInputElement>(who === 'new' ? '[name="name"]' : '[name="password"]')!.focus();
    }));
    page.querySelector('#mail')?.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.login();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      err.hidden = true;
      if (st.setup && fd.get('password') !== fd.get('password2')) {
        err.textContent = 'Die Passwörter stimmen nicht überein.';
        err.hidden = false;
        return;
      }
      const body = st.setup
        ? { ...(who === 'new' ? { name: fd.get('name') } : { person_id: Number(who) }), password: fd.get('password') }
        : { person_id: Number(who), password: fd.get('password') };
      const r = await fetch(`/api/auth/${st.setup ? 'setup' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        err.textContent = d.error ?? 'Anmeldung fehlgeschlagen.';
        err.hidden = false;
        return;
      }
      await ctx.ensureUser();
      render();
    });
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('pagehide', stopScanner);
  return { render };
}
