// Anleitung (#/hilfe): Kapitel mit Inhaltsverzeichnis und Suche. Admin-Kapitel werden nur Admins gezeigt.

import { esc } from './core';
import type { View } from './views';
import { tr } from '../i18n';

const S: { id: string; title: string; admin?: boolean; html: string }[] = [
  {
    id: 'start', title: tr('Erste Schritte'),
    html: `<p>${tr('<b>homemgmt-ng</b> verbindet den Plan deines Hauses mit dem Lager: Jedes Fach eines geplanten Möbels – Schublade, Regalboden, Kühlschrankfach – ist ein Lagerplatz. So weißt du, <b>was wo liegt</b>, wie viel da ist und wer zuletzt etwas genommen hat.')}</p>
      <ul><li>${tr('<b>Übersicht</b>: Scannen, Ein-/Ausbuchen, Suchen, Einkaufsliste, was bald abläuft, was zuletzt bewegt wurde.')}</li>
      <li>${tr('<b>Haus</b>: der Plan zum <b>Ansehen</b> – Möbel antippen zeigt die Fächer, ein Fach seinen Inhalt. <b>Planen</b> (Wände, Möbel, Etagen) gibt es am PC für Personen mit dem Recht „Haus planen“.')}</li>
      <li>${tr('<b>Suchen</b>, <b>Einkauf</b> und unter <b>Mehr</b> Haltbarkeit, Assistent, Auswertung, Etiketten, Einstellungen und Verwaltung.')}</li></ul>
      <p>${tr('Am Handy liegt die Navigation unten, <b>Scannen</b> in der Mitte.')}</p>
      <p>${tr('<b>Anmelden:</b> eigene Kachel antippen und Passwort oder PIN eingeben (oder mit E-Mail). Die Anmeldung bleibt 30 Tage auf dem Gerät; jede Buchung gehört der angemeldeten Person.')}</p>`,
  },
  {
    id: 'adressen', title: tr('Lager, Fächer und Adressen'),
    html: `<table><tr><th>${tr('Raum')}</th><td>${tr('ist ein <b>Lager</b> mit Kürzel, z. B. Küche = <code>KU</code>')}</td></tr>
      <tr><th>${tr('Möbel')}</th><td>${tr('ist eine <b>Spalte</b> (Buchstabe am Möbel im Plan), z. B. <code>B</code>')}</td></tr>
      <tr><th>${tr('Fach')}</th><td>${tr('ist eine <b>Zeile</b>, von oben gezählt ab 0')}</td></tr></table>
      <p>${tr('<code>KU-B2</code> = Küche, Möbel B, Fach 2 – z. B. „Unterschrank Auszüge 60 · Schublade 3 (unten)“. Diese Adresse steht auf dem QR-Etikett. Möbel außerhalb eines Raums gehören zum Lager der Etage. Zusätzliche Lager ohne Plan (z. B. „Hauptlager“) gibt es weiterhin mit frei vergebenen Plätzen wie <code>H-B12</code>.')}</p>`,
  },
  {
    id: 'plan', title: tr('Haus planen'),
    html: `<p>${tr('Im Haus auf <b>„Planen“</b> tippen (nur am PC, nur mit dem Recht „Haus planen“ – Admins dürfen immer). Oben erscheinen die Werkzeuge; „Möbel“, „Materialien“ und „Etage“ klappen links eine Leiste auf. Seltenes (Datei, Showroom, Name des Hauses) steht im Menü <b>⋯</b>. <b>„Fertig“</b> führt zurück zum Ansehen.')}</p>
      <ul><li>${tr('<b>Etagen:</b> Reiter oben; „+“ legt Obergeschoss, Keller, Dachgeschoss oder Außenbereich an – auf Wunsch mit den Außenwänden der aktuellen Etage. Die Etage darunter erscheint gestrichelt als Hilfe.')}</li>
      <li>${tr('<b>Wände:</b> Werkzeug „Wand“, Punkte setzen, Länge eintippen + Enter für exakte Maße. Oder „Wände aus Maßen“. Grundriss-Bild hochladen, Maßstab über eine bekannte Strecke setzen und nachzeichnen.')}</li>
      <li>${tr('<b>Türen, Fenster, Durchgänge:</b> Werkzeug wählen und auf eine Wand klicken; im Eigenschaftenfeld Breite, Höhe, Brüstung.')}</li>
      <li>${tr('<b>Räume:</b> Werkzeug „Raum“ und in eine von Wänden umschlossene Fläche klicken, Namen vergeben. Der Raum folgt, wenn Wände verschoben werden. Übernommene oder offene Räume haben einen festen Umriss („aus Wänden erkennen“ schaltet um).')}</li>
      <li>${tr('<b>Möbel:</b> „Möbel“ öffnet den Katalog; wählen und setzen – Schränke docken an Wände und Nachbarn an. <kbd>R</kbd> dreht, <kbd>Entf</kbd> löscht, <kbd>Strg</kbd>+<kbd>D</kbd> dupliziert, <kbd>Strg</kbd>+<kbd>Z</kbd> macht rückgängig. Bei Regalen, Schränken und Kommoden ist die Zahl der Böden bzw. Schubladen einstellbar; ein eigener Name („Vorratsschrank“) erscheint im Lager.')}</li>
      <li>${tr('<b>Sperren:</b> Wände, Fenster/Türen, Möbel und Räume mit „Sperren“ oder <kbd>L</kbd> festsetzen – sie sind dann im Editor nicht mehr auswählbar, verschiebbar oder löschbar (Schloss-Symbol im Grundriss). In der Leiste „Etage“ → „Gesperrt“ einzeln oder alle entsperren; dort auch „Alle Wände sperren“. Das Lager (Fächer anklicken, einbuchen) funktioniert weiter.')}</li>
      <li>${tr('<b>Möbel &amp; Deko:</b> unter „Möbel“ die „Online-Bibliothek“ – Quelle <i>Poly Haven</i> (frei, echte Maße) oder <i>FurniMesh</i> (realistische Möbel, Größe wird auf typische Maße gesetzt, Laden dauert etwa 10 s). Suche auch auf Deutsch; eigene .glb-Dateien lassen sich hochladen.')}</li>
      <li>${tr('<b>Materialien:</b> Fronten, Arbeitsplatte, Boden, Wände – aus der Bibliothek, eigene Farbe oder hochgeladene Textur; einzelne Elemente und Räume (Bodenbelag) können abweichen.')}</li>
      <li>${tr('<b>3D:</b> „Etage“, „Bis hier“ (Blick von oben ins Haus) oder „Haus“ (alle Etagen mit Dach). „Fotorealistisch“ rendert mit Pathtracing, „Begehen“: wie im Spiel mit WASD und Maus durchs ganze Haus laufen, über die Treppen in andere Etagen (Esc beendet).')}</li></ul>
      <p>${tr('Der Plan wird automatisch gespeichert und von allen geteilt (ändern dürfen nur Personen mit dem Recht „Haus planen“; vergeben unter Verwaltung → Personen). Arbeiten zwei gleichzeitig daran, fragt die App, welcher Stand gilt.')}</p>`,
  },
  {
    id: 'objekte', title: tr('Objektbibliothek: eigene Möbelarten'),
    html: `<ul><li>${tr('Unter <b>Mehr → Objektbibliothek</b> stehen alle Möbelarten neben den eingebauten: <b>Installiert</b>, <b>Community</b> (fertige Möbelarten aus dem gemeinsamen Katalog auf GitHub – beim Planen auch direkt unter „Möbel“ → <b>Online-Bibliothek</b>: auswählen installiert und setzt sie) und <b>Vorlagen</b>. Installierte Möbelarten erscheinen beim Planen unter „Möbel“ in ihrer Gruppe.')}</li>
      <li>${tr('<b>Editor:</b> Name, Maße und Aufbau – Spalten von links nach rechts, darin Elemente von oben nach unten (Schublade, Tür mit Böden, offenes Fach, Klappe, Kühl- oder Gefrierfach, Waschmaschine, Trockner), Höhen und Breiten als Verhältnis. Auf Wunsch mit <b>Arbeitsplatte</b> (z. B. Waschmaschine unter Arbeitsplatte) – auch als Teil der Küchenzeile. Oder ein eigenes 3D-Modell (.glb) mit eingetragenen Fächern. Die Vorschau zeigt jedes Fach als Rahmen – <b>jedes Fach wird ein Lagerplatz</b>.')}</li>
      <li>${tr('Das Haus behält eine <b>Kopie</b> jeder verwendeten Möbelart: Änderungen in der Bibliothek ändern bestehende Möbel und Adressen nicht. Gibt es eine neuere Version, bietet das Möbel beim Planen „Version … übernehmen“ an.')}</li>
      <li>${tr('<b>Teilen:</b> Exportieren speichert eine <code>.zuhause-objekt.json</code>, die sich anderswo importieren oder als Pull Request im Katalog-Repo <code>mupf-dev/homemgmt-object-library</code> einreichen lässt. Ändern und installieren darf, wer das Recht „Haus planen“ hat.')}</li></ul>`,
  },
  {
    id: 'imhaus', title: tr('Lager im Haus: Fächer, Suche, „Im Haus zeigen“'),
    html: `<ul><li>${tr('Beim Ansehen zeigt die Seitenleiste die <b>Räume</b> der Etage mit Füllstand; Raum → <b>Möbel</b> → <b>Fach</b> → Inhalt. Dort einbuchen (mit Vorschlägen aus vorhandenen Gegenständen), „−1“ entnehmen oder etwas hierher umlagern. Am Handy erscheint das als Blatt von unten.')}</li>
      <li>${tr('Im Grundriss sind Möbel nach Füllstand gefärbt (leer, teils, voll). In 3D sind die Fächer gefärbt – blau leer, grün belegt, orange läuft bald ab, rot abgelaufen; die Färbung lässt sich auf <b>Bewegung</b> oder <b>lange unberührt</b> umstellen.')}</li>
      <li>${tr('<b>„Wo liegt …?“</b> sucht im ganzen Lager; Treffer leuchten blau, Etagen mit Treffern bekommen einen Punkt, ein Klick öffnet das Fach.')}</li>
      <li>${tr('<b>„Im Haus zeigen“</b> gibt es bei Suchtreffern, Gegenständen, Plätzen, Haltbarkeit und Assistent-Antworten.')}</li></ul>`,
  },
  {
    id: 'buchen', title: tr('Einbuchen, Ausbuchen, Umlagern'),
    html: `<ul><li>${tr('<b>Einbuchen:</b> Name eingeben (vorhandene Gegenstände werden vorgeschlagen), „Fach im Haus wählen“ (Etage → Raum → Möbel → Fach) oder in einen Behälter, Menge, optional Haltbarkeit und Verbrauchsmaterial.')}</li>
      <li>${tr('<b>Ausbuchen:</b> suchen und „−1“, oder in der Detailansicht „Entnehmen“ mit Menge. Verbrauchsmaterial landet dabei auf der Einkaufsliste.')}</li>
      <li>${tr('<b>Umlagern:</b> in der Detailansicht „Umlagern“ und ein neues Fach wählen.')}</li>
      <li>${tr('<b>Rückgängig:</b> nach jeder Buchung im Hinweis unten, später an der obersten Buchung im Verlauf (nur die letzte Buchung eines Gegenstands; eigene, Admins alle).')}</li>
      <li>${tr('<b>Foto:</b> in der Detailansicht auf das Foto-Feld tippen.')}</li></ul>`,
  },
  {
    id: 'einstellungen', title: tr('Einstellungen pro Person'),
    html: `<p>${tr('Unter <b>Mehr → Einstellungen</b> legt jede Person für sich fest: ob die App mit der <b>Übersicht</b> oder dem <b>Haus</b> startet, ob das Haus zuerst als <b>Grundriss (2D)</b> oder in <b>3D</b> erscheint, <b>Hell/Dunkel</b> und die <b>Schriftgröße</b>. Die Einstellungen gelten auf allen Geräten der Person.')}</p>`,
  },
  {
    id: 'offline', title: tr('Schlechtes WLAN (Keller, Garage)'),
    html: `<p>${tr('Erreicht eine Buchung den Server nicht, wird sie <b>vorgemerkt</b> und automatisch nachgebucht, sobald die Verbindung wieder da ist. Oben zeigt „n Buchungen warten“ den Stand – antippen versucht es sofort. Doppelt gebucht wird nichts, auch wenn nur die Antwort verloren ging. Fächer und Gegenstände aus dem Hausplan lassen sich auch ohne Netz scannen. Lehnt der Server eine nachgeholte Buchung ab (z. B. weil der Gegenstand inzwischen weg ist), meldet die App sie einzeln.')}</p>`,
  },
  {
    id: 'terminal', title: tr('Wandterminal'),
    html: `<p>${tr('Ein Tablet an der Wand zeigt das Haus zum Suchen und Ansehen – ohne persönliche Anmeldung. Wer etwas ein- oder ausbucht, tippt seine <b>Kachel</b> an; die Wahl gilt 90 Sekunden (oben zu sehen, antippen wechselt). Ohne Bedienung kehrt das Terminal zum Haus zurück und zeigt den <b>Ruhezustand</b>: das Haus gedimmt, im Licht von Tageszeit und Wetter am Ort, dazu Uhr, Einkaufsliste und was bald abläuft. Antippen weckt es.')}</p>
      <p>${tr('Ist die <b>Lage des Hauses</b> gesetzt (Planen → Menü ⋯ → „Lage des Hauses“: Adresse suchen oder Koordinaten, Nordrichtung), steht die Sonne im 3D wie draußen; Himmel, Licht und Wetter laufen am Terminal live mit, ums Haus liegt Rasen.')}</p>
      <p>${tr('<b>Wetter und Gewitter:</b> Wolken, Regen, Schnee und Nebel erscheinen wie draußen. Blitze kommen in Echtzeit von Blitzortung.org: Ab 50 km zeigt das Terminal einen Hinweis, im Ruhezustand eine Blitzkarte; nahe Einschläge lassen den Bildschirm aufblitzen.')}</p>
      <p>${tr('Einrichten (Admins): <b>Mehr → Verwaltung → Wandterminals</b> → anlegen (Name, Hoch- oder Querformat, 2D/3D, Rückkehr nach Minuten, Ruhezustand, Postleitzahl fürs Wetter) und den <b>Einrichtungslink</b> auf dem Tablet öffnen oder den QR-Code scannen.')}</p>`,
  },
  {
    id: 'scan', title: tr('Scannen mit QR-Codes'),
    html: `<table><tr><th>${tr('Einbuchen')}</th><td>${tr('erst das <b>Fach</b>, dann den <b>Gegenstand</b> scannen – das Fach bleibt aktiv, weitere Gegenstände direkt nachscannen')}</td></tr>
      <tr><th>${tr('Ausbuchen')}</th><td>${tr('den <b>Gegenstand zweimal</b> scannen')}</td></tr>
      <tr><th>${tr('Einräumen')}</th><td>${tr('<b>Behälter</b> scannen, „Einräumen“, dann die Gegenstände scannen')}</td></tr>
      <tr><th>${tr('Neu')}</th><td>${tr('unbekanntes, vorgedrucktes Etikett scannen – das Einbuchen-Formular öffnet sich mit dem Code')}</td></tr></table>
      <p>${tr('Mit der normalen Kamera-App gescannt öffnet ein Etikett direkt das Fach bzw. den Gegenstand. Die Kamera im Browser braucht HTTPS.')}</p>`,
  },
  {
    id: 'behaelter', title: tr('Behälter (Tasche, Box, Kiste)'),
    html: `<p>${tr('Ein Gegenstand wird zum Behälter über „Bearbeiten → Behälter“. In seiner Detailansicht: „Gegenstand hineinlegen“, „Neuen Gegenstand hinein einbuchen“ oder „Einräumen per Scan“. Der Inhalt hat immer den Platz des Behälters und wandert beim Umlagern mit.')}</p>`,
  },
  {
    id: 'aufgaben', title: tr('Aufgaben'),
    html: `<ul><li>${tr('Unter <b>Mehr → Aufgaben</b> (und auf der Übersicht): was im Haushalt zu tun ist – mit Termin, <b>Wiederholung</b> (täglich, wöchentlich, alle 3 Monate … oder ein eigener Rhythmus) und optional einer <b>Person</b>.')}</li>
      <li>${tr('Eine Aufgabe kann an einem <b>Fach</b> hängen, z. B. „Filter Dunstabzug tauschen“ am Hochschrank – ein Klick auf die Adresse zeigt es im Haus.')}</li>
      <li>${tr('<b>Abhaken</b>: einmalige Aufgaben sind erledigt, wiederkehrende rücken auf den nächsten Termin – nach festem Rhythmus (verpasste Termine werden übersprungen) oder „ab Erledigung“. Versehentlich abgehakt? „Rückgängig“ in der Meldung.')}</li>
      <li>${tr('Am <b>Wandterminal</b> stehen die Aufgaben links in der Navigation; abhaken mit „Wer bucht?“. Fällige Aufgaben zeigt auch der Ruhezustand. Anlegen und Ändern geht in der App.')}</li></ul>`,
  },
  {
    id: 'einkauf', title: tr('Einkaufsliste und Preise'),
    html: `<ul><li>${tr('Verbrauchsmaterial kommt beim Entnehmen automatisch auf die Liste; freie Einträge („Milch“) oben hinzufügen.')}</li>
      <li>${tr('Kreis = gekauft; „einbuchen“ bucht auf den bisherigen Platz, „einlagern“ legt freie Einträge in einem gewählten Fach als Gegenstand an.')}</li>
      <li>${tr('Teilen per WhatsApp, Teilen-Menü oder Kopieren.')}</li>
      <li>${tr('<b>Preise prüfen</b> sucht im Internet das günstigste Angebot je Eintrag und schlägt eine Einkaufstour vor (wenn der Assistent mit Websuche eingerichtet ist).')}</li></ul>`,
  },
  {
    id: 'haltbar', title: tr('Haltbarkeit'),
    html: `<p>${tr('Ein Datum je Gegenstand (beim Einbuchen oder Bearbeiten). Ab 30 Tagen vor Ablauf orange, danach rot; die Startseite warnt bei Ablauf in 7 Tagen. „Haltbarkeit“ listet Abgelaufenes und was in 7 Tagen bis 1 Jahr abläuft – „Alle im Haus zeigen“ markiert die Fächer.')}</p>`,
  },
  {
    id: 'assistent', title: tr('Assistent'),
    html: `<p>${tr('Aufträge per Text, Sprache (Mikrofon) oder Foto: „3 Dosen Tomaten in den Vorratsschrank, haltbar bis 05/2027“, „Wo ist der Akkuschrauber?“, Foto vom Gegenstand und vom Fach-Etikett: „das kommt hierhin“. Fächer versteht er beim Namen – „Küche Kühlschrank oben“, „Kellerregal Boden 2“. Ab 4 Buchungen auf einmal fragt er nach; jede Buchung lässt sich rückgängig machen. „Neues Gespräch“ löscht den Verlauf.')}</p>`,
  },
  {
    id: 'auswertung', title: tr('Auswertung'),
    html: `<p>${tr('Kennzahlen, meistgenutzte Gegenstände (90 Tage), wer wie viel bucht, lange nicht Angefasstes (Kandidaten zum Aussortieren) und Ausverkauftes – dazu Heatmaps im Haus.')}</p>`,
  },
  {
    id: 'etiketten', title: tr('Etiketten und QR-Schilder'),
    html: `<p>${tr('„Etiketten & QR-Schilder“ (Mehr, Detailansicht oder beim Planen am Möbel): Fächer nach Etage, Raum und Möbel, Gegenstände oder leere Etiketten zum Vordrucken. Ausgabe über den Druckdialog (groß ca. 7 × 3,6 cm, klein ca. 5 × 2,5 cm) oder als <b>3D-Schilder</b>: 3MF-Datei mit zwei Farben je Schild, auf Druckplatten verteilt (Breite, Stärke, QR-Höhe, Farben, Öse einstellbar).')}</p>`,
  },
  {
    id: 'handy', title: tr('Am Handy'),
    html: `<p>${tr('Auf dem Handy startet homemgmt-ng im Lager. Über HTTPS lässt sich die App installieren („App installieren“ bzw. iPhone: Teilen → Zum Home-Bildschirm); langes Drücken auf das Symbol springt zu Scannen, Einbuchen, Suchen, Einkaufsliste oder Haus.')}</p>`,
  },
  {
    id: 'personen', title: tr('Personen und Anmeldung'), admin: true,
    html: `<p>${tr('Verwaltung → Personen: anlegen, Rolle (Benutzer bucht, Admin verwaltet), Passwort setzen, archivieren (Verlauf bleibt) oder löschen – Buchungen lassen sich dabei auf eine andere Person übertragen. Unten: Selbst-Registrierung per E-Mail erlauben und Freigabepflicht; wartende Konten hier freigeben. Admin-Passwort vergessen: <code>npm run reset-password -- Name</code> auf dem Server.')}</p>`,
  },
  {
    id: 'lager-admin', title: tr('Lager und Hausplan'), admin: true,
    html: `<p>${tr('Räume des Hausplans sind automatisch Lager; Name und Kürzel werden am Raum gepflegt. Kürzel ändern benennt alle Plätze um – gedruckte Etiketten passen dann nicht mehr. Wandert ein Möbel in einen anderen Raum, ziehen Plätze und Gegenstände mit; entfernte Fächer mit Inhalt bleiben als Platz „nicht mehr im Plan“. Zusätzliche Lager ohne Plan unter Verwaltung → Lager.')}</p>`,
  },
  {
    id: 'mcp', title: tr('API-Schlüssel und KI-Assistenten (MCP)'), admin: true,
    html: `<p>${tr('Verwaltung → API-Schlüssel: je Schlüssel eine Person und die Rechte „lesen und buchen“ oder „nur lesen“. Der Schlüssel wird nur einmal angezeigt. Damit nutzen Claude &amp; Co. das Lager über den MCP-Server (eigener Port, Standard 3100) – mit denselben Werkzeugen wie der Assistent.')}</p>`,
  },
  {
    id: 'backup', title: tr('Backups, Export und Import'), admin: true,
    html: `<p>${tr('Automatisch alle 24 Stunden (14 bleiben). Verwaltung → Backups: sofort sichern, herunterladen, wiederherstellen (der aktuelle Stand wird vorher gesichert) oder hochladen. Backups enthalten Lager, Hausplan, Konten und Planungen – bitte zusätzlich woanders aufbewahren. Export/Import: alle Gegenstände als Excel oder CSV; beim Import zuerst eine Vorschau, dann wird gesichert und gebucht.')}</p>`,
  },
  {
    id: 'ki', title: tr('Assistent einrichten'), admin: true,
    html: `<p>${tr('Verwaltung → Assistent: Adresse einer OpenAI-kompatiblen Schnittstelle (Standard OpenRouter), Modell mit Werkzeugen und Bildern, Schlüssel – dann „Verbindung testen“. Für die Preisrecherche den Wohnort eintragen; ohne OpenRouter zusätzlich das Such-Tool des Gateways (z. B. „foundry-web“ bei LiteLLM). Nachrichten, Fotos und Suchergebnisse gehen an den gewählten Anbieter.')}</p>`,
  },
];

export const viewHelp: View = (el, ctx) => {
  const admin = ctx.user()?.role === 'admin';
  const list = S.filter((s) => !s.admin || admin);
  el.innerHTML = `<a class="l-back" href="javascript:history.back()">← ${tr('Zurück')}</a><h1>${tr('Anleitung')}</h1>
    <input type="search" class="fach-search" id="hq" placeholder="${tr('In der Anleitung suchen …')}" />
    <nav class="help-toc">${list.map((s) => `<a href="#/hilfe" data-to="${s.id}">${esc(s.title)}${s.admin ? ` <small>(${tr('Admin')})</small>` : ''}</a>`).join('')}</nav>
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
