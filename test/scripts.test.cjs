'use strict';
// Kommandozeile: Passwort zurücksetzen
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startServer, client, setupUsers, ROOT } = require('./helpers.cjs');

let srv;
before(async () => { srv = await startServer(); await setupUsers(srv.base); });
after(() => srv.stop());

const reset = (...args) => execFileSync(process.execPath, ['--no-warnings', path.join(ROOT, 'scripts', 'reset-password.cjs'), ...args],
  { env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });

test('Passwort per Skript zurücksetzen, auch während der Server läuft', async () => {
  assert.match(reset(), /Anna \(Admin\)/);
  assert.match(reset('ben', 'neu5678', '--admin'), /jetzt Admin/);
  const c = client(srv.base);
  const r = await c.post('/api/auth/login', { person_id: 2, password: 'neu5678' });
  assert.equal(r.status, 200);
  assert.equal(r.data.me.role, 'admin');
  const out = reset('Anna');
  const pw = out.match(/Neues Passwort: (\S+)/)[1];
  assert.equal((await c.post('/api/auth/login', { person_id: 1, password: pw })).status, 200);
  assert.throws(() => reset('niemand'), /Command failed/);
});

test('Dockerfile übernimmt Server, Hausmodell, gebaute App und Skripte', () => {
  const fs = require('node:fs');
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const copied = docker.split('\n').filter((l) => l.startsWith('COPY')).join('\n');
  for (const what of ['server', 'web/app/src/model', '/app/dist', 'scripts', 'package.json']) {
    assert.ok(copied.includes(what), `${what} fehlt im Dockerfile (COPY)`);
  }
});
