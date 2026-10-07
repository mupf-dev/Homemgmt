// Preisrecherche für die Einkaufsliste: sucht über den KI-Anbieter (Websuche von OpenRouter oder Such-Tool eines Gateways), wo die Einträge gerade am
// günstigsten sind – je Eintrag das beste Angebot, weitere aufklappbar, dazu eine Einkaufstour nach Händler.
// Server: GET/POST /api/shopping/prices (läuft im Hintergrund, Ergebnisse 24 Stunden gültig).

import { api, esc, relDate, type LagerCtx } from './core';
import { ic } from '../icons';

const euro = (n: number) => Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'Quelle';
  }
};

const offer = (o: any) => `<span class="offer-shop">${esc(o.haendler)}${o.filiale ? ` <small>${esc(o.filiale)}</small>` : ''}</span>
  <span class="offer-price">${euro(o.preis)}${o.packung ? ` <small>${esc(o.packung)}</small>` : ''}${o.preis_je_einheit ? ` <small>· ${esc(o.preis_je_einheit)}</small>` : ''}${o.pfand ? ` <small>+ ${euro(o.pfand)} Pfand</small>` : ''}</span>
  <span class="offer-meta">${o.bestaetigt ? '' : '<span class="tag warn" title="Preis nicht direkt beim Händler bestätigt">unbestätigt</span> '}${o.gueltig_bis ? `bis ${esc(o.gueltig_bis)} · ` : ''}<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(host(o.url))} ↗</a></span>`;

function priceHtml(c: any) {
  if (!c) return '';
  if (c.status === 'pending' || c.status === 'running') return `<div class="price-wait">${ic('hourglass')} Suche Preise …</div>`;
  if (c.status === 'error') return `<div class="price-none">Preisrecherche fehlgeschlagen: ${esc(c.error ?? '')}</div>`;
  const r = c.result ?? { angebote: [] };
  const [best, ...rest] = r.angebote;
  if (!best) return `<div class="price-none">Keine Preise gefunden.${r.hinweis ? ` ${esc(r.hinweis)}` : ''}</div>`;
  return `<div class="price-best"><span class="price-label">Günstigst</span>${offer(best)}</div>
    ${rest.length || r.hinweis ? `<details class="price-more"><summary>${rest.length ? `${rest.length} weitere${rest.length === 1 ? 's Angebot' : ' Angebote'}` : 'Hinweis'}</summary>
      ${rest.map((o: any) => `<div class="price-alt">${offer(o)}</div>`).join('')}${r.hinweis ? `<p class="hint">${esc(r.hinweis)}</p>` : ''}</details>` : ''}`;
}

function tourHtml(open: any[], checks: Record<string, any>) {
  const shops = new Map<string, string[]>();
  let sum = 0;
  for (const e of open) {
    const best = checks[e.id]?.status === 'done' ? checks[e.id].result.angebote[0] : null;
    if (!best) continue;
    const k = best.haendler + (best.filiale ? ` (${best.filiale})` : '');
    if (!shops.has(k)) shops.set(k, []);
    shops.get(k)!.push(e.name);
    sum += best.preis;
  }
  if (!shops.size) return '';
  return `<div class="price-tour"><b>Einkaufstour</b>${[...shops].map(([k, names]) => `<div><span class="offer-shop">${esc(k)}</span>: ${names.map(esc).join(', ')}</div>`).join('')}
    <p class="hint">Summe der günstigsten Packungen ca. ${euro(sum)} (ohne Pfand; Packungsgrößen können von der benötigten Menge abweichen).</p></div>`;
}

/** Karte „Preise prüfen“ über der Liste; Ergebnisse je Eintrag in [data-price="<id>"] */
export async function mountPrices(root: HTMLElement, ctx: LagerCtx, open: any[]) {
  const card = root.querySelector<HTMLElement>('#price-card');
  if (!card || !open.length) return;
  let st: any;
  try {
    st = await api('GET', '/api/shopping/prices');
  } catch {
    return;
  }
  if (!st.available) return;
  let timer = 0;
  const draw = () => {
    if (!document.body.contains(card)) return clearTimeout(timer);
    const checks = st.checks ?? {};
    const busy = Object.values(checks).some((c: any) => c.status === 'pending' || c.status === 'running');
    const have = open.filter((e) => checks[e.id]).length;
    const when = Object.values(checks).map((c: any) => c.finished_at).filter(Boolean).sort().pop() as string | undefined;
    card.hidden = false;
    card.innerHTML = `<div class="price-head"><div><b>Preise prüfen</b><div class="hint">${st.location ? `für ${esc(st.location)}` : 'Tipp: Wohnort unter Verwaltung → Assistent eintragen, dann gibt es Filialen in der Nähe.'}${when && !busy ? ` · Stand ${esc(relDate(when))}` : ''}</div></div>
      <button class="btn" id="priceGo" ${busy ? 'disabled' : ''}>${busy ? 'Recherche läuft …' : have ? 'Neu prüfen' : '💶 Preise prüfen'}</button></div>
      ${tourHtml(open, checks)}<p class="hint">Sucht im Internet über den KI-Anbieter (Einkaufsliste und Wohnort gehen an den Suchdienst). Ergebnisse gelten 24 Stunden.</p>`;
    for (const e of open) {
      const el = root.querySelector(`[data-price="${e.id}"]`);
      if (el) el.innerHTML = priceHtml(checks[e.id]);
    }
    card.querySelector('#priceGo')!.addEventListener('click', async () => {
      try {
        st = await api('POST', '/api/shopping/prices', { force: have > 0 && open.every((e) => checks[e.id]) });
        draw();
      } catch (err) {
        ctx.toast((err as Error).message);
      }
    });
    clearTimeout(timer);
    if (busy) {
      timer = window.setTimeout(async () => {
        if (!document.body.contains(card)) return;
        st = await api('GET', '/api/shopping/prices').catch(() => st);
        draw();
      }, 3000);
    }
  };
  draw();
}
