// Zuhause – Modul „Planungen“ (ehemals Küchenplaner-Server): gespeicherte Planungen (Entwürfe, Import ins Haus),
// Showroom-Links, Benutzerverwaltung auf dem gemeinsamen Konto und Online-Materialbibliothek.

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createLibrary, type Resolution, type Source } from './library.ts';

export interface Person {
  id: number;
  name: string;
  role: 'user' | 'admin';
  status: string;
  /** darf den Hausplan ändern (Admins immer) */
  can_plan?: number;
}
export interface Auth {
  person: Person;
  via: 'session' | 'key' | 'terminal';
  scope: 'read' | 'write';
}

/** Was das Lager-Modul (gemeinsames Konto, Haus) dem Küchen-Modul bereitstellt */
export interface Core {
  readonly db: DatabaseSync;
  authenticate(req: Request): Auth | null;
  onOpen(hook: (db: DatabaseSync) => void): void;
  authSettings(): { registrationEnabled: boolean; requireApproval: boolean };
  setAuthSetting(name: 'registrationEnabled' | 'requireApproval', value: boolean): void;
  HttpError: new (status: number, message: string) => Error & { status: number };
}

declare global {
  namespace Express {
    interface Request {
      auth?: Auth | null;
    }
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function createKitchen(core: Core, { dataDir }: { dataDir: string }) {
  core.onOpen((db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kitchen_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        thumbnail TEXT,
        share_token TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_kitchen_person ON kitchen_projects(person_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_share ON kitchen_projects(share_token) WHERE share_token IS NOT NULL;`);
  });
  const db = () => core.db;

  const router = express.Router();
  // Body nur auf den eigenen Pfaden lesen – alle anderen Anfragen gehen unangetastet an das Lager-Modul
  const OWN = ['/api/projects', '/api/shared', '/api/admin', '/api/library'];
  router.use(OWN, (req, _res, next) => {
    req.auth = core.authenticate(req);
    next();
  });
  router.use(OWN, express.json({ limit: '60mb' }));
  // Nur JSON für schreibende Aufrufe (erschwert CSRF über einfache Formulare)
  router.use(OWN, (req, res, next) => {
    if (req.originalUrl.startsWith('/api/library/models/upload')) return next(); // Datei (Rohdaten)
    if ((req.method === 'POST' || req.method === 'PUT') && !req.is('application/json')) return res.status(415).json({ error: 'JSON erwartet.' });
    next();
  });

  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Bitte anmelden.' });
    if (req.auth.scope === 'read' && req.method !== 'GET') return res.status(403).json({ error: 'Dieser API-Schlüssel darf nur lesen.' });
    if (req.auth.via === 'terminal' && req.method !== 'GET') return res.status(403).json({ error: 'Am Wandterminal nicht möglich.' });
    next();
  };
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.via !== 'session' || req.auth.person.role !== 'admin') return res.status(403).json({ error: 'Nur für Admins.' });
    next();
  };
  const me = (req: Request) => req.auth!.person.id;

  // --- Planungen ---
  const projectMeta = (p: any) => ({
    id: p.id, name: p.name, thumbnail: p.thumbnail, createdAt: p.created_at, updatedAt: p.updated_at, shareToken: p.share_token ?? null,
  });
  const META = 'id, name, thumbnail, created_at, updated_at, share_token';
  const validProject = (data: unknown) => !!data && typeof data === 'object' && Array.isArray((data as any).walls) && Array.isArray((data as any).items);
  const thumb = (v: unknown) => (typeof v === 'string' && v.startsWith('data:image/') && v.length < 400_000 ? v : null);

  router.get('/api/projects', requireUser, (req, res) => {
    const rows = db().prepare(`SELECT ${META} FROM kitchen_projects WHERE person_id = ? ORDER BY updated_at DESC`).all(me(req));
    res.json({ projects: rows.map(projectMeta) });
  });

  router.get('/api/projects/:id', requireUser, (req, res) => {
    const row = db().prepare('SELECT * FROM kitchen_projects WHERE id = ? AND person_id = ?').get(Number(req.params.id), me(req)) as any;
    if (!row) return res.status(404).json({ error: 'Planung nicht gefunden.' });
    res.json({ ...projectMeta(row), data: JSON.parse(row.data) });
  });

  router.post('/api/projects', requireUser, (req, res) => {
    const { data } = req.body ?? {};
    if (!validProject(data)) return res.status(400).json({ error: 'Ungültige Planung.' });
    const name = str(req.body.name, 120) || 'Unbenannte Küche';
    const r = db().prepare('INSERT INTO kitchen_projects (person_id, name, data, thumbnail) VALUES (?, ?, ?, ?)')
      .run(me(req), name, JSON.stringify(data), thumb(req.body.thumbnail));
    res.status(201).json(projectMeta(db().prepare(`SELECT ${META} FROM kitchen_projects WHERE id = ?`).get(r.lastInsertRowid)));
  });

  router.put('/api/projects/:id', requireUser, (req, res) => {
    const id = Number(req.params.id);
    if (!db().prepare('SELECT 1 FROM kitchen_projects WHERE id = ? AND person_id = ?').get(id, me(req))) return res.status(404).json({ error: 'Planung nicht gefunden.' });
    const { data } = req.body ?? {};
    const name = str(req.body?.name, 120);
    if (data !== undefined && !validProject(data)) return res.status(400).json({ error: 'Ungültige Planung.' });
    db().prepare(`UPDATE kitchen_projects SET name = COALESCE(?, name), data = COALESCE(?, data), thumbnail = COALESCE(?, thumbnail),
      updated_at = datetime('now') WHERE id = ?`).run(name || null, data !== undefined ? JSON.stringify(data) : null, thumb(req.body?.thumbnail), id);
    res.json(projectMeta(db().prepare(`SELECT ${META} FROM kitchen_projects WHERE id = ?`).get(id)));
  });

  router.delete('/api/projects/:id', requireUser, (req, res) => {
    const r = db().prepare('DELETE FROM kitchen_projects WHERE id = ? AND person_id = ?').run(Number(req.params.id), me(req));
    if (!r.changes) return res.status(404).json({ error: 'Planung nicht gefunden.' });
    res.json({ ok: true });
  });

  // --- Teilen (nur ansehen, ohne Anmeldung) ---
  router.post('/api/projects/:id/share', requireUser, (req, res) => {
    const row = db().prepare('SELECT id, share_token FROM kitchen_projects WHERE id = ? AND person_id = ?').get(Number(req.params.id), me(req)) as any;
    if (!row) return res.status(404).json({ error: 'Planung nicht gefunden.' });
    let token: string = row.share_token;
    if (!token) {
      token = randomBytes(18).toString('base64url');
      db().prepare('UPDATE kitchen_projects SET share_token = ? WHERE id = ?').run(token, row.id);
    }
    res.json({ token });
  });

  router.delete('/api/projects/:id/share', requireUser, (req, res) => {
    const r = db().prepare('UPDATE kitchen_projects SET share_token = NULL WHERE id = ? AND person_id = ?').run(Number(req.params.id), me(req));
    if (!r.changes) return res.status(404).json({ error: 'Planung nicht gefunden.' });
    res.json({ ok: true });
  });

  router.get('/api/shared/:token', (req, res) => {
    const token = String(req.params.token);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return res.status(404).json({ error: 'Link ungültig.' });
    const row = db().prepare('SELECT name, data, updated_at FROM kitchen_projects WHERE share_token = ?').get(token) as any;
    if (!row) return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ name: row.name, updatedAt: row.updated_at, data: JSON.parse(row.data) });
  });

  // --- Benutzerverwaltung (Konten sind die Personen des Lagers) ---
  const activeAdmins = (exceptId = 0) => (db().prepare(
    "SELECT COUNT(*) AS n FROM persons WHERE role = 'admin' AND status = 'active' AND archived = 0 AND password_hash IS NOT NULL AND id != ?",
  ).get(exceptId) as { n: number }).n;

  router.get('/api/admin/users', requireUser, requireAdmin, (_req, res) => {
    const rows = db().prepare(`SELECT p.id, p.email, p.name, p.role, p.status, p.created_at,
        (SELECT COUNT(*) FROM kitchen_projects k WHERE k.person_id = p.id) AS projects
      FROM persons p WHERE p.archived = 0 ORDER BY p.status = 'pending' DESC, p.created_at`).all() as any[];
    res.json({ users: rows.map((u) => ({ id: u.id, email: u.email ?? '', name: u.name, role: u.role, status: u.status, createdAt: u.created_at, projects: u.projects })) });
  });

  router.get('/api/admin/settings', requireUser, requireAdmin, (_req, res) => {
    const pending = (db().prepare("SELECT COUNT(*) AS n FROM persons WHERE status = 'pending' AND archived = 0").get() as { n: number }).n;
    res.json({ settings: core.authSettings(), pending });
  });

  router.put('/api/admin/settings', requireUser, requireAdmin, (req, res) => {
    for (const key of ['registrationEnabled', 'requireApproval'] as const) {
      const v = req.body?.[key];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') return res.status(400).json({ error: `Ungültiger Wert für ${key}.` });
      core.setAuthSetting(key, v);
    }
    res.json({ settings: core.authSettings() });
  });

  router.put('/api/admin/users/:id', requireUser, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const { role, status } = req.body ?? {};
    if (role !== undefined && role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Ungültige Rolle.' });
    if (status !== undefined && status !== 'active' && status !== 'pending') return res.status(400).json({ error: 'Ungültiger Status.' });
    const target = db().prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    const losesAdmin = target.role === 'admin' && target.status === 'active' && (role === 'user' || status === 'pending');
    if (losesAdmin && activeAdmins(id) === 0) return res.status(400).json({ error: 'Es muss mindestens ein aktiver Admin bleiben.' });
    if (role) db().prepare('UPDATE persons SET role = ? WHERE id = ?').run(role, id);
    if (status) {
      db().prepare('UPDATE persons SET status = ? WHERE id = ?').run(status, id);
      if (status === 'pending') db().prepare('DELETE FROM sessions WHERE person_id = ?').run(id); // gesperrt → sofort abmelden
    }
    res.json({ ok: true });
  });

  // Löschen nur ohne Lager-Buchungen – sonst im Lager archivieren oder zusammenführen (Verlauf bleibt erhalten)
  router.delete('/api/admin/users/:id', requireUser, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === me(req)) return res.status(400).json({ error: 'Das eigene Konto kann hier nicht gelöscht werden.' });
    const target = db().prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    if (target.role === 'admin' && activeAdmins(id) === 0) return res.status(400).json({ error: 'Es muss mindestens ein aktiver Admin bleiben.' });
    const used = (db().prepare('SELECT COUNT(*) AS n FROM movements WHERE person_id = ?').get(id) as { n: number }).n;
    if (used) return res.status(409).json({ error: 'Diese Person hat Buchungen im Lager. Bitte dort unter „Personen verwalten“ archivieren oder zusammenführen.' });
    db().prepare('DELETE FROM persons WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --- Online-Materialbibliotheken (Poly Haven, ambientCG) ---
  const library = createLibrary(dataDir);

  router.get('/api/library/search', requireUser, async (req, res) => {
    const source = (req.query.source === 'ambientcg' ? 'ambientcg' : 'polyhaven') as Source;
    try {
      res.json(await library.search(source, str(req.query.q, 100), Number(req.query.limit) || 48, Number(req.query.offset) || 0));
    } catch (e) {
      res.status(502).json({ error: `Bibliothek nicht erreichbar: ${(e as Error).message}` });
    }
  });

  router.post('/api/library/import', requireUser, async (req, res) => {
    try {
      res.json(await library.importTexture(req.body?.source as Source, String(req.body?.id ?? ''), (req.body?.res ?? '2k') as Resolution));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // --- 3D-Modelle: Möbel und Einrichtung (Poly Haven, eigene .glb) ---
  router.get('/api/library/models', requireUser, async (req, res) => {
    try {
      res.json(await library.searchModels(str(req.query.q, 100), str(req.query.cat, 30), Math.min(96, Number(req.query.limit) || 48), Math.max(0, Number(req.query.offset) || 0), req.query.all === '1', str(req.query.source, 20) || 'polyhaven'));
    } catch (e) {
      res.status(502).json({ error: `Bibliothek nicht erreichbar: ${(e as Error).message}` });
    }
  });
  router.post('/api/library/models/import', requireUser, async (req, res) => {
    try {
      const id = String(req.body?.id ?? '');
      res.json(req.body?.source === 'furnimesh' ? await library.importFurniMeshModel(id) : await library.importModel(id, (req.body?.res ?? '1k') as Resolution));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  router.post('/api/library/models/upload', requireUser, express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
    try {
      res.json(library.uploadModel(req.body as Buffer, str(req.query.name, 80)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // importierte Texturen und Modelle (unveränderlich je Quelle/ID/Auflösung)
  router.use('/library', express.static(library.root, { maxAge: '30d', immutable: true, index: false }));

  return router;
}
