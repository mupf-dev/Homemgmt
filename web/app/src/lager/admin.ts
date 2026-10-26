// Verwaltung (nur Admins): Personen und Konten, Lager, API-Schlüssel, Backups, Assistent, Export/Import.
// Lager aus dem Hausplan (Räume) werden im Planer gepflegt und sind hier nur zur Ansicht.

import { api, esc, fmtDate, type LagerCtx } from './core';
import type { View } from './views';
import { ic, type IconName } from '../icons';
import { locale, shown, tr, trn } from '../i18n';

declare global {
  interface Window {
    Transfer?: any;
    qrcode?: any;
  }
}

const COLORS = ['#e0574f', '#e0883d', '#d9b032', '#5aa84f', '#3a9c9c', '#3f7fd0', '#7a5ad0', '#c74d9a'];
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const back = `<a class="l-back" href="#/verwaltung">← ${tr('Verwaltung')}</a>`;

async function run(ctx: LagerCtx, fn: () => Promise<unknown>, msg?: string) {
  try {
    await fn();
    if (msg) ctx.toast(msg);
    return true;
  } catch (e) {
    ctx.toast((e as Error).message);
    return false;
  }
}

export const viewAdmin: View = (el, ctx) => {
  if (ctx.user()?.role !== 'admin') return void (el.innerHTML = `<p>${tr('Nur für Admins.')}</p>`);
  const tile = (h: string, i: IconName, t: string, s: string) => `<a class="ov-tile" href="${h}">${ic(i)}<b>${t}</b><small>${s}</small></a>`;
  el.innerHTML = `<a class="l-back" href="#/mehr">${ic('back')}${tr('Mehr')}</a><h1>${tr('Verwaltung')}</h1><div class="ov-tiles">
    ${tile('#/verwaltung/personen', 'users', tr('Personen'), tr('Anmeldung, Rollen, Recht „Haus planen“, Freigaben'))}
    ${tile('#/verwaltung/lager', 'box', tr('Lager'), tr('Lager und Kürzel (Räume kommen aus dem Hausplan)'))}
    ${tile('#/verwaltung/terminals', 'photo', tr('Wandterminals'), tr('Tablets an der Wand: Ausrichtung, Ruhezustand, Einrichtungslink'))}
    ${tile('#/verwaltung/schluessel', 'key', tr('API-Schlüssel'), tr('Für KI-Assistenten (MCP) und eigene Skripte'))}
    ${tile('#/verwaltung/backups', 'file', tr('Sicherungen'), tr('Sichern, herunterladen, wiederherstellen'))}
    ${tile('#/verwaltung/assistent', 'spark', tr('Assistent'), tr('KI-Anbieter, Modell, Preisrecherche, Verbrauch'))}
    ${tile('#/verwaltung/transfer', 'upload', tr('Export & Import'), tr('Excel/CSV – z. B. für die Hausratversicherung'))}
    ${tile('#/haus', 'plan', tr('Hausplan'), tr('Etagen, Räume, Möbel und Fächer'))}
  </div>`;
};

