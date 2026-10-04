// Objektbibliothek (#/objekte): eigene, importierte und Community-Möbelarten verwalten; Editor (#/objekte/bearbeiten)
// mit 3D-Vorschau und Fächerliste. Lesen dürfen alle, ändern und installieren nur Personen mit dem Recht „Haus planen“.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ic } from '../icons';
import { api, esc, type LagerCtx } from './core';
import type { View } from './views';
import { downloadObject, libraryRows, loadLibrary, objectIcon, type LibraryRow } from '../objectlib';
import {
  copyId, ELEMENT_KINDS, objectCompartments, TEMPLATES, validateObjectType,
  type ElementKind, type KorpusBuild, type ModelBuild, type ObjectType,
} from '../model/objects.ts';
import { PREVIEW_TYPE, setPreviewObject } from '../model/catalog.ts';
import { buildItem } from '../models';
import { store } from '../state';
import { LIBRARY } from '../materials';

const SOURCE: Record<string, string> = { eigene: 'Eigene', community: 'Community', datei: 'Importiert' };
const REPO = 'https://github.com/mupf-dev/homemgmt-object-library';
const GALLERY = 'https://mupf-dev.github.io/homemgmt-object-library/';
const mayEdit = (ctx: LagerCtx) => !!ctx.user()?.canPlan || ctx.user()?.role === 'admin';

