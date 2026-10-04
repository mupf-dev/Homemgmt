'use strict';
// Passwort einer Person zurücksetzen – für den Notfall, z. B. wenn der einzige Admin sein Passwort vergessen hat.
//
//   npm run reset-password -- <Name oder ID> [neues Passwort] [--admin]
//   docker compose exec zuhause node scripts/reset-password.cjs <Name oder ID> [neues Passwort] [--admin]
//
// Ohne Passwort wird ein zufälliges erzeugt und ausgegeben. --admin macht die Person zusätzlich zum Admin
// (und holt sie aus dem Archiv). Alle bestehenden Anmeldungen der Person werden beendet.
// Funktioniert auch, während der Server läuft.
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../server/lager/password.cjs');

const args = process.argv.slice(2);
const makeAdmin = args.includes('--admin');
const [who, newPassword] = args.filter((a) => a !== '--admin');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'zuhause.db');

const fail = (msg) => { console.error(msg); process.exit(1); };

(async () => {
  const db = new DatabaseSync(DB_PATH);
  const persons = db.prepare('SELECT id, name, role, archived, password_hash IS NOT NULL AS has_pw FROM persons ORDER BY id').all();
  if (!who) {
    console.log('Aufruf: reset-password <Name oder ID> [neues Passwort] [--admin]\n\nPersonen:');
    for (const p of persons) console.log(`  ${String(p.id).padStart(3)}  ${p.name}${p.role === 'admin' ? ' (Admin)' : ''}${p.archived ? ' (archiviert)' : ''}${p.has_pw ? '' : ' – kein Passwort'}`);
    process.exit(persons.length ? 0 : 1);
  }
  const person = /^\d+$/.test(who)
    ? persons.find((p) => p.id === Number(who))
    : persons.find((p) => p.name.toLocaleLowerCase('de') === who.toLocaleLowerCase('de'));
  if (!person) fail(`Person „${who}“ nicht gefunden. Ohne Argumente aufrufen, um alle Personen zu sehen.`);

  const password = newPassword || crypto.randomBytes(9).toString('base64url');
  if (password.length < 4) fail('Das Passwort muss mindestens 4 Zeichen haben.');
  const hash = await hashPassword(password);
  db.exec('BEGIN');
  db.prepare('UPDATE persons SET password_hash = ? WHERE id = ?').run(hash, person.id);
  if (makeAdmin) db.prepare("UPDATE persons SET role = 'admin', archived = 0 WHERE id = ?").run(person.id);
  const ended = db.prepare('DELETE FROM sessions WHERE person_id = ?').run(person.id).changes;
  db.exec('COMMIT');
  db.close();

  console.log(`Passwort von ${person.name} wurde zurückgesetzt${makeAdmin ? ' und die Person ist jetzt Admin' : ''}.`);
  if (!newPassword) console.log(`Neues Passwort: ${password}\n(Bitte nach der Anmeldung unter „Mein Konto“ ändern.)`);
  if (ended) console.log(`${ended} bestehende Anmeldung(en) beendet.`);
})().catch((e) => fail(`Fehler: ${e.message}`));
