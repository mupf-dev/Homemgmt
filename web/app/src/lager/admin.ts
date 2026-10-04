// Verwaltung (nur Admins): Personen und Konten, Lager, API-Schlüssel, Backups, Assistent, Export/Import.
// Lager aus dem Hausplan (Räume) werden im Planer gepflegt und sind hier nur zur Ansicht.

import { api, esc, fmtDate, type LagerCtx } from './core';
import type { View } from './views';
import { ic, type IconName } from '../icons';

declare global {
  interface Window {
    Transfer?: any;
    qrcode?: any;
  }
}

const COLORS = ['#e0574f', '#e0883d', '#d9b032', '#5aa84f', '#3a9c9c', '#3f7fd0', '#7a5ad0', '#c74d9a'];
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const back = '<a class="l-back" href="#/verwaltung">← Verwaltung</a>';

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
  if (ctx.user()?.role !== 'admin') return void (el.innerHTML = '<p>Nur für Admins.</p>');
  const tile = (h: string, i: IconName, t: string, s: string) => `<a class="ov-tile" href="${h}">${ic(i)}<b>${t}</b><small>${s}</small></a>`;
  el.innerHTML = `<a class="l-back" href="#/mehr">${ic('back')}Mehr</a><h1>Verwaltung</h1><div class="ov-tiles">
    ${tile('#/verwaltung/personen', 'users', 'Personen', 'Anmeldung, Rollen, Recht „Haus planen“, Freigaben')}
    ${tile('#/verwaltung/lager', 'box', 'Lager', 'Lager und Kürzel (Räume kommen aus dem Hausplan)')}
    ${tile('#/verwaltung/terminals', 'photo', 'Wandterminals', 'Tablets an der Wand: Ausrichtung, Ruhezustand, Einrichtungslink')}
    ${tile('#/verwaltung/schluessel', 'key', 'API-Schlüssel', 'Für KI-Assistenten (MCP) und eigene Skripte')}
    ${tile('#/verwaltung/backups', 'file', 'Sicherungen', 'Sichern, herunterladen, wiederherstellen')}
    ${tile('#/verwaltung/assistent', 'spark', 'Assistent', 'KI-Anbieter, Modell, Preisrecherche, Verbrauch')}
    ${tile('#/verwaltung/transfer', 'upload', 'Export & Import', 'Excel/CSV – z. B. für die Hausratversicherung')}
    ${tile('#/haus', 'plan', 'Hausplan', 'Etagen, Räume, Möbel und Fächer')}
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
  el.innerHTML = `${back}<h1>Personen</h1>
    <div class="l-list">${persons.map((p) => {
      const u = byId.get(p.id);
      return `<div class="l-item ${p.archived ? 'muted' : ''}" data-id="${p.id}"><span class="avatar" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>
        <span class="l-main"><b>${esc(p.name)}${p.id === me.id ? ' <small>(du)</small>' : ''}</b><small>${p.role === 'admin' ? 'Admin' : p.can_plan ? 'Benutzer · darf planen' : 'Benutzer'}${u?.email ? ` · ${esc(u.email)}` : ''}${p.has_password ? '' : ' · ohne Passwort (kann sich nicht anmelden)'}${p.archived ? ' · archiviert' : ''}${u?.status === 'pending' ? ' · <b>wartet auf Freigabe</b>' : ''} · ${p.bookings} Buchungen</small></span>
        ${u?.status === 'pending' ? '<button class="btn primary mini" data-act="approve">Freigeben</button>' : ''}
        <button class="btn mini" data-act="edit">Bearbeiten</button></div>`;
    }).join('')}</div>
    <div class="l-actions"><button class="btn primary" id="add">+ Person anlegen</button></div>
    <h2>Anmeldung per E-Mail</h2>
    <label class="l-check"><input type="checkbox" id="reg" ${st.settings.registrationEnabled ? 'checked' : ''} /> Selbst-Registrierung erlauben</label>
    <label class="l-check"><input type="checkbox" id="appr" ${st.settings.requireApproval ? 'checked' : ''} /> Neue Konten müssen freigegeben werden</label>`;
  const reload = () => viewPersons(el, ctx, new URLSearchParams());
  el.querySelector('#reg')!.addEventListener('change', (e) => run(ctx, () => api('PUT', '/api/admin/settings', { registrationEnabled: (e.target as HTMLInputElement).checked })));
  el.querySelector('#appr')!.addEventListener('change', (e) => run(ctx, () => api('PUT', '/api/admin/settings', { requireApproval: (e.target as HTMLInputElement).checked })));
  const editor = (p?: any) => {
    const m = ctx.modal(p ? `${p.name} bearbeiten` : 'Person anlegen', `<form class="l-form">
      <label>Name<input name="name" value="${esc(p?.name ?? '')}" required maxlength="40" /></label>
      <label>Farbe<span class="colors">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${(p?.color ?? COLORS[0]) === c ? 'checked' : ''} /><span style="background:${c}"></span></label>`).join('')}</span></label>
      <label>Rolle<select name="role"><option value="user">Benutzer (buchen)</option><option value="admin" ${p?.role === 'admin' ? 'selected' : ''}>Admin (verwalten)</option></select></label>
      <label class="l-check" title="Admins dürfen immer planen"><input type="checkbox" name="can_plan" ${p?.can_plan || p?.role === 'admin' ? 'checked' : ''} ${p?.role === 'admin' ? 'disabled' : ''} /> Haus planen (Wände, Möbel, Etagen ändern)</label>
      <label>${p ? 'Neues Passwort (leer = unverändert)' : 'Passwort (leer = kann sich nicht anmelden)'}<input name="password" type="password" autocomplete="new-password" /></label>
      ${p && p.id !== ctx.user()!.id ? `<label class="l-check"><input type="checkbox" name="archived" ${p.archived ? 'checked' : ''} /> archiviert (kann nicht mehr buchen, Verlauf bleibt)</label>` : ''}
    </form>`, `${p && p.id !== ctx.user()!.id ? '<button class="btn danger" data-del>Löschen …</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Speichern</button>`);
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
        const target = prompt(`${p.name} hat ${p.bookings} Buchungen. Auf wen sollen sie übertragen werden?\n${others.map((x) => `${x.id} = ${x.name}`).join('\n')}\n\nID eingeben:`);
        if (!target) return;
        url += `?merge_into=${Number(target)}`;
      } else if (!confirm(`${p.name} löschen?`)) return;
      if (await run(ctx, () => api('DELETE', url), `${p.name} gelöscht.`)) {
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
      if (await run(ctx, () => api('PUT', `/api/admin/users/${p.id}`, { status: 'active' }), `${p.name} freigegeben.`)) reload();
    });
  });
};

