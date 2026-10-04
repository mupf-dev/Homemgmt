'use strict';
// Test-Hilfen: startet einen eigenen Heimlager-Server mit frischer Datenbank auf freien Ports.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heimlager-test-'));
  const port = await freePort();
  const mcpPort = await freePort();
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), HTTPS_PORT: '0', MCP_PORT: String(mcpPort), MCP_HOST: '127.0.0.1',
      DB_PATH: path.join(dir, 'zuhause.db'), CERT_DIR: path.join(dir, 'keine-zertifikate'), BACKUP_INTERVAL_HOURS: '0', LIGHTNING: '0', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* startet noch */ }
    if (i > 100 || proc.exitCode !== null) throw new Error(`Server startet nicht:\n${output}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    base, dir, dbPath: path.join(dir, 'zuhause.db'), mcpUrl: `http://127.0.0.1:${mcpPort}/mcp`,
    output: () => output,
    async stop() {
      proc.kill('SIGTERM');
      await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// HTTP-Client mit Cookie (Sitzung) oder API-Schlüssel
function client(base, { key } = {}) {
  let cookie = '';
  const call = async (method, url, body, { raw } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (key) headers.authorization = `Bearer ${key}`;
    let payload;
    if (raw) { payload = raw; headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) cookie = /Max-Age=0/.test(c) ? '' : c.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b),
    patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u), raw: (u, buf) => call('POST', u, undefined, { raw: buf }),
    get cookie() { return cookie; },
  };
}

// MCP (JSON-RPC über HTTP)
function mcp(url, key) {
  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  };
  return {
    rpc,
    async tool(name, args = {}) {
      const r = await rpc('tools/call', { name, arguments: args });
      const result = r.body.result;
      const text = result.content.find((c) => c.type === 'text')?.text ?? '';
      let json = null;
      try { json = JSON.parse(text); } catch { /* Text */ }
      return { isError: !!result.isError, text, json, content: result.content };
    },
  };
}

// Ersteinrichtung + zweite Person; gibt Admin- und Benutzer-Client zurück
async function setupUsers(base) {
  const admin = client(base);
  const r = await admin.post('/api/auth/setup', { name: 'Anna', password: 'geheim1' });
  if (r.status !== 200) throw new Error(`Setup fehlgeschlagen: ${JSON.stringify(r.data)}`);
  const ben = (await admin.post('/api/persons', { name: 'Ben', password: '1234' })).data;
  const user = client(base);
  await user.post('/api/auth/login', { person_id: ben.id, password: '1234' });
  return { admin, user, annaId: r.data.me.id, benId: ben.id };
}

// kleinstes gültiges JPEG-„Bild“ für Foto-Tests (Server prüft nur die Signatur)
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

// Schein-KI-Anbieter (OpenAI-kompatibel): beantwortet /chat/completions der Reihe nach aus `replies`.
// Eine Antwort ist ein Objekt {content?, tool_calls?: [[name, args], …]} oder eine Funktion (Anfrage) → Objekt.
// `requests` sammelt die empfangenen Anfragen (zum Prüfen von Prompt, Werkzeugen, Bildern).
async function fakeLlm() {
  const http = require('node:http');
  const state = { replies: [], requests: [], status: 200 };
  let n = 0;
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      state.requests.push({ auth: req.headers.authorization, path: req.url, body });
      if (state.status !== 200) {
        res.writeHead(state.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Schlüssel ungültig' } }));
      }
      let r = state.replies.shift() ?? { content: 'Fertig.' };
      if (typeof r === 'function') r = r(body);
      const message = { role: 'assistant', content: r.content ?? null };
      if (r.annotations) message.annotations = r.annotations;
      if (r.tool_calls) message.tool_calls = r.tool_calls.map(([name, args]) => ({ id: `call_${++n}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return Object.assign(state, { url: `http://127.0.0.1:${srv.address().port}/v1`, stop: () => new Promise((r) => srv.close(r)) });
}

module.exports = { ROOT, startServer, client, mcp, setupUsers, fakeLlm, FAKE_JPEG };