export const viewPersons: View = async (el, ctx) => {
  const [persons, users, st] = await Promise.all([
    api<any[]>('GET', '/api/persons?all=1'),
    api<{ users: any[] }>('GET', '/api/admin/users'),
    api<{ settings: { registrationEnabled: boolean; requireApproval: boolean } }>('GET', '/api/admin/settings'),
  ]);
  const byId = new Map(users.users.map((u) => [u.id, u]));
  const me = ctx.user()!;
  el.innerHTML = `${back}<h1>${tr('Personen')}</h1>
    <div class="l-list">${persons.map((p) => {
      const u = byId.get(p.id);
      return `<div class="l-item ${p.archived ? 'muted' : ''}" data-id="${p.id}"><span class="avatar" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="l-main"><b>${esc(p.name)}${p.id === me.id ? ` <small>(${tr('du')})</small>` : ''}</b><small>${p.role === 'admin' ? tr('Admin') : p.can_plan ? tr('Benutzer · darf planen') : tr('Benutzer')}${u?.email ? ` · ${esc(u.email)}` : ''}${p.has_password ? '' : ` · ${tr('ohne Passwort (kann sich nicht anmelden)')}`}${p.archived ? ` · ${tr('archiviert')}` : ''}${u?.status === 'pending' ? ` · <b>${tr('wartet auf Freigabe')}</b>` : ''} · ${trn(p.bookings, '{n} Buchung', '{n} Buchungen')}</small></span>
        ${u?.status === 'pending' ? `<button class="btn primary mini" data-act="approve">${tr('Freigeben')}</button>` : ''}
        <button class="btn mini" data-act="edit">${tr('Bearbeiten')}</button></div>`;
    }).join('')}</div>
    <div class="l-actions"><button class="btn primary" id="add">+ ${tr('Person anlegen')}</button></div>
    <h2>${tr('Anmeldung per E-Mail')}</h2>
    <label class="l-check"><input type="checkbox" id="reg" ${st.settings.registrationEnabled ? 'checked' : ''} /> ${tr('Selbst-Registrierung erlauben')}</label>
    <label class="l-check"><input type="checkbox" id="appr" ${st.settings.requireApproval ? 'checked' : ''} /> ${tr('Neue Konten müssen freigegeben werden')}</label>`;
  const reload = () => viewPersons(el, ctx, new URLSearchParams());
  el.querySelector('#reg')!.addEventListener('change', (e) => run(ctx, () => api('PUT', '/api/admin/settings', { registrationEnabled: (e.target as HTMLInputElement).checked })));
  el.querySelector('#appr')!.addEventListener('change', (e) => run(ctx, () => api('PUT', '/api/admin/settings', { requireApproval: (e.target as HTMLInputElement).checked })));
  const editor = (p?: any) => {
    const m = ctx.modal(p ? tr('{name} bearbeiten', { name: p.name }) : tr('Person anlegen'), `<form class="l-form">
      <label>${tr('Name')}<input name="name" value="${esc(p?.name ?? '')}" required maxlength="40" /></label>
      <label>${tr('Farbe')}<span class="colors">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${(p?.color ?? COLORS[0]) === c ? 'checked' : ''} /><span style="background:${c}"></span></label>`).join('')}</span></label>
      <label>${tr('Rolle')}<select name="role"><option value="user">${tr('Benutzer (buchen)')}</option><option value="admin" ${p?.role === 'admin' ? 'selected' : ''}>${tr('Admin (verwalten)')}</option></select></label>
      <label class="l-check" title="${tr('Admins dürfen immer planen')}"><input type="checkbox" name="can_plan" ${p?.can_plan || p?.role === 'admin' ? 'checked' : ''} ${p?.role === 'admin' ? 'disabled' : ''} /> ${tr('Haus planen (Wände, Möbel, Etagen ändern)')}</label>
      <label>${p ? tr('Neues Passwort (leer = unverändert)') : tr('Passwort (leer = kann sich nicht anmelden)')}<input name="password" type="password" autocomplete="new-password" /></label>
      ${p && p.id !== ctx.user()!.id ? `<label class="l-check"><input type="checkbox" name="archived" ${p.archived ? 'checked' : ''} /> ${tr('archiviert (kann nicht mehr buchen, Verlauf bleibt)')}</label>` : ''}
    </form>`, `${p && p.id !== ctx.user()!.id ? `<button class="btn danger" data-del>${tr('Löschen …')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${tr('Speichern')}</button>`);
    // Admins dürfen immer planen: Haken fest gesetzt
    const roleSel = m.el.querySelector<HTMLSelectElement>('select[name="role"]')!;
    const planBox = m.el.querySelector<HTMLInputElement>('[name="can_plan"]')!;
    roleSel.addEventListener('change', () => {
      planBox.disabled = roleSel.value === 'admin';
      if (planBox.disabled) planBox.checked = true;
    });
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      const body: Record<string, unknown> = { name: fd.get('name'), color: fd.get('color'), role: fd.get('role'), can_plan: planBox.checked };
      if (fd.get('password')) body.password = fd.get('password');
      if (p) body.archived = !!fd.get('archived');
      if (await run(ctx, () => (p ? api('PATCH', `/api/persons/${p.id}`, body) : api('POST', '/api/persons', body)))) {
        m.close();
        reload();
      }
    });
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      let url = `/api/persons/${p.id}`;
      if (p.bookings) {
        const others = persons.filter((x) => x.id !== p.id && !x.archived);
        const target = prompt(`${trn(p.bookings, '{name} hat {n} Buchung. Auf wen soll sie übertragen werden?', '{name} hat {n} Buchungen. Auf wen sollen sie übertragen werden?', { name: p.name })}\n${others.map((x) => `${x.id} = ${x.name}`).join('\n')}\n\n${tr('ID eingeben:')}`);
        if (!target) return;
        url += `?merge_into=${Number(target)}`;
      } else if (!confirm(tr('{name} löschen?', { name: p.name }))) return;
      if (await run(ctx, () => api('DELETE', url), tr('{name} gelöscht.', { name: p.name }))) {
        m.close();
        reload();
      }
    });
  };
  el.querySelector('#add')!.addEventListener('click', () => editor());
  el.querySelectorAll<HTMLElement>('.l-item[data-id]').forEach((row) => {
    const p = persons.find((x) => x.id === Number(row.dataset.id));
    row.querySelector('[data-act="edit"]')!.addEventListener('click', () => editor(p));
    row.querySelector('[data-act="approve"]')?.addEventListener('click', async () => {
      if (await run(ctx, () => api('PUT', `/api/admin/users/${p.id}`, { status: 'active' }), tr('{name} freigegeben.', { name: p.name }))) reload();
    });
  });
};