export const viewObjects: View = async (el, ctx, params) => {
  const tab = params.get('tab') ?? 'installiert';
  const edit = mayEdit(ctx);
  el.innerHTML = `<a class="l-back" href="#/mehr">${ic('back')}Mehr</a><h1>Objektbibliothek</h1>
    <p class="hint">Möbelarten für den Hausplan – Schränke, Regale, Kommoden … Jedes Fach wird ein Lagerplatz. Eigene Möbelarten entstehen im Editor; weitere gibt es im Community-Katalog.</p>
    <div class="seg ob-tabs">${[['installiert', 'Installiert'], ['community', 'Community'], ['vorlagen', 'Vorlagen']].map(([k, l]) => `<a href="#/objekte?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="ob"><p class="hint">Lade …</p></div>`;
  const box = el.querySelector<HTMLElement>('#ob')!;
  const reload = () => viewObjects(el, ctx, params);
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      await loadLibrary();
      if (msg) ctx.toast(msg);
      reload();
    } catch (e) {
      ctx.toast((e as Error).message);
    }
  };

  if (tab === 'installiert') {
    const rows = await loadLibrary();
    box.innerHTML = `${edit ? `<div class="l-actions"><a class="btn primary" href="#/objekte/bearbeiten?neu=1">${ic('plus')}Neue Möbelart</a><button class="btn" id="imp">${ic('upload')}Importieren (.json)</button><input type="file" id="impFile" accept=".json,application/json" hidden /></div>` : ''}
      ${rows.length ? `<div class="ob-list">${rows.map((r) => row(r, edit)).join('')}</div>` : '<p class="hint">Noch keine Möbelarten installiert. Im Community-Katalog gibt es fertige – oder eine Vorlage kopieren.</p>'}`;
    box.querySelector('#imp')?.addEventListener('click', () => box.querySelector<HTMLInputElement>('#impFile')!.click());
    box.querySelector<HTMLInputElement>('#impFile')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        const object = JSON.parse(await f.text());
        const r = await fetch('/api/objects/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object }), credentials: 'same-origin' });
        const d = await r.json();
        if (r.status === 409 && d.exists) {
          if (!confirm(`${d.error} Ersetzen?`)) return;
          await act(() => api('POST', '/api/objects/import', { object, replace: true }), 'Möbelart ersetzt.');
          return;
        }
        if (!r.ok) throw new Error(d.error);
        await act(async () => {}, `„${d.object.name}“ importiert.`);
      } catch (ex) {
        ctx.toast(`Import fehlgeschlagen: ${(ex as Error).message}`);
      }
    });
    box.querySelectorAll<HTMLElement>('[data-id]').forEach((b) => {
      const r = rows.find((x) => x.object.id === b.dataset.id)!;
      b.querySelector('[data-a="export"]')?.addEventListener('click', () => downloadObject(r.object));
      b.querySelector('[data-a="hide"]')?.addEventListener('click', () => act(() => api('PATCH', `/api/objects/${r.object.id}`, { hidden: !r.hidden }), r.hidden ? 'Wieder im Katalog.' : 'Im Katalog ausgeblendet.'));
      b.querySelector('[data-a="del"]')?.addEventListener('click', () => {
        if (confirm(`„${r.object.name}“ aus der Bibliothek löschen? Bereits geplante Möbel behalten ihre Kopie im Hausplan.`)) act(() => api('DELETE', `/api/objects/${r.object.id}`), 'Gelöscht.');
      });
    });
    return;
  }

  if (tab === 'community') {
    try {
      const c = await api<{ url: string; objects: any[] }>('GET', '/api/objects/community');
      box.innerHTML = `<p class="hint">Möbelarten aus dem <a class="link" href="${GALLERY}" target="_blank" rel="noopener">Community-Katalog ${ic('external')}</a> – frei verwendbar. Eigene Möbelarten beisteuern: exportieren und als Pull Request im <a class="link" href="${REPO}" target="_blank" rel="noopener">Katalog-Repo ${ic('external')}</a> einreichen.</p>
        <div class="ob-list">${c.objects.map((o) => `<div class="ob-row" data-id="${esc(o.id)}">
          <span class="ob-icon">${o.preview ? `<img src="${esc(o.preview)}" alt="" loading="lazy" />` : ic('box')}</span>
          <span class="l-main"><b>${esc(o.name)}</b><small>${esc(o.group)}${o.places ? ` · ${o.places} Fächer` : ''} · Version ${esc(o.version)}${o.author ? ` · ${esc(o.author)}` : ''}${o.license ? ` · ${esc(o.license)}` : ''}</small>${o.description ? `<small class="ob-desc">${esc(o.description)}</small>` : ''}</span>
          ${o.update ? `<button class="btn primary mini" data-a="install">${ic('in')}Aktualisieren auf ${esc(o.version)}</button>` : o.installed ? `<span class="tag ok">installiert</span>` : edit ? `<button class="btn mini" data-a="install">${ic('in')}Installieren</button>` : ''}
        </div>`).join('') || '<p class="hint">Der Katalog ist leer.</p>'}</div>`;
      box.querySelectorAll<HTMLElement>('[data-a="install"]').forEach((b) =>
        b.addEventListener('click', () => {
          b.setAttribute('disabled', '');
          const id = b.closest<HTMLElement>('[data-id]')!.dataset.id!;
          act(() => api('POST', '/api/objects/community/install', { id }), 'Installiert – im Planen unter „Möbel“ zu finden.');
        }),
      );
    } catch (e) {
      box.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p><p class="hint">Der Community-Katalog liegt auf GitHub; ohne Internetverbindung ist er nicht erreichbar.</p>`;
    }
    return;
  }

  // Vorlagen: als Ausgangspunkt für eigene Möbelarten
  box.innerHTML = `<p class="hint">Vorlagen als Ausgangspunkt – kopieren und im Editor anpassen. Die eingebauten Küchenschränke und Regale bleiben unverändert, damit bestehende Lagerplätze stabil sind.</p>
    <div class="ob-grid">${TEMPLATES.map((t) => `<div class="ob-card"><span class="ob-icon big">${objectIcon(t, 90, 60)}</span><b>${esc(t.name)}</b><small>${t.size.width} × ${t.size.depth} × ${t.size.height} cm · ${objectCompartments(t, t.size.width, t.size.depth, t.size.height).length} Fächer</small>
      ${edit ? `<a class="btn mini" href="#/objekte/bearbeiten?vorlage=${encodeURIComponent(t.id)}">${ic('copy')}Als Vorlage nutzen</a>` : ''}</div>`).join('')}</div>`;
};

function row(r: LibraryRow, edit: boolean) {
  const t = r.object;
  const n = objectCompartments(t, t.size.width, t.size.depth, t.size.height).length;
  const own = r.source !== 'community';
  return `<div class="ob-row ${r.hidden ? 'muted' : ''}" data-id="${esc(t.id)}">
    <span class="ob-icon">${objectIcon(t)}</span>
    <span class="l-main"><b>${esc(t.name)}</b><small>${esc(t.group)} · ${t.size.width} × ${t.size.depth} × ${t.size.height} cm · ${n} Fächer · Version ${esc(t.version)} · ${SOURCE[r.source] ?? r.source}${r.hidden ? ' · ausgeblendet' : ''}</small></span>
    <span class="ob-acts">
      ${edit ? `<a class="btn mini" href="#/objekte/bearbeiten?${own ? 'id' : 'kopie'}=${encodeURIComponent(t.id)}">${ic(own ? 'pencil' : 'copy')}${own ? 'Bearbeiten' : 'Kopieren'}</a>` : ''}
      <button class="btn mini" data-a="export" title="Als Datei speichern (zum Teilen)">${ic('share')}Exportieren</button>
      ${edit ? `<button class="btn mini" data-a="hide">${r.hidden ? 'Einblenden' : 'Ausblenden'}</button><button class="btn mini danger" data-a="del" aria-label="Löschen">${ic('trash')}</button>` : ''}
    </span></div>`;
}

// ---------------------------------------------------------------------------
// Editor

const KINDS = Object.entries(ELEMENT_KINDS) as [ElementKind, string][];
const slug = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'moebel';

export const viewObjectEditor: View = async (el, ctx, params) => {
  if (!mayEdit(ctx)) return void (el.innerHTML = '<p>Möbelarten bearbeiten nur Personen mit dem Recht „Haus planen“.</p>');
  await loadLibrary();
  const rows = libraryRows();
  const taken = new Set(rows.map((r) => r.object.id));
  let draft: ObjectType;
  let isNew = true;
  const id = params.get('id');
  const from = params.get('kopie') ?? params.get('vorlage');
  if (id) {
    const r = rows.find((x) => x.object.id === id);
    if (!r) return void (el.innerHTML = '<p>Möbelart nicht gefunden.</p>');
    draft = structuredClone(r.object);
    isNew = false;
  } else if (from) {
    const src = rows.find((x) => x.object.id === from)?.object ?? TEMPLATES.find((t) => t.id === from);
    if (!src) return void (el.innerHTML = '<p>Vorlage nicht gefunden.</p>');
    draft = { ...structuredClone(src), id: copyId(src.id, taken), version: '1.0', author: ctx.user()?.name, name: `${src.name}${params.get('kopie') ? ' (Kopie)' : ''}` };
  } else {
    draft = { ...structuredClone(TEMPLATES[1]), id: copyId('eigene.moebel', taken), name: 'Neue Möbelart', author: ctx.user()?.name, version: '1.0' };
  }
  const groups = [...new Set([...rows.map((r) => r.object.group), 'Schränke & Regale', 'Küche', 'Diele', 'Bad', 'Werkstatt', 'Eigene Möbel'])];
  const materials = LIBRARY.map((m) => [m.id, m.name] as [string, string]);

  el.innerHTML = `<a class="l-back" href="#/objekte">${ic('back')}Objektbibliothek</a>
    <div class="ob-head"><h1>${isNew ? 'Neue Möbelart' : esc(draft.name)}</h1>
      <span class="spacer"></span><button class="btn" id="exp">${ic('share')}Exportieren</button><button class="btn primary" id="save">${ic('check')}Speichern</button></div>
    <div class="ob-editor">
      <form class="l-form ob-form" id="f" autocomplete="off"></form>
      <div class="ob-side"><div class="ob-preview" id="pv"></div><p class="form-error" id="err" hidden></p><div class="ob-faecher" id="fa"></div></div>
    </div>`;
  const form = el.querySelector<HTMLFormElement>('#f')!;
  const err = el.querySelector<HTMLElement>('#err')!;
  const preview = createPreview(el.querySelector('#pv')!);

  const num = (v: string) => Number(String(v).replace(',', '.'));
  const opt = (pairs: [string, string][], cur?: string, empty?: string) => (empty !== undefined ? `<option value="">${empty}</option>` : '') + pairs.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');

  /** Formular aus dem Entwurf zeichnen */
  const draw = () => {
    const b = draft.build;
    form.innerHTML = `
      <section class="l-card"><h2>Allgemein</h2>
        <label>Name<input data-k="name" value="${esc(draft.name)}" maxlength="60" required /></label>
        <div class="grid2"><label>Gruppe<input data-k="group" value="${esc(draft.group)}" list="obGroups" maxlength="40" /></label>
        <label>Version<input data-k="version" value="${esc(draft.version)}" maxlength="20" /></label></div>
        <datalist id="obGroups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        <label>Kennung<input data-k="id" value="${esc(draft.id)}" ${isNew ? '' : 'readonly'} maxlength="60" title="eindeutig; Kleinbuchstaben, Ziffern, Punkt, Bindestrich" /></label>
        <div class="grid2"><label>Autor<input data-k="author" value="${esc(draft.author ?? '')}" maxlength="60" /></label>
        <label>Lizenz<select data-k="license">${opt([['CC0-1.0', 'CC0 (frei, empfohlen)'], ['CC-BY-4.0', 'CC BY 4.0 (Namensnennung)'], ['privat', 'nur privat']], draft.license ?? 'CC0-1.0')}</select></label></div>
        <label>Beschreibung<textarea data-k="description" rows="2" maxlength="500">${esc(draft.description ?? '')}</textarea></label>
      </section>
      <section class="l-card"><h2>Maße (cm)</h2>
        <div class="grid4"><label>Breite<input data-s="width" inputmode="decimal" value="${draft.size.width}" /></label><label>Tiefe<input data-s="depth" inputmode="decimal" value="${draft.size.depth}" /></label>
        <label>Höhe<input data-s="height" inputmode="decimal" value="${draft.size.height}" /></label><label>vom Boden<input data-s="elevation" inputmode="decimal" value="${draft.size.elevation}" /></label></div>
        <label>Breiten-Vorschläge<input data-s="widths" value="${(draft.size.widths ?? []).join(', ')}" placeholder="z. B. 40, 60, 80" /></label>
        <label class="l-check"><input type="checkbox" data-k="snapToWall" ${draft.snapToWall ? 'checked' : ''} /> An Wände andocken</label>
      </section>
      <section class="l-card"><h2>Aufbau</h2>
        <div class="seg"><button type="button" data-build="korpus" class="${b.type === 'korpus' ? 'on' : ''}">Korpus (Spalten &amp; Elemente)</button><button type="button" data-build="modell" class="${b.type === 'modell' ? 'on' : ''}">3D-Modell</button></div>
        ${b.type === 'korpus' ? korpusForm(b) : modelForm(b)}
      </section>
      <section class="l-card"><h2>Materialien</h2>
        <div class="grid2"><label>Fronten<select data-m="front">${opt(materials, draft.materials?.front, 'wie im Haus')}</select></label>
        <label>Korpus<select data-m="carcass">${opt(materials, draft.materials?.carcass, 'wie im Haus')}</select></label>
        ${b.type === 'korpus' && b.countertop ? `<label>Arbeitsplatte<select data-m="countertop">${opt(materials, draft.materials?.countertop, 'wie in der Küche')}</select></label>` : ''}</div>
      </section>`;
  };
  const korpusForm = (b: KorpusBuild) => `
    <div class="grid3"><label>Sockel (cm)<input data-b="plinth" inputmode="decimal" value="${b.plinth}" /></label><label>Plattenstärke (cm)<input data-b="board" inputmode="decimal" value="${b.board}" /></label>
    <label class="l-check" style="align-self:end"><input type="checkbox" data-b="back" ${b.back ? 'checked' : ''} /> Rückwand</label></div>
    <div class="ob-ct">
      <label class="l-check"><input type="checkbox" data-ct="on" ${b.countertop ? 'checked' : ''} /> Arbeitsplatte <small class="hint">(oben, kein Fach; die Höhe oben ist die Gesamthöhe mit Platte)</small></label>
      ${b.countertop ? `<div class="grid3"><label>Stärke (cm)<input data-ct="thickness" inputmode="decimal" value="${b.countertop.thickness}" /></label><label>Überstand vorne (cm)<input data-ct="overhang" inputmode="decimal" value="${b.countertop.overhang}" /></label>
        <label class="l-check" style="align-self:end" title="Die Platte geht in angrenzende Küchen-Unterschränke über (durchgehende Arbeitsplatte, Maserung läuft weiter)"><input type="checkbox" data-ct="join" ${b.countertop.join ? 'checked' : ''} /> mit Küchenzeile verbinden</label></div>` : ''}
    </div>
    <div class="ob-cols">${b.columns.map((c, ci) => `<div class="ob-col" data-ci="${ci}">
      <div class="ob-col-h"><b>Spalte ${ci + 1}</b><label>Breite<input data-c="size" inputmode="decimal" value="${c.size}" title="relative Breite" /></label>
        <span class="spacer"></span><button type="button" class="btn mini" data-col="left" ${ci === 0 ? 'disabled' : ''} aria-label="nach links">←</button><button type="button" class="btn mini" data-col="right" ${ci === b.columns.length - 1 ? 'disabled' : ''} aria-label="nach rechts">→</button>
        <button type="button" class="btn mini danger" data-col="del" ${b.columns.length === 1 ? 'disabled' : ''} aria-label="Spalte entfernen">${ic('trash')}</button></div>
      ${c.elements.map((e, ei) => `<div class="ob-el" data-ei="${ei}">
        <select data-e="kind">${opt(KINDS, e.kind)}</select>
        <label title="relative Höhe">Höhe<input data-e="size" inputmode="decimal" value="${e.size}" /></label>
        ${e.kind === 'door' || e.kind === 'open' ? `<label>Böden<input data-e="shelves" type="number" min="1" max="12" value="${e.shelves ?? 1}" /></label>` : '<span></span>'}
        <input data-e="label" value="${esc(e.label ?? '')}" placeholder="Bezeichnung (optional)" maxlength="40" />
        <span class="ob-el-acts"><button type="button" class="btn mini" data-el="up" ${ei === 0 ? 'disabled' : ''} aria-label="nach oben">↑</button><button type="button" class="btn mini" data-el="down" ${ei === c.elements.length - 1 ? 'disabled' : ''} aria-label="nach unten">↓</button><button type="button" class="btn mini" data-el="del" ${c.elements.length === 1 ? 'disabled' : ''} aria-label="Element entfernen">${ic('x')}</button></span>
      </div>`).join('')}
      <button type="button" class="btn mini" data-el="add">${ic('plus')}Element</button>
    </div>`).join('')}</div>
    <button type="button" class="btn" data-col="add">${ic('plus')}Spalte</button>`;
  const modelForm = (b: ModelBuild) => `
    <p class="hint">3D-Modell (.glb) hochladen und die Fächer als Bereiche eintragen – in % von Breite (links → rechts), Höhe (unten → oben) und Tiefe (hinten → vorne).</p>
    <div class="l-actions"><button type="button" class="btn" id="up">${ic('upload')}${b.model.url ? 'Anderes Modell hochladen' : 'Modell hochladen (.glb)'}</button><input type="file" id="upFile" accept=".glb,model/gltf-binary" hidden />
      <span class="hint">${b.model.url ? esc(b.model.name ?? 'Modell geladen') : 'noch kein Modell'}</span></div>
    <div class="ob-mc">${b.compartments.map((c, i) => `<div class="ob-mrow" data-mi="${i}">
      <input data-mc="label" value="${esc(c.label)}" maxlength="40" />
      <select data-mc="kind">${opt([['shelf', 'Boden'], ['drawer', 'Schublade'], ['door', 'hinter Tür'], ['open', 'offen'], ['cold', 'Kühlfach'], ['freezer', 'Gefrierfach']], c.kind)}</select>
      ${['x von', 'x bis', 'y von', 'y bis', 'z von', 'z bis'].map((l, k) => `<label>${l}<input data-mb="${k}" inputmode="decimal" value="${Math.round(c.box[k] * 100)}" /></label>`).join('')}
      <button type="button" class="btn mini" data-mc="del" aria-label="Fach entfernen">${ic('x')}</button></div>`).join('')}</div>
    <button type="button" class="btn" data-mc="add">${ic('plus')}Fach</button>`;

  /** Eingaben in den Entwurf übernehmen, prüfen, Vorschau aktualisieren */
  const update = () => {
    try {
      const t = validateObjectType(draft);
      err.hidden = true;
      setPreviewObject(t);
      preview.show(t);
      const list = objectCompartments(t, t.size.width, t.size.depth, t.size.height);
      el.querySelector('#fa')!.innerHTML = `<h3>${list.length} Fächer = Lagerplätze</h3><ol>${list.map((c) => `<li>${esc(c.label)}</li>`).join('')}</ol>`;
      return t;
    } catch (e) {
      err.textContent = (e as Error).message;
      err.hidden = false;
      return null;
    }
  };
  let timer = 0;
  form.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const b = draft.build;
    if (inp.dataset.k) {
      const k = inp.dataset.k as keyof ObjectType;
      (draft as any)[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
    } else if (inp.dataset.s) {
      if (inp.dataset.s === 'widths') {
        const w = inp.value.split(/[;,\s]+/).map(num).filter((x) => x > 0);
        if (w.length) draft.size.widths = w;
        else delete draft.size.widths;
      } else (draft.size as any)[inp.dataset.s] = num(inp.value);
    } else if (inp.dataset.m) {
      draft.materials = { ...(draft.materials ?? {}), [inp.dataset.m]: inp.value || undefined };
      if (!inp.value) delete (draft.materials as any)[inp.dataset.m];
    } else if (b.type === 'korpus') {
      const ci = Number(inp.closest<HTMLElement>('[data-ci]')?.dataset.ci);
      const ei = Number(inp.closest<HTMLElement>('[data-ei]')?.dataset.ei);
      if (inp.dataset.ct) {
        const k = inp.dataset.ct;
        if (k === 'on') {
          if (inp.checked) b.countertop = { thickness: 4, overhang: 2 };
          else {
            delete b.countertop;
            if (draft.materials) delete draft.materials.countertop;
          }
          return void (draw(), update());
        }
        if (!b.countertop) return;
        if (k === 'join') {
          if (inp.checked) b.countertop.join = true;
          else delete b.countertop.join;
        } else b.countertop[k as 'thickness' | 'overhang'] = num(inp.value);
      } else if (inp.dataset.b) (b as any)[inp.dataset.b] = inp.type === 'checkbox' ? inp.checked : num(inp.value);
      else if (inp.dataset.c) b.columns[ci].size = num(inp.value);
      else if (inp.dataset.e) {
        const elx = b.columns[ci].elements[ei];
        if (inp.dataset.e === 'kind') {
          elx.kind = inp.value as ElementKind;
          if (elx.kind !== 'door' && elx.kind !== 'open') delete elx.shelves;
          return void (draw(), update());
        }
        if (inp.dataset.e === 'label') elx.label = inp.value || undefined;
        else (elx as any)[inp.dataset.e] = num(inp.value);
      }
    } else {
      const mi = Number(inp.closest<HTMLElement>('[data-mi]')?.dataset.mi);
      const c = b.compartments[mi];
      if (inp.dataset.mc === 'label') c.label = inp.value;
      else if (inp.dataset.mc === 'kind') c.kind = inp.value as any;
      else if (inp.dataset.mb) c.box[Number(inp.dataset.mb)] = num(inp.value) / 100;
    }
    clearTimeout(timer);
    timer = window.setTimeout(update, 150);
  });
  form.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!btn) return;
    const b = draft.build;
    if (btn.dataset.build && btn.dataset.build !== b.type) {
      draft.build = btn.dataset.build === 'korpus'
        ? structuredClone(TEMPLATES[1].build)
        : { type: 'modell', model: {}, compartments: [{ label: 'Fach', kind: 'shelf', box: [0.05, 0.95, 0.1, 0.9, 0.05, 0.95] }] };
    } else if (b.type === 'korpus' && (btn.dataset.col || btn.dataset.el)) {
      const ci = Number(btn.closest<HTMLElement>('[data-ci]')?.dataset.ci);
      const ei = Number(btn.closest<HTMLElement>('[data-ei]')?.dataset.ei);
      const cols = b.columns;
      const swap = <T,>(a: T[], i: number, j: number) => ([a[i], a[j]] = [a[j], a[i]]);
      if (btn.dataset.col === 'add') cols.push({ size: 1, elements: [{ kind: 'door', size: 1, shelves: 3 }] });
      if (btn.dataset.col === 'del') cols.splice(ci, 1);
      if (btn.dataset.col === 'left') swap(cols, ci, ci - 1);
      if (btn.dataset.col === 'right') swap(cols, ci, ci + 1);
      const els = cols[ci]?.elements;
      if (btn.dataset.el === 'add') els.push({ kind: 'drawer', size: 1 });
      if (btn.dataset.el === 'del') els.splice(ei, 1);
      if (btn.dataset.el === 'up') swap(els, ei, ei - 1);
      if (btn.dataset.el === 'down') swap(els, ei, ei + 1);
    } else if (b.type === 'modell') {
      if (btn.id === 'up') return form.querySelector<HTMLInputElement>('#upFile')!.click();
      if (btn.dataset.mc === 'add') b.compartments.push({ label: `Fach ${b.compartments.length + 1}`, kind: 'shelf', box: [0.05, 0.95, 0.1, 0.9, 0.05, 0.95] });
      if (btn.dataset.mc === 'del') b.compartments.splice(Number(btn.closest<HTMLElement>('[data-mi]')!.dataset.mi), 1);
    } else return;
    draw();
    update();
  });
  form.addEventListener('change', async (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.id !== 'upFile' || draft.build.type !== 'modell') return;
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const r = await fetch(`/api/library/models/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, credentials: 'same-origin' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      draft.build.model = { url: d.url, name: d.name };
      draw();
      update();
      ctx.toast('Modell hochgeladen – jetzt die Fächer eintragen.');
    } catch (ex) {
      ctx.toast((ex as Error).message);
    }
  });
  el.querySelector('#save')!.addEventListener('click', async () => {
    const t = update();
    if (!t) return ctx.toast('Bitte zuerst die markierten Angaben korrigieren.');
    if (isNew && taken.has(t.id)) return ctx.toast(`Die Kennung „${t.id}“ gibt es schon.`);
    try {
      await api('PUT', `/api/objects/${encodeURIComponent(t.id)}`, { object: t });
      await loadLibrary();
      ctx.toast(`„${t.name}“ gespeichert – im Planen unter „Möbel“ zu finden.`);
      location.hash = '#/objekte';
    } catch (ex) {
      ctx.toast((ex as Error).message);
    }
  });
  el.querySelector('#exp')!.addEventListener('click', () => {
    const t = update();
    if (t) downloadObject(t);
  });
  // neue Kennung aus dem Namen ableiten, solange sie nicht von Hand geändert wurde
  if (isNew) {
    let auto = true;
    form.addEventListener('input', (e) => {
      const k = (e.target as HTMLElement).dataset.k;
      if (k === 'id') auto = false;
      if (k === 'name' && auto) {
        draft.id = copyId(`eigene.${slug(draft.name)}`, taken).replace(/^eigene\.eigene\./, 'eigene.');
        const idIn = form.querySelector<HTMLInputElement>('[data-k="id"]');
        if (idIn) idIn.value = draft.id;
      }
    });
  }
  draw();
  update();
  // Seite verlassen: Vorschau aufräumen
  const off = () => {
    if (!el.isConnected) {
      preview.dispose();
      setPreviewObject(null);
      window.removeEventListener('hashchange', off);
    }
  };
  window.addEventListener('hashchange', off);
};