export const viewWarehouses: View = async (el, ctx) => {
  const list = await api<any[]>('GET', '/api/warehouses');
  el.innerHTML = `${back}<h1>Lager</h1>
    <p class="hint">Jeder Raum im Hausplan ist ein Lager – Name und Kürzel werden dort gepflegt (Raum auswählen). Hier lassen sich zusätzliche Lager ohne Hausplan anlegen, z. B. für eine Garage, die (noch) nicht geplant ist.</p>
    <div class="l-list">${list.map((w) => `<div class="l-item" data-id="${w.id}"><code>${esc(w.code)}</code><span class="l-main"><b>${esc(w.name)}</b><small>${w.plan_key ? 'aus dem Hausplan · ' : ''}${w.places} Plätze · ${w.items} Gegenstände${w.description ? ` · ${esc(w.description)}` : ''}</small></span>
      ${w.plan_key ? '<a class="btn mini" href="#/haus">im Hausplan</a>' : '<button class="btn mini" data-edit>Bearbeiten</button>'}</div>`).join('')}</div>
    <div class="l-actions"><button class="btn primary" id="add">+ Lager anlegen</button></div>`;
  const reload = () => viewWarehouses(el, ctx, new URLSearchParams());
  const editor = (w?: any) => {
    const m = ctx.modal(w ? `${w.name} bearbeiten` : 'Lager anlegen', `<form class="l-form">
      <label>Name<input name="name" value="${esc(w?.name ?? '')}" required maxlength="40" /></label>
      <label>Kürzel (1–4 Zeichen)<input name="code" value="${esc(w?.code ?? '')}" maxlength="4" style="text-transform:uppercase" /></label>
      <label>Beschreibung<input name="description" value="${esc(w?.description ?? '')}" maxlength="200" /></label></form>`,
      `${w ? '<button class="btn danger" data-del>Löschen</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Speichern</button>`);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      const body = { name: fd.get('name'), code: String(fd.get('code') ?? '').toUpperCase(), description: fd.get('description') };
      if (await run(ctx, () => (w ? api('PATCH', `/api/warehouses/${w.id}`, body) : api('POST', '/api/warehouses', body)))) {
        m.close();
        reload();
      }
    });
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (confirm(`Lager „${w.name}“ löschen? (nur ohne Gegenstände möglich)`) && (await run(ctx, () => api('DELETE', `/api/warehouses/${w.id}`)))) {
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
  el.innerHTML = `${back}<h1>API-Schlüssel</h1>
    <p class="hint">Für KI-Assistenten wie Claude (MCP-Server${mcp ? ` <code>${esc(mcp)}</code>` : ''}) und die REST-API. Gebucht wird im Namen der gewählten Person.</p>
    <div class="l-list">${keys.map((k) => `<div class="l-item" data-id="${k.id}"><code>${esc(k.prefix)}…</code><span class="l-main"><b>${esc(k.name)}</b><small>${esc(k.person)} · ${k.scope === 'read' ? 'nur lesen' : 'lesen und buchen'} · ${k.last_used_at ? `zuletzt ${fmtDate(k.last_used_at)}` : 'noch nie benutzt'}${k.expires_at ? ` · gültig bis ${fmtDate(k.expires_at)}` : ''}</small></span><button class="btn danger mini" data-del>Löschen</button></div>`).join('') || '<p class="hint">Noch keine Schlüssel.</p>'}</div>
    <form class="l-form l-card" id="f"><h2>Neuer Schlüssel</h2>
      <label>Name<input name="name" placeholder="z. B. Claude Handy" required maxlength="60" /></label>
      <label>Person<select name="person_id">${persons.map((p) => `<option value="${p.id}" ${p.id === ctx.user()!.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Rechte<select name="scope"><option value="write">Lesen und buchen</option><option value="read">Nur lesen</option></select></label>
      <label>Gültig (Tage, leer = unbegrenzt)<input type="number" name="expires_days" min="1" /></label>
      <button class="btn primary">Schlüssel erzeugen</button></form>`;
  const reload = () => viewKeys(el, ctx, new URLSearchParams());
  el.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (confirm('Schlüssel löschen? Clients mit diesem Schlüssel verlieren sofort den Zugriff.') && (await run(ctx, () => api('DELETE', `/api/keys/${b.closest<HTMLElement>('[data-id]')!.dataset.id}`)))) reload();
  }));
  el.querySelector<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      const k = await api<any>('POST', '/api/keys', { name: fd.get('name'), person_id: Number(fd.get('person_id')), scope: fd.get('scope'), expires_days: fd.get('expires_days') || undefined });
      ctx.modal('Schlüssel erzeugt', `<p>Der Schlüssel wird <b>nur jetzt</b> angezeigt:</p><p><code class="key">${esc(k.key)}</code></p>
        ${mcp ? `<p class="hint">Claude Code: <code>claude mcp add --transport http zuhause ${esc(mcp)} --header "Authorization: Bearer ${esc(k.key)}"</code></p>` : ''}`);
      reload();
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  });
};

export const viewBackups: View = async (el, ctx) => {
  const b = await api<any>('GET', '/api/backups');
  el.innerHTML = `${back}<h1>Backups</h1>
    <p class="hint">Automatisch ${b.interval_hours ? `alle ${b.interval_hours} Stunden, die letzten ${b.keep} bleiben` : 'aus'} · Ordner <code>${esc(b.dir)}</code>. Enthält Lager, Hausplan, Konten und Planungen. Wichtig: zusätzlich woanders aufbewahren (herunterladen).</p>
    <div class="l-actions"><button class="btn primary" id="now">Jetzt sichern</button><label class="btn">Backup hochladen …<input type="file" id="up" accept=".db,application/vnd.sqlite3" hidden /></label></div>
    <div class="l-list">${b.backups.map((x: any) => `<div class="l-item" data-n="${esc(x.name)}"><span class="l-main"><b>${fmtDate(x.created_at.replace('T', ' ').slice(0, 19))}</b><small>${esc(x.kind_label ?? x.kind)} · ${fmtSize(x.size)}</small></span>
      <a class="btn mini" href="/api/backups/${encodeURIComponent(x.name)}/download">Herunterladen</a><button class="btn mini" data-restore>Wiederherstellen</button><button class="btn danger mini" data-del>✕</button></div>`).join('') || '<p class="hint">Noch keine Backups.</p>'}</div>`;
  const reload = () => viewBackups(el, ctx, new URLSearchParams());
  el.querySelector('#now')!.addEventListener('click', async () => {
    if (await run(ctx, () => api('POST', '/api/backups'), 'Backup angelegt.')) reload();
  });
  el.querySelector<HTMLInputElement>('#up')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const restore = confirm('Backup nach dem Hochladen sofort wiederherstellen? (Abbrechen = nur ablegen)');
    const r = await fetch(`/api/backups/upload${restore ? '?restore=1' : ''}`, { method: 'POST', body: f, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    ctx.toast(r.ok ? (restore ? 'Wiederhergestellt – Seite wird neu geladen.' : 'Backup abgelegt.') : d.error ?? 'Hochladen fehlgeschlagen.');
    if (r.ok && restore) setTimeout(() => location.reload(), 800);
    else reload();
  });
  el.querySelectorAll<HTMLElement>('.l-item[data-n]').forEach((row) => {
    const n = row.dataset.n!;
    row.querySelector('[data-restore]')!.addEventListener('click', async () => {
      if (!confirm('Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher gesichert.')) return;
      if (await run(ctx, () => api('POST', `/api/backups/${encodeURIComponent(n)}/restore`), 'Wiederhergestellt – Seite wird neu geladen.')) setTimeout(() => location.reload(), 800);
    });
    row.querySelector('[data-del]')!.addEventListener('click', async () => {
      if (confirm('Backup löschen?') && (await run(ctx, () => api('DELETE', `/api/backups/${encodeURIComponent(n)}`)))) reload();
    });
  });
};

export const viewAiSettings: View = async (el, ctx) => {
  const s = await api<any>('GET', '/api/assistant/settings');
  el.innerHTML = `${back}<h1>Assistent einrichten</h1>
    <p class="hint">Jede OpenAI-kompatible Schnittstelle (Standard OpenRouter). Das Modell muss Werkzeuge (Tool Calling) und für Fotos Bilder unterstützen. Der Schlüssel bleibt auf dem Server.</p>
    <form class="l-form l-card" id="f">
      <label>Adresse der Schnittstelle<input name="base_url" value="${esc(s.base_url ?? '')}" ${s.base_url_from_env ? 'disabled' : ''} placeholder="https://openrouter.ai/api/v1" /></label>
      <label>Modell<input name="model" value="${esc(s.model ?? '')}" ${s.model_from_env ? 'disabled' : ''} /></label>
      <label>API-Schlüssel${s.key_set ? ` <small>(gesetzt: ${esc(s.key_hint ?? '')}${s.key_from_env ? ', aus der Umgebung' : ''})</small>` : ''}<input name="api_key" type="password" placeholder="${s.key_set ? 'leer = unverändert' : 'sk-…'}" ${s.key_from_env ? 'disabled' : ''} autocomplete="off" /></label>
      <label>Wohnort für die Preisrecherche<input name="location" value="${esc(s.location ?? '')}" placeholder="z. B. 12345 Musterstadt" /></label>
      <label class="l-check"><input type="checkbox" name="research_enabled" ${s.research_enabled ? 'checked' : ''} /> Preisrecherche aktiv${s.research?.available === false ? ' <small>(nur mit OpenRouter)</small>' : ''}</label>
      <div class="l-actions"><button class="btn primary">Speichern</button><button type="button" class="btn" id="test">Verbindung testen</button></div>
    </form>
    <p class="hint">Status: ${s.enabled ? 'eingerichtet ✓' : 'nicht eingerichtet'} · letzte 30 Tage: ${s.usage_30d?.requests ?? 0} Anfragen, ${(s.usage_30d?.prompt_tokens ?? 0) + (s.usage_30d?.completion_tokens ?? 0)} Tokens${s.usage_30d?.cost ? `, ${Number(s.usage_30d.cost).toFixed(2)} $` : ''}</p>`;
  el.querySelector<HTMLFormElement>('#f')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const body: Record<string, unknown> = { location: fd.get('location'), research_enabled: !!fd.get('research_enabled') };
    if (fd.get('base_url') !== null) body.base_url = fd.get('base_url');
    if (fd.get('model') !== null) body.model = fd.get('model');
    if (fd.get('api_key')) body.api_key = fd.get('api_key');
    if (await run(ctx, () => api('PUT', '/api/assistant/settings', body), 'Gespeichert.')) viewAiSettings(el, ctx, new URLSearchParams());
  });
  el.querySelector('#test')!.addEventListener('click', async () => {
    try {
      const r = await api<any>('POST', '/api/assistant/test');
      ctx.toast(r.message ?? (r.ok ? 'Verbindung klappt.' : 'Fehler.'));
    } catch (err) {
      ctx.toast((err as Error).message);
    }
  });
};

export const viewTransfer: View = async (el, ctx) => {
  await new Promise<void>((res) => (window.Transfer ? res() : document.head.appendChild(Object.assign(document.createElement('script'), { src: `${import.meta.env.BASE_URL}transfer.js`, onload: () => res(), onerror: () => res() }))));
  const T = window.Transfer;
  if (!T) return void (el.innerHTML = `${back}<p>Export/Import nicht verfügbar.</p>`);
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
  el.innerHTML = `${back}<h1>Export &amp; Import</h1>
    <div class="l-card"><h2>Exportieren</h2><p class="hint">Alle Gegenstände mit Code, Lager, Fach (Platzname = Möbel · Fach, Kategorie = Raum), Menge und letzter Buchung.</p>
      <div class="l-actions"><button class="btn primary" id="xlsx">Excel (.xlsx)</button><button class="btn" id="csv">CSV</button></div></div>
    <div class="l-card"><h2>Importieren</h2><p class="hint">Excel oder CSV mit Überschriften. Pflicht: Name und Platz (z. B. <code>KU-B2</code>). Zeilen mit bekanntem Code aktualisieren den Gegenstand; Mengenänderungen werden als Buchung erfasst. Vorher wird automatisch gesichert.</p>
      <div class="l-actions"><label class="btn primary">Datei auswählen …<input type="file" id="file" accept=".xlsx,.csv,.txt" hidden /></label></div><div id="res"></div></div>`;
  el.querySelector('#xlsx')!.addEventListener('click', async () => save(T.toXlsx(await rows(), { sheet: 'Gegenstände' }), `zuhause-${stamp}.xlsx`));
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
      out.innerHTML = `<h3>Vorschau: ${esc(f.name)}</h3><p>${Object.entries(dry.summary).map(([k, n]) => `<span class="tag">${n} ${esc(k)}</span>`).join(' ')}</p>
        <div class="l-list">${dry.rows.filter((r: any) => r.action !== 'unverändert').slice(0, 200).map((r: any) => `<div class="l-item"><span class="tag ${r.action === 'fehler' ? 'bad' : ''}">${esc(r.action)}</span><span class="l-main"><b>${esc(r.name)}</b><small>Zeile ${r.row}${r.message ? ` · ${esc(r.message)}` : ''}</small></span></div>`).join('')}</div>
        <div class="l-actions"><button class="btn primary" id="go" ${todo ? '' : 'disabled'}>Import ausführen (${todo})</button></div>`;
      out.querySelector('#go')!.addEventListener('click', async () => {
        const r = await api<any>('POST', '/api/import', { rows: objects }).catch((err) => ctx.toast(err.message));
        if (!r) return;
        out.innerHTML = `<p>Import abgeschlossen: ${r.summary.neu} neu, ${r.summary['geändert']} geändert. Backup vorher: <code>${esc(r.backup)}</code></p>`;
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
const ORIENT: Record<string, string> = { portrait: 'Hochformat', landscape: 'Querformat' };

/** Einrichtungslink mit QR-Code zeigen (auf dem Tablet öffnen oder scannen) */
async function showLink(ctx: LagerCtx, name: string, path: string) {
  const url = `${location.origin}${path}`;
  const { script, qrSvg } = await import('./labels');
  await script(`${import.meta.env.BASE_URL}vendor/qrcode.js`, () => !!window.qrcode).catch(() => {});
  const m = ctx.modal(`Einrichtungslink für „${name}“`, `<div class="term-link">
    <div class="term-qr">${window.qrcode ? qrSvg(url) : ''}</div>
    <div><p>Diesen Link <b>auf dem Tablet</b> öffnen oder den QR-Code mit dem Tablet scannen. Das Tablet wird damit zum Wandterminal „${esc(name)}“ – ohne persönliche Anmeldung.</p>
    <p class="hint">Ein neuer Link macht den alten ungültig. Ein bereits eingerichtetes Tablet muss dann neu verbunden werden.</p>
    <div class="share-row"><input readonly value="${esc(url)}" id="tl" /><button class="btn" id="tlc">${ic('copy')}Kopieren</button></div></div></div>`,
    '<button class="btn primary" data-close>Fertig</button>');
  m.el.querySelector('#tlc')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast('Link kopiert.');
    } catch {
      m.el.querySelector<HTMLInputElement>('#tl')!.select();
    }
  });
}

export const viewTerminals: View = async (el, ctx) => {
  const list = await api<TerminalRow[]>('GET', '/api/terminals');
  el.innerHTML = `${back}<h1>Wandterminals</h1>
    <p class="hint">Tablets an der Wand zeigen das Haus zum Suchen und Ansehen. Wer etwas ein- oder ausbucht, tippt seine Kachel an. Ohne Bedienung kehrt das Terminal zum Haus zurück und zeigt den Ruhezustand – das Haus im Licht von Tageszeit und Wetter.</p>
    <div class="l-list">${list.map((t) => `<div class="l-item" data-id="${t.id}">${ic('photo')}
      <span class="l-main"><b>${esc(t.name)}</b><small>${ORIENT[t.settings.orientation]} · ${t.settings.houseView === '3d' ? '3D' : '2D'} · zurück zum Haus nach ${t.settings.idleMinutes} Min.${t.settings.screensaver ? ' · Ruhezustand' : ''}${t.settings.plz ? ` · Wetter ${esc(t.settings.plz)}` : ''} · ${t.last_seen_at ? `zuletzt aktiv ${fmtDate(t.last_seen_at)}` : 'noch nicht verbunden'}</small></span>
      <button class="btn mini" data-act="link">Einrichtungslink</button><button class="btn mini" data-act="edit">Bearbeiten</button></div>`).join('') || '<p class="hint">Noch kein Wandterminal.</p>'}</div>
    <div class="l-actions"><button class="btn primary" id="add">${ic('plus')}Wandterminal anlegen</button></div>`;
  const reload = () => viewTerminals(el, ctx, new URLSearchParams());
  const editor = (t?: TerminalRow) => {
    const s = t?.settings ?? { orientation: 'portrait', houseView: '2d', theme: 'auto', fontSize: 'normal', idleMinutes: 2, screensaver: true, plz: '' };
    const sel = (name: string, opts: [string, string][]) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${s[name] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const m = ctx.modal(t ? `${t.name} bearbeiten` : 'Wandterminal anlegen', `<form class="l-form">
      <label>Name (Ort)<input name="name" value="${esc(t?.name ?? '')}" placeholder="z. B. Diele" required maxlength="40" /></label>
      <label>Ausrichtung des Tablets${sel('orientation', [['portrait', 'Hochformat'], ['landscape', 'Querformat']])}</label>
      <label>Haus zeigen als${sel('houseView', [['2d', 'Grundriss (2D)'], ['3d', '3D']])}</label>
      <label>Darstellung${sel('theme', [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']])}</label>
      <label>Schriftgröße${sel('fontSize', [['normal', 'Normal'], ['large', 'Groß'], ['xlarge', 'Sehr groß']])}</label>
      <label>Zurück zum Haus nach (Minuten ohne Bedienung)<input name="idleMinutes" type="number" min="1" max="60" value="${s.idleMinutes}" /></label>
      <label class="l-check"><input type="checkbox" name="screensaver" ${s.screensaver ? 'checked' : ''} /> Ruhezustand: gedimmtes Haus, fotorealistisch, Licht nach Tageszeit und Wetter</label>
      <label>Postleitzahl (für das Wetter)<input name="plz" value="${esc(s.plz)}" inputmode="numeric" maxlength="5" placeholder="z. B. 70173" /></label>
    </form>`, `${t ? '<button class="btn danger" data-del>Entfernen</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Speichern</button>`);
    m.el.querySelector('[data-ok]')!.addEventListener('click', async () => {
      const fd = new FormData(m.el.querySelector('form')!);
      const settings = { orientation: fd.get('orientation'), houseView: fd.get('houseView'), theme: fd.get('theme'), fontSize: fd.get('fontSize'), idleMinutes: Number(fd.get('idleMinutes')) || 2, screensaver: !!fd.get('screensaver'), plz: String(fd.get('plz') ?? '').trim() };
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
      if (!confirm(`Wandterminal „${t!.name}“ entfernen? Das Tablet ist danach nicht mehr verbunden.`)) return;
      if (await run(ctx, () => api('DELETE', `/api/terminals/${t!.id}`), `${t!.name} entfernt.`)) {
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
      if (t.last_seen_at && !confirm(`Neuen Einrichtungslink erzeugen? Das bisher verbundene Tablet „${t.name}“ muss dann neu verbunden werden.`)) return;
      const r = await api<{ path: string }>('POST', `/api/terminals/${t.id}/link`, {});
      showLink(ctx, t.name, r.path);
    });
  });
};
