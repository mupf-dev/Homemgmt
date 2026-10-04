// Alle Maße im Grundriss in Zentimetern. 2D: x nach rechts, y nach unten.
// In 3D: 1 Einheit = 1 Meter, 2D-x -> 3D-x, 2D-y -> 3D-z.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  /** Gesperrt: im Editor nicht auswählbar und nicht veränderbar */
  locked?: boolean;
}

export type OpeningType = 'door' | 'window' | 'passage';

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  /** Abstand der Öffnungsmitte vom Wandpunkt a (cm) */
  offset: number;
  width: number;
  height: number;
  /** Brüstungshöhe (cm), bei Türen 0 */
  sill: number;
  /** Gesperrt: im Editor nicht auswählbar und nicht veränderbar */
  locked?: boolean;
}

export type FrontStyle = 'doors' | 'drawers' | 'mixed' | 'open' | 'single';

export interface Item {
  id: string;
  /** Gesperrt: im Editor nicht auswählbar und nicht veränderbar */
  locked?: boolean;
  type: string;
  x: number;
  y: number;
  /** Rotation in Radiant (2D, im Uhrzeigersinn bei y nach unten) */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  /** Abstand Unterkante zum Boden (cm) */
  elevation: number;
  front?: FrontStyle;
  /** Material-Überschreibungen pro Slot (z. B. nur diese Front in Eiche) */
  materials?: Partial<Record<MaterialSlot, string>>;
  wallId?: string;
  /** Textur-Ausrichtung je Materialbereich */
  uv?: Partial<Record<MaterialSlot, UVSettings>>;
  /** Kochinsel: Rückseite als Theke (Sitzüberstand) oder mit Schranktüren */
  islandBack?: 'seating' | 'doors';
  /** Griffart bei grifflosen Küchen: 'vertical' = über senkrechte Griffleiste daneben (keine waagerechten Mulden) */
  grip?: 'horizontal' | 'vertical';
  /** Kochinsel: Breiten der Spalten in cm (überschreibt „columns“) */
  columnWidths?: number[];
  /** Kochinsel: Frontaufteilung je Spalte (Höhenverhältnisse von oben nach unten) */
  columnFronts?: number[][];
  /** Arbeitsplattenüberstand in cm (links, rechts, vorne, hinten) */
  ctOverhang?: { l?: number; r?: number; f?: number; b?: number };
  /** Spülbecken: Edelstahl oder Granitverbund anthrazit */
  sinkFinish?: 'steel' | 'anthracite';
  /** Spülbecken-Modell: Standard oder BLANCO SUBLINE 500-U (Unterbau, Becken 500 × 400 × 190 mm) */
  sinkModel?: 'standard' | 'subline500u';
  /** Armatur: Standard-Bogen oder BLANCO KANO-S Vario (flach, Schlauchbrause, anthrazit/chrom) */
  faucet?: 'standard' | 'kano-s';
  /** Kochfeld mit integriertem Dunstabzug (Muldenlüfter) */
  downdraft?: boolean;
  /** Kochinsel: Anzahl Spalten (leer = automatisch nach Breite) */
  columns?: number;
  /** Kochinsel: Auszüge je Spalte (Standard 3) */
  drawers?: number;
  /** Kochinsel-Rückseite: Türen je Spalte (leer = automatisch, ab 62 cm zwei) */
  doorsPerColumn?: number;
  /** Kochinsel: Arbeitsplatte seitlich bis zum Boden geführt */
  waterfall?: boolean;
  /** Regale/Schränke: Anzahl Böden bzw. Schubladen (Kommode) */
  levels?: number;
  /** 3D-Modell aus der Bibliothek (Möbel, Deko …): Element-Typ „model“ */
  model?: { url: string; name: string; source: 'polyhaven' | 'eigene' | 'furnimesh'; id: string; license?: string; thumb?: string; size?: [number, number, number] };
  /** Durchgang in Schrankoptik: nur Front (Tür), kein Korpus, keine Fächer – dahinter eine Öffnung in der Wand */
  passage?: boolean;
  /** ID der zugehörigen Wandöffnung (wird mit dem Durchgang angelegt/entfernt) */
  passageOpening?: string;
  /** Eigener Name (z. B. „Vorratsschrank“) – erscheint im Lager als Name der Plätze */
  label?: string;
  /** Lager: Spaltenbuchstabe im Lager des Raums (vom Server vergeben, z. B. „B“ → Plätze KU-B0, KU-B1 …) */
  storageCol?: string;
}

export type MaterialSlot =
  | 'front'
  | 'carcass'
  | 'countertop'
  | 'handle'
  | 'channel'
  | 'sink'
  | 'backsplash'
  | 'floor'
  | 'wall'
  | 'ceiling';

export interface MaterialDef {
  id: string;
  name: string;
  /** Kategorie für die Bibliothek */
  category: 'lack' | 'holz' | 'stein' | 'metall' | 'fliese' | 'boden' | 'wand' | 'eigene';
  color: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  /** Prozedurale Textur-Generierung */
  procedural?: 'ceramicCloud' | 'oak' | 'walnut' | 'marble' | 'marbleDark' | 'concrete' | 'granite' | 'terrazzo' | 'subway' | 'parquet' | 'floortile' | 'brushed' | 'plaster';
  /** Hochgeladene Textur (Data-URL) oder mitgelieferte Bilddatei (URL) */
  image?: string;
  /** kleines Vorschaubild für die Auswahl (bei mitgelieferten Texturen) */
  thumb?: string;
  normalImage?: string;
  roughnessImage?: string;
  /** Kantenlänge einer Texturkachel in cm */
  tileSize: number;
  /** Textur um 90° drehen (veraltet, siehe rotation) */
  rotate?: boolean;
  /** Standard-Drehung der Textur in Grad */
  rotation?: number;
  /** Farbanpassung (wirkt auf Textur bzw. Grundfarbe) */
  adjust?: ColorAdjust;
  /** Herkunft bei importierten Bibliotheksmaterialien */
  source?: string;
  /** Stärke der Reliefwirkung (Normal Map) */
  bump?: number;
  /** Seitenverhältnis Breite/Höhe des hochgeladenen Bildes */
  aspect?: number;
  /** Standard-Darstellung: wiederholen oder einmal über die ganze Fläche strecken */
  mapping?: TexMode;
}

