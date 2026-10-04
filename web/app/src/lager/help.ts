// Anleitung (#/hilfe): Kapitel mit Inhaltsverzeichnis und Suche. Admin-Kapitel werden nur Admins gezeigt.

import { esc } from './core';
import type { View } from './views';

const S: { id: string; title: string; admin?: boolean; html: string }[] = [
  {
    id: 'start', title: 'Erste Schritte',
    html: `<p><b>Zuhause</b> verbindet den Plan deines Hauses mit dem Lager: Jedes Fach eines geplanten Möbels – Schublade, Regalboden, Kühlschrankfach – ist ein Lagerplatz. So weißt du, <b>was wo liegt</b>, wie viel da ist und wer zuletzt etwas genommen hat.</p>
      <ul><li><b>Haus</b> (<a href="#/haus">#/haus</a>): Etagen, Wände, Räume, Möbel in 2D und 3D planen – am besten am PC.</li>
      <li><b>Lager</b> (<a href="#/lager">#/lager</a>): Scannen, Ein-/Ausbuchen, Suchen, Einkaufsliste – auch am Handy.</li></ul>
      <p><b>Anmelden:</b> eigene Kachel antippen und Passwort oder PIN eingeben (oder mit E-Mail). Die Anmeldung bleibt 30 Tage auf dem Gerät; jede Buchung gehört der angemeldeten Person.</p>`,
  },
  {
    id: 'adressen', title: 'Lager, Fächer und Adressen',
    html: `<table><tr><th>Raum</th><td>ist ein <b>Lager</b> mit Kürzel, z. B. Küche = <code>KU</code></td></tr>
      <tr><th>Möbel</th><td>ist eine <b>Spalte</b> (Buchstabe am Möbel im Plan), z. B. <code>B</code></td></tr>
      <tr><th>Fach</th><td>ist eine <b>Zeile</b>, von oben gezählt ab 0</td></tr></table>
      <p><code>KU-B2</code> = Küche, Möbel B, Fach 2 – z. B. „Unterschrank Auszüge 60 · Schublade 3 (unten)“. Diese Adresse steht auf dem QR-Etikett. Möbel außerhalb eines Raums gehören zum Lager der Etage. Zusätzliche Lager ohne Plan (z. B. „Hauptlager“) gibt es weiterhin mit frei vergebenen Plätzen wie <code>H-B12</code>.</p>`,
  },
  {
    id: 'plan', title: 'Haus planen',
    html: `<ul><li><b>Etagen:</b> Reiter oben; „+“ legt Obergeschoss, Keller, Dachgeschoss oder Außenbereich an – auf Wunsch mit den Außenwänden der aktuellen Etage. Die Etage darunter erscheint gestrichelt als Hilfe.</li>
      <li><b>Wände:</b> „Wand zeichnen“, Punkte setzen, Länge eintippen + Enter für exakte Maße. Oder „Wände aus Maßen“. Grundriss-Bild hochladen, Maßstab über eine bekannte Strecke setzen und nachzeichnen.</li>
      <li><b>Türen, Fenster, Durchgänge:</b> Werkzeug wählen und auf eine Wand klicken; im Eigenschaftenfeld Breite, Höhe, Brüstung.</li>
      <li><b>Räume:</b> „Raum festlegen“ und in eine von Wänden umschlossene Fläche klicken, Namen vergeben. Der Raum folgt, wenn Wände verschoben werden. Übernommene oder offene Räume haben einen festen Umriss („aus Wänden erkennen“ schaltet um).</li>
      <li><b>Möbel:</b> im Reiter „Katalog“ wählen und setzen – Schränke docken an Wände und Nachbarn an. <kbd>R</kbd> dreht, <kbd>Entf</kbd> löscht, <kbd>Strg</kbd>+<kbd>D</kbd> dupliziert, <kbd>Strg</kbd>+<kbd>Z</kbd> macht rückgängig. Bei Regalen, Schränken und Kommoden ist die Zahl der Böden bzw. Schubladen einstellbar; ein eigener Name („Vorratsschrank“) erscheint im Lager.</li>
      <li><b>Sperren:</b> Wände, Fenster/Türen, Möbel und Räume mit „Sperren“ oder <kbd>L</kbd> festsetzen – sie sind dann im Editor nicht mehr auswählbar, verschiebbar oder löschbar (Schloss-Symbol im Grundriss). Unter „Etage“ → „Gesperrt“ einzeln oder alle entsperren; dort auch „Alle Wände sperren“. Das Lager (Fächer anklicken, einbuchen) funktioniert weiter.</li>
      <li><b>Möbel &amp; Deko:</b> im Katalog „Online-Bibliothek“ – Quelle <i>Poly Haven</i> (frei, echte Maße) oder <i>FurniMesh</i> (realistische Möbel, Größe wird auf typische Maße gesetzt, Laden dauert etwa 10 s). Suche auch auf Deutsch; eigene .glb-Dateien lassen sich hochladen.</li>
      <li><b>Materialien:</b> Fronten, Arbeitsplatte, Boden, Wände – aus der Bibliothek, eigene Farbe oder hochgeladene Textur; einzelne Elemente und Räume (Bodenbelag) können abweichen.</li>
      <li><b>3D:</b> „Etage“, „Bis hier“ (Blick von oben ins Haus) oder „Haus“ (alle Etagen mit Dach). „Fotorealistisch“ rendert mit Pathtracing, „Begehen“: wie im Spiel mit WASD und Maus durchs ganze Haus laufen, über die Treppen in andere Etagen (Esc beendet).</li></ul>
      <p>Der Plan wird automatisch gespeichert und von allen geteilt (ändern dürfen nur Admins). Arbeiten zwei gleichzeitig daran, fragt die App, welcher Stand gilt.</p>`,
  },
  {
    id: 'imhaus', title: 'Lager im Haus: Fächer, Suche, „Im Haus zeigen“',
    html: `<ul><li>In 3D <b>„Lager“</b> einschalten: Fächer sind gefärbt – blau leer, grün belegt, orange läuft bald ab, rot abgelaufen. Fach anklicken zeigt den Inhalt; dort einbuchen, entnehmen oder etwas hierher umlagern.</li>
      <li>Daneben lässt sich die Färbung umstellen: <b>Bewegung</b> (oft genutzt = rot) oder <b>lange unberührt</b>.</li>
      <li><b>„Wo liegt …?“</b> oben im Planer sucht im ganzen Lager; Treffer leuchten gelb, ein Klick springt zur Etage und zum Fach.</li>
      <li><b>„Im Haus zeigen“</b> gibt es bei Suchtreffern, Gegenständen, Plätzen, Haltbarkeit und Assistent-Antworten.</li>
      <li>Im Eigenschaftenfeld eines Möbels stehen alle Fächer mit Adresse und Belegung.</li></ul>`,
  },
  {
    id: 'buchen', title: 'Einbuchen, Ausbuchen, Umlagern',
    html: `<ul><li><b>Einbuchen:</b> Name eingeben (vorhandene Gegenstände werden vorgeschlagen), „Fach im Haus wählen“ (Etage → Raum → Möbel → Fach) oder in einen Behälter, Menge, optional Haltbarkeit und Verbrauchsmaterial.</li>
      <li><b>Ausbuchen:</b> suchen und „−1“, oder in der Detailansicht „Entnehmen“ mit Menge. Verbrauchsmaterial landet dabei auf der Einkaufsliste.</li>
      <li><b>Umlagern:</b> in der Detailansicht „Umlagern“ und ein neues Fach wählen.</li>
      <li><b>Rückgängig:</b> nach jeder Buchung im Hinweis unten, später an der obersten Buchung im Verlauf (nur die letzte Buchung eines Gegenstands; eigene, Admins alle).</li>
      <li><b>Foto:</b> in der Detailansicht auf das Foto-Feld tippen.</li></ul>`,
  },
  {
    id: 'scan', title: 'Scannen mit QR-Codes',
    html: `<table><tr><th>Einbuchen</th><td>erst das <b>Fach</b>, dann den <b>Gegenstand</b> scannen – das Fach bleibt aktiv, weitere Gegenstände direkt nachscannen</td></tr>
      <tr><th>Ausbuchen</th><td>den <b>Gegenstand zweimal</b> scannen</td></tr>
      <tr><th>Einräumen</th><td><b>Behälter</b> scannen, „Einräumen“, dann die Gegenstände scannen</td></tr>
      <tr><th>Neu</th><td>unbekanntes, vorgedrucktes Etikett scannen – das Einbuchen-Formular öffnet sich mit dem Code</td></tr></table>
      <p>Mit der normalen Kamera-App gescannt öffnet ein Etikett direkt das Fach bzw. den Gegenstand. Die Kamera im Browser braucht HTTPS.</p>`,
  },
  {
    id: 'behaelter', title: 'Behälter (Tasche, Box, Kiste)',
    html: `<p>Ein Gegenstand wird zum Behälter über „Bearbeiten → Behälter“. In seiner Detailansicht: „Gegenstand hineinlegen“, „Neuen Gegenstand hinein einbuchen“ oder „Einräumen per Scan“. Der Inhalt hat immer den Platz des Behälters und wandert beim Umlagern mit.</p>`,
  },
  {
    id: 'einkauf', title: 'Einkaufsliste und Preise',
    html: `<ul><li>Verbrauchsmaterial kommt beim Entnehmen automatisch auf die Liste; freie Einträge („Milch“) oben hinzufügen.</li>
      <li>Kreis = gekauft; „einbuchen“ bucht auf den bisherigen Platz, „einlagern“ legt freie Einträge in einem gewählten Fach als Gegenstand an.</li>
      <li>Teilen per WhatsApp, Teilen-Menü oder Kopieren.</li>
      <li><b>Preise prüfen</b> sucht im Internet das günstigste Angebot je Eintrag und schlägt eine Einkaufstour vor (wenn der Assistent mit Websuche eingerichtet ist).</li></ul>`,
  },
  {
    id: 'haltbar', title: 'Haltbarkeit',
    html: `<p>Ein Datum je Gegenstand (beim Einbuchen oder Bearbeiten). Ab 30 Tagen vor Ablauf orange, danach rot; die Startseite warnt bei Ablauf in 7 Tagen. „Haltbarkeit“ listet Abgelaufenes und was in 7 Tagen bis 1 Jahr abläuft – „Alle im Haus zeigen“ markiert die Fächer.</p>`,
  },
  {
    id: 'assistent', title: 'Assistent',
    html: `<p>Aufträge per Text, Sprache (🎤) oder Foto: „3 Dosen Tomaten in den Vorratsschrank, haltbar bis 05/2027“, „Wo ist der Akkuschrauber?“, Foto vom Gegenstand und vom Fach-Etikett: „das kommt hierhin“. Fächer versteht er beim Namen – „Küche Kühlschrank oben“, „Kellerregal Boden 2“. Ab 4 Buchungen auf einmal fragt er nach; jede Buchung lässt sich rückgängig machen. „Neues Gespräch“ löscht den Verlauf.</p>`,
  },
  {
    id: 'auswertung', title: 'Auswertung',
    html: `<p>Kennzahlen, meistgenutzte Gegenstände (90 Tage), wer wie viel bucht, lange nicht Angefasstes (Kandidaten zum Aussortieren) und Ausverkauftes – dazu Heatmaps im Haus.</p>`,
  },
  {
    id: 'etiketten', title: 'Etiketten und QR-Schilder',
    html: `<p>„Etiketten & QR-Schilder“ (Lager-Start, Detailansicht oder im Planer beim Möbel): Fächer nach Etage, Raum und Möbel, Gegenstände oder leere Etiketten zum Vordrucken. Ausgabe über den Druckdialog (groß ca. 7 × 3,6 cm, klein ca. 5 × 2,5 cm) oder als <b>3D-Schilder</b>: 3MF-Datei mit zwei Farben je Schild, auf Druckplatten verteilt (Breite, Stärke, QR-Höhe, Farben, Öse einstellbar).</p>`,
  },
  {
    id: 'handy', title: 'Am Handy',
    html: `<p>Auf dem Handy startet Zuhause im Lager. Über HTTPS lässt sich die App installieren („App installieren“ bzw. iPhone: Teilen → Zum Home-Bildschirm); langes Drücken auf das Symbol springt zu Scannen, Einbuchen, Suchen, Einkaufsliste oder Haus.</p>`,
  },
  {
    id: 'personen', title: 'Personen und Anmeldung', admin: true,
    html: `<p>Verwaltung → Personen: anlegen, Rolle (Benutzer bucht, Admin verwaltet), Passwort setzen, archivieren (Verlauf bleibt) oder löschen – Buchungen lassen sich dabei auf eine andere Person übertragen. Unten: Selbst-Registrierung per E-Mail erlauben und Freigabepflicht; wartende Konten hier freigeben. Admin-Passwort vergessen: <code>npm run reset-password -- Name</code> auf dem Server.</p>`,
  },
  {
    id: 'lager-admin', title: 'Lager und Hausplan', admin: true,
    html: `<p>Räume des Hausplans sind automatisch Lager; Name und Kürzel werden am Raum gepflegt. Kürzel ändern benennt alle Plätze um – gedruckte Etiketten passen dann nicht mehr. Wandert ein Möbel in einen anderen Raum, ziehen Plätze und Gegenstände mit; entfernte Fächer mit Inhalt bleiben als Platz „nicht mehr im Plan“. Zusätzliche Lager ohne Plan unter Verwaltung → Lager.</p>`,
  },
  {
    id: 'mcp', title: 'API-Schlüssel und KI-Assistenten (MCP)', admin: true,
    html: `<p>Verwaltung → API-Schlüssel: je Schlüssel eine Person und die Rechte „lesen und buchen“ oder „nur lesen“. Der Schlüssel wird nur einmal angezeigt. Damit nutzen Claude &amp; Co. das Lager über den MCP-Server (eigener Port, Standard 3100) – mit denselben Werkzeugen wie der Assistent.</p>`,
  },
  {
    id: 'backup', title: 'Backups, Export und Import', admin: true,
    html: `<p>Automatisch alle 24 Stunden (14 bleiben). Verwaltung → Backups: sofort sichern, herunterladen, wiederherstellen (der aktuelle Stand wird vorher gesichert) oder hochladen. Backups enthalten Lager, Hausplan, Konten und Planungen – bitte zusätzlich woanders aufbewahren. Export/Import: alle Gegenstände als Excel oder CSV; beim Import zuerst eine Vorschau, dann wird gesichert und gebucht.</p>`,
  },
  {
    id: 'ki', title: 'Assistent einrichten', admin: true,
    html: `<p>Verwaltung → Assistent: Adresse einer OpenAI-kompatiblen Schnittstelle (Standard OpenRouter), Modell mit Werkzeugen und Bildern, Schlüssel – dann „Verbindung testen“. Für die Preisrecherche den Wohnort eintragen. Nachrichten, Fotos und Suchergebnisse gehen an den gewählten Anbieter.</p>`,
  },
];

export const viewHelp: View = (el, ctx) => {
  const admin = ctx.user()?.role === 'admin';
  const list = S.filter((s) => !s.admin || admin);
  el.innerHTML = `<a class="l-back" href="javascript:history.back()">← Zurück</a><h1>Anleitung</h1>
    <input type="search" class="fach-search" id="hq" placeholder="In der Anleitung suchen …" />
    <nav class="help-toc">${list.map((s) => `<a href="#/hilfe" data-to="${s.id}">${esc(s.title)}${s.admin ? ' <small>(Admin)</small>' : ''}</a>`).join('')}</nav>
    <div class="help">${list.map((s) => `<section id="h-${s.id}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('')}</div>`;
  el.querySelectorAll<HTMLElement>('[data-to]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    el.querySelector(`#h-${a.dataset.to}`)?.scrollIntoView({ behavior: 'smooth' });
  }));
  el.querySelector<HTMLInputElement>('#hq')!.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>('.help section').forEach((s) => (s.hidden = !!q && !s.textContent!.toLowerCase().includes(q)));
  });
};
