// Übersetzung in den gemeinsamen Modelldateien (App und Server). Diese Dateien dürfen i18n.ts nicht importieren
// (import.meta.glob, document – nur im Browser). Die App meldet ihr tr() über setModelTr() an (modelText.ts, als
// erster Import von state.ts – also bevor Kataloge und Bezeichnungen hier entstehen). Ohne Anmeldung, also auf dem
// Server, bleibt der deutsche Text: Fach- und Möbelnamen fließen dort in die Namen der Lagerplätze (Datenbank) und
// sollen nicht je nach Sprache der Anfrage wechseln.

type Tr = (de: string, params?: Record<string, unknown>) => string;

let impl: Tr | null = null;

/** Übersetzungsfunktion der App anmelden (nur im Browser) */
export function setModelTr(f: Tr) {
  impl = f;
}

/** Text in der Sprache der App – ohne Anmeldung Deutsch (Platzhalter {name} werden gefüllt) */
export function tr(de: string, params?: Record<string, unknown>): string {
  if (impl) return impl(de, params);
  return params ? de.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : de;
}
