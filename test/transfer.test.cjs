'use strict';
// CSV lesen/schreiben (public/transfer.js läuft im Browser – hier mit minimalem window-Ersatz geladen)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { window: {}, TextEncoder, TextDecoder };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'app', 'public', 'transfer.js'), 'utf8'), ctx);
const T = ctx.window.Transfer;
// Werte aus dem vm-Kontext haben eigene Prototypen → für Vergleiche in normale Objekte umwandeln
const plain = (v) => JSON.parse(JSON.stringify(v));

test('CSV: Sonderzeichen überstehen Schreiben und Lesen', () => {
  const rows = [['Code', 'Name', 'Beschreibung'], ['ABC234', 'Schrauben; M6', 'mit "Anführungszeichen"\nzweite Zeile'], ['', 'Äpfel & Öl', '']];
  const csv = T.toCsv(rows);
  assert.ok(csv.startsWith('﻿'), 'BOM für Excel');
  assert.deepEqual(plain(T.parseCsv(csv)), rows);
});

test('CSV: Trennzeichen wird erkannt', () => {
  assert.deepEqual(plain(T.parseCsv('Name,Platz\nHammer,B12\n')), [['Name', 'Platz'], ['Hammer', 'B12']]);
  assert.deepEqual(plain(T.parseCsv('Name\tPlatz\nHammer\tB12')), [['Name', 'Platz'], ['Hammer', 'B12']]);
});

test('Spaltennamen: Export-Format und Alternativen werden erkannt', () => {
  const { columns, objects } = T.rowsToObjects([['Bezeichnung', 'Lagerplatz', 'Anzahl', 'Egal'], ['Hammer', 'K-B12', '2', 'x']]);
  assert.deepEqual(plain(columns).sort(), ['menge', 'name', 'platz']);
  assert.deepEqual(plain(objects[0]), { name: 'Hammer', platz: 'K-B12', menge: '2' });
  assert.throws(() => T.rowsToObjects([['Foo'], ['bar']]), /Name/);
});