export type TexMode = 'tile' | 'stretch';

/** Farbanpassung eines Materials; alle Werte 0 = unverändert */
export interface ColorAdjust {
  /** Farbton-Drehung in Grad (−180…180) */
  hue?: number;
  /** Sättigung in % (−100…100) */
  saturation?: number;
  /** Helligkeit in % (−100…100) */
  brightness?: number;
  /** Kontrast in % (−100…100) */
  contrast?: number;
  /** Tönungsfarbe und Stärke in % (0…100) */
  tint?: string;
  tintAmount?: number;
}

/** Textur-Ausrichtung je Element und Bereich */
export interface UVSettings {
  mode?: TexMode;
  /** Skalierung (1 = Materialgröße bzw. genau die Fläche) */
  scale?: number;
  /** Drehung in Grad (0/90/180/270) */
  rotation?: number;
  /** Verschiebung in Prozent der Bild- bzw. Flächengröße */
  offsetX?: number;
  offsetY?: number;
}

export interface Underlay {
  image: string;
  /** cm pro Bildpixel */
  scale: number;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
}

export interface Project {
  version: 1;
  name: string;
  walls: Wall[];
  openings: Opening[];
  items: Item[];
  slots: Record<MaterialSlot, string>;
  customMaterials: MaterialDef[];
  /** Textur-Ausrichtung je Bereich für das ganze Projekt (Boden, Wände …; Elemente können abweichen) */
  uv?: Partial<Record<MaterialSlot, UVSettings>>;
  underlay?: Underlay;
  settings: {
    ceiling: boolean;
    backsplash: boolean;
    plinth: number;
    countertopThickness: number;
    timeOfDay: number;
    /** Lage des Hauses: Koordinaten und Nordrichtung (Grad im Uhrzeigersinn ab „oben“ im Grundriss) – für Sonnenstand und Wetter */
    location?: { lat: number; lon: number; north: number; label?: string };
    /** Lichtregler (1 = Standard) */
    sunIntensity?: number;
    skyIntensity?: number;
    lampIntensity?: number;
    /** Weichheit von Schatten und Lichtkegeln 0…1 */
    softness?: number;
    /** Höhe der automatischen Nischenrückwand in cm (Standard 60) */
    backsplashHeight?: number;
    /** Dielenrichtung des Bodens in Grad (0 = entlang x, 90 = quer) – veraltet */
    floorRotation?: number;
    /** Grifflose Fronten mit Griffmulden */
    handleless?: boolean;
  };
}

export type Selection =
  | { kind: 'item'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | null;

// ---------------------------------------------------------------------------
// Haus: mehrere Etagen, Räume und Möbel. Jede Etage ist für Editor und 3D eine „Planung“ (Project) wie bisher –
// Materialien, Licht und eigene Oberflächen gelten für das ganze Haus.

export type FloorKind = 'basement' | 'floor' | 'attic' | 'outdoor';

/** Raum: Fläche wird aus den umschließenden Wänden um den Punkt „seed“ erkannt (polygon ist der zuletzt erkannte Umriss) */
export interface Room {
  id: string;
  /** Gesperrt: im Editor nicht auswählbar und nicht veränderbar */
  locked?: boolean;
  name: string;
  /** Lager-Kürzel (1–4 Zeichen, A–Z/0–9, beginnt mit Buchstabe) – der Raum ist im Lager ein eigenes Lager */
  code: string;
  seed: Vec2;
  polygon?: Vec2[];
  /** Bodenbelag dieses Raums (sonst Hausstandard) */
  floorMaterial?: string;
  /** Umriss fest vorgegeben (offener Grundriss, Außenfläche) statt aus den Wänden erkannt */
  manual?: boolean;
  /** Außenflächen ohne Wände (Außenbereich): Carport, Terrasse, Stellplatz, Fläche */
  kind?: 'carport' | 'terrace' | 'parking' | 'area';
}

/** Satteldach über einer Etage (Dachgeschoss) */
export interface Roof {
  type: 'gable';
  /** Dachneigung in Grad */
  pitch: number;
  /** Kniestock in cm */
  knee: number;
  /** Firstrichtung entlang x oder y */
  ridge: 'x' | 'y';
}

export interface Floor {
  id: string;
  name: string;
  kind: FloorKind;
  /** Höhenlage der Fußbodenoberkante in cm (EG = 0, Keller negativ) */
  elevation: number;
  /** lichte Raumhöhe in cm (Standard für neue Wände) */
  height: number;
  walls: Wall[];
  openings: Opening[];
  items: Item[];
  rooms: Room[];
  /** Lager-Kürzel für Möbel außerhalb eines Raums (z. B. Flur ohne eigenen Raum) */
  code?: string;
  underlay?: Underlay;
  roof?: Roof;
}

export interface House {
  version: 2;
  name: string;
  floors: Floor[];
  slots: Record<MaterialSlot, string>;
  customMaterials: MaterialDef[];
  uv?: Partial<Record<MaterialSlot, UVSettings>>;
  settings: Project['settings'];
}
