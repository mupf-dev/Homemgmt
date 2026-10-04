// Konto in der App: Anmelden (E-Mail – oder per Kachel im Lager, dieselbe Sitzung), Passwort, Benutzerverwaltung und
// gespeicherte Planungen (frühere Küchenplanungen) als Etage ins Haus übernehmen. Das Haus selbst speichert HouseSync.
import type { Project } from './model/types.ts';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'pending';
  createdAt: string;
}

interface ProjectMeta {
  id: number;
  name: string;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Helpers {
  modal: (title: string, body: string, footer?: string) => { el: HTMLElement; close: () => void };
  toast: (msg: string) => void;
  esc: (s: string) => string;
  /** An-/Abmeldung (auch beim ersten Abgleich) */
  onUser: (user: User | null) => void;
  /** Gespeicherte Planung übernehmen: als neue Etage oder anstelle der aktuellen Etage */
  importPlan: (data: Project, name: string, mode: 'new' | 'replace') => void;
}

async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* leer */
  }
  if (!res.ok) throw new Error(data?.error ?? `Serverfehler (${res.status})`);
  return data as T;
}

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export class Account {
  user: User | null = null;
  private firstUser = false;
  private registrationEnabled = true;
  private requireApproval = false;
  private pendingCount = 0;
  private serverAvailable = true;
  private menuOpen = false;
  /** Platz für die Speicheranzeige des Hauses (HouseSync) */
  statusEl: HTMLElement | null = null;

  constructor(private root: HTMLElement, private h: Helpers) {
    document.addEventListener('click', (e) => {
      if (this.menuOpen && !this.root.contains(e.target as Node)) this.toggleMenu(false);
    });
  }

  async refresh() {
    try {
      const r = await api<{ user: User | null; firstUser: boolean; registrationEnabled: boolean; requireApproval: boolean }>('/auth/me');
      this.user = r.user;
      this.firstUser = r.firstUser;
      this.registrationEnabled = r.registrationEnabled;
      this.requireApproval = r.requireApproval;
      this.serverAvailable = true;
    } catch {
      this.serverAvailable = false;
      this.user = null;
    }
    this.render();
    this.refreshPending();
    return this.user;
  }

  /** Anzahl wartender Freigaben für Administratoren */
  private async refreshPending() {
    if (this.user?.role !== 'admin') return;
    try {
      this.pendingCount = (await api<{ pending: number }>('/admin/settings')).pending;
    } catch {
      this.pendingCount = 0;
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Kopfzeile

  private render() {
    const { esc } = this.h;
    if (!this.serverAvailable) {
      this.root.innerHTML = `<span class="acc-status warn" title="Server nicht erreichbar – Änderungen werden nur in diesem Browser gespeichert">Offline</span>`;
      this.statusEl = null;
      return;
    }
    if (!this.user) {
      this.root.innerHTML = `<button class="btn primary" data-acc="login">Anmelden</button>`;
      this.root.querySelector('[data-acc="login"]')!.addEventListener('click', () => (location.hash = '#/lager'));
      this.statusEl = null;
      return;
    }
    const u = this.user;
    this.root.innerHTML = `
      <span class="acc-status" id="accStatus"></span>
      <div class="acc-menu">
        <button class="btn" data-acc="menu"><span class="avatar">${esc(u.name.slice(0, 1).toUpperCase())}</span>${esc(u.name)}${this.pendingCount ? `<span class="badge" title="${this.pendingCount} Konto/Konten warten auf Freigabe">${this.pendingCount}</span>` : ''} ▾</button>
        <div class="dropdown" hidden>
          <div class="dd-head"><b>${esc(u.name)}</b><small>${esc(u.email || 'ohne E-Mail')}${u.role === 'admin' ? ' · Administrator' : ''}</small></div>
          <a class="dd-link" href="#/lager">Zum Lager (Scannen, Einkaufsliste …)</a>
          ${u.role === 'admin' ? '<button data-acc="plans">Gespeicherte Planungen übernehmen …</button>' : ''}
          <button data-acc="password">Passwort ändern</button>
          ${u.role === 'admin' ? `<button data-acc="admin">Benutzerverwaltung${this.pendingCount ? ` <span class="badge">${this.pendingCount}</span>` : ''}</button>` : ''}
          <hr />
          <button data-acc="logout">Abmelden</button>
        </div>
      </div>`;
    this.statusEl = this.root.querySelector('#accStatus');
    const on = (k: string, fn: () => void) =>
      this.root.querySelector(`[data-acc="${k}"]`)?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (k !== 'menu') this.toggleMenu(false);
        fn();
      });
    on('menu', () => this.toggleMenu(!this.menuOpen));
    on('plans', () => this.openPlans());
    on('password', () => this.openPassword());
    on('admin', () => this.openAdmin());
    on('logout', () => this.logout());
    document.dispatchEvent(new CustomEvent('zh-account-render'));
  }

  private toggleMenu(open: boolean) {
    this.menuOpen = open;
    const dd = this.root.querySelector<HTMLElement>('.dropdown');
    if (dd) dd.hidden = !open;
  }

  private async logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* ignorieren */
    }
    this.user = null;
    this.render();
    this.h.onUser(null);
    this.h.toast('Abgemeldet.');
  }

  // -------------------------------------------------------------------------
  // Dialoge

  async openLogin(mode: 'login' | 'register' = this.firstUser ? 'register' : 'login') {
    await this.refresh();
    if (!this.registrationEnabled) mode = 'login';
    const body = `
      ${this.registrationEnabled ? '<div class="seg auth-tabs"><button data-mode="login">Anmelden</button><button data-mode="register">Registrieren</button></div>' : ''}
      <form class="auth-form" novalidate>
        <p class="hint" data-first ${this.firstUser ? '' : 'hidden'}>Es gibt noch kein Konto. Das erste registrierte Konto wird <b>Administrator</b>.</p>
        <p class="hint" data-only="register" ${this.requireApproval ? '' : 'hidden'}>Neue Konten müssen von einem Administrator freigegeben werden, bevor du dich anmelden kannst.</p>
        ${this.registrationEnabled ? '' : '<p class="hint">Neue Registrierungen sind derzeit deaktiviert.</p>'}
        <p class="form-ok" hidden></p>
        <label class="field" data-only="register"><span>Name</span><input type="text" name="name" autocomplete="name" /></label>
        <label class="field"><span>E-Mail</span><input type="text" name="email" autocomplete="email" inputmode="email" required /></label>
        <label class="field"><span>Passwort</span><input type="password" name="password" autocomplete="current-password" required /></label>
        <label class="field" data-only="register" data-field><span>Passwort wiederholen</span><input type="password" name="password2" autocomplete="new-password" /></label>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center"></button>
        <p class="hint">Im Lager meldest du dich per Kachel an – dieselbe Anmeldung gilt hier. Ohne Anmeldung kannst du planen; gespeichert wird dann nur in diesem Browser.</p>
      </form>`;
    const m = this.h.modal('Konto', body);
    m.el.querySelector('.modal')!.classList.add('narrow');
    const form = m.el.querySelector('form')!;
    const err = form.querySelector<HTMLElement>('.form-error')!;
    const ok = form.querySelector<HTMLElement>('.form-ok')!;
    const setMode = (md: 'login' | 'register') => {
      mode = md;
      m.el.querySelectorAll<HTMLElement>('.auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === md));
      form.querySelectorAll<HTMLElement>('[data-only="register"]').forEach((el) => {
        el.hidden = md !== 'register' || (!el.matches('label') && !this.requireApproval);
      });
      (form.querySelector('[name="password"]') as HTMLInputElement).autocomplete = md === 'register' ? 'new-password' : 'current-password';
      form.querySelector('button[type="submit"]')!.textContent = md === 'register' ? 'Konto erstellen' : 'Anmelden';
      err.hidden = true;
    };
    m.el.querySelectorAll<HTMLElement>('.auth-tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as any)));
    setMode(mode);
    (form.querySelector(mode === 'register' ? '[name="name"]' : '[name="email"]') as HTMLInputElement).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const email = String(fd.get('email') ?? '').trim();
      const password = String(fd.get('password') ?? '');
      err.hidden = true;
      ok.hidden = true;
      if (mode === 'register' && password !== String(fd.get('password2') ?? '')) {
        err.textContent = 'Die Passwörter stimmen nicht überein.';
        err.hidden = false;
        return;
      }
      try {
        const r = await api<{ user: User | null; pending?: boolean; message?: string }>(`/auth/${mode}`, {
          method: 'POST',
          body: mode === 'register' ? { email, password, name: String(fd.get('name') ?? '') } : { email, password },
        });
        if (r.pending || !r.user) {
          setMode('login');
          form.reset();
          ok.textContent = r.message ?? 'Konto angelegt – bitte auf die Freigabe warten.';
          ok.hidden = false;
          return;
        }
        this.user = r.user;
        this.firstUser = false;
        m.close();
        this.render();
        this.refreshPending();
        this.h.toast(mode === 'register' ? `Willkommen, ${r.user.name}!${r.user.role === 'admin' ? ' Du bist Administrator.' : ''}` : `Angemeldet als ${r.user.name}.`);
        this.h.onUser(this.user);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
      }
    });
  }

  /** Gespeicherte Planungen (frühere Küchenplanungen) als Etage ins Haus übernehmen */
  async openPlans() {
    const { esc } = this.h;
    const m = this.h.modal('Gespeicherte Planungen übernehmen', '<p class="hint">Lade …</p>');
    m.el.querySelector('.modal')!.classList.add('wide');
    const body = m.el.querySelector('.body')!;
    let list: ProjectMeta[] = [];
    try {
      list = (await api<{ projects: ProjectMeta[] }>('/projects')).projects;
    } catch (e) {
      body.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
      return;
    }
    if (!list.length) {
      body.innerHTML = '<p class="hint">In deinem Konto sind keine Planungen gespeichert.</p>';
      return;
    }
    body.innerHTML = `<p class="hint">Planungen aus dem früheren Küchenplaner. Eine Planung wird zu einer Etage des Hauses – mit Wänden, Fenstern, Möbeln und Grundriss-Vorlage. Danach im Reiter „Etage“ die Räume festlegen.</p>
      <div class="proj-grid">${list
        .map((p) => `<div class="proj-card" data-id="${p.id}">
          <div class="proj-thumb" ${p.thumbnail ? `style="background-image:url(${p.thumbnail})"` : ''}>${p.thumbnail ? '' : 'Keine Vorschau'}</div>
          <div class="proj-info"><b>${esc(p.name)}</b><small>Zuletzt gespeichert ${fmtDate(p.updatedAt)}</small></div>
          <div class="proj-actions"><button class="btn primary" data-act="new">Als neue Etage</button><button class="btn" data-act="replace">Aktuelle Etage ersetzen</button></div>
        </div>`)
        .join('')}</div>`;
    body.querySelectorAll<HTMLElement>('.proj-card').forEach((card) => {
      const id = Number(card.dataset.id);
      const name = list.find((x) => x.id === id)!.name;
      card.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
        b.addEventListener('click', async () => {
          const mode = b.dataset.act as 'new' | 'replace';
          if (mode === 'replace' && !confirm('Wände, Öffnungen und Möbel der aktuellen Etage werden ersetzt. Räume bleiben, soweit sie im neuen Grundriss liegen. Fortfahren?')) return;
          try {
            const p = await api<{ data: Project }>(`/projects/${id}`);
            m.close();
            this.h.importPlan(p.data, name, mode);
          } catch (e) {
            this.h.toast((e as Error).message);
          }
        }),
      );
    });
  }

  private openPassword() {
    const m = this.h.modal(
      'Passwort ändern',
      `<form class="auth-form">
        <label class="field"><span>Aktuelles Passwort</span><input type="password" name="current" autocomplete="current-password" /></label>
        <label class="field"><span>Neues Passwort (min. 8 Zeichen)</span><input type="password" name="password" autocomplete="new-password" /></label>
        <label class="field"><span>Neues Passwort wiederholen</span><input type="password" name="password2" autocomplete="new-password" /></label>
        <p class="form-error" hidden></p>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center">Passwort ändern</button>
      </form>`,
    );
    m.el.querySelector('.modal')!.classList.add('narrow');
    const form = m.el.querySelector('form')!;
    const err = form.querySelector<HTMLElement>('.form-error')!;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (fd.get('password') !== fd.get('password2')) {
        err.textContent = 'Die neuen Passwörter stimmen nicht überein.';
        err.hidden = false;
        return;
      }
      try {
        await api('/auth/password', { method: 'POST', body: { current: fd.get('current'), password: fd.get('password') } });
        m.close();
        this.h.toast('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.hidden = false;
      }
    });
  }

  private async openAdmin() {
    const { esc } = this.h;
    const m = this.h.modal('Benutzerverwaltung', '<p class="hint">Lade …</p>');
    const body = m.el.querySelector('.body')!;
    const act = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (ex) {
        this.h.toast((ex as Error).message);
      }
      draw();
    };
    const draw = async () => {
      let users: (User & { projects: number })[] = [];
      let settings = { registrationEnabled: true, requireApproval: false };
      try {
        const [u, st] = await Promise.all([
          api<{ users: (User & { projects: number })[] }>('/admin/users'),
          api<{ settings: typeof settings; pending: number }>('/admin/settings'),
        ]);
        users = u.users;
        settings = st.settings;
        this.pendingCount = st.pending;
        this.render();
      } catch (e) {
        body.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
        return;
      }
      const pending = users.filter((u) => u.status === 'pending');
      body.innerHTML = `
        <h3>Registrierung</h3>
        <label class="row switch"><input type="checkbox" data-set="registrationEnabled" ${settings.registrationEnabled ? 'checked' : ''} />
          <span><b>Registrierung erlauben</b><small>Wenn deaktiviert, können sich keine neuen Benutzer selbst registrieren.</small></span></label>
        <label class="row switch"><input type="checkbox" data-set="requireApproval" ${settings.requireApproval ? 'checked' : ''} />
          <span><b>Neue Benutzer müssen freigegeben werden</b><small>Neue Konten können das Tool erst nutzen, nachdem ein Administrator sie freigegeben hat.</small></span></label>
        ${pending.length ? `<div class="pending-note">${pending.length > 1 ? `${pending.length} Konten warten` : '1 Konto wartet'} auf Freigabe.</div>` : ''}
        <h3>Benutzer</h3>
        <table class="user-table">
        <thead><tr><th>Name</th><th>E-Mail</th><th>Planungen</th><th>Seit</th><th>Status</th><th>Rolle</th><th></th></tr></thead>
        <tbody>${users
          .map((u) => {
            const self = u.id === this.user?.id;
            const actions = self
              ? ''
              : u.status === 'pending'
                ? '<button class="btn primary" data-approve>Freigeben</button><button class="btn danger" data-del>Ablehnen</button>'
                : '<button class="btn" data-lock title="Zugang sperren, bis er wieder freigegeben wird">Sperren</button><button class="btn danger icon" data-del title="Benutzer löschen">✕</button>';
            return `<tr data-id="${u.id}" class="${u.status === 'pending' ? 'is-pending' : ''}">
              <td>${esc(u.name)}${self ? ' <small>(du)</small>' : ''}</td>
              <td>${esc(u.email)}</td>
              <td>${u.projects}</td>
              <td>${fmtDate(u.createdAt).split(',')[0]}</td>
              <td>${u.status === 'pending' ? '<span class="pill warn">Wartet auf Freigabe</span>' : '<span class="pill">Aktiv</span>'}</td>
              <td><select data-role ${self ? 'title="Eigene Rolle"' : ''}><option value="user" ${u.role === 'user' ? 'selected' : ''}>Benutzer</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select></td>
              <td><div class="row-actions">${actions}</div></td>
            </tr>`;
          })
          .join('')}</tbody></table>`;

      body.querySelectorAll<HTMLInputElement>('[data-set]').forEach((cb) =>
        cb.addEventListener('change', () => act(() => api('/admin/settings', { method: 'PUT', body: { [cb.dataset.set!]: cb.checked } }))),
      );
      body.querySelectorAll<HTMLElement>('tr[data-id]').forEach((row) => {
        const id = Number(row.dataset.id);
        const u = users.find((x) => x.id === id)!;
        row.querySelector<HTMLSelectElement>('[data-role]')!.addEventListener('change', async (e) => {
          const role = (e.target as HTMLSelectElement).value;
          if (id === this.user?.id && role === 'user' && !confirm('Du entziehst dir selbst die Administratorrechte. Fortfahren?')) return draw();
          try {
            await api(`/admin/users/${id}`, { method: 'PUT', body: { role } });
            if (id === this.user?.id && role === 'user') {
              this.user.role = 'user';
              this.pendingCount = 0;
              m.close();
              this.render();
              return;
            }
          } catch (ex) {
            this.h.toast((ex as Error).message);
          }
          draw();
        });
        row.querySelector('[data-approve]')?.addEventListener('click', () =>
          act(async () => {
            await api(`/admin/users/${id}`, { method: 'PUT', body: { status: 'active' } });
            this.h.toast(`${u.name} wurde freigegeben.`);
          }),
        );
        row.querySelector('[data-lock]')?.addEventListener('click', () => {
          if (!confirm(`Zugang von „${u.name}“ sperren? Der Benutzer wird sofort abgemeldet und muss erneut freigegeben werden.`)) return;
          act(() => api(`/admin/users/${id}`, { method: 'PUT', body: { status: 'pending' } }));
        });
        row.querySelector('[data-del]')?.addEventListener('click', () => {
          const msg = u.status === 'pending' ? `Registrierung von „${u.name}“ (${u.email}) ablehnen und Konto löschen?` : `Benutzer „${u.name}“ (${u.email}) mit allen ${u.projects} Planungen endgültig löschen?`;
          if (!confirm(msg)) return;
          act(() => api(`/admin/users/${id}`, { method: 'DELETE' }));
        });
      });
    };
    draw();
  }
}