/** kleine 3D-Vorschau: Möbel aus der Beschreibung, Fächer als farbige Rahmen */
function createPreview(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9b4aa', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  let obj: THREE.Object3D | null = null;
  let raf = 0;
  const size = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(size).observe(host);
  size();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();
  let lastSize = '';
  return {
    show(t: ObjectType) {
      if (obj) scene.remove(obj);
      const W = t.size.width;
      const D = t.size.depth;
      const H = t.size.height;
      const item = { id: 'vorschau', type: PREVIEW_TYPE, x: 0, y: 0, rotation: 0, width: W, depth: D, height: H, elevation: 0, ...(t.materials ? { materials: { ...t.materials } } : {}) };
      const g = new THREE.Group();
      g.add(buildItem(item as any, { project: store.project, ceilingHeight: 2.6 }));
      // Fächer als Rahmen (Lagerplätze)
      for (const c of objectCompartments(t, W, D, H)) {
        const b = new THREE.Box3(new THREE.Vector3(c.x0 / 100, c.y0 / 100, c.z0 / 100), new THREE.Vector3(c.x1 / 100, c.y1 / 100, c.z1 / 100));
        b.expandByScalar(-0.006);
        const h = new THREE.Box3Helper(b, new THREE.Color('#e0763f'));
        // auch hinter Türen und Fronten sichtbar
        Object.assign(h.material, { depthTest: false, transparent: true, opacity: 0.75 });
        h.renderOrder = 10;
        g.add(h);
      }
      scene.add(g);
      obj = g;
      // Kamera nur bei geänderten Maßen neu ausrichten
      const key = `${W}x${D}x${H}`;
      if (key !== lastSize) {
        lastSize = key;
        const r = Math.max(W, H, D) / 100;
        controls.target.set(0, H / 200, 0);
        camera.position.set(r * 0.9, H / 100 * 0.75 + r * 0.25, r * 1.6);
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}
