// Zuhause – Modul „Haus“: der Hausplan (alle Etagen, Räume, Möbel) als gemeinsames Dokument und sein Abgleich mit
// dem Lager. Jeder Raum ist ein Lager (Kürzel des Raums), jedes Möbel mit Fächern eine Spalte, jedes Fach ein Platz:
// KU-B2 = Küche, Möbel B, Fach 2. Wandert ein Möbel in einen anderen Raum oder bekommt es eine andere Spalte, ziehen
// Plätze und Gegenstände mit; entfernte Fächer mit Inhalt bleiben als Platz erhalten (nicht mehr im Plan).

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { migrateHouse, normalizeHouse, storageUnits } from '../../web/app/src/model/house.ts';
import { itemName } from '../../web/app/src/model/storage.ts';
import type { House } from '../../web/app/src/model/types.ts';
import type { Core } from '../kueche/index.ts';

type Row = Record<string, any>;

export interface SyncResult {
  warehouses: number;
  created: number;
  updated: number;
  moved: number;
  removed: number;
  kept: number;
}

/** Plan-Lager und Plan-Plätze an den Hausplan angleichen (innerhalb einer Transaktion aufrufen) */
export function syncStorage(db: DatabaseSync, house: House, HttpError: Core['HttpError']): SyncResult {
  const res: SyncResult = { warehouses: 0, created: 0, updated: 0, moved: 0, removed: 0, kept: 0 };
  const units = storageUnits(house).filter((u) => u.code);
  const floorName = new Map(house.floors.map((f) => [f.id, f.name]));

  // 1. Lager je Raum
  const whId = new Map<string, number>();
  for (const u of units) {
    const name = u.name.slice(0, 40);
    const description = `Hausplan · ${floorName.get(u.floorId) ?? ''}`.trim();
    const cur = db.prepare('SELECT * FROM warehouses WHERE plan_key = ?').get(u.key) as Row | undefined;
    if (cur) {
      if (cur.code !== u.code || cur.name !== name || cur.description !== description) {
        db.prepare('UPDATE warehouses SET code = ?, name = ?, description = ? WHERE id = ?').run(u.code, name, description, cur.id);
      }
      whId.set(u.key, cur.id);
    } else {
      const r = db.prepare('INSERT INTO warehouses (code, name, description, plan_key) VALUES (?, ?, ?, ?)').run(u.code, name, description, u.key);
      whId.set(u.key, Number(r.lastInsertRowid));
    }
  }
  res.warehouses = units.length;

  // 2. gewünschte Plätze
  type Want = { wid: number; col: string; row: number; item: string; slot: number; name: string; category: string; description: string };
  const want = new Map<string, Want>();
  for (const u of units) {
    for (const s of u.items) {
      for (const c of s.compartments) {
        want.set(`${s.item.id}:${c.row}`, {
          wid: whId.get(u.key)!, col: s.col, row: c.row, item: s.item.id, slot: c.row,
          name: `${itemName(s.item)} · ${c.label}`.slice(0, 80), category: u.name.slice(0, 40), description: floorName.get(u.floorId) ?? '',
        });
      }
    }
  }

  const itemsAt = (wid: number, col: string, row: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM items WHERE warehouse_id = ? AND col = ? AND row = ?').get(wid, col, row) as { n: number }).n;
  const movePlace = (from: { wid: number; col: string; row: number }, to: { wid: number; col: string; row: number }) => {
    db.prepare('DELETE FROM fixture_slots WHERE warehouse_id = ? AND col = ? AND row = ?').run(from.wid, from.col, from.row); // altes Haus-Modell
    db.prepare('UPDATE places SET warehouse_id = ?, col = ?, row = ? WHERE warehouse_id = ? AND col = ? AND row = ?').run(to.wid, to.col, to.row, from.wid, from.col, from.row);
    db.prepare('UPDATE items SET warehouse_id = ?, col = ?, row = ? WHERE warehouse_id = ? AND col = ? AND row = ?').run(to.wid, to.col, to.row, from.wid, from.col, from.row);
  };

  // 3. vorhandene Plan-Plätze: behalten, umbenennen, verschieben oder entfernen
  const existing = db.prepare('SELECT warehouse_id AS wid, col, row, plan_item, plan_slot, name, category, description FROM places WHERE plan_item IS NOT NULL').all() as Row[];
  const moving: { tmp: { wid: number; col: string; row: number }; to: Want }[] = [];
  let tmpWid = -1;
  const seen = new Set<string>();
  for (const p of existing) {
    const k = `${p.plan_item}:${p.plan_slot}`;
    const w = want.get(k);
    if (!w || seen.has(k)) {
      if (itemsAt(p.wid, p.col, p.row)) {
        db.prepare("UPDATE places SET plan_item = NULL, plan_slot = NULL, name = ? WHERE warehouse_id = ? AND col = ? AND row = ?")
          .run(`${p.name} (nicht mehr im Plan)`.slice(0, 100), p.wid, p.col, p.row);
        res.kept++;
      } else {
        db.prepare('DELETE FROM places WHERE warehouse_id = ? AND col = ? AND row = ?').run(p.wid, p.col, p.row);
        res.removed++;
      }
      continue;
    }
    seen.add(k);
    if (p.wid === w.wid && p.col === w.col && p.row === w.row) {
      if (p.name !== w.name || p.category !== w.category || p.description !== w.description) {
        db.prepare('UPDATE places SET name = ?, category = ?, description = ? WHERE warehouse_id = ? AND col = ? AND row = ?')
          .run(w.name, w.category, w.description, p.wid, p.col, p.row);
        res.updated++;
      }
      want.delete(k);
      continue;
    }
    // erst auf einen freien Zwischenplatz, damit sich vertauschte Spalten nicht im Weg stehen
    const tmp = { wid: tmpWid--, col: p.col, row: p.row };
    movePlace({ wid: p.wid, col: p.col, row: p.row }, tmp);
    moving.push({ tmp, to: w });
    want.delete(k);
  }
  const occupy = (w: Want) => {
    const cur = db.prepare('SELECT plan_item FROM places WHERE warehouse_id = ? AND col = ? AND row = ?').get(w.wid, w.col, w.row) as Row | undefined;
    if (!cur) return;
    // Ziel ist ein von Hand angelegter Platz (oder ein abgehängter Plan-Platz): leer → übernehmen, mit Inhalt → Konflikt
    if (itemsAt(w.wid, w.col, w.row)) {
      const code = (db.prepare('SELECT code FROM warehouses WHERE id = ?').get(w.wid) as Row).code;
      throw new HttpError(409, `Platz ${code}-${w.col}${w.row} ist schon belegt (nicht aus dem Hausplan). Bitte die Gegenstände dort zuerst umlagern.`);
    }
    db.prepare('DELETE FROM places WHERE warehouse_id = ? AND col = ? AND row = ?').run(w.wid, w.col, w.row);
  };
  for (const m of moving) {
    occupy(m.to);
    movePlace(m.tmp, { wid: m.to.wid, col: m.to.col, row: m.to.row });
    db.prepare('UPDATE places SET name = ?, category = ?, description = ? WHERE warehouse_id = ? AND col = ? AND row = ?')
      .run(m.to.name, m.to.category, m.to.description, m.to.wid, m.to.col, m.to.row);
    res.moved++;
  }

  // 4. neue Fächer anlegen
  for (const w of want.values()) {
    occupy(w);
    db.prepare('INSERT INTO places (warehouse_id, col, row, name, category, description, plan_item, plan_slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(w.wid, w.col, w.row, w.name, w.category, w.description, w.item, w.slot);
    res.created++;
  }

  // 5. Lager von Räumen, die es nicht mehr gibt: leer → löschen, sonst vom Plan lösen
  const keys = new Set(units.map((u) => u.key));
  for (const wh of db.prepare('SELECT * FROM warehouses WHERE plan_key IS NOT NULL').all() as Row[]) {
    if (keys.has(wh.plan_key)) continue;
    const used = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE warehouse_id = ?').get(wh.id) as { n: number }).n;
    if (used) db.prepare("UPDATE warehouses SET plan_key = NULL, name = ? WHERE id = ?").run(`${wh.name} (nicht mehr im Plan)`.slice(0, 40), wh.id);
    else {
      db.prepare('DELETE FROM places WHERE warehouse_id = ?').run(wh.id);
      db.prepare('DELETE FROM warehouses WHERE id = ?').run(wh.id);
    }
  }
  return res;
}

type Saved = { house: House; version: number; sync: SyncResult };

/**
 * Hausplan speichern: normalisieren, Lager abgleichen, Version hochzählen – alles in einer Transaktion.
 * baseVersion = zuletzt geladener Stand (sonst Konflikt, 409); undefined = ohne Prüfung.
 */
export function saveHouse(db: DatabaseSync, raw: unknown, personId: number | null, HttpError: Core['HttpError'], baseVersion?: number): Saved {
  let house: House;
  try {
    house = migrateHouse(raw);
  } catch {
    throw new HttpError(400, 'Ungültiger Hausplan.');
  }
  if (!house.floors.length || house.floors.length > 30) throw new HttpError(400, 'Ein Haus braucht 1 bis 30 Etagen.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT h.*, p.name AS updated_by_name FROM house h LEFT JOIN persons p ON p.id = h.updated_by WHERE h.id = 1').get() as Row | undefined;
    const version = row?.version ?? 0;
    if (baseVersion !== undefined && baseVersion !== version) {
      throw new HttpError(409, `Der Hausplan wurde inzwischen von ${row?.updated_by_name ?? 'jemand anderem'} geändert. Bitte neu laden.`);
    }
    // Kürzel anderer Lager sind reserviert (Hauptlager H, Garage G …)
    const reserved = new Set((db.prepare('SELECT code FROM warehouses WHERE plan_key IS NULL').all() as Row[]).map((w) => w.code));
    normalizeHouse(house, reserved, row ? migrateHouse(JSON.parse(row.data)) : null);
    const sync = syncStorage(db, house, HttpError);
    db.prepare(`INSERT INTO house (id, data, version, updated_at, updated_by) VALUES (1, ?, ?, datetime('now'), ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(JSON.stringify(house), version + 1, personId);
    db.exec('COMMIT');
    return { house, version: version + 1, sync };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function createHouse(core: Core) {
  core.onOpen((db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS house (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES persons(id) ON DELETE SET NULL
    )`);
    const wcols = (db.prepare('PRAGMA table_info(warehouses)').all() as Row[]).map((c) => c.name);
    if (!wcols.includes('plan_key')) db.exec('ALTER TABLE warehouses ADD COLUMN plan_key TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_plan ON warehouses(plan_key) WHERE plan_key IS NOT NULL');
    const pcols = (db.prepare('PRAGMA table_info(places)').all() as Row[]).map((c) => c.name);
    if (!pcols.includes('plan_item')) db.exec('ALTER TABLE places ADD COLUMN plan_item TEXT');
    if (!pcols.includes('plan_slot')) db.exec('ALTER TABLE places ADD COLUMN plan_slot INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_places_plan ON places(plan_item, plan_slot) WHERE plan_item IS NOT NULL');
  });
  const db = () => core.db;

  const router = express.Router();
  const OWN = ['/api/house'];
  router.use(OWN, (req, _res, next) => {
    req.auth = core.authenticate(req);
    next();
  });
  router.use(OWN, express.json({ limit: '80mb' }));
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: 'Bitte anmelden.' });
    next();
  };
  // Planen: Admins immer, sonst nur mit dem Recht „Haus planen“ (persons.can_plan)
  const canPlan = (req: Request) => req.auth?.via === 'session' && (req.auth.person.role === 'admin' || !!req.auth.person.can_plan);
  const requirePlanner = (req: Request, res: Response, next: NextFunction) => {
    if (!canPlan(req)) return res.status(403).json({ error: 'Den Hausplan dürfen nur Personen mit dem Recht „Haus planen“ ändern.' });
    next();
  };

  const current = () => db().prepare('SELECT h.*, p.name AS updated_by_name FROM house h LEFT JOIN persons p ON p.id = h.updated_by WHERE h.id = 1').get() as Row | undefined;

  router.get('/api/house', requireUser, (req, res) => {
    const row = current();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      house: row ? JSON.parse(row.data) : null,
      version: row?.version ?? 0,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by_name ?? null,
      can_edit: canPlan(req),
      // Kürzel der übrigen Lager – Räume dürfen sie nicht bekommen
      reserved: (db().prepare('SELECT code FROM warehouses WHERE plan_key IS NULL').all() as Row[]).map((w) => w.code),
    });
  });

  // Speichern {house, base_version}: base_version = zuletzt geladener Stand (sonst 409, damit nichts überschrieben wird)
  router.put('/api/house', requireUser, requirePlanner, (req, res) => {
    const body = req.body ?? {};
    if (!body.house || typeof body.house !== 'object') return res.status(400).json({ error: 'Kein Hausplan übergeben.' });
    try {
      const base = body.base_version !== undefined ? Number(body.base_version) : undefined;
      res.json(saveHouse(db(), body.house, req.auth!.person.id, core.HttpError, base));
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message, ...(e.status === 409 ? { version: (current()?.version ?? 0) } : {}) });
      throw e;
    }
  });

  // Inhalt aller Fächer: je Plan-Platz Adresse und Gegenstände (für Füllstand, Suche und Fach-Ansicht in der App)
  router.get('/api/house/storage', requireUser, (_req, res) => {
    const places = db().prepare(`SELECT pl.plan_item, pl.plan_slot, pl.warehouse_id, w.code AS wh_code, pl.col, pl.row, pl.name
      FROM places pl JOIN warehouses w ON w.id = pl.warehouse_id WHERE pl.plan_item IS NOT NULL ORDER BY pl.plan_item, pl.plan_slot`).all() as Row[];
    const items = db().prepare(`SELECT i.id, i.name, i.code, i.quantity, i.consumable, i.container, i.parent_id, i.expires_on, i.warehouse_id, i.col, i.row,
        CAST(julianday(i.expires_on) - julianday('now', 'localtime', 'start of day') AS INTEGER) AS expires_in,
        (SELECT updated_at FROM item_photos ph WHERE ph.item_id = i.id) AS photo_at
      FROM items i JOIN places pl ON pl.warehouse_id = i.warehouse_id AND pl.col = i.col AND pl.row = i.row
      WHERE pl.plan_item IS NOT NULL ORDER BY i.name COLLATE NOCASE`).all() as Row[];
    const byPlace = new Map<string, Row[]>();
    for (const it of items) {
      const k = `${it.warehouse_id}-${it.col}-${it.row}`;
      if (!byPlace.has(k)) byPlace.set(k, []);
      const { warehouse_id: _w, col: _c, row: _r, ...rest } = it;
      byPlace.get(k)!.push(rest);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      places: places.map((p) => ({ ...p, address: `${p.wh_code}-${p.col}${p.row}`, items: byPlace.get(`${p.warehouse_id}-${p.col}-${p.row}`) ?? [] })),
    });
  });

  // Heatmap: je Fach Buchungen der letzten 90 Tage und letzte Bewegung eines Gegenstands darin
  router.get('/api/house/stats', requireUser, (_req, res) => {
    const moves = db().prepare(`SELECT pl.plan_item, pl.plan_slot, COUNT(m.id) AS n FROM movements m
      JOIN places pl ON pl.warehouse_id = m.warehouse_id AND pl.col = m.col AND pl.row = m.row
      WHERE pl.plan_item IS NOT NULL AND m.created_at >= datetime('now', '-90 days') GROUP BY pl.plan_item, pl.plan_slot`).all() as Row[];
    const touched = db().prepare(`SELECT pl.plan_item, pl.plan_slot, MAX(COALESCE((SELECT MAX(created_at) FROM movements WHERE item_id = i.id), i.created_at)) AS last_at
      FROM items i JOIN places pl ON pl.warehouse_id = i.warehouse_id AND pl.col = i.col AND pl.row = i.row
      WHERE pl.plan_item IS NOT NULL GROUP BY pl.plan_item, pl.plan_slot`).all() as Row[];
    const out: Record<string, { moves_90: number; last_at: string | null }> = {};
    const at = (r: Row) => (out[`${r.plan_item}:${r.plan_slot}`] ??= { moves_90: 0, last_at: null });
    for (const r of moves) at(r).moves_90 = r.n;
    for (const r of touched) at(r).last_at = r.last_at;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ places: out });
  });

  return router;
}
