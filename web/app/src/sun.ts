// Sonnenstand für Ort und Zeit (vereinfachte NOAA-/SunCalc-Formeln, Genauigkeit < 1°) – für Licht und Himmel im 3D.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const E = RAD * 23.4397; // Schiefe der Ekliptik

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}

/**
 * Sonnenstand: azimuth in Grad von Norden im Uhrzeigersinn (Osten = 90), altitude in Grad über dem Horizont.
 */
export function sunPosition(date: Date, lat: number, lon: number): { azimuth: number; altitude: number } {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // SunCalc liefert den Azimut von Süden aus (westlich positiv) – hier von Norden im Uhrzeigersinn
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: ((azS / RAD + 180) % 360 + 360) % 360, altitude: altitude / RAD };
}
