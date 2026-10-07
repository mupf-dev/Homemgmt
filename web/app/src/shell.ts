// App-Rahmen: eine Navigation für alle Seiten (Übersicht, Haus, Suchen, Einkauf, Mehr). Großer Bildschirm: Leiste oben
// mit Scannen und Konto; Handy: schmale Kopfzeile und Leiste unten mit Scannen in der Mitte (mit dem Daumen erreichbar).

import { ic, type IconName } from './icons';
import { onOutbox, pending } from './lager/outbox';

type Key = 'start' | 'haus' | 'suche' | 'einkauf' | 'mehr' | 'scan';
const NAV: [Key, string, string, IconName][] = [
  ['start', '#/lager', 'Übersicht', 'home'],
  ['haus', '#/haus', 'Haus', 'plan'],
  ['suche', '#/suche', 'Suchen', 'search'],
  ['einkauf', '#/einkauf', 'Einkauf', 'cart'],
  ['mehr', '#/mehr', 'Mehr', 'more'],
];

/** Welcher Navigationspunkt zu einer Adresse gehört */
export function navKey(hash: string): Key {
  const h = hash.split('?')[0];
  if (h === '#/lager') return 'start';
  if (h === '#/haus' || h === '' || h === '#/' || h === '#') return 'haus';
  if (h === '#/suche' || h.startsWith('#/item/') || h === '#/platz') return 'suche';
  if (h === '#/einkauf') return 'einkauf';
  if (h === '#/scan' || h === '#/ein' || h === '#/aus' || h.startsWith('#/q/')) return 'scan';
  return 'mehr';
}

export function initShell() {
  const top = document.createElement('header');
  top.id = 'shell';
  top.className = 'sh-top';
  top.innerHTML = `
    <a class="sh-brand" href="#/" title="Startseite">${ic('logo')}<span>homemgmt-ng</span></a>
    <nav class="sh-nav" aria-label="Hauptnavigation">${NAV.map(([k, h, l, i]) => `<a href="${h}" data-k="${k}">${ic(i)}<span>${l}</span>${k === 'einkauf' ? '<span class="badge" hidden></span>' : ''}</a>`).join('')}</nav>
    <span class="spacer"></span>
    <button class="btn sh-outbox" id="outboxPill" hidden title="Ohne Verbindung vorgemerkte Buchungen – antippen zum Nachbuchen">${ic('hourglass')}<span></span></button>
    <a class="btn sh-scan" href="#/scan" data-k="scan">${ic('scan')}Scannen</a>
    <a class="btn icon sh-find" href="#/suche" aria-label="Suchen">${ic('search')}</a>
    <div id="account" class="account"></div>`;
  const tabs = document.createElement('nav');
  tabs.id = 'tabbar';
  tabs.className = 'sh-tabs';
  tabs.setAttribute('aria-label', 'Hauptnavigation');
  const T: [Key, string, string, IconName][] = [NAV[0], NAV[1], ['scan', '#/scan', 'Scannen', 'scan'], NAV[3], NAV[4]];
  tabs.innerHTML = T.map(([k, h, l, i]) =>
    k === 'scan'
      ? `<a href="${h}" data-k="${k}" class="tab-scan"><span class="ring">${ic(i)}</span><span>${l}</span></a>`
      : `<a href="${h}" data-k="${k}">${ic(i)}<span>${k === 'start' ? 'Start' : l}</span>${k === 'einkauf' ? '<span class="badge" hidden></span>' : ''}</a>`,
  ).join('');
  // Wandterminal: große Navigation am linken Rand
  const rail = document.createElement('nav');
  rail.id = 'rail';
  rail.className = 'sh-rail';
  rail.setAttribute('aria-label', 'Navigation');
  const R: [string, string, IconName][] = [['#/haus', 'Haus', 'plan'], ['#/suche', 'Suchen', 'search'], ['#/einkauf', 'Einkauf', 'cart'], ['#/aufgaben', 'Aufgaben', 'check'], ['#/haltbarkeit', 'Haltbarkeit', 'clock'], ['#/assistent?sprechen=1', 'Sprechen', 'mic']];
  rail.innerHTML = R.map(([h, l, i]) => `<a href="${h}" data-r="${h}">${ic(i)}<span>${l}</span>${h === '#/einkauf' ? '<span class="badge" hidden></span>' : ''}</a>`).join('');
  document.body.prepend(top);
  document.body.appendChild(tabs);
  document.body.appendChild(rail);
  // „Sprechen“, während der Assistent schon offen ist: kein Seitenwechsel, gleich zuhören
  rail.querySelector('[data-r^="#/assistent"]')?.addEventListener('click', (e) => {
    if (!location.hash.startsWith('#/assistent')) return;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('zh-talk'));
  });

  // vorgemerkte Buchungen (schlechtes WLAN)
  const pill = top.querySelector<HTMLButtonElement>('#outboxPill')!;
  const showPending = () => {
    const n = pending().length;
    pill.hidden = !n;
    pill.querySelector('span')!.textContent = `${n} ${n === 1 ? 'Buchung wartet' : 'Buchungen warten'}`;
  };
  onOutbox(showPending);
  showPending();
  pill.addEventListener('click', () => document.dispatchEvent(new CustomEvent('zh-outbox-flush')));

  let badgeAt = 0;
  return {
    accountEl: top.querySelector<HTMLElement>('#account')!,
    /** aktiven Punkt markieren (bei jedem Seitenwechsel) */
    update(hash: string, loggedIn: boolean) {
      const k = navKey(hash);
      document.querySelectorAll<HTMLElement>('#shell [data-k], #tabbar [data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
      const h = hash.split('?')[0];
      rail.querySelectorAll<HTMLElement>('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r!.split('?')[0] === h || (a.dataset.r === '#/suche' && (h.startsWith('#/item/') || h === '#/platz'))));
      document.body.classList.toggle('logged-out', !loggedIn);
      if (loggedIn && Date.now() - badgeAt > 5000) {
        badgeAt = Date.now();
        this.refreshBadge();
      }
    },
    /** Zahl offener Einträge der Einkaufsliste */
    async refreshBadge() {
      const r = await fetch('/api/shopping', { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const n = r?.open?.length ?? 0;
      document.querySelectorAll<HTMLElement>('#shell .badge, #tabbar .badge, #rail .badge').forEach((b) => {
        b.textContent = String(n);
        b.hidden = !n;
      });
    },
  };
}
export type Shell = ReturnType<typeof initShell>;
