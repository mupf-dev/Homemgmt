// homemgmt-ng – Modul „Planungen“ (ehemals Küchenplaner-Server): gespeicherte Planungen (Entwürfe, Import ins Haus),
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

import { compareVersions, validateObjectType, type ObjectType } from '../../web/app/src/model/objects.ts';
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
      -- Objektbibliothek: Möbelarten als Daten (zuhause-objekt/1); source: eigene | community | datei
      CREATE TABLE IF NOT EXISTS object_types (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'eigene',
        source_url TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kitchen_share ON kitchen_projects(share_token) WHERE share_token IS NOT NULL;`);
  });
  const db = () => core.db;

  const router = express.Router();
  // Body nur auf den eigenen Pfaden lesen – alle anderen Anfragen gehen unangetastet an das Lager-Modul
  const OWN = ['/api/projects', '/api/shared', '/api/admin', '/api/library', '/api/objects'];
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

  // --- Objektbibliothek: Möbelarten als Daten, eigener Bestand und Community-Katalog (eigenes Repo homemgmt-object-library, veröffentlicht über GitHub Pages) ---
  // Lesen: alle Angemeldeten (auch Wandterminals); Ändern und Installieren: wer planen darf (Admins immer)
  const requirePlanner = (req: Request, res: Response, next: NextFunction) => {
    const a = req.auth;
    if (a?.via !== 'session' || (a.person.role !== 'admin' && !a.person.can_plan)) return res.status(403).json({ error: 'Die Objektbibliothek ändern nur Personen mit dem Recht „Haus planen“.' });
    next();
  };
  const CATALOG_URL = (process.env.OBJECT_CATALOG_URL || 'https://mupf-dev.github.io/homemgmt-object-library/').replace(/\/?$/, '/');
  type ObjRow = { id: string; data: string; source: string; source_url: string | null; hidden: number; updated_at: string };
  const objRow = (r: ObjRow) => ({ object: JSON.parse(r.data) as ObjectType, source: r.source, sourceUrl: r.source_url, hidden: !!r.hidden, updatedAt: r.updated_at });
  const getObj = (id: string) => db().prepare('SELECT * FROM object_types WHERE id = ?').get(id) as ObjRow | undefined;
  const saveObj = (t: ObjectType, source: string, sourceUrl: string | null, by: number | null) => {
    db().prepare(`INSERT INTO object_types (id, data, source, source_url, created_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, source = excluded.source, source_url = excluded.source_url, hidden = 0, updated_at = datetime('now')`)
      .run(t.id, JSON.stringify(t), source, sourceUrl, by);
    return objRow(getObj(t.id)!);
  };
  const fail400 = (res: Response, e: unknown) => res.status(400).json({ error: (e as Error).message });

  router.get('/api/objects', requireUser, (_req, res) => {
    res.json({ objects: (db().prepare('SELECT * FROM object_types ORDER BY id').all() as ObjRow[]).map(objRow) });
  });
  // Eigene Möbelart anlegen oder ändern (Community-Möbelarten werden nicht verändert, sondern kopiert)
  router.put('/api/objects/:id', requireUser, requirePlanner, (req, res) => {
    let t: ObjectType;
    try {
      t = validateObjectType(req.body?.object);
    } catch (e) {
      return fail400(res, e);
    }
    if (t.id !== req.params.id) return res.status(400).json({ error: 'Kennung passt nicht zur Adresse.' });
    if (t.build.type === 'modell' && !t.build.model.url) return res.status(400).json({ error: 'Bitte zuerst ein 3D-Modell hochladen.' });
    const old = getObj(t.id);
    if (old?.source === 'community') return res.status(409).json({ error: 'Möbelarten aus dem Community-Katalog werden nicht verändert – bitte kopieren und die Kopie bearbeiten.' });
    res.json(saveObj(t, 'eigene', null, me(req)));
  });
  // Import einer Datei (.json); vorhandene Kennung nur mit replace
  router.post('/api/objects/import', requireUser, requirePlanner, (req, res) => {
    let t: ObjectType;
    try {
      t = validateObjectType(req.body?.object);
    } catch (e) {
      return fail400(res, e);
    }
    if (t.build.type === 'modell' && !t.build.model.url) return res.status(400).json({ error: 'Möbelarten mit 3D-Modell bitte über den Community-Katalog installieren (die Datei enthält das Modell nicht).' });
    if (getObj(t.id) && !req.body?.replace) return res.status(409).json({ error: `Die Möbelart „${t.id}“ gibt es schon.`, exists: true });
    res.json(saveObj(t, 'datei', null, me(req)));
  });
  router.patch('/api/objects/:id', requireUser, requirePlanner, (req, res) => {
    const id = String(req.params.id);
    if (!getObj(id)) return res.status(404).json({ error: 'Möbelart nicht gefunden.' });
    db().prepare("UPDATE object_types SET hidden = ?, updated_at = datetime('now') WHERE id = ?").run(req.body?.hidden ? 1 : 0, id);
    res.json(objRow(getObj(id)!));
  });
  router.delete('/api/objects/:id', requireUser, requirePlanner, (req, res) => {
    db().prepare('DELETE FROM object_types WHERE id = ?').run(String(req.params.id));
    res.json({ ok: true });
  });

  // Community-Katalog: index.json auf GitHub Pages (ohne Konto/Schlüssel), 30 Min. zwischengespeichert
  let catalogCache: { at: number; data: any } | null = null;
  const fetchCatalog = async () => {
    if (catalogCache && Date.now() - catalogCache.at < 30 * 60000) return catalogCache.data;
    const r = await fetch(CATALOG_URL + 'index.json', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Community-Katalog nicht erreichbar (${r.status}).`);
    const data = await r.json();
    if (data?.format !== 'zuhause-katalog/1' || !Array.isArray(data.objects)) throw new Error('Community-Katalog hat ein unbekanntes Format.');
    catalogCache = { at: Date.now(), data };
    return data;
  };
  router.get('/api/objects/community', requireUser, async (_req, res) => {
    try {
      const cat = await fetchCatalog();
      const installed = new Map((db().prepare('SELECT * FROM object_types').all() as ObjRow[]).map((r) => [r.id, objRow(r)]));
      res.json({
        url: CATALOG_URL,
        objects: cat.objects.slice(0, 500).map((o: any) => {
          const have = installed.get(String(o.id));
          return {
            id: String(o.id), name: str(o.name, 60), group: str(o.group, 40), version: str(o.version, 20), author: str(o.author, 60),
            license: str(o.license, 40), description: str(o.description, 500), file: str(o.file, 200),
            preview: o.preview && /^[\w./-]+\.svg$/.test(String(o.preview)) && !String(o.preview).includes('..') ? CATALOG_URL + String(o.preview) : null,
            places: Number.isFinite(o.places) ? Number(o.places) : null,
            size: Array.isArray(o.size) && o.size.length === 3 && o.size.every((v: unknown) => Number.isFinite(v)) ? o.size.map(Number) : null,
            installed: have ? have.object.version : null,
            update: !!have && have.source === 'community' && compareVersions(String(o.version), have.object.version) > 0,
          };
        }),
      });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });
  // Installieren bzw. aktualisieren: Möbelart laden, prüfen, ggf. 3D-Modell herunterladen und ablegen
  router.post('/api/objects/community/install', requireUser, requirePlanner, async (req, res) => {
    try {
      const cat = await fetchCatalog();
      const entry = cat.objects.find((o: any) => String(o.id) === String(req.body?.id));
      if (!entry) return res.status(404).json({ error: 'Nicht im Community-Katalog.' });
      const file = String(entry.file ?? '');
      if (!/^[\w./-]+\.json$/.test(file) || file.includes('..')) return res.status(400).json({ error: 'Ungültiger Eintrag im Katalog.' });
      const url = CATALOG_URL + file;
      const raw = await fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => {
        if (!r.ok) throw new Error(`Möbelart nicht ladbar (${r.status}).`);
        return r.json();
      });
      const t = validateObjectType(raw);
      if (t.id !== entry.id) throw new Error('Kennung der Datei passt nicht zum Katalog.');
      const old = getObj(t.id);
      if (old && old.source !== 'community') return res.status(409).json({ error: `Es gibt schon eine eigene Möbelart „${t.id}“.` });
      if (t.build.type === 'modell' && t.build.model.file) {
        const glb = await fetch(CATALOG_URL + t.build.model.file, { signal: AbortSignal.timeout(60000) }).then(async (r) => {
          if (!r.ok) throw new Error(`3D-Modell nicht ladbar (${r.status}).`);
          return Buffer.from(await r.arrayBuffer());
        });
        t.build.model.url = library.uploadModel(glb, t.build.model.name || t.name).url;
      }
      res.json(saveObj(t, 'community', url, me(req)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // importierte Texturen und Modelle (unveränderlich je Quelle/ID/Auflösung)
  router.use('/library', express.static(library.root, { maxAge: '30d', immutable: true, index: false }));

  return router;
}
