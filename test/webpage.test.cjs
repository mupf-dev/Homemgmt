'use strict';
// Seiten lesen für die Preisrecherche: private Adressen gesperrt, HTML → Text
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchPage, isPrivateIp, htmlToText } = require('../server/lager/webpage.cjs');

test('Private Adressen sind gesperrt', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.18.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450:4001::1']) assert.equal(isPrivateIp(ip), false, ip);

  const srv = http.createServer((req, res) => res.end('<p>intern</p>'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await assert.rejects(fetchPage(`http://127.0.0.1:${port}/`), /private Adressen/);
  await assert.rejects(fetchPage(`http://localhost:${port}/`), /private Adressen/);
  await assert.rejects(fetchPage('file:///etc/passwd'), /nur http/);
  assert.match((await fetchPage(`http://127.0.0.1:${port}/`, { allowPrivate: true })).text, /intern/);
  await new Promise((r) => srv.close(r));
});

test('HTML wird zu Text: Zeilen, Entities, ohne Skripte', () => {
  const { title, lines } = htmlToText('<title>A &amp; B</title><script>x()</script><ul><li>Milch&nbsp;1,5 %</li><li>0,99&euro;</li></ul>');
  assert.equal(title, 'A & B');
  assert.deepEqual(lines, ['Milch 1,5 %', '0,99€']);
});
