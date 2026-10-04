'use strict';
// Heimlager – MCP-Server (Model Context Protocol, Transport „Streamable HTTP“), ohne externe Abhängigkeiten.
// Läuft auf eigenem Port und kann über einen Reverse Proxy veröffentlicht werden.
// Anmeldung per API-Schlüssel: "Authorization: Bearer hlk_…" (Schlüssel werden in der App unter „API-Schlüssel“ angelegt).

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const { createTools } = require('./tools.cjs');

function createMcpHandler(core, opts = {}) {
  const allowedOrigins = new Set(opts.allowedOrigins || []);
  const keyInUrl = !!opts.keyInUrl;
  const kit = createTools(core, opts);
  const toolList = (auth) => kit.list(auth).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
  }));

  // ---------- JSON-RPC ----------
  const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  function callTool(params, auth) {
    const r = kit.call(params?.name, params?.arguments, auth, { source: 'mcp' });
    if (r.unknown) return { error: [-32602, r.content[0].text] };
    return { result: r.isError ? { content: r.content, isError: true } : { content: r.content } };
  }

  function handleMessage(msg, auth) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid Request');
    if (typeof msg.method !== 'string') return null; // Antwort des Clients – ignorieren
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return null; // Benachrichtigung (z. B. notifications/initialized)
    switch (msg.method) {
      case 'initialize': {
        const wanted = msg.params?.protocolVersion;
        return rpcResult(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'heimlager', title: 'Heimlager', version: opts.version || '0' },
          instructions: kit.instructions(auth),
        });
      }
      case 'ping': return rpcResult(msg.id, {});
      case 'tools/list': return rpcResult(msg.id, { tools: toolList(auth) });
      case 'tools/call': {
        const r = callTool(msg.params, auth);
        return r.error ? rpcError(msg.id, ...r.error) : rpcResult(msg.id, r.result);
      }
      case 'resources/list': return rpcResult(msg.id, { resources: [] });
      case 'prompts/list': return rpcResult(msg.id, { prompts: [] });
      default: return rpcError(msg.id, -32601, `Methode nicht unterstützt: ${msg.method}`);
    }
  }

  // ---------- HTTP ----------
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers });
    res.end(body !== undefined ? JSON.stringify(body) : undefined);
  };

  return function handleMcp(req, res) {
    const url = new URL(req.url, 'http://mcp.local');
    const m = url.pathname.match(/^\/(?:mcp\/?)?(?:(hlk_[A-Za-z0-9_-]+)\/?)?$/);
    if (!m) return send(res, 404, { error: 'Nicht gefunden. MCP-Endpunkt: /mcp' });

    // Schutz vor DNS-Rebinding: Browser-Anfragen nur von erlaubten Ursprüngen
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, rpcError(null, -32000, 'Origin nicht erlaubt.'));

    const token = (String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i) || [])[1]
      || (keyInUrl ? m[1] || url.searchParams.get('key') : null);
    const auth = core.keyAuth(token);
    if (!auth) {
      return send(res, 401, rpcError(null, -32001, 'API-Schlüssel fehlt oder ist ungültig.'),
        { 'WWW-Authenticate': 'Bearer realm="Heimlager"' });
    }

    if (req.method !== 'POST') {
      // Kein serverseitiger Ereignis-Stream und keine Sitzungen (zustandslos)
      return send(res, 405, rpcError(null, -32000, 'Nur POST wird unterstützt.'), { Allow: 'POST' });
    }

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return send(res, 400, rpcError(null, -32700, 'Parse error')); }
      const batch = Array.isArray(msg);
      const out = (batch ? msg : [msg]).map((x) => handleMessage(x, auth)).filter(Boolean);
      if (!out.length) return send(res, 202);
      send(res, 200, batch ? out : out[0]);
    });
  };
}

module.exports = { createMcpHandler };
