// Lager in der App: Seitenhülle und Router. #/haus (oder leer) zeigt den Hausplaner, alle anderen Adressen eine
// Lager-Seite (handytauglich). Die Seiten teilen sich Anmeldung, Hausplan und Fach-Inhalte mit dem Planer.

import type { LagerCtx } from './core';
import { esc } from './core';
import { viewCheckin, viewCheckout, viewExpiry, viewItem, viewPlace, viewQuick, viewSearch, viewShopping, viewStart, viewStats, type View } from './views';
import { viewAssistant } from './assistant';
import { viewLabels } from './labels';
import { viewHelp } from './help';
import { viewAdmin, viewAiSettings, viewBackups, viewKeys, viewPersons, viewTransfer, viewWarehouses } from './admin';
import { stopScanner, viewScan } from './scan';

const ROUTES: [RegExp, View, (m: RegExpMatchArray, p: URLSearchParams) => void][] = [
  [/^#\/lager$/, viewStart, () => {}],
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
  [/^#\/verwaltung$/, viewAdmin, () => {}],
  [/^#\/verwaltung\/personen$/, viewPersons, () => {}],
  [/^#\/verwaltung\/lager$/, viewWarehouses, () => {}],
  [/^#\/verwaltung\/schluessel$/, viewKeys, () => {}],
  [/^#\/verwaltung\/backups$/, viewBackups, () => {}],
  [/^#\/verwaltung\/assistent$/, viewAiSettings, () => {}],
  [/^#\/verwaltung\/transfer$/, viewTransfer, () => {}],
  [/^#\/q\/(.+)$/, viewQuick, (m, p) => p.set('code', decodeURIComponent(m[1]))],
];

const NAV: [string, string][] = [
  ['#/lager', 'Start'],
  ['#/suche', 'Suchen'],
  ['#/scan', 'Scannen'],
  ['#/einkauf', 'Einkauf'],
  ['#/haltbarkeit', 'Haltbarkeit'],
  ['#/assistent', 'Assistent'],
  ['#/auswertung', 'Auswertung'],
  ['#/verwaltung', 'Verwaltung'],
];

export function initLager(ctx: LagerCtx, onHouse: (params: URLSearchParams) => void) {
  const root = document.createElement('div');
  root.id = 'lager';
  root.hidden = true;
  root.innerHTML = `
    <header class="l-top">
      <a class="l-brand" href="#/lager"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg><span>Zuhause</span></a>
      <nav class="l-nav">${NAV.map(([h, l]) => `<a href="${h}" data-nav="${h}">${l}</a>`).join('')}</nav>
      <a class="btn l-house" href="#/haus">🏠 Haus</a>
      <span class="l-user" id="lUser"></span>
    </header>
    <div class="l-page" id="lPage" role="main"></div>`;
  document.body.appendChild(root);
  const page = root.querySelector<HTMLElement>('#lPage')!;

  const render = async () => {
    stopScanner();
    const raw = location.hash || '#/haus';
    const [hash, qs] = raw.split('?');
    const params = new URLSearchParams(qs ?? '');
    if (hash === '#/haus' || hash === '' || hash === '#/' || hash === '#') {
      root.hidden = true;
      document.body.classList.remove('mode-lager');
      onHouse(params);
      return;
    }
    root.hidden = false;
    document.body.classList.add('mode-lager');
    root.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === hash || (a.dataset.nav === '#/verwaltung' && hash.startsWith('#/verwaltung'))));
    root.querySelector<HTMLElement>('[data-nav="#/verwaltung"]')!.hidden = ctx.user()?.role !== 'admin';
    const u = ctx.user() ?? (await ctx.ensureUser());
    root.querySelector('#lUser')!.innerHTML = u ? esc(u.name) : '';
    if (!u) return loginPage();
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
        box.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p><p><a class="btn" href="#/lager">Zur Lager-Startseite</a></p>`;
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
