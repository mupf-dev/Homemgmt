'use strict';
// Übersetzungen: jeder tr()/trn()-Text hat einen englischen Eintrag mit denselben Platzhaltern
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../scripts/i18n-check.cjs');
const i18n = require('../server/i18n.cjs');

test('Alle übersetzbaren Texte haben einen englischen Eintrag', () => {
  const { errors } = check();
  assert.deepEqual(errors, [], `\n${errors.join('\n')}`);
});

test('Server: Sprache je Anfrage aus Cookie oder Accept-Language, Platzhalter und Mehrzahl', () => {
  assert.equal(i18n.langOf({ headers: { cookie: 'a=1; zh_lang=en' } }), 'en');
  assert.equal(i18n.langOf({ headers: { 'accept-language': 'fr-FR,en;q=0.8,de;q=0.5' } }), 'en');
  assert.equal(i18n.langOf({ headers: { 'accept-language': 'de-CH,de;q=0.9' } }), 'de');
  assert.equal(i18n.langOf({ headers: {} }), 'de', 'Standard Deutsch');
  i18n.withLang('en', () => {
    assert.equal(i18n.tr('Sprache'), 'Language');
    assert.equal(i18n.tr('Unbekannter Text {x}', { x: 1 }), 'Unbekannter Text 1', 'ohne Eintrag bleibt Deutsch');
    assert.equal(i18n.locale(), 'en-GB');
  });
  i18n.withLang('de', () => assert.equal(i18n.tr('Sprache'), 'Sprache'));
  assert.equal(i18n.trn(1, '{n} Platz', '{n} Plätze'), '1 Platz');
  assert.equal(i18n.trn(3, '{n} Platz', '{n} Plätze'), '3 Plätze');
});
