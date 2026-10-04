'use strict';
// Passwörter mit scrypt (in Node eingebaut) – gemeinsam für Server und Hilfsskripte. Format: "scrypt$<salt>$<hash>"
const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => crypto.scrypt(String(password), salt, 64, (err, key) =>
    err ? reject(err) : resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`)));
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return Promise.resolve(false);
  const expected = Buffer.from(hash, 'base64');
  return new Promise((resolve) => crypto.scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, (err, key) =>
    resolve(!err && crypto.timingSafeEqual(key, expected))));
}

module.exports = { hashPassword, verifyPassword };
