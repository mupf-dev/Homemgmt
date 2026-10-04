'use strict';
// Blitze in Echtzeit vom Gemeinschaftsnetz Blitzortung.org (Daten hinter lightningmaps.org) – ohne Konto oder Schlüssel,
// für private, nicht-kommerzielle Nutzung. Die Verbindung steht nur, solange jemand (Wandterminal) fragt; gemerkt
// werden nur Blitze im Umkreis der angefragten Orte, höchstens eine Stunde lang.

const HOSTS = ['ws1', 'ws7', 'ws8'];
const KEEP_KM = 300; // Blitze weiter weg werden gar nicht erst gemerkt
const KEEP_MS = 60 * 60000;
const IDLE_MS = 10 * 60000; // ohne Anfrage so lange: Verbindung schließen

/** Nachrichten von Blitzortung sind LZW-komprimierte JSON-Texte */
function decode(b) {
  const dict = {};
  const data = String(b).split('');
  let c = data[0];
  let prev = c;
  const out = [c];
  let code = 256;
  for (let i = 1; i < data.length; i++) {
    const k = data[i].charCodeAt(0);
    const a = k < 256 ? data[i] : dict[k] ? dict[k] : prev + c;
    out.push(a);
    c = a.charAt(0);
    dict[code++] = prev + c;
    prev = a;
  }
  return out.join('');
}

const RAD = Math.PI / 180;
/** Entfernung in km und Richtung in Grad (von Norden im Uhrzeigersinn) von a nach b */
function distBearing(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return { km, bearing: ((Math.atan2(y, x) / RAD) + 360) % 360 };
}
const DIRS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
const direction = (deg) => DIRS[Math.round(deg / 45) % 8];

/** Zusammenfassung für einen Ort: Blitze bis radiusKm in den letzten minutes Minuten */
function summarize(strikes, lat, lon, now = Date.now(), radiusKm = 100, minutes = 60) {
  const list = [];
  for (const s of strikes) {
    const age = (now - s.t) / 1000;
    if (age > minutes * 60 || age < -60) continue;
    const d = distBearing(lat, lon, s.lat, s.lon);
    if (d.km > radiusKm) continue;
    list.push({ age_s: Math.max(0, Math.round(age)), km: Math.round(d.km * 10) / 10, bearing: Math.round(d.bearing) });
  }
  list.sort((a, b) => a.age_s - b.age_s);
  const recent = list.filter((s) => s.age_s <= 15 * 60);
  const nearest = recent.reduce((m, s) => (!m || s.km < m.km ? s : m), null);
  // Warnstufe: 0 nichts, 1 Gewitter in der Region (≤ 50 km), 2 nah (≤ 20 km), 3 sehr nah (≤ 8 km)
  const level = !nearest || nearest.km > 50 ? 0 : nearest.km > 20 ? 1 : nearest.km > 8 ? 2 : 3;
  return {
    strikes: list.slice(0, 500),
    count15: recent.filter((s) => s.km <= 50).length,
    nearest: nearest && { ...nearest, direction: direction(nearest.bearing) },
    level,
  };
}

function createLightning({ log = () => {} } = {}) {
  let ws = null;
  let host = 0;
  let retry = 0;
  let timer = null;
  let lastAsk = 0;
  let connected = false;
  const places = new Map(); // "lat,lon" → letzte Anfrage
  let strikes = [];
  const subscribers = new Set(); // Echtzeit: { lat, lon, radiusKm, fn }

  const near = (lat, lon) => {
    for (const k of places.keys()) {
      const [a, b] = k.split(',').map(Number);
      if (distBearing(a, b, lat, lon).km <= KEEP_KM) return true;
    }
    return false;
  };
  function connect() {
    if (ws || typeof WebSocket === 'undefined') return;
    const url = `wss://${HOSTS[host % HOSTS.length]}.blitzortung.org/`;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log(`Blitze: Verbindung fehlgeschlagen (${e.message})`);
      return schedule();
    }
    ws.onopen = () => {
      connected = true;
      retry = 0;
      ws.send(JSON.stringify({ a: 111 }));
    };
    ws.onmessage = (m) => {
      let s;
      try {
        s = JSON.parse(decode(m.data));
      } catch {
        return;
      }
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || !near(s.lat, s.lon)) return;
      const strike = { t: Math.round(Number(s.time) / 1e6) || Date.now(), lat: s.lat, lon: s.lon };
      strikes.push(strike);
      if (strikes.length > 20000) strikes = strikes.slice(-10000);
      // sofort an alle weitergeben, die diesen Umkreis beobachten
      for (const sub of subscribers) {
        const d = distBearing(sub.lat, sub.lon, strike.lat, strike.lon);
        if (d.km <= sub.radiusKm) {
          try {
            sub.fn({ km: Math.round(d.km * 10) / 10, bearing: Math.round(d.bearing), direction: direction(d.bearing), t: strike.t });
          } catch {
            /* Empfänger weg */
          }
        }
      }
    };
    ws.onclose = () => {
      ws = null;
      connected = false;
      if (Date.now() - lastAsk < IDLE_MS) schedule();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* egal */
      }
    };
  }
  function schedule() {
    clearTimeout(timer);
    host++;
    const delay = Math.min(60000, 2000 * 2 ** retry++);
    timer = setTimeout(connect, delay);
    timer.unref?.();
  }
  // aufräumen: alte Blitze, vergessene Orte, ungenutzte Verbindung
  const sweep = setInterval(() => {
    const now = Date.now();
    strikes = strikes.filter((s) => now - s.t < KEEP_MS);
    // wer in Echtzeit zuhört, hält seinen Ort und die Verbindung wach
    for (const sub of subscribers) {
      places.set(`${sub.lat.toFixed(2)},${sub.lon.toFixed(2)}`, now);
      lastAsk = now;
    }
    for (const [k, t] of places) if (now - t > IDLE_MS) places.delete(k);
    if (!places.size && ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
      connected = false;
    }
  }, 60000);
  sweep.unref?.();

  return {
    /** Blitze rund um einen Ort; baut die Verbindung bei Bedarf auf */
    around(lat, lon, radiusKm = 100) {
      lastAsk = Date.now();
      places.set(`${lat.toFixed(2)},${lon.toFixed(2)}`, lastAsk);
      connect();
      return { connected, ...summarize(strikes, lat, lon, Date.now(), radiusKm) };
    },
    /** Echtzeit: fn wird für jeden neuen Blitz im Umkreis sofort aufgerufen; liefert die Abmeldung */
    subscribe(lat, lon, radiusKm, fn) {
      const sub = { lat, lon, radiusKm, fn };
      subscribers.add(sub);
      lastAsk = Date.now();
      places.set(`${lat.toFixed(2)},${lon.toFixed(2)}`, lastAsk);
      connect();
      return () => subscribers.delete(sub);
    },
    close() {
      subscribers.clear();
      clearInterval(sweep);
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    },
  };
}

module.exports = { createLightning, decode, distBearing, summarize, direction };
