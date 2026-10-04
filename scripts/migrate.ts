// Bestehende Daten nach Zuhause übernehmen: Heimlager-Datenbank (Basis) + Küchenplaner-Datenbank (Konten, Planungen)
// + importierte Texturen. Die Quellen werden nur gelesen.
//
//   npm run migrate -- --lager ../inventory/data/lager.db --kueche ../küchenplaner/data/kuechenplaner.db
//   Optionen: --out data/zuhause.db   Ziel (Standard: DB_PATH bzw. data/zuhause.db; muss neu sein, sonst --force)
//             --map mail@x.de=Name    Küchen-Konto ausdrücklich einer Lager-Person zuordnen (mehrfach möglich)
//
// Konten: gleiche E-Mail oder gleicher Name (ohne Groß-/Kleinschreibung) = dieselbe Person. Die Person bekommt dann die
// E-Mail dazu; hat sie im Lager schon ein Passwort, bleibt es (gilt danach auch für die Anmeldung per E-Mail).

import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const maps = new Map(args.flatMap((a, i) => (a === '--map' && args[i + 1]?.includes('=') ? [args[i + 1].split('=') as [string, string]] : []))
  .map(([mail, name]) => [mail.toLowerCase(), name]));
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const lagerSrc = opt('lager');
const kuecheSrc = opt('kueche');
const out = resolve(opt('out') ?? process.env.DB_PATH ?? join(ROOT, 'data', 'zuhause.db'));
if (!lagerSrc && !kuecheSrc) fail('Bitte --lager <lager.db> und/oder --kueche <kuechenplaner.db> angeben.');
for (const f of [lagerSrc, kuecheSrc]) if (f && !existsSync(f)) fail(`${f} gibt es nicht.`);
if (existsSync(out)) {
  if (!args.includes('--force')) fail(`${out} gibt es schon. Mit --force überschreiben.`);
  for (const ext of ['', '-wal', '-shm']) rmSync(out + ext, { force: true });
}
mkdirSync(dirname(out), { recursive: true });

// 1. Lager-Datenbank als Basis – VACUUM INTO liefert einen konsistenten Stand (inkl. WAL), die Quelle bleibt unberührt
if (lagerSrc) {
  const src = new DatabaseSync(lagerSrc, { readOnly: true });
  src.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
  src.close();
  console.log(`Lager übernommen: ${lagerSrc}`);
}

// 2. Schema auf den neuen Stand bringen (Migrationen des Lagers + Tabellen der Küche)
process.env.DB_PATH = out;
process.env.BACKUP_INTERVAL_HOURS = '0';
const lager = createRequire(import.meta.url)('../server/lager/server.cjs');
const { createKitchen } = await import('../server/kueche/index.ts');
const { createHouse } = await import('../server/haus/index.ts');
createHouse(lager);
createKitchen(lager, { dataDir: dirname(out) });
const db: DatabaseSync = lager.db;

// 3. Küchenplaner: Konten → Personen, Planungen, Einstellungen, Texturen
if (kuecheSrc) {
  const k = new DatabaseSync(kuecheSrc, { readOnly: true });
  const COLORS = ['#e0574f', '#e0883d', '#d9b032', '#5aa84f', '#3a9c9c', '#3f7fd0', '#7a5ad0', '#c74d9a'];
  const ids = new Map<number, number>();
  db.exec('BEGIN');
  try {
    for (const u of k.prepare('SELECT * FROM users ORDER BY id').all() as any[]) {
      const email = String(u.email).toLowerCase();
      const wanted = maps.get(email) ?? u.name;
      const p = (db.prepare('SELECT * FROM persons WHERE email = ?').get(email)
        ?? db.prepare('SELECT * FROM persons WHERE name = ? COLLATE NOCASE').get(wanted)) as any;
      if (p) {
        db.prepare('UPDATE persons SET email = COALESCE(email, ?), password_hash = COALESCE(password_hash, ?) WHERE id = ?').run(email, u.password_hash, p.id);
        ids.set(u.id, p.id);
        console.log(`  Konto ${email} → vorhandene Person „${p.name}“${p.password_hash ? ' (Lager-Passwort bleibt)' : ' (Passwort aus dem Küchenplaner)'}`);
      } else {
        let name = wanted;
        for (let i = 2; db.prepare('SELECT 1 FROM persons WHERE name = ? COLLATE NOCASE').get(name); i++) name = `${wanted} ${i}`;
        const n = (db.prepare('SELECT COUNT(*) AS n FROM persons').get() as { n: number }).n;
        const r = db.prepare('INSERT INTO persons (name, color, role, password_hash, email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(name, COLORS[n % COLORS.length], u.role, u.password_hash, email, u.status ?? 'active', u.created_at);
        ids.set(u.id, Number(r.lastInsertRowid));
        console.log(`  Konto ${email} → neue Person „${name}“ (${u.role})`);
      }
    }
    const ins = db.prepare(`INSERT INTO kitchen_projects (person_id, name, data, thumbnail, share_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let count = 0;
    for (const p of k.prepare('SELECT * FROM projects ORDER BY id').all() as any[]) {
      ins.run(ids.get(p.user_id)!, p.name, p.data, p.thumbnail, p.share_token ?? null, p.created_at, p.updated_at);
      count++;
    }
    console.log(`  ${count} Küchenplanung(en) übernommen`);
    for (const s of k.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) {
      if (s.key === 'registrationEnabled' || s.key === 'requireApproval') lager.setAuthSetting(s.key, s.value === '1');
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  k.close();
  const lib = join(dirname(resolve(kuecheSrc)), 'library');
  if (existsSync(lib)) {
    cpSync(lib, join(dirname(out), 'library'), { recursive: true, force: false });
    console.log(`  Texturen übernommen: ${lib}`);
  }
}

lager.close();
console.log(`Fertig: ${out}`);
process.exit(0);
