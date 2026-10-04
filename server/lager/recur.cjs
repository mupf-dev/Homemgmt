'use strict';
// Wiederkehrende Aufgaben: Termine rechnen (ohne Datenbank, testbar)

const TASK_UNITS = ['day', 'week', 'month', 'year'];
const localDate = (d = new Date()) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD in der Zeitzone des Servers
/** Datum + n Einheiten (Monatsende bleibt Monatsende: 31.01. + 1 Monat = 28./29.02.) */
function addInterval(iso, unit, n) {
  const [y, m, d] = iso.split('-').map(Number);
  if (unit === 'day' || unit === 'week') return new Date(Date.UTC(y, m - 1, d + n * (unit === 'week' ? 7 : 1))).toISOString().slice(0, 10);
  const months = unit === 'year' ? 12 * n : n;
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
/** nächster Termin nach dem Erledigen */
function nextDue(task, today = localDate()) {
  const base = task.repeat_from_done || !task.due_on ? today : task.due_on;
  // immer vom Ausgangstermin aus in Vielfachen rechnen – sonst rutscht der 31. über den Februar auf den 28.
  let k = 1;
  let next = addInterval(base, task.repeat_unit, task.repeat_every);
  while (next <= today && k < 100000) next = addInterval(base, task.repeat_unit, task.repeat_every * ++k);
  return next;
}

module.exports = { TASK_UNITS, localDate, addInterval, nextDue };
