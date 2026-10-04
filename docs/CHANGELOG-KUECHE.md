# Changelog Küchenplaner (bis 1.0.0, vor der Zusammenführung)

## 1.0.0 – 2026-10-03

Erster Release des Küchenplaners.

**Planung**
- 2D-Grundriss-Editor: Wände zeichnen (Längeneingabe, Winkel- und Endpunktfang), Türen und Fenster, Raum aus Maßen
  (Rechteck, L-Form), Grundriss-Bild als Vorlage mit Maßstabskalibrierung
- Katalog mit Unter-, Ober- und Hochschränken, Geräten, Kochinsel, Wangen, senkrechten Griffleisten, Einrichtung;
  Andocken an Wände und Nachbarn, Breite frei per Ziehpunkte, Undo/Redo
- Grifflose Küche mit Griffmulden (waagerecht/senkrecht), Fronten (Türen, eine Tür/Klappe, Auszüge 1–4),
  Kochinsel mit Spaltenbreiten, Rückseite Theke oder Türen, Überständen, Muldenlüfter
- Spüle BLANCO SUBLINE 500-U (Unterbau) und Armatur BLANCO KANO-S Vario als Modelle

**Materialien**
- Bibliothek mit Lacken, Holz, Stein, Keramik, Metall, Fliesen, Böden (Scans von Poly Haven, CC0), Silgranit
- Eigene Texturen hochladen (inkl. Normal-/Roughness-Map), eigene Farben per Farbrad (matt/normal/Hochglanz)
- Online-Bibliothek Poly Haven und ambientCG mit Import auf den Server
- Textur ausrichten je Bereich und Element (strecken/kacheln, Größe, Drehung gradgenau, Verschiebung)
- Farbanpassung (Farbton, Sättigung, Helligkeit, Kontrast, Einfärben, Glanz)

**3D**
- Echtzeit mit Schatten, Ambient Occlusion, Tageszeit, Lichtregler (Sonne, Himmel, Lampen, Weichheit)
- Fotorealistischer Modus (GPU-Pathtracing), Begehen, Showroom-Ansicht mit Rundgang und Vollbild

**Konten & Teilen**
- Anmeldung, erster Benutzer ist Administrator; Registrierung ein/aus, Freigabepflicht, Benutzerverwaltung
- Planungen im Konto speichern, öffnen, umbenennen, als Kopie speichern, löschen
- Showroom-Link zum Ansehen ohne Anmeldung (nur lesend, deaktivierbar)

**Betrieb**
- Docker-Image (Node 22, Express, SQLite), Betrieb hinter Zoraxy