export const viewWarehouses: View = async (el, ctx) => {
  const list = await api<any[]>('GET', '/api/warehouses');
  el.innerHTML = `${back}<h1>${tr('Lager')}</h1>
    <p class="hint">${tr('Jeder Raum im Hausplan ist ein Lager – Name und Kürzel werden dort gepflegt (Raum auswählen). Hier lassen sich zusätzliche Lager ohne Hausplan anlegen, z. B. für eine Garage, die (noch) nicht geplant ist.')}</p>
    <div class="l-list">${list.map((w) => `<div class="l-item" data-id="${w.id}"><code>${esc(w.code)}</code><span class="l-main"><b>${esc(shown(w.name))}</b><small>${w.plan_key ? `${tr('aus dem Hausplan')} · ` : ''}${trn(w.places, '{n} Platz', '{n} Plätze')} · ${trn(w.items, '{n} Gegenstand', '{n} Gegenstände')}${w.description ? ` · ${esc(shown(w.description))}` : ''}</small></span>
      ${w.plan_key ? `<a class="btn mini" href="#/haus">${tr('im Hausplan')}</a>` : `<button class="btn mini" data-edit>${tr('Bearbeiten')}</button>`}</div>`).join('')}</div>
    <div class="l-actions"><button class="btn primary" id="add">+ ${tr('Lager anlegen')}</button></div>`;
  const reload = () => viewWarehouses(el, ctx, new URLSearchParams());
  const editor = (w?: any) => {
    const m = ctx.modal(w ? tr('{name} bearbeiten', { name: w.name }) : tr('Lager anlegen'), `<form class="l-form">
      <label>${tr('Name')}<input name="name" value="${esc(w?.name ?? '')}" required maxlength="40" /></label>
      <label>${tr('Kürzel (1–4 Zeichen)')}<input name="code" value="${esc(w?.code ?? '')}" maxlength="4" style="text-transform:uppercase" /></label>
      <label>${tr('Beschreibung')}<input name="description" value="${esc(w?.description ?? '')}" maxlength="200" /></label></form>`,
      `${w ? `<button class="btn danger" data-del>${tr('Löschen')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${tr('Speichern')}</button>`);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      const body = { name: fd.get('name'), code: String(fd.get('code') ?? '').toUpperCase(), description: fd.get('description') };
      if (await run(ctx, () => (w ? api('PATCH', `/api/warehouses/${w.id}`, body) : api('POST', '/api/warehouses', body)))) {
        m.close();
        reload();
      }
    });
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (confirm(tr('Lager „{name}“ löschen? (nur ohne Gegenstände möglich)', { name: w.name })) && (await run(ctx, () => api('DELETE', `/api/warehouses/${w.id}`)))) {
        m.close();
        reload();
      }
    });
  };
  el.querySelector('#add')!.addEventListener('click', () => editor());
  el.querySelectorAll<HTMLElement>('[data-edit]').forEach((b) => b.addEventListener('click', () => editor(list.find((w) => w.id === Number(b.closest<HTMLElement>('[data-id]')!.dataset.id)))));
};

export const viewKeys: View = async (el, ctx) => {
  const [keys, info, persons] = await Promise.all([api<any[]>('GET', '/api/keys'), api<any>('GET', '/api/keys/info'), api<any[]>('GET', '/api/persons')]);
  const mcp = info.mcp_url ?? (info.mcp_port ? `${location.protocol}//${location.hostname}:${info.mcp_port}/mcp` : null);
  el.innerHTML = `${back}<h1>${tr('API-Schlüssel')}</h1>
    <p class="hint">${tr('Für KI-Assistenten wie Claude (MCP-Server{url}) und die REST-API. Gebucht wird im Namen der gewählten Person.', { url: mcp ? ` <code>${esc(mcp)}</code>` : '' })}</p>
    <div class="l-list">${keys.map((k) => `<div class="l-item" data-id="${k.id}"><code>${esc(k.prefix)}…</code><span class="l-main"><b>${esc(k.name)}</b><small>${esc(k.person)} · ${k.scope === 'read' ? tr('nur lesen') : tr('lesen und buchen')} · ${k.last_used_at ? tr('zuletzt {date}', { date: fmtDate(k.last_used_at) }) : tr('noch nie benutzt')}${k.expires_at ? ` · ${tr('gültig bis {date}', { date: fmtDate(k.expires_at) })}` : ''}</small></span><button class="btn danger mini" data-del>${tr('Löschen')}</button></div>`).join('') || `<p class="hint">${tr('Noch keine Schlüssel.')}</p>`}</div>
    <form class="l-form l-card" id="f"><h2>${tr('Neuer Schlüssel')}</h2>
      <label>${tr('Name')}<input name="name" placeholder="${tr('z. B. Claude Handy')}" required maxlength="60" /></label>
      <label>${tr('Person')}<select name="person_id">${persons.map((p) => `<option value="${p.id}" ${p.id === ctx.user()!.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>${tr('Rechte')}<select name="scope"><option value="write">${tr('Lesen und buchen')}</option><option value="read">${tr('Nur lesen')}</option></select></label>
      <label>${tr('Gültig (Tage, leer = unbegrenzt)')}<input type="number" name="expires_days" min="1" /></label>
      <button class="btn primary">${tr('Schlüssel erzeugen')}</button></form>`;
  const reload = () => viewKeys(el, ctx, new URLSearchParams());
  el.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (confirm(tr('Schlüssel löschen? Clients mit diesem Schlüssel verlieren sofort den Zugriff.')) && (await run(ctx, () => api('DELETE', `/api/keys/${b.closest<HTMLElement>('[data-id]')!.dataset.id}`)))) reload();
  }));
  el.querySelector<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const k = await api<any>('POST', '/api/keys', { name: fd.get('name'), person_id: Number(fd.get('person_id')), scope: fd.get('scope'), expires_days: fd.get('expires_days') || undefined });
      ctx.modal(tr('Schlüssel erzeugt'), `<p>${tr('Der Schlüssel wird <b>nur jetzt</b> angezeigt:')}</p><p><code class="key">${esc(k.key)}</code></p>
        ${mcp ? `<p class="hint">Claude Code: <code>claude mcp add --transport http zuhause ${esc(mcp)} --header "Authorization: Bearer ${esc(k.key)}"</code></p>` : ''}`);
      reload();
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  });
};

export const viewBackups: View = async (el, ctx) => {
  const b = await api<any>('GET', '/api/backups');
  el.innerHTML = `${back}<h1>${tr('Backups')}</h1>
    <p class="hint">${b.interval_hours ? tr('Automatisch alle {h} Stunden, die letzten {keep} bleiben', { h: b.interval_hours, keep: b.keep }) : tr('Automatisch: aus')} · ${tr('Ordner {dir}', { dir: `<code>${esc(b.dir)}</code>` })}. ${tr('Enthält Lager, Hausplan, Konten und Planungen. Wichtig: zusätzlich woanders aufbewahren (herunterladen).')}</p>
    <div class="l-actions"><button class="btn primary" id="now">${tr('Jetzt sichern')}</button><label class="btn">${tr('Backup hochladen …')}<input type="file" id="up" accept=".db,application/vnd.sqlite3" hidden /></label></div>
    <div class="l-list">${b.backups.map((x: any) => `<div class="l-item" data-n="${esc(x.name)}"><span class="l-main"><b>${fmtDate(x.created_at.replace('T', ' ').slice(0, 19))}</b><small>${esc(x.kind_label ?? x.kind)} · ${fmtSize(x.size)}</small></span>
      <a class="btn mini" href="/api/backups/${encodeURIComponent(x.name)}/download">${tr('Herunterladen')}</a><button class="btn mini" data-restore>${tr('Wiederherstellen')}</button><button class="btn danger mini" data-del aria-label="${tr('Backup löschen')}">✕</button></div>`).join('') || `<p class="hint">${tr('Noch keine Backups.')}</p>`}</div>`;
  const reload = () => viewBackups(el, ctx, new URLSearchParams());
  el.querySelector('#now')!.addEventListener('click', async () => {
    if (await run(ctx, () => api('POST', '/api/backups'), tr('Backup angelegt.'))) reload();
  });
  el.querySelector<HTMLInputElement>('#up')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const restore = confirm(tr('Backup nach dem Hochladen sofort wiederherstellen? (Abbrechen = nur ablegen)'));
    const r = await fetch(`/api/backups/upload${restore ? '?restore=1' : ''}`, { method: 'POST', body: f, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    ctx.toast(r.ok ? (restore ? tr('Wiederhergestellt – Seite wird neu geladen.') : tr('Backup abgelegt.')) : d.error ?? tr('Hochladen fehlgeschlagen.'));
    if (r.ok && restore) setTimeout(() => location.reload(), 800);
    else reload();
  });
  el.querySelectorAll<HTMLElement>('.l-item[data-n]').forEach((row) => {
    const n = row.dataset.n!;
    row.querySelector('[data-restore]')!.addEventListener('click', async () => {
      if (!confirm(tr('Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher gesichert.'))) return;
      if (await run(ctx, () => api('POST', `/api/backups/${encodeURIComponent(n)}/restore`), tr('Wiederhergestellt – Seite wird neu geladen.'))) setTimeout(() => location.reload(), 800);
    });
    row.querySelector('[data-del]')!.addEventListener('click', async () => {
      if (confirm(tr('Backup löschen?')) && (await run(ctx, () => api('DELETE', `/api/backups/${encodeURIComponent(n)}`)))) reload();
    });
  });
};

export const viewAiSettings: View = async (el, ctx) => {
  const s = await api<any>('GET', '/api/assistant/settings');
  el.innerHTML = `${back}<h1>${tr('Assistent einrichten')}</h1>
    <p class="hint">${tr('Jede OpenAI-kompatible Schnittstelle (Standard OpenRouter). Das Modell muss Werkzeuge (Tool Calling) und für Fotos Bilder unterstützen. Der Schlüssel bleibt auf dem Server.')}</p>
    <form class="l-form l-card" id="f">
      <label>${tr('Adresse der Schnittstelle')}<input name="base_url" value="${esc(s.base_url ?? '')}" ${s.base_url_from_env ? 'disabled' : ''} placeholder="https://openrouter.ai/api/v1" /></label>
      <label>${tr('Modell')}<input name="model" value="${esc(s.model ?? '')}" ${s.model_from_env ? 'disabled' : ''} /></label>
      <label>${tr('API-Schlüssel')}${s.key_set ? ` <small>(${s.key_from_env ? tr('gesetzt: {hint}, aus der Umgebung', { hint: esc(s.key_hint ?? '') }) : tr('gesetzt: {hint}', { hint: esc(s.key_hint ?? '') })})</small>` : ''}<input name="api_key" type="password" placeholder="${s.key_set ? tr('leer = unverändert') : 'sk-…'}" ${s.key_from_env ? 'disabled' : ''} autocomplete="off" /></label>
      <label>${tr('Wohnort für die Preisrecherche')}<input name="location" value="${esc(s.location ?? '')}" placeholder="${tr('z. B. 12345 Musterstadt')}" /></label>
      <label>${tr('Such-Tool im Gateway')} <small>${tr('(für die Preisrecherche ohne OpenRouter, z. B. „foundry-web“ bei LiteLLM)')}</small><input name="search_tool" value="${esc(s.search_tool ?? '')}" ${s.search_tool_from_env ? 'disabled' : ''} placeholder="${tr('leer = keins')}" /></label>
      <label class="l-check"><input type="checkbox" name="research_enabled" ${s.research_enabled ? 'checked' : ''} /> ${tr('Preisrecherche aktiv')}${s.research?.available === false && !s.research?.disabled ? ` <small>${tr('(braucht OpenRouter oder ein Such-Tool)')}</small>` : ''}</label>
      <div class="l-actions"><button class="btn primary">${tr('Speichern')}</button><button type="button" class="btn" id="test">${tr('Verbindung testen')}</button></div>
    </form>
    <p class="hint">${tr('Status: {status}', { status: s.enabled ? tr('eingerichtet ✓') : tr('nicht eingerichtet') })} · ${tr('letzte 30 Tage: {requests} Anfragen, {tokens} Tokens', { requests: s.usage_30d?.requests ?? 0, tokens: (s.usage_30d?.prompt_tokens ?? 0) + (s.usage_30d?.completion_tokens ?? 0) })}${s.usage_30d?.cost ? `, ${Number(s.usage_30d.cost).toFixed(2)} $` : ''}</p>`;
  el.querySelector<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const body: Record<string, unknown> = { location: fd.get('location'), research_enabled: !!fd.get('research_enabled') };
    if (fd.get('base_url') !== null) body.base_url = fd.get('base_url');
    if (fd.get('model') !== null) body.model = fd.get('model');
    if (fd.get('search_tool') !== null) body.search_tool = fd.get('search_tool');
    if (fd.get('api_key')) body.api_key = fd.get('api_key');
    if (await run(ctx, () => api('PUT', '/api/assistant/settings', body), tr('Gespeichert.'))) viewAiSettings(el, ctx, new URLSearchParams());
  });
  el.querySelector('#test')!.addEventListener('click', async () => {
    try {
      const r = await api<any>('POST', '/api/assistant/test');
      ctx.toast(r.message ?? (r.ok ? tr('Verbindung klappt.') : tr('Fehler.')));
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  });
};

export const viewTransfer: View = async (el, ctx) => {
  await new Promise<void>((res) => (window.Transfer ? res() : document.head.appendChild(Object.assign(document.createElement('script'), { src: `${import.meta.env.BASE_URL}transfer.js`, onload: () => res(), onerror: () => res() }))));
  const T = window.Transfer;
  if (!T) return void (el.innerHTML = `${back}<p>${tr('Export/Import nicht verfügbar.')}</p>`);
  const stamp = new Date().toISOString().slice(0, 10);
  const save = (blob: Blob, name: string) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const rows = async () => {
    const items = await api<any[]>('GET', '/api/items?limit=100000');
    return [T.HEADERS, ...items.map((i) => [i.code, i.name, i.description, i.wh_code, `${i.col}${i.row}`, i.quantity, i.consumable ? 'ja' : 'nein', i.expires_on ? i.expires_on.split('-').reverse().join('.') : '', i.place_name || '', i.place_category || '', i.last_at ? fmtDate(i.last_at) : '', i.last_person || ''])];
  };
  el.innerHTML = `${back}<h1>${tr('Export &amp; Import')}</h1>
    <div class="l-card"><h2>${tr('Exportieren')}</h2><p class="hint">${tr('Alle Gegenstände mit Code, Lager, Fach (Platzname = Möbel · Fach, Kategorie = Raum), Menge und letzter Buchung.')}</p>
      <div class="l-actions"><button class="btn primary" id="xlsx">Excel (.xlsx)</button><button class="btn" id="csv">CSV</button></div></div>
    <div class="l-card"><h2>${tr('Importieren')}</h2><p class="hint">${tr('Excel oder CSV mit Überschriften. Pflicht: Name und Platz (z. B. <code>KU-B2</code>). Zeilen mit bekanntem Code aktualisieren den Gegenstand; Mengenänderungen werden als Buchung erfasst. Vorher wird automatisch gesichert.')}</p>
      <div class="l-actions"><label class="btn primary">${tr('Datei auswählen …')}<input type="file" id="file" accept=".xlsx,.csv,.txt" hidden /></label></div><div id="res"></div></div>`;
  el.querySelector('#xlsx')!.addEventListener('click', async () => save(T.toXlsx(await rows(), { sheet: tr('Gegenstände') }), `zuhause-${stamp}.xlsx`));
  el.querySelector('#csv')!.addEventListener('click', async () => save(new Blob([T.toCsv(await rows())], { type: 'text/csv;charset=utf-8' }), `zuhause-${stamp}.csv`));
  const out = el.querySelector<HTMLElement>('#res')!;
  el.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const { objects } = T.rowsToObjects(await T.parseFile(f));
      const dry = await api<any>('POST', '/api/import', { dry: true, rows: objects });
      const todo = dry.summary.neu + dry.summary['geändert'];
      out.innerHTML = `<h3>${tr('Vorschau: {file}', { file: esc(f.name) })}</h3><p>${Object.entries(dry.summary).map(([k, n]) => `<span class="tag">${n} ${esc(ACTION[k] ?? k)}</span>`).join(' ')}</p>
        <div class="l-list">${dry.rows.filter((r: any) => r.action !== 'unverändert').slice(0, 200).map((r: any) => `<div class="l-item"><span class="tag ${r.action === 'fehler' ? 'bad' : ''}">${esc(ACTION[r.action] ?? r.action)}</span><span class="l-main"><b>${esc(r.name)}</b><small>${tr('Zeile {n}', { n: r.row })}${r.message ? ` · ${esc(r.message)}` : ''}</small></span></div>`).join('')}</div>
        <div class="l-actions"><button class="btn primary" id="go" ${todo ? '' : 'disabled'}>${tr('Import ausführen ({n})', { n: todo })}</button></div>`;
      out.querySelector('#go')!.addEventListener('click', async () => {
        const r = await api<any>('POST', '/api/import', { rows: objects }).catch((err) => ctx.toast(err.message));
        if (!r) return;
        out.innerHTML = `<p>${tr('Import abgeschlossen: {neu} neu, {changed} geändert. Backup vorher: {backup}', { neu: r.summary.neu, changed: r.summary['geändert'], backup: `<code>${esc(r.backup)}</code>` })}</p>`;
        ctx.sync.loadStorage();
      });
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  });
};

// ---------------------------------------------------------------------------
// Wandterminals: Tablets an der Wand ohne persönliche Anmeldung (Einrichtungslink setzt ein Geräte-Cookie)

type TerminalRow = { id: number; name: string; settings: Record<string, any>; last_seen_at: string | null };
const ORIENT: Record<string, string> = { portrait: tr('Hochformat'), landscape: tr('Querformat') };
/** Zeilen-Status des Imports (Werte vom Server) */
const ACTION: Record<string, string> = { neu: tr('neu'), 'geändert': tr('geändert'), 'unverändert': tr('unverändert'), fehler: tr('fehler') };

/** Einrichtungslink mit QR-Code zeigen (auf dem Tablet öffnen oder scannen) */
async function showLink(ctx: LagerCtx, name: string, path: string) {
  const url = `${location.origin}${path}`;
  const { script, qrSvg } = await import('./labels');
  await script(`${import.meta.env.BASE_URL}vendor/qrcode.js`, () => !!window.qrcode).catch(() => {});
  const m = ctx.modal(tr('Einrichtungslink für „{name}“', { name }), `<div class="term-link">
    <div class="term-qr">${window.qrcode ? qrSvg(url) : ''}</div>
    <div><p>${tr('Diesen Link <b>auf dem Tablet</b> öffnen oder den QR-Code mit dem Tablet scannen. Das Tablet wird damit zum Wandterminal „{name}“ – ohne persönliche Anmeldung.', { name: esc(name) })}</p>
    <p class="hint">${tr('Ein neuer Link macht den alten ungültig. Ein bereits eingerichtetes Tablet muss dann neu verbunden werden.')}</p>
    <div class="share-row"><input readonly value="${esc(url)}" id="tl" /><button class="btn" id="tlc">${ic('copy')}${tr('Kopieren')}</button></div></div></div>`,
    `<button class="btn primary" data-close>${tr('Fertig')}</button>`);
  m.el.querySelector('#tlc')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast(tr('Link kopiert.'));
    } catch {
      m.el.querySelector<HTMLInputElement>('#tl')!.select();
    }
  });
}

export const viewTerminals: View = async (el, ctx) => {
  const list = await api<TerminalRow[]>('GET', '/api/terminals');
  el.innerHTML = `${back}<h1>${tr('Wandterminals')}</h1>
    <p class="hint">${tr('Tablets an der Wand zeigen das Haus zum Suchen und Ansehen. Wer etwas ein- oder ausbucht, tippt seine Kachel an. Ohne Bedienung kehrt das Terminal zum Haus zurück und zeigt den Ruhezustand – das Haus im Licht von Tageszeit und Wetter.')}</p>
    <div class="l-list">${list.map((t) => `<div class="l-item" data-id="${t.id}">${ic('photo')}
      <span class="l-main"><b>${esc(t.name)}</b><small>${ORIENT[t.settings.orientation]} · ${t.settings.houseView === '3d' ? '3D' : '2D'} · ${tr('zurück zum Haus nach {n} Min.', { n: t.settings.idleMinutes })}${t.settings.screensaver ? ` · ${tr('Ruhezustand')}` : ''}${t.settings.plz ? ` · ${tr('Wetter {plz}', { plz: esc(t.settings.plz) })}` : ''} · ${t.last_seen_at ? tr('zuletzt aktiv {date}', { date: fmtDate(t.last_seen_at) }) : tr('noch nicht verbunden')}</small></span>
      <button class="btn mini" data-act="link">${tr('Einrichtungslink')}</button><button class="btn mini" data-act="edit">${tr('Bearbeiten')}</button></div>`).join('') || `<p class="hint">${tr('Noch kein Wandterminal.')}</p>`}</div>
    <div class="l-actions"><button class="btn primary" id="add">${ic('plus')}${tr('Wandterminal anlegen')}</button></div>`;
  const reload = () => viewTerminals(el, ctx, new URLSearchParams());
  const editor = (t?: TerminalRow) => {
    const s = t?.settings ?? { orientation: 'portrait', houseView: '2d', theme: 'auto', fontSize: 'normal', idleMinutes: 2, screensaver: true, plz: '', renderQuality: 'normal' };
    const sel = (name: string, opts: [string, string][]) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${s[name] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const m = ctx.modal(t ? tr('{name} bearbeiten', { name: t.name }) : tr('Wandterminal anlegen'), `<form class="l-form">
      <label>${tr('Name (Ort)')}<input name="name" value="${esc(t?.name ?? '')}" placeholder="${tr('z. B. Diele')}" required maxlength="40" /></label>
      <label>${tr('Ausrichtung des Tablets')}${sel('orientation', [['portrait', tr('Hochformat')], ['landscape', tr('Querformat')]])}</label>
      <label>${tr('Haus zeigen als')}${sel('houseView', [['2d', tr('Grundriss (2D)')], ['3d', '3D']])}</label>
      <label>${tr('Darstellung')}${sel('theme', [['auto', tr('Automatisch')], ['light', tr('Hell')], ['dark', tr('Dunkel')]])}</label>
      <label>${tr('Schriftgröße')}${sel('fontSize', [['normal', tr('Normal')], ['large', tr('Groß')], ['xlarge', tr('Sehr groß')]])}</label>
      <label>${tr('Zurück zum Haus nach (Minuten ohne Bedienung)')}<input name="idleMinutes" type="number" min="1" max="60" value="${s.idleMinutes}" /></label>
      <label class="l-check"><input type="checkbox" name="screensaver" ${s.screensaver ? 'checked' : ''} /> ${tr('Ruhezustand: gedimmtes Haus, fotorealistisch, Licht nach Tageszeit und Wetter')}</label>
      <label>${tr('Detailgrad im Ruhezustand')}${sel('renderQuality', [['draft', tr('Entwurf – schnell (32 Proben, max. 15 s)')], ['normal', tr('Normal (64 Proben, max. 30 s)')], ['high', tr('Hoch – sehr ruhiges Bild (256 Proben, max. 90 s)')]])}</label>
      <label>${tr('Postleitzahl (für das Wetter)')}<input name="plz" value="${esc(s.plz)}" inputmode="numeric" maxlength="5" placeholder="${tr('z. B. 70173')}" /></label>
    </form>`, `${t ? `<button class="btn danger" data-del>${tr('Entfernen')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${tr('Abbrechen')}</button><button class="btn primary" data-ok>${tr('Speichern')}</button>`);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      const settings = { orientation: fd.get('orientation'), houseView: fd.get('houseView'), theme: fd.get('theme'), fontSize: fd.get('fontSize'), idleMinutes: Number(fd.get('idleMinutes')) || 2, screensaver: !!fd.get('screensaver'), plz: String(fd.get('plz') ?? '').trim(), renderQuality: fd.get('renderQuality') };
      try {
        if (t) await api('PATCH', `/api/terminals/${t.id}`, { name: fd.get('name'), settings });
        else {
          const r = await api<{ terminal: TerminalRow; path: string }>('POST', '/api/terminals', { name: fd.get('name'), settings });
          m.close();
          await reload();
          return showLink(ctx, r.terminal.name, r.path);
        }
        m.close();
        reload();
      } catch (e) {
        ctx.toast((e as Error).message);
      }
    });
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm(tr('Wandterminal „{name}“ entfernen? Das Tablet ist danach nicht mehr verbunden.', { name: t!.name }))) return;
      if (await run(ctx, () => api('DELETE', `/api/terminals/${t!.id}`), tr('{name} entfernt.', { name: t!.name }))) {
        m.close();
        reload();
      }
    });
  };
  el.querySelector('#add')!.addEventListener('click', () => editor());
  el.querySelectorAll<HTMLElement>('.l-item[data-id]').forEach((row) => {
    const t = list.find((x) => x.id === Number(row.dataset.id))!;
    row.querySelector('[data-act="edit"]')!.addEventListener('click', () => editor(t));
    row.querySelector('[data-act="link"]')!.addEventListener('click', async () => {
      if (t.last_seen_at && !confirm(tr('Neuen Einrichtungslink erzeugen? Das bisher verbundene Tablet „{name}“ muss dann neu verbunden werden.', { name: t.name }))) return;
      const r = await api<{ path: string }>('POST', `/api/terminals/${t.id}/link`, {});
      showLink(ctx, t.name, r.path);
    });
  });
};
