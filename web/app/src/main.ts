import './style.css';
import { store, uid } from './state';
import { Plan2D, type Tool } from './plan2d';
import { Scene3D } from './scene3d';
import { CATALOG, getEntry, libraryEntries, libraryObject, type CatalogEntry } from './model/catalog.ts';
import { compareVersions, objectCompartmentCount, OBJ_PREFIX } from './model/objects.ts';
import { loadLibrary, objectIcon } from './objectlib';
import {
  adjustCanvas, adjustHex, allMaterials, CATEGORY_LABELS, hasAdjust, isTextured, LIBRARY, MATCH_FRONT, materialAspect, readImageFile, SLOT_LABELS, slotMaterialDef, swatchStyle,
} from './materials';
import type { ColorAdjust, FrontStyle, Item, MaterialDef, MaterialSlot, Project, UVSettings, Wall } from './model/types.ts';
import { countertopRuns, dist, projectOnWall, snapItem, wallDir, wallLength } from './model/geom.ts';
import { wallFaces as wallFacesRaw } from './model/rooms.ts';
import type { Floor, FloorKind, House, Room, Selection as PlanSelection, Vec2 } from './model/types.ts';
import { FLOOR_KINDS, CODE_RE, projectToFloor, roomOf, suggestCode } from './model/house.ts';
import { compartments, itemName, LEVEL_KINDS, levelsOf } from './model/storage.ts';
import { polygonArea } from './model/rooms.ts';
import { Account } from './account';
import { HouseSync } from './houseSync';
import { modelSize } from './modelLoader';
import type { HouseMode } from './scene3d';
import { initLager } from './lager/index';
import { api, bindExpiry, expiryField, parseExpiry } from './lager/core';
import { clearFailures, failures, flush, QueuedError } from './lager/outbox';
import { ic } from './icons';
import { initShell } from './shell';
import { onPrefs, prefs } from './prefs';
import { idleNow, initIdle, setTermStorm, setTermWeather, terminal } from './terminal';
import { sunPosition } from './sun';
import { lookFromWeather, WeatherFx } from './weatherfx';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ICON = {
  select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3l14 8-6 2-2 6z"/></svg>',
  wall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20V5h8v8h10"/><circle cx="3" cy="20" r="1.5" fill="currentColor"/><circle cx="21" cy="13" r="1.5" fill="currentColor"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21h18M6 21V5M6 5a14 14 0 0 1 14 14"/></svg>',
  window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h6l2 2h10v10H3z"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="13" cy="4" r="2"/><path d="M9 21l3-7 3 3v4M7 12l3-4 4 1 2 4"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-6-6-9 9"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M3 12h18M12 3l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.2-1.7-.5-1.1.2-2.3 1.4-2.3H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  logo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  room: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16v16H4z" stroke-dasharray="3 2"/><path d="M8 12h8M12 8v8"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
};

// ---------------------------------------------------------------------------
// Grundgerüst

const shell = initShell();
const app = $('#app');
app.innerHTML = `
<div class="hausbar" id="hausbar">
  <button class="btn primary plan-only" id="planDone" title="Planen beenden – zurück zum Ansehen">${ic('check')}Fertig</button>
  <div class="floor-tabs" id="floorTabs" role="tablist" aria-label="Etagen"></div>
  <form class="house-search view-only" id="houseSearch" role="search">${ICON.search}<input type="search" id="houseSearchInput" placeholder="Wo liegt …?" aria-label="Im Haus suchen" autocomplete="off" /><div class="search-pop" id="searchPop" hidden></div></form>
  <div class="plan-tools plan-only">
    <button class="btn icon" id="undo" title="Rückgängig (Strg+Z)">${ICON.undo}</button>
    <button class="btn icon" id="redo" title="Wiederholen (Strg+Y)">${ICON.redo}</button>
    <span class="vsep"></span>
    <button class="tool on" data-tool="select" title="Auswählen und verschieben">${ICON.select}<span>Auswählen</span></button>
    <button class="tool" data-tool="wall" title="Wand zeichnen">${ICON.wall}<span>Wand</span></button>
    <button class="tool" data-tool="door" title="Tür in eine Wand setzen">${ICON.door}<span>Tür</span></button>
    <button class="tool" data-tool="window" title="Fenster in eine Wand setzen">${ICON.window}<span>Fenster</span></button>
    <button class="tool" data-tool="room" title="Raum festlegen – jeder Raum wird ein Lager">${ICON.room}<span>Raum</span></button>
    <span class="vsep"></span>
    <button class="tool" data-drawer="catalog" title="Möbel und Einrichtung hinzufügen">${ic('sofa')}<span>Möbel</span></button>
    <button class="tool" data-drawer="materials" title="Materialien und Oberflächen">${ic('palette')}<span>Materialien</span></button>
    <button class="tool" data-drawer="room" title="Etage, Räume, Grundriss-Vorlage">${ic('layers')}<span>Etage</span></button>
  </div>
  <div class="spacer"></div>
  <div class="seg" id="viewMode">
    <button data-v="2d">2D</button><button data-v="split" class="plan-only">Geteilt</button><button data-v="3d">3D</button>
  </div>
  <button class="btn view-only" id="planStart" title="Wände, Möbel und Etagen bearbeiten" hidden>${ic('pencil')}Planen</button>
  <span class="acc-status plan-only" id="saveStatus"></span>
  <div class="file-menu">
    <button class="btn icon" id="fileBtn" title="Weitere Funktionen" aria-label="Weitere Funktionen">${ic('dots')}</button>
    <div class="dropdown" id="fileMenu" hidden>
      <label class="dd-name plan-only">Name des Hauses<input id="projectName" type="text" /></label>
      <button id="showroomBtn">${ICON.sparkle}Showroom (3D im Vollbild)</button>
      <button id="locationBtn" class="plan-only">${ic('sun')}Lage des Hauses …</button>
      <hr class="plan-only" />
      <button id="newBtn" class="plan-only">${ic('file')}Neues Haus …</button>
      <button id="openBtn" class="plan-only">${ICON.open}Aus Datei importieren (.json) …</button>
      <button id="saveBtn" class="plan-only">${ICON.save}Haus als Datei exportieren (.json)</button>
      <hr />
      <a class="dd-link" href="#/hilfe">${ic('help')}Anleitung</a>
    </div>
  </div>
  <input type="file" id="openFile" accept=".json,application/json" hidden />
</div>

<aside class="left">
  <div class="tabs">
    <button data-tab="room" class="on">Etage</button>
    <button data-tab="catalog">Möbel</button>
    <button data-tab="materials">Materialien</button>
    <button class="drawer-close" id="drawerClose" title="Leiste einklappen" aria-label="Leiste einklappen">${ic('x')}</button>
  </div>

  <section class="tab on" id="tab-room">
    <h3>Etage</h3>
    <div id="floorPanel"></div>

    <h3>Räume</h3>
    <div id="roomList"></div>

    <h3>Wände aus Maßen</h3>
    <div class="grid2">
      <label class="field"><span>Breite</span><span class="unit" data-unit="cm"><input type="number" id="roomW" value="460" min="100" /></span></label>
      <label class="field"><span>Tiefe</span><span class="unit" data-unit="cm"><input type="number" id="roomD" value="400" min="100" /></span></label>
      <label class="field"><span>Raumhöhe</span><span class="unit" data-unit="cm"><input type="number" id="roomH" value="260" min="200" /></span></label>
      <label class="field"><span>Form</span><select id="roomShape"><option value="rect">Rechteck</option><option value="l">L-Form</option></select></label>
    </div>
    <button class="btn" id="makeRoom" style="width:100%;justify-content:center">Wände erzeugen (ersetzt Wände)</button>

    <h3>Grundriss-Vorlage (2D-Plan)</h3>
    <p class="hint">Lade einen Grundriss als Bild (Scan, Foto, PNG/JPG) hoch, kalibriere den Maßstab über eine bekannte Strecke und zeichne die Wände nach.</p>
    <div class="drop" id="underlayDrop">${ICON.image}<div>Bild hierher ziehen oder klicken</div></div>
    <input type="file" id="underlayFile" accept="image/*" hidden />
    <div id="underlayControls" hidden>
      <div class="row"><label>Deckkraft</label><input type="range" id="underlayOpacity" min="0.1" max="1" step="0.05" style="width:120px" /></div>
      <div class="row"><label>Sichtbar</label><input type="checkbox" id="underlayVisible" /></div>
      <div class="tools" style="margin-top:6px">
        <button class="tool" id="calibrate">${ICON.ruler}Maßstab</button>
        <button class="tool" id="moveUnderlay">${ICON.move}Verschieben</button>
      </div>
      <button class="btn danger" id="removeUnderlay" style="margin-top:6px">${ICON.trash}Vorlage entfernen</button>
    </div>

    <h3>Einstellungen</h3>
    <div class="row"><label for="setCeiling">Decke mit Deckenleuchten</label><input type="checkbox" id="setCeiling" /></div>
    <div class="row"><label for="setBacksplash">Nischenrückwand automatisch</label><input type="checkbox" id="setBacksplash" /></div>
    <div class="row"><label>Höhe Nischenrückwand</label><span class="unit" data-unit="cm"><input type="number" id="setBsHeight" min="10" max="150" step="0.1" /></span></div>
    <div class="row"><label for="setHandleless" title="Fronten ohne Griffe: Unterschränke mit Griffmulde oben, Hängeschränke von unten greifbar">Grifflos (Griffmulden)</label><input type="checkbox" id="setHandleless" /></div>
    <div class="row"><label>Sockelhöhe</label><span class="unit" data-unit="cm"><input type="number" id="setPlinth" min="0" max="20" /></span></div>
    <div class="row"><label>Arbeitsplattenstärke</label><span class="unit" data-unit="cm"><input type="number" id="setTop" min="1" max="12" step="0.5" /></span></div>
  </section>

  <section class="tab" id="tab-catalog">
    <div class="btn-col" style="margin-bottom:10px">
      <button class="btn primary" id="modelLibrary" style="justify-content:center">${ICON.globe}Möbel &amp; Deko aus der Online-Bibliothek</button>
      <button class="btn" id="modelUpload" style="justify-content:center">${ICON.box}Eigenes 3D-Modell (.glb) hochladen</button>
      <input type="file" id="modelFile" accept=".glb,model/gltf-binary" hidden />
    </div>
    <p class="hint">Element anklicken und im Grundriss platzieren. Schränke docken automatisch an Wände und Nachbarn an. <kbd>R</kbd> dreht, <kbd>Shift</kbd>+Klick platziert mehrfach, <kbd>Alt</kbd> deaktiviert das Andocken.</p>
    <div id="catalog"></div>
  </section>

  <section class="tab" id="tab-materials">
    <p class="hint">Standardmaterial je Bereich. Einzelne Elemente können im Eigenschaftenfeld abweichende Materialien erhalten.</p>
    <div id="slots"></div>
    <h3>Eigene Oberflächen</h3>
    <p class="hint">Mische eine eigene Lackfarbe (matt, normal oder Hochglanz) oder lade ein Foto bzw. eine Textur deiner Wunschoberfläche hoch (z. B. Musterfoto einer Arbeitsplatte, Fliese, Holzdekor).</p>
    <div class="btn-col">
      <button class="btn primary" id="libraryMaterial" style="justify-content:center">${ICON.globe}Online-Bibliothek</button>
      <button class="btn" id="colorMaterial" style="justify-content:center">${ICON.palette}Eigene Farbe</button>
      <button class="btn" id="uploadMaterial" style="justify-content:center">${ICON.image}Textur hochladen</button>
    </div>
    <div class="mat-grid" id="customMats" style="margin-top:10px"></div>
  </section>
</aside>

<main class="v-split" id="main">
  <div class="pane" id="plan">
    <div class="overlay tr"><div class="chip"><button class="btn" id="fitPlan" title="Ansicht einpassen">Einpassen</button></div></div>
    <div class="tool-hint plan-only" id="toolHint"></div>
  </div>
  <div class="pane" id="view">
    <div class="shared-badge"><b id="sharedTitle">Lade Küche …</b><span>Nur ansehen</span></div>
    <div class="overlay tr showroom-only">
      <div class="chip">
        <button class="btn" id="tourBtn" title="Kamera kreist langsam durch den Raum">${ICON.rotate}Rundgang</button>
        <button class="btn" id="fsBtn" title="Browser-Vollbild">${ICON.expand}Vollbild</button>
        <button class="btn" id="exitShowroom" title="Showroom beenden (Esc)">${ic('x')}Beenden</button>
      </div>
    </div>
    <div class="overlay tl">
      <div class="chip">
        <div class="seg" id="houseMode" title="Was zu sehen ist"><button data-h="floor" class="on" title="Nur die aktive Etage">Etage</button><button data-h="stack" title="Alle Etagen bis zur aktiven – Blick von oben ins Haus">Bis hier</button><button data-h="house" title="Das ganze Haus">Haus</button></div>
        <button class="btn plan-only" id="storageBtn" title="Lager: Fächer nach Füllstand färben, anklicken zeigt den Inhalt">${ICON.box}Lager</button>
        <select id="heatSel" hidden title="Färbung der Fächer"><option value="">Füllstand</option><option value="moves">Bewegung (90 Tage)</option><option value="stale">Lange unberührt</option></select>
      </div>
      <div class="chip">
        <button class="btn" data-cam="perspective">Übersicht</button>
        <button class="btn" data-cam="corner">Raumecke</button>
        <button class="btn" data-cam="front">Frontal</button>
        <button class="btn" data-cam="top">Draufsicht</button>
        <button class="btn" id="walkBtn" title="Durch das Haus laufen: Maus umsehen, WASD laufen, über Treppen in andere Etagen">${ICON.walk}Begehen</button>
      </div>
    </div>
    <div class="overlay bl">
      <div class="chip plan-only"><span title="Tageszeit (Sonnenstand)">${ic('sun')}</span><input type="range" id="timeOfDay" min="6" max="20" step="0.25" /><span id="timeLabel"></span></div>
      <div class="chip plan-only"><span>Belichtung</span><input type="range" id="exposure" min="0.3" max="2.5" step="0.05" value="1" /></div>
      <div class="chip light-chip plan-only">
        <button class="btn" id="lightBtn" title="Licht einstellen: Sonne, Himmel, Lampen, Weichheit">${ICON.bulb}Licht</button>
        <div class="light-pop" id="lightPop" hidden>
          <label class="field"><span>Sonne <b data-v="sunIntensity"></b></span><input type="range" data-light="sunIntensity" min="0" max="2" step="0.05" /></label>
          <label class="field"><span>Himmel / Tageslicht <b data-v="skyIntensity"></b></span><input type="range" data-light="skyIntensity" min="0" max="2.5" step="0.05" /></label>
          <label class="field"><span>Lampen <b data-v="lampIntensity"></b></span><input type="range" data-light="lampIntensity" min="0" max="3" step="0.05" /></label>
          <label class="field"><span>Weichheit Schatten &amp; Lichtkegel <b data-v="softness"></b></span><input type="range" data-light="softness" min="0" max="1" step="0.05" /></label>
          <div class="chips"><button data-preset="sun">Sonnig</button><button data-preset="soft">Weich / bewölkt</button><button data-preset="evening">Abend</button><button data-preset="reset">Standard</button></div>
        </div>
      </div>
      <div class="spacer"></div>
      <div class="chip">
        <button class="btn" id="ptBtn" title="Physikalisch korrektes Pathtracing – Bild wird fortlaufend verfeinert">${ICON.sparkle}Fotorealistisch</button>
        <span id="ptSamples" hidden></span>
        <span id="gpuBadge" class="gpu-badge" hidden></span>
        <button class="btn" id="shotBtn" title="Aktuelle Ansicht als PNG speichern">${ICON.camera}Bild</button>
      </div>
    </div>
    <div class="walk-hint" id="walkHint"><b id="walkWhere"></b>WASD / Pfeiltasten laufen · Maus umsehen · Shift schneller · Treppen führen in die anderen Etagen · Esc beenden</div>
  </div>
</main>

<aside class="right props plan-only" id="props"></aside>
<aside class="right view-panel view-only" id="viewPanel" aria-label="Fächer und Inhalt"></aside>
`;

// ---------------------------------------------------------------------------
// Ansichten

const plan = new Plan2D($('#plan'));
const view = new Scene3D($('#view'));
// Hausplan auf dem Server (früh anlegen: Panels lesen beim ersten Zeichnen den Lagerinhalt)
const sync = new HouseSync({ toast, modal, statusEl: () => document.getElementById('saveStatus'), afterLoad });

const toolHints: Record<Tool, string> = {
  select: 'Elemente, Wände, Türen und Fenster anklicken und ziehen. Breite eines Elements über die seitlichen Ziehpunkte frei ändern. Wandendpunkte verschieben. <kbd>Entf</kbd> löscht, <kbd>R</kbd> dreht. Rechte Maustaste / Leertaste + Ziehen verschiebt die Ansicht, Mausrad zoomt.',
  wall: 'Klicken setzt Wandpunkte. Länge eintippen + <kbd>Enter</kbd> für exakte Maße. Doppelklick, Rechtsklick oder <kbd>Esc</kbd> beendet. <kbd>Alt</kbd> hebt den Winkelfang auf.',
  door: 'Auf eine Wand klicken, um eine Tür einzusetzen.',
  window: 'Auf eine Wand klicken, um ein Fenster einzusetzen.',
  calibrate: 'Zwei Punkte einer bekannten Strecke auf der Vorlage anklicken.',
  room: 'In eine von Wänden umschlossene Fläche klicken und den Raum benennen. Jeder Raum wird ein eigenes Lager; Möbel mit Fächern darin bekommen Lagerplätze (z. B. KU-B2).',
  place: 'Klicken zum Platzieren. <kbd>R</kbd> dreht, <kbd>Esc</kbd> bricht ab.',
};

plan.onToolChange = (t) => {
  document.querySelectorAll<HTMLElement>('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('#calibrate').classList.toggle('on', t === 'calibrate');
  if (t !== 'place') document.querySelectorAll('.cat-item').forEach((b) => b.classList.remove('on'));
  // Auswählen ist der Normalfall – Hinweis nur für die übrigen Werkzeuge (Bedienung steht in der Anleitung)
  $('#toolHint').innerHTML = t === 'select' ? '' : toolHints[t];
};
plan.onToolChange('select');

document.querySelectorAll<HTMLElement>('.tool[data-tool]').forEach((b) =>
  b.addEventListener('click', () => {
    plan.moveUnderlay = false;
    $('#moveUnderlay').classList.remove('on');
    plan.setTool(b.dataset.tool as Tool);
  }),
);

// Ansichtsmodus
document.querySelectorAll<HTMLElement>('#viewMode button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#viewMode button').forEach((x) => x.classList.toggle('on', x === b));
    $('#main').className = 'v-' + b.dataset.v;
  }),
);

// Tabs
document.querySelectorAll<HTMLElement>('.tabs button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'materials') renderMaterialsTab();
    // beim Planen klappt die Leiste dafür auf
    if (document.body.classList.contains('haus-plan')) setDrawer(b.dataset.tab!, false);
  }),
);

$('#fitPlan').addEventListener('click', () => plan.fit());
document.querySelectorAll<HTMLElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => view.setView(b.dataset.cam as any)));
$('#walkBtn').addEventListener('click', () => view.startWalk());
view.onWalkChange = (on) => $('#walkHint').classList.toggle('on', on);
view.onWalkWhere = (f, room) => {
  $('#walkWhere').textContent = `${f.name}${room ? ' · ' + room : ''}`;
};
view.onModeChange = (mode) => document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.h === mode));
// 3D-Knopf „Haus“ beim Ansehen: Seitenleiste zeigt das ganze Haus, „Etage“/„Bis hier“ die Räume der Etage
document.querySelectorAll<HTMLElement>('#houseMode [data-h]').forEach((b) =>
  b.addEventListener('click', () => {
    if (!document.body.classList.contains('haus-view')) return;
    viewHouse = b.dataset.h === 'house';
    if (viewHouse) {
      viewFach = null;
      store.select(null);
    }
    renderViewPanel();
  }),
);

$('#exposure').addEventListener('input', (e) => view.setExposure(+(e.target as HTMLInputElement).value));

$('#ptBtn').addEventListener('click', async () => {
  const on = !view.pathTracing;
  await view.setPathTracing(on);
  $('#ptBtn').classList.toggle('pt-on', on);
  $('#ptSamples').hidden = !on;
  if (on) {
    const gpu = view.gpuInfo();
    if (gpu.integrated) showGpuHint(gpu.name);
    else toast('Fotorealistischer Modus: Das Bild wird mit jeder Probe rauschfreier. Kamera ruhig halten.');
  }
});
// GPU-Anzeige: warnt, wenn nur die integrierte Grafik genutzt wird
{
  const gpu = view.gpuInfo();
  const badge = $('#gpuBadge');
  const short = gpu.name.replace(/^ANGLE \(|\)$/g, '').replace(/Direct3D.*$|vs_\d.*$/i, '').split(',').slice(-2, -1)[0]?.trim() || gpu.name;
  badge.hidden = false;
  badge.innerHTML = gpu.integrated ? `${ic('warn')} integrierte GPU` : `GPU ${ic('check')}`;
  badge.title = `Genutzte Grafikkarte: ${short}`;
  badge.classList.toggle('warn', gpu.integrated);
  if (gpu.integrated) badge.addEventListener('click', () => showGpuHint(gpu.name));
}

function showGpuHint(name: string) {
  modal(
    'Leistungsstarke Grafikkarte nutzen',
    `<p>Der Browser rendert gerade mit <b>${esc(name)}</b>. Der fotorealistische Modus läuft auf der dedizierten Grafikkarte (z. B. NVIDIA) um ein Vielfaches schneller.</p>
    <h3>Windows-Einstellung (empfohlen)</h3>
    <ol class="steps">
      <li><b>Einstellungen → System → Bildschirm → Grafik</b> öffnen.</li>
      <li>Den Browser in der Liste suchen (oder über <i>Durchsuchen</i> hinzufügen, z. B. <code>C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe</code> bzw. <code>msedge.exe</code>).</li>
      <li><b>Optionen → Hohe Leistung</b> (NVIDIA) wählen und speichern.</li>
      <li>Den Browser <b>vollständig schließen</b> (alle Fenster, ggf. Hintergrundprozesse) und neu starten.</li>
    </ol>
    <h3>Alternativ: NVIDIA-Systemsteuerung</h3>
    <p class="hint">3D-Einstellungen verwalten → Programmeinstellungen → Browser auswählen → „Hochleistungs-NVIDIA-Prozessor“.</p>
    <h3>Prüfen</h3>
    <p class="hint">Nach dem Neustart zeigt die Anzeige neben „Fotorealistisch“ <b>GPU ✓</b>. Details unter <code>chrome://gpu</code> bzw. <code>edge://gpu</code> (Eintrag „GL_RENDERER“).
    Notebook dabei möglichst am Netzteil betreiben – im Akkubetrieb drosseln viele Geräte die NVIDIA-GPU.</p>`,
  );
}

let ptSamples = 0;
view.onSamples = (n) => {
  ptSamples = n;
  $('#ptSamples').textContent = `${n} Proben`;
};

$('#shotBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = view.screenshot();
  a.download = `${store.project.name || 'kueche'}.png`;
  a.click();
});

// ---------------------------------------------------------------------------
// Showroom: 3D im Vollformat, alle Bedienleisten ausgeblendet

let showroomPrevView = 'split';
function setShowroom(on: boolean) {
  const main = $('#main');
  if (on) {
    showroomPrevView = main.className.replace('v-', '') || 'split';
    main.className = 'v-3d';
    store.select(null);
    plan.setTool('select');
  } else {
    main.className = 'v-' + showroomPrevView;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  document.body.classList.toggle('showroom', on);
  view.setShowroom(on);
  $('#tourBtn').classList.toggle('on', false);
  try {
    if (store.readonly) throw 0;
    if (on) sessionStorage.setItem('kp.showroom', '1');
    else sessionStorage.removeItem('kp.showroom');
  } catch {
    /* ignorieren */
  }
  if (on) toast('Showroom: Maus ziehen zum Drehen, Mausrad zum Zoomen, Doppelklick zum Fokussieren · Esc beendet');
}
$('#showroomBtn').addEventListener('click', () => setShowroom(true));
$('#exitShowroom').addEventListener('click', () => setShowroom(false));
$('#tourBtn').addEventListener('click', () => {
  const on = !view.autoRotate;
  view.setAutoRotate(on);
  $('#tourBtn').classList.toggle('on', on);
});
$('#fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => toast('Vollbild wird von diesem Browser nicht unterstützt.'));
});
document.addEventListener('fullscreenchange', () => $('#fsBtn').classList.toggle('on', !!document.fullscreenElement));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !document.body.classList.contains('showroom') || store.readonly) return;
  // Esc beendet erst Begehen/Dialoge, dann den Showroom
  if (document.pointerLockElement || document.querySelector('.modal-back')) return;
  if (document.fullscreenElement) return; // Browser verlässt bei Esc zuerst das Vollbild
  setShowroom(false);
});

// Licht-Regler
const LIGHT_DEFAULTS = { sunIntensity: 1, skyIntensity: 1, lampIntensity: 1, softness: 0.6 } as const;
type LightKey = keyof typeof LIGHT_DEFAULTS;
const lightPop = $('#lightPop');
$('#lightBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  lightPop.hidden = !lightPop.hidden;
  syncLight();
});
lightPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => (lightPop.hidden = true));
function syncLight() {
  const st = store.project.settings;
  lightPop.querySelectorAll<HTMLInputElement>('[data-light]').forEach((inp) => {
    const k = inp.dataset.light as LightKey;
    const v = st[k] ?? LIGHT_DEFAULTS[k];
    if (document.activeElement !== inp) inp.value = String(v);
    lightPop.querySelector(`[data-v="${k}"]`)!.textContent = k === 'softness' ? `${Math.round(v * 100)} %` : `${Math.round(v * 100)} %`;
  });
}
let lightTimer = 0;
lightPop.querySelectorAll<HTMLInputElement>('[data-light]').forEach((inp) => {
  inp.addEventListener('input', () => {
    (store.project.settings as Record<string, unknown>)[inp.dataset.light!] = +inp.value;
    syncLight();
    clearTimeout(lightTimer);
    lightTimer = window.setTimeout(() => store.emit(), 60);
  });
  inp.addEventListener('change', () => store.commit());
});
const LIGHT_PRESETS: Record<string, Partial<Record<LightKey, number>>> = {
  sun: { sunIntensity: 1.3, skyIntensity: 1, lampIntensity: 0.6, softness: 0.3 },
  soft: { sunIntensity: 0.25, skyIntensity: 1.6, lampIntensity: 1, softness: 1 },
  evening: { sunIntensity: 0.2, skyIntensity: 0.35, lampIntensity: 1.8, softness: 0.8 },
  reset: { ...LIGHT_DEFAULTS },
};
lightPop.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    Object.assign(store.project.settings, LIGHT_PRESETS[b.dataset.preset!]);
    syncLight();
    store.commit();
  }),
);
store.subscribe(() => {
  if (!lightPop.hidden) syncLight();
});

// Undo / Redo
$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
  if (!document.body.classList.contains('haus-plan')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelection();
  }
});

// Projekt
const nameInput = $<HTMLInputElement>('#projectName');
nameInput.addEventListener('change', () => {
  store.project.name = nameInput.value;
  store.commit();
});
// Datei-Menü
const fileMenu = $('#fileMenu');
$('#fileBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  fileMenu.hidden = !fileMenu.hidden;
});
document.addEventListener('click', () => (fileMenu.hidden = true));
// Namensfeld im Menü: Klick hinein schließt das Menü nicht
fileMenu.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.dd-name')) e.stopPropagation();
});

$('#newBtn').addEventListener('click', () => openNewPlan());

async function openNewPlan() {
  const shared = sync.online && sync.canEdit;
  const m = modal(
    'Neues Haus',
    `${shared ? '<p class="form-error" style="display:block">Achtung: Der Hausplan wird von allen geteilt. Ein neues Haus ersetzt ihn für alle; Lagerplätze von Möbeln, die es dann nicht mehr gibt, werden entfernt (Plätze mit Inhalt bleiben erhalten).</p>' : ''}
    <div class="choice-grid">
      <button class="choice" data-kind="empty"><b>Leeres Haus</b><span>Eine leere Etage – Wände aus Maßen erzeugen oder Grundriss hochladen.</span></button>
      <button class="choice" data-kind="example"><b>Beispiel</b><span>Eine Etage mit fertiger Küche als Ausgangspunkt.</span></button>
    </div>`,
  );
  m.el.querySelectorAll<HTMLElement>('.choice').forEach((b) =>
    b.addEventListener('click', () => {
      if (shared && !confirm('Den gemeinsamen Hausplan wirklich ersetzen?')) return;
      m.close();
      store.reset(b.dataset.kind === 'empty');
      afterLoad();
      if (b.dataset.kind === 'empty') setDrawer('room');
    }),
  );
}

/** Planung (alte Küchenplanung) als neue Etage oder anstelle der aktiven Etage übernehmen */
function importPlan(data: Project, name: string, mode: 'new' | 'replace') {
  const h = store.house;
  if (mode === 'new') {
    const top = h.floors.reduce((m, f) => Math.max(m, f.elevation), -Infinity);
    const f = projectToFloor(data, { name, elevation: h.floors.some((x) => x.walls.length || x.items.length) ? top + 290 : 0 });
    // leere Start-Etage ersetzen statt eine weitere anzulegen
    if (h.floors.length === 1 && !h.floors[0].walls.length && !h.floors[0].items.length) h.floors = [{ ...f, elevation: 0 }];
    else h.floors.push(f);
    store.sortFloors();
    store.floorId = f.id;
  } else {
    const fl = store.floor;
    fl.walls = data.walls ?? [];
    fl.openings = data.openings ?? [];
    fl.items = data.items ?? [];
    if (data.underlay) fl.underlay = data.underlay;
  }
  // eigene Oberflächen der Planung mitnehmen
  for (const m of data.customMaterials ?? []) if (!h.customMaterials.some((x) => x.id === m.id)) h.customMaterials.push(m);
  store.select(null);
  store.floorChanged();
  afterLoad();
  toast(`„${name}“ übernommen. Jetzt mit „Raum“ die Räume bestimmen – daraus entstehen die Lager.`);
  setPlanning(true);
  setDrawer('room');
}

function afterLoad() {
  plan.fit();
  view.setView('perspective');
}

$('#saveBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.house)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${store.house.name || 'haus'}.zuhause.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#openBtn').addEventListener('click', () => $('#openFile').click());
$<HTMLInputElement>('#openFile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    if (raw?.version === 2 && Array.isArray(raw.floors)) {
      if (!confirm(`Das ganze Haus durch „${raw.name ?? f.name}“ ersetzen?`)) return;
      store.replace(raw as House, { keepUndo: true });
      afterLoad();
    } else {
      if (!Array.isArray(raw?.walls)) throw new Error('Keine Haus- oder Planungsdatei');
      const choice = await askChoice('Planung importieren', `<p>„${esc(raw.name ?? f.name)}“ ist eine einzelne Planung (eine Etage).</p>`, [
        { id: 'replace', label: 'Aktuelle Etage ersetzen' },
        { id: 'new', label: 'Als neue Etage', primary: true },
      ]);
      if (choice) importPlan(raw as Project, raw.name || f.name.replace(/\..*$/, ''), choice as 'new' | 'replace');
    }
  } catch (err) {
    toast('Datei konnte nicht geladen werden: ' + (err as Error).message);
  }
  (e.target as HTMLInputElement).value = '';
});

// Raum aus Maßen
$('#makeRoom').addEventListener('click', () => {
  const W = +$<HTMLInputElement>('#roomW').value;
  const D = +$<HTMLInputElement>('#roomD').value;
  const H = +$<HTMLInputElement>('#roomH').value;
  const shape = $<HTMLSelectElement>('#roomShape').value;
  if (store.project.walls.length && !confirm('Vorhandene Wände, Türen und Fenster werden ersetzt. Fortfahren?')) return;
  const pts =
    shape === 'l'
      ? [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D * 0.55 }, { x: W * 0.55, y: D * 0.55 }, { x: W * 0.55, y: D }, { x: 0, y: D }]
      : [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }];
  const p = store.project;
  p.walls = pts.map((a, i) => ({ id: uid(), a: { ...a }, b: { ...pts[(i + 1) % pts.length] }, thickness: 12, height: H }));
  p.openings = [];
  p.items.forEach((i) => delete i.wallId);
  store.commit();
  plan.fit();
  view.setView('perspective');
});

// Grundriss-Vorlage
const underlayFile = $<HTMLInputElement>('#underlayFile');
const drop = $('#underlayDrop');
drop.addEventListener('click', () => underlayFile.click());
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) loadUnderlay(f);
});
underlayFile.addEventListener('change', () => {
  const f = underlayFile.files?.[0];
  if (f) loadUnderlay(f);
  underlayFile.value = '';
});

async function loadUnderlay(f: File) {
  if (!f.type.startsWith('image/')) {
    toast('Bitte ein Bild (PNG, JPG, WebP) hochladen. PDFs vorher als Bild exportieren.');
    return;
  }
  const url = await readImageFile(f, 3000);
  const img = new Image();
  img.onload = () => {
    // Startmaßstab: Bild ungefähr auf 8 m Breite
    const scale = 800 / img.width;
    store.project.underlay = { image: url, scale, x: 0, y: 0, opacity: 0.6, visible: true };
    store.commit();
    plan.fit();
    toast('Vorlage geladen. Jetzt den Maßstab kalibrieren: zwei Punkte einer bekannten Strecke anklicken.');
    plan.setTool('calibrate');
  };
  img.src = url;
}

$('#calibrate').addEventListener('click', () => plan.setTool('calibrate'));
plan.onCalibrated = (d) => {
  const real = prompt(`Gemessene Strecke: ${Math.round(d)} cm im aktuellen Maßstab.\nWie lang ist die Strecke in Wirklichkeit (cm)?`, String(Math.round(d)));
  const v = parseFloat((real ?? '').replace(',', '.'));
  const u = store.project.underlay;
  if (!u || !(v > 0)) return;
  const f = v / d;
  u.scale *= f;
  u.x *= f;
  u.y *= f;
  store.commit();
  plan.fit();
  toast('Maßstab gesetzt. Jetzt mit „Wand zeichnen“ die Wände nachzeichnen.');
};
$('#moveUnderlay').addEventListener('click', () => {
  plan.moveUnderlay = !plan.moveUnderlay;
  $('#moveUnderlay').classList.toggle('on', plan.moveUnderlay);
  plan.setTool('select');
});
$('#removeUnderlay').addEventListener('click', () => {
  delete store.project.underlay;
  store.commit();
});
$<HTMLInputElement>('#underlayOpacity').addEventListener('input', (e) => {
  if (!store.project.underlay) return;
  store.project.underlay.opacity = +(e.target as HTMLInputElement).value;
  plan.draw();
});
$<HTMLInputElement>('#underlayOpacity').addEventListener('change', () => store.commit());
$<HTMLInputElement>('#underlayVisible').addEventListener('change', (e) => {
  if (!store.project.underlay) return;
  store.project.underlay.visible = (e.target as HTMLInputElement).checked;
  store.commit();
});

// Einstellungen
const bindSetting = (id: string, key: keyof Project['settings'], type: 'bool' | 'num') => {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('change', () => {
    (store.project.settings as any)[key] = type === 'bool' ? el.checked : +el.value;
    store.commit();
  });
};
bindSetting('#setCeiling', 'ceiling', 'bool');
bindSetting('#setBacksplash', 'backsplash', 'bool');
bindSetting('#setBsHeight', 'backsplashHeight', 'num');
bindSetting('#setHandleless', 'handleless', 'bool');
bindSetting('#setPlinth', 'plinth', 'num');

bindSetting('#setTop', 'countertopThickness', 'num');
const timeInput = $<HTMLInputElement>('#timeOfDay');
timeInput.addEventListener('input', () => {
  store.project.settings.timeOfDay = +timeInput.value;
  updateTimeLabel();
});
timeInput.addEventListener('change', () => store.commit());
function updateTimeLabel() {
  const t = store.project.settings.timeOfDay;
  $('#timeLabel').textContent = `${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
}

function syncSettings() {
  const p = store.project;
  if (document.activeElement !== nameInput) nameInput.value = p.name;
  $<HTMLInputElement>('#setCeiling').checked = p.settings.ceiling;
  $<HTMLInputElement>('#setBacksplash').checked = p.settings.backsplash;
  $<HTMLInputElement>('#setBsHeight').value = String(p.settings.backsplashHeight ?? 60);
  $<HTMLInputElement>('#setHandleless').checked = !!p.settings.handleless;
  $<HTMLInputElement>('#setPlinth').value = String(p.settings.plinth);
  $<HTMLInputElement>('#setTop').value = String(p.settings.countertopThickness);
  timeInput.value = String(p.settings.timeOfDay);
  updateTimeLabel();
  const u = p.underlay;
  $('#underlayControls').hidden = !u;
  if (u) {
    $<HTMLInputElement>('#underlayOpacity').value = String(u.opacity);
    $<HTMLInputElement>('#underlayVisible').checked = u.visible;
  }
}

// ---------------------------------------------------------------------------
// Katalog

function catalogIcon(e: CatalogEntry) {
  const k = e.kind;
  if (e.object) return objectIcon(e.object);
  const s = 'stroke="currentColor" fill="none" stroke-width="1.4"';
  if (k === 'wall' || k === 'shelf' || k === 'hood') {
    if (k === 'hood') return `<svg viewBox="0 0 60 40"><path d="M26 2h8v18h14l4 8H8l4-8h14z" ${s}/></svg>`;
    if (k === 'shelf') return `<svg viewBox="0 0 60 40"><path d="M6 20h48v4H6z" ${s}/></svg>`;
    return `<svg viewBox="0 0 60 40"><rect x="14" y="4" width="32" height="22" ${s}/><path d="M30 4v22" ${s}/></svg>`;
  }
  if (k === 'tall' || k === 'tallFridge' || k === 'tallOven' || k === 'fridgeFree')
    return `<svg viewBox="0 0 60 40"><rect x="20" y="2" width="20" height="36" ${s}/><path d="M20 ${k === 'tallOven' ? 16 : 22}h20M${k === 'tallOven' ? '23 18h14v9H23z' : '36 26v6'}" ${s}/></svg>`;
  if (k === 'table') return `<svg viewBox="0 0 60 40"><path d="M6 16h48M10 16v20M50 16v20" ${s}/></svg>`;
  if (k === 'rack' || k === 'heavyRack') return `<svg viewBox="0 0 60 40"><path d="M18 2v36M42 2v36M18 9h24M18 18h24M18 27h24M18 36h24" ${s}/></svg>`;
  if (k === 'cupboard' || k === 'wardrobe') return `<svg viewBox="0 0 60 40"><rect x="17" y="2" width="26" height="36" ${s}/><path d="M30 2v36M27 18v4M33 18v4" ${s}/></svg>`;
  if (k === 'sideboard') return `<svg viewBox="0 0 60 40"><rect x="6" y="14" width="48" height="20" ${s}/><path d="M22 14v20M38 14v20M10 34v4M50 34v4" ${s}/></svg>`;
  if (k === 'dresser') return `<svg viewBox="0 0 60 40"><rect x="14" y="6" width="32" height="30" ${s}/><path d="M14 13.5h32M14 21h32M14 28.5h32" ${s}/></svg>`;
  if (k === 'workbench') return `<svg viewBox="0 0 60 40"><path d="M4 12h52M8 12v26M52 12v26M8 30h44" ${s}/></svg>`;
  if (k === 'stool') return `<svg viewBox="0 0 60 40"><path d="M22 10h16M24 10l-4 26M36 10l4 26M22 26h16" ${s}/></svg>`;
  if (k === 'pendant') return `<svg viewBox="0 0 60 40"><path d="M30 0v14M18 28a12 12 0 0 1 24 0z" ${s}/><circle cx="30" cy="31" r="2" ${s}/></svg>`;
  if (k === 'panel') return `<svg viewBox="0 0 60 40"><rect x="27" y="6" width="6" height="32" ${s}/></svg>`;
  const top = '<path d="M8 12h44" stroke="currentColor" stroke-width="3"/>';
  let inner = '<path d="M30 14v22" ' + s + '/>';
  if (e.front === 'drawers' || k === 'hob' || k === 'island') inner = `<path d="M10 21h40M10 28h40" ${s}/>`;
  if (e.front === 'mixed') inner = `<path d="M10 19h40" ${s}/>`;
  if (k === 'oven') inner = `<rect x="14" y="16" width="32" height="12" ${s}/>`;
  if (k === 'dishwasher') inner = `<path d="M12 17h36" ${s}/>`;
  if (k === 'sink') inner += `<path d="M20 9q10 6 20 0" ${s}/>`;
  return `<svg viewBox="0 0 60 40">${top}<rect x="10" y="13" width="40" height="23" ${s}/>${inner}</svg>`;
}

function renderCatalog() {
  // eingebaute Möbel und Möbelarten aus der Objektbibliothek (gleiche Gruppe → gemeinsam)
  const all = [...CATALOG, ...libraryEntries()];
  const groups = [...new Set(all.map((c) => c.group))].filter((g) => !g.startsWith('_'));
  $('#catalog').innerHTML = groups
    .map(
      (g) => `<div class="cat-group"><h3>${esc(g)}</h3><div class="catalog">${all.filter((c) => c.group === g)
        .map((c) => `<button class="cat-item${c.object ? ' cat-obj' : ''}" data-type="${esc(c.id)}" title="${c.object ? esc(`${c.object.name} · Objektbibliothek, Version ${c.object.version}`) : ''}">${catalogIcon(c)}<span>${esc(c.name)}</span><small>${c.width} × ${c.depth} × ${c.height} cm</small></button>`)
        .join('')}</div></div>`,
    )
    .join('') + `<p class="cat-lib"><a class="link" href="#/objekte">${ic('box')}Objektbibliothek – weitere Möbelarten</a></p>`;
  document.querySelectorAll<HTMLElement>('.cat-item').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.cat-item').forEach((x) => x.classList.toggle('on', x === b));
      if ($('#main').classList.contains('v-3d')) ($('#viewMode button[data-v="split"]') as HTMLElement).click();
      plan.setTool('place', b.dataset.type!);
    }),
  );
}
renderCatalog();
document.addEventListener('zh-objects', () => renderCatalog());

// ---------------------------------------------------------------------------
// Möbel & Deko: 3D-Modelle aus der Online-Bibliothek (Poly Haven CC0, FurniMesh) oder eigene .glb

const MODEL_CATS: [string, string][] = [['', 'Alle'], ['sitzen', 'Sitzmöbel'], ['tische', 'Tische'], ['betten', 'Betten'], ['schraenke', 'Schränke & Regale'], ['leuchten', 'Leuchten'], ['pflanzen', 'Pflanzen'], ['deko', 'Deko'], ['kueche', 'Küche & Geschirr'], ['elektronik', 'Elektronik'], ['buero', 'Büro'], ['aufbewahrung', 'Kisten & Körbe'], ['werkzeug', 'Werkzeug'], ['garten', 'Garten & Natur'], ['sonstiges', 'Sonstiges']];
let modelAll = false;
/** FurniMesh: realistische (KI-erzeugte) Möbel, nur Einrichtungs-Kategorien */
const FM_CATS: [string, string][] = [['', 'Alle'], ['sofas', 'Sofas'], ['sitzen', 'Sitzmöbel'], ['tische', 'Tische'], ['betten', 'Betten'], ['schraenke', 'Schränke & Regale'], ['leuchten', 'Leuchten'], ['bad', 'Bad']];
let modelSource: 'polyhaven' | 'furnimesh' = 'polyhaven';
const SOURCE_HINT = {
  polyhaven: 'Freie 3D-Modelle von Poly Haven (CC0) mit echten Maßen und Materialien. Beim Auswählen wird das Modell einmal auf den Server geladen.',
  furnimesh: 'Realistische, KI-erzeugte Möbel von FurniMesh – frei herunterladbar, aber ohne ausdrückliche Lizenz. Beim Auswählen wird das Modell geladen und verkleinert (dauert etwa 10 s); die Größe ist ein typischer Wert der Kategorie und lässt sich anpassen.',
};
let modelState = { q: '', cat: '' };

/** Modell platzieren: Originalmaße messen, dann im Grundriss setzen */
async function placeModel(model: NonNullable<Item['model']>) {
  toast(`${model.name} wird geladen …`);
  try {
    const s = await modelSize(model.url);
    const size: [number, number, number] = [s.w, s.d, s.h];
    if ($('#main').classList.contains('v-3d')) ($('#viewMode button[data-v="split"]') as HTMLElement).click();
    plan.setTool('place', 'model', { model: { ...model, size }, width: s.w, depth: s.d, height: s.h });
    toast(`${model.name}: zum Platzieren in den Grundriss klicken (R dreht).`);
  } catch (e) {
    toast((e as Error).message);
  }
}

function openModelLibrary() {
  if (!account.user) return toast('Für die Online-Bibliothek bitte anmelden.');
  const m = modal('Möbel & Deko – Online-Bibliothek', `
    <form class="lib-search" id="mlForm"><input type="search" id="mlQ" placeholder="Suchen, z. B. Stuhl, Sofa, Lampe, Pflanze (oder englisch) …" value="${esc(modelState.q)}" /><button class="btn primary">Suchen</button></form>
    <div class="seg" id="mlSource" style="margin:6px 0"><button type="button" data-src="polyhaven">Poly Haven</button><button type="button" data-src="furnimesh">FurniMesh</button></div>
    <label class="row switch" id="mlAllRow" style="margin:4px 0"><input type="checkbox" id="mlAll" ${modelAll ? 'checked' : ''} /><span><b>Ohne Filter</b><small>Bei „Alle“ auch Garten, Natur, Werkzeug, Industrie und Requisiten zeigen</small></span></label>
    <p class="hint" id="mlCount"></p>
    <div class="chips" id="mlCats"></div>
    <div class="ml-grid" id="mlRes"><p class="hint">Lade …</p></div>
    <div style="text-align:center;margin-top:8px"><button class="btn" id="mlMore" hidden>Mehr anzeigen</button></div>
    <p class="hint" id="mlHint"></p>`);
  m.el.querySelector('.modal')!.classList.add('wide');
  const res = $('#mlRes', m.el);
  const more = $<HTMLButtonElement>('#mlMore', m.el);
  let offset = 0;
  let seq = 0;
  const load = async (append = false) => {
    const my = ++seq;
    if (!append) offset = 0;
    try {
      const r = await fetch(`/api/library/models?q=${encodeURIComponent(modelState.q)}&cat=${modelState.cat}&all=${modelAll ? 1 : 0}&source=${modelSource}&limit=48&offset=${offset}`, { credentials: 'same-origin' }).then((x) => x.json());
      if (my !== seq) return;
      if (r.error) throw new Error(r.error);
      $('#mlCount', m.el).textContent = r.note ?? (r.more ? `${r.hits.length + offset} Modelle geladen, weitere verfügbar` : `${r.total} Modelle`);
      const html = r.hits.map((h: any) => `<button class="ml-card" data-id="${esc(h.id)}"><img src="${esc(h.thumb)}" alt="" loading="lazy" /><b>${esc(h.name)}</b><small>${h.size ? `${h.size[0]} × ${h.size[1]} × ${h.size[2]} cm` : ''}</small></button>`).join('');
      res.innerHTML = append ? res.innerHTML + html : html || '<p class="hint">Nichts gefunden – englische Begriffe probieren.</p>';
      offset += r.hits.length;
      more.hidden = offset >= r.total;
      res.querySelectorAll<HTMLElement>('.ml-card:not([data-bound])').forEach((b) => {
        b.dataset.bound = '1';
        b.addEventListener('click', async () => {
          b.classList.add('busy');
          try {
            const r2 = await fetch('/api/library/models/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id, source: modelSource }), credentials: 'same-origin' }).then((x) => x.json());
            if (r2.error) throw new Error(r2.error);
            m.close();
            placeModel({ url: r2.url, name: r2.name, source: r2.source ?? modelSource, id: r2.id, license: r2.license, thumb: r2.thumb });
          } catch (e) {
            b.classList.remove('busy');
            toast((e as Error).message);
          }
        });
      });
    } catch (e) {
      res.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
    }
  };
  $('#mlForm', m.el).addEventListener('submit', (e) => {
    e.preventDefault();
    modelState.q = $<HTMLInputElement>('#mlQ', m.el).value.trim();
    load();
  });
  // Quelle: eigene Kategorien, „Ohne Filter“ nur bei Poly Haven
  const renderSource = () => {
    const cats = modelSource === 'furnimesh' ? FM_CATS : MODEL_CATS;
    if (!cats.some(([k]) => k === modelState.cat)) modelState.cat = '';
    m.el.querySelectorAll<HTMLElement>('#mlSource [data-src]').forEach((x) => x.classList.toggle('on', x.dataset.src === modelSource));
    ($('#mlAllRow', m.el) as HTMLElement).hidden = modelSource !== 'polyhaven';
    $('#mlHint', m.el).textContent = SOURCE_HINT[modelSource];
    const chips = $('#mlCats', m.el);
    chips.innerHTML = cats.map(([k, l]) => `<button type="button" data-cat="${k}" class="${modelState.cat === k ? 'on' : ''}">${l}</button>`).join('');
    chips.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      modelState.cat = b.dataset.cat!;
      chips.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
      load();
    }));
  };
  m.el.querySelectorAll<HTMLElement>('#mlSource [data-src]').forEach((b) => b.addEventListener('click', () => {
    modelSource = b.dataset.src as typeof modelSource;
    renderSource();
    load();
  }));
  renderSource();
  more.addEventListener('click', () => load(true));
  $<HTMLInputElement>('#mlAll', m.el).addEventListener('change', (e) => {
    modelAll = (e.target as HTMLInputElement).checked;
    load();
  });
  load();
}
$('#modelLibrary').addEventListener('click', openModelLibrary);
$('#modelUpload').addEventListener('click', () => {
  if (!account.user) return toast('Zum Hochladen bitte anmelden.');
  $('#modelFile').click();
});
$<HTMLInputElement>('#modelFile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  try {
    const r = await fetch(`/api/library/models/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' }).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    placeModel({ url: r.url, name: r.name, source: 'eigene', id: r.id, license: r.license });
  } catch (err) {
    toast((err as Error).message);
  }
});

// ---------------------------------------------------------------------------
// Materialien

const SLOT_ORDER: MaterialSlot[] = ['front', 'carcass', 'countertop', 'handle', 'channel', 'sink', 'backsplash', 'floor', 'wall', 'ceiling'];

/** Anzeigename eines Bereichsmaterials (berücksichtigt „wie Fronten“) */
function slotLabel(p: Project, slot: MaterialSlot, override?: string, frontOverride?: string) {
  const m = slotMaterialDef(p, slot, override, frontOverride);
  const id = override ?? p.slots[slot];
  return { m, name: id === MATCH_FRONT ? `Wie Fronten (${m.name})` : m.name };
}

function renderMaterialsTab() {
  const p = store.project;
  $('#slots').innerHTML = SLOT_ORDER.map((slot) => {
    const { m, name } = slotLabel(p, slot);
    const hint = slot === 'channel' && !p.settings.handleless ? ' · nur bei grifflos' : slot === 'handle' && p.settings.handleless ? ' · grifflos aktiv' : '';
    const uvOn = p.uv?.[slot] && Object.keys(p.uv[slot]!).length;
    return `<div class="slot" data-slot="${slot}"><span class="sw" style="${swatchStyle(m)}"></span><div><b>${SLOT_LABELS[slot]}</b><small>${esc(name)}${hint}</small></div><span class="slot-btns"><button class="btn mini ${hasAdjust(m.adjust) ? 'on' : ''}" data-slot-adj="${slot}" title="Farbe anpassen: Farbton, Sättigung, Helligkeit, Tönung, Glanz">${ICON.palette}</button>${isTextured(m) ? `<button class="btn mini ${uvOn ? 'on' : ''}" data-slot-uv="${slot}" title="Textur ausrichten: Drehung in Grad, Größe, Verschiebung, Strecken">${ICON.rotate}</button>` : ''}</span></div>`;
  }).join('');
  document.querySelectorAll<HTMLElement>('[data-slot-adj]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openAdjustDialog(b.dataset.slotAdj as MaterialSlot);
    }),
  );
  document.querySelectorAll<HTMLElement>('[data-slot-uv]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openUVDialog(projectUVTarget(b.dataset.slotUv as MaterialSlot));
    }),
  );
  document.querySelectorAll<HTMLElement>('.slot').forEach((el) =>
    el.addEventListener('click', () => {
      const slot = el.dataset.slot as MaterialSlot;
      openMaterialPicker(`${SLOT_LABELS[slot]} – Material wählen`, p.slots[slot], false, async (id) => {
        if (!id) return;
        const proj = store.project;
        proj.slots[slot] = id;
        // Elemente mit eigener Abweichung in diesem Bereich: mit umstellen?
        const deviating = proj.items.filter((i) => i.materials?.[slot]);
        if (deviating.length) {
          const choice = await askChoice(
            `${SLOT_LABELS[slot]} ändern`,
            `<p>${deviating.length} Element${deviating.length > 1 ? 'e haben' : ' hat'} ein eigenes Material für „${SLOT_LABELS[slot]}“.</p><p class="hint">Sollen diese ebenfalls auf „${esc(slotLabel(proj, slot).name)}“ umgestellt werden?</p>`,
            [
              { id: 'keep', label: 'Abweichungen behalten' },
              { id: 'all', label: `Alle ${SLOT_LABELS[slot]} umstellen`, primary: true },
            ],
          );
          if (choice === 'all') deviating.forEach((i) => delete i.materials![slot]);
        }
        store.commit();
      }, slot);
    }),
  );
  $('#customMats').innerHTML = p.customMaterials
    .map((m) => `<div class="mat-card" data-id="${m.id}"><span class="sw" style="${swatchStyle(m)}"></span><span>${esc(m.name)}</span><button class="del" title="Löschen">✕</button></div>`)
    .join('');
  document.querySelectorAll<HTMLElement>('#customMats .mat-card').forEach((el) => {
    el.addEventListener('click', () => {
      const m = store.project.customMaterials.find((x) => x.id === el.dataset.id);
      if (m) (m.image ? openUploadDialog(m) : openColorDialog(m));
    });
    el.querySelector('.del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomMaterial(el.dataset.id!);
    });
  });
}

function deleteCustomMaterial(id: string) {
  const p = store.project;
  if (!confirm('Eigenes Material löschen? Verwendungen werden auf Standard zurückgesetzt.')) return;
  p.customMaterials = p.customMaterials.filter((m) => m.id !== id);
  for (const s of SLOT_ORDER) if (p.slots[s] === id) p.slots[s] = LIBRARY[0].id;
  for (const it of p.items) if (it.materials) for (const k of Object.keys(it.materials) as MaterialSlot[]) if (it.materials[k] === id) delete it.materials[k];
  store.commit();
  renderMaterialsTab();
}

$('#uploadMaterial').addEventListener('click', () => openUploadDialog());
$('#colorMaterial').addEventListener('click', () => openColorDialog());
$('#libraryMaterial').addEventListener('click', () => openLibraryDialog());

function modal(title: string, body: string, footer = '') {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn icon" data-close aria-label="Schließen">${ic('x')}</button></header><div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  back.querySelector('[data-close]')!.addEventListener('click', close);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);
  return { el: back, close };
}

/** Materialauswahl; bei allowDefault kann "Standard" (= null) gewählt werden */
function openMaterialPicker(title: string, current: string | undefined, allowDefault: boolean, onPick: (id: string | null) => void, slotHint?: MaterialSlot) {
  const p = store.project;
  const preferred: Partial<Record<MaterialSlot, MaterialDef['category'][]>> = {
    front: ['lack', 'holz', 'stein', 'metall'],
    carcass: ['lack', 'holz'],
    countertop: ['stein', 'holz', 'metall', 'lack'],
    handle: ['metall'],
    sink: ['stein', 'metall'],
    channel: ['metall', 'lack'],
    backsplash: ['fliese', 'stein', 'lack', 'metall'],
    floor: ['boden', 'stein', 'holz'],
    wall: ['wand', 'fliese', 'lack'],
    ceiling: ['wand'],
  };
  const order = (slotHint && preferred[slotHint]) || [];
  const cats = [...new Set([...(p.customMaterials.length ? ['eigene' as const] : []), ...order, ...(Object.keys(CATEGORY_LABELS) as MaterialDef['category'][])])].filter(
    (c) => c !== 'eigene' || p.customMaterials.length,
  );
  const all = allMaterials(p);
  const body =
    `<div class="mat-grid" style="margin-bottom:8px"><button class="mat-card upload color-card" data-library>${ICON.globe}<span>Online-Bibliothek…</span></button><button class="mat-card upload color-card" data-color>${ICON.palette}<span>Eigene Farbe mischen…</span></button></div>` +
    (slotHint === 'channel'
      ? `<div class="mat-grid" style="margin-bottom:8px"><button class="mat-card ${current === MATCH_FRONT ? 'on' : ''}" data-id="${MATCH_FRONT}"><span class="sw" style="${swatchStyle(slotMaterialDef(p, 'front'))}"></span><span>Wie Fronten</span></button></div>`
      : '') +
    (allowDefault ? `<div class="mat-grid" style="margin-bottom:8px"><button class="mat-card ${!current ? 'on' : ''}" data-id=""><span class="sw" style="background:repeating-linear-gradient(45deg,var(--panel-2) 0 6px,var(--line) 6px 12px)"></span><span>Standard (Projekt)</span></button></div>` : '') +
    cats
      .map((c) => {
        const mats = all.filter((m) => m.category === c);
        if (!mats.length) return '';
        return `<h3>${CATEGORY_LABELS[c]}</h3><div class="mat-grid">${mats
          .map((m) => `<button class="mat-card ${m.id === current ? 'on' : ''}" data-id="${m.id}"><span class="sw" style="${swatchStyle(m)}"></span><span>${esc(m.name)}</span></button>`)
          .join('')}</div>`;
      })
      .join('') +
    `<h3>Eigene Textur</h3><div class="mat-grid"><button class="mat-card upload" data-upload>${ICON.image}<span>Textur hochladen…</span></button></div>`;
  const m = modal(title, body);
  m.el.querySelectorAll<HTMLElement>('.mat-card[data-id]').forEach((b) =>
    b.addEventListener('click', () => {
      onPick(b.dataset.id || null);
      m.close();
    }),
  );
  m.el.querySelector('[data-upload]')!.addEventListener('click', () => {
    m.close();
    openUploadDialog(undefined, (id) => onPick(id));
  });
  m.el.querySelector('[data-color]')!.addEventListener('click', () => {
    m.close();
    openColorDialog(undefined, (id) => onPick(id));
  });
  m.el.querySelector('[data-library]')!.addEventListener('click', () => {
    m.close();
    openLibraryDialog((id) => onPick(id), slotHint);
  });
}

function findMaterialName(id: string) {
  return allMaterials(store.project).find((m) => m.id === id)?.name ?? id;
}

/** Auswahldialog mit mehreren Schaltflächen; liefert die ID oder null bei Abbruch */
function askChoice(title: string, body: string, options: { id: string; label: string; primary?: boolean }[]): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const m = modal(
      title,
      body,
      `<button class="btn" data-choice="">Abbrechen</button>${options.map((o) => `<button class="btn ${o.primary ? 'primary' : ''}" data-choice="${o.id}">${esc(o.label)}</button>`).join('')}`,
    );
    m.el.querySelector('.modal')!.classList.add('narrow');
    m.el.querySelectorAll<HTMLElement>('[data-choice]').forEach((b) =>
      b.addEventListener('click', () => {
        m.close();
        finish(b.dataset.choice || null);
      }),
    );
    new MutationObserver((_, obs) => {
      if (!m.el.isConnected) {
        obs.disconnect();
        finish(null);
      }
    }).observe(document.body, { childList: true });
  });
}

// ---------------------------------------------------------------------------
// Textur ausrichten (je Element)

/** Ziel eines Ausrichten-Dialogs: ein Element (bzw. Arbeitsplattenzeile) oder ein Projektbereich */
interface UVTarget {
  def: MaterialDef;
  scope: string;
  /** geerbte Einstellungen (Projekt) – nur zur Anzeige */
  base?: UVSettings;
  get(): UVSettings | undefined;
  set(s: UVSettings | undefined): void;
}

function itemUVTarget(it: Item, slot: MaterialSlot): UVTarget {
  const p = store.project;
  const def = slotMaterialDef(p, slot, it.materials?.[slot], it.materials?.front);
  // Arbeitsplatte/Rückwand: Einstellung gilt für die ganze zusammenhängende Zeile
  const run = slot === 'countertop' || slot === 'backsplash' ? countertopRuns(p).get(it.id) : undefined;
  const ids = run?.ids ?? [it.id];
  return {
    def,
    base: p.uv?.[slot],
    scope:
      run && run.ids.length > 1
        ? `Gilt für die gesamte Arbeitsplatte dieser Zeile (${run.ids.length} Schränke, ${Math.round((run.u1 - run.u0) * 100)} × ${Math.round((run.v1 - run.v0) * 100)} cm).`
        : `Gilt nur für ${esc(getEntry(it.type).name)}.`,
    get: () => store.item(it.id)?.uv?.[slot],
    set: (v) => {
      for (const id of ids) {
        const t = store.item(id);
        if (!t) continue;
        t.uv = { ...(t.uv ?? {}) };
        if (v) t.uv[slot] = { ...v };
        else delete t.uv[slot];
      }
    },
  };
}

function projectUVTarget(slot: MaterialSlot): UVTarget {
  const p = store.project;
  const area = slot === 'floor' ? 'den ganzen Boden' : slot === 'wall' ? 'alle Wände' : slot === 'ceiling' ? 'die Decke' : `alle Elemente (${SLOT_LABELS[slot]})`;
  return {
    def: slotMaterialDef(p, slot),
    scope: `Gilt für ${area}${['floor', 'wall', 'ceiling'].includes(slot) ? '' : ' – einzelne Elemente können abweichen'}.`,
    get: () => store.project.uv?.[slot],
    set: (v) => {
      const proj = store.project;
      proj.uv = { ...(proj.uv ?? {}) };
      if (v) proj.uv[slot] = { ...v };
      else delete proj.uv[slot];
    },
  };
}

function openUVDialog(target: UVTarget) {
  const def = target.def;
  const original = target.get();
  const s: UVSettings = { ...(original ?? {}) };
  const eff = () => ({ ...(target.base ?? {}), ...s });
  const mode = () => eff().mode ?? def.mapping ?? 'tile';
  const baseRot = def.rotation ?? (def.rotate ? 90 : 0);
  const body = `
    <p class="hint">${esc(def.name)} · ${target.scope}</p>
    <div class="field"><span>Darstellung</span>
      <div class="seg mode-seg"><button type="button" data-m="stretch">Einmal auf ganze Fläche strecken</button><button type="button" data-m="tile">Wiederholen (Kacheln)</button></div>
    </div>
    <label class="field"><span>Größe <b id="uvScaleV"></b></span><input type="range" id="uvScale" min="-2" max="2" step="0.01" /></label>
    <div class="field"><span>Drehung${baseRot ? ` <small>(zusätzlich zur Materialdrehung ${baseRot}°)</small>` : ''}</span>
      <div class="rot-row">
        <input type="range" id="uvRot" min="-180" max="180" step="1" />
        <span class="unit" data-unit="°"><input type="number" id="uvRotN" min="-360" max="360" step="0.5" /></span>
      </div>
      <div class="chips">${[-90, -45, 0, 45, 90, 180].map((r) => `<button type="button" data-r="${r}">${r}°</button>`).join('')}</div>
    </div>
    <div class="grid2">
      <label class="field"><span>Verschieben ↔ <b id="uvXV"></b></span><input type="range" id="uvX" min="-50" max="50" step="0.5" /></label>
      <label class="field"><span>Verschieben ↕ <b id="uvYV"></b></span><input type="range" id="uvY" min="-50" max="50" step="0.5" /></label>
    </div>
    <p class="hint">Änderungen sind sofort sichtbar – die Ansicht bleibt bedienbar. „Wiederholen“ nutzt die reale Bildgröße des Materials; „Strecken“ passt das Bild genau einmal auf die Fläche ein.</p>`;
  const m = modal('Textur ausrichten', body, `<button class="btn" data-reset>Zurücksetzen</button><span class="spacer"></span><button class="btn" data-cancel>Abbrechen</button><button class="btn primary" data-ok>Fertig</button>`);
  m.el.querySelector('.modal')!.classList.add('narrow');
  // Dialog blockiert die Ansicht nicht: 3D/2D bleiben bedienbar (Kamera drehen, rendern …)
  m.el.classList.add('see-through');
  const el = m.el;
  const scale = $<HTMLInputElement>('#uvScale', el);
  const rot = $<HTMLInputElement>('#uvRot', el);
  const rotN = $<HTMLInputElement>('#uvRotN', el);
  const ox = $<HTMLInputElement>('#uvX', el);
  const oy = $<HTMLInputElement>('#uvY', el);

  const apply = () => {
    const clean: UVSettings = {};
    if (s.mode) clean.mode = s.mode;
    if (s.scale !== undefined && Math.abs(s.scale - 1) > 0.001) clean.scale = s.scale;
    if (s.rotation) clean.rotation = s.rotation;
    if (s.offsetX) clean.offsetX = s.offsetX;
    if (s.offsetY) clean.offsetY = s.offsetY;
    target.set(Object.keys(clean).length ? clean : undefined);
    store.emit();
  };
  const sync = () => {
    const e = eff();
    el.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode()));
    const r = e.rotation ?? 0;
    el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.classList.toggle('on', +b.dataset.r! === r));
    rot.value = String(((((r + 180) % 360) + 360) % 360) - 180);
    if (document.activeElement !== rotN) rotN.value = String(r);
    scale.value = String(Math.log2(e.scale ?? 1));
    $('#uvScaleV', el).textContent = `${Math.round((e.scale ?? 1) * 100)} %`;
    ox.value = String(e.offsetX ?? 0);
    oy.value = String(e.offsetY ?? 0);
    $('#uvXV', el).textContent = `${e.offsetX ?? 0} %`;
    $('#uvYV', el).textContent = `${e.offsetY ?? 0} %`;
  };
  const change = (fn: () => void) => () => {
    fn();
    sync();
    apply();
  };
  el.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', change(() => (s.mode = b.dataset.m as UVSettings['mode']))));
  el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.addEventListener('click', change(() => (s.rotation = +b.dataset.r!))));
  rot.addEventListener('input', change(() => (s.rotation = +rot.value)));
  rotN.addEventListener('input', change(() => (s.rotation = Math.max(-360, Math.min(360, +rotN.value || 0)))));
  scale.addEventListener('input', change(() => (s.scale = Math.round(2 ** +scale.value * 100) / 100)));
  ox.addEventListener('input', change(() => (s.offsetX = +ox.value)));
  oy.addEventListener('input', change(() => (s.offsetY = +oy.value)));
  el.querySelector('[data-reset]')!.addEventListener(
    'click',
    change(() => {
      for (const k of Object.keys(s) as (keyof UVSettings)[]) delete s[k];
    }),
  );
  let cancelled = false;
  el.querySelector('[data-ok]')!.addEventListener('click', () => m.close());
  el.querySelector('[data-cancel]')!.addEventListener('click', () => {
    cancelled = true;
    m.close();
  });
  // Schließen über „Fertig“, ✕ oder Esc übernimmt die Einstellungen – nur „Abbrechen“ verwirft
  new MutationObserver((_, obs) => {
    if (!el.isConnected) {
      obs.disconnect();
      if (cancelled) {
        target.set(original);
        store.emit();
      } else store.commit();
    }
  }).observe(document.body, { childList: true });
  sync();
}

// ---------------------------------------------------------------------------
// Online-Bibliothek (Poly Haven, ambientCG)

interface LibraryHit {
  source: 'polyhaven' | 'ambientcg';
  id: string;
  name: string;
  thumb: string;
  categories: string[];
  sizeCm?: number;
}

const LIB_CHIPS: [string, string][] = [
  ['Holz', 'wood'], ['Boden', 'floor'], ['Parkett', 'parquet'], ['Fliesen', 'tiles'], ['Marmor', 'marble'], ['Stein', 'stone'],
  ['Granit', 'granite'], ['Beton', 'concrete'], ['Terrazzo', 'terrazzo'], ['Putz', 'plaster'], ['Ziegel', 'brick'], ['Metall', 'metal'],
  ['Stoff', 'fabric'], ['Leder', 'leather'],
];
const SLOT_QUERY: Partial<Record<MaterialSlot, string>> = { floor: 'floor', countertop: 'marble', backsplash: 'tiles', wall: 'plaster', front: 'wood' };
let libState = { source: 'polyhaven' as LibraryHit['source'], q: '', res: '2k' };

async function libApi<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Fehler ${r.status}`);
  return d as T;
}

function openLibraryDialog(onPicked?: (id: string) => void, slotHint?: MaterialSlot) {
  if (!account.user) {
    toast('Für die Online-Bibliothek bitte anmelden – importierte Texturen werden auf dem Server gespeichert.');
    account.openLogin();
    return;
  }
  if (!libState.q && slotHint && SLOT_QUERY[slotHint]) libState.q = SLOT_QUERY[slotHint]!;
  const body = `
    <div class="lib-bar">
      <div class="seg lib-src"><button data-src="polyhaven">Poly Haven</button><button data-src="ambientcg">ambientCG</button></div>
      <form class="lib-search"><input type="text" id="libQ" placeholder="Suchen (englisch, z. B. oak, marble, tiles)" /><button class="btn primary" type="submit">Suchen</button></form>
      <select id="libRes" title="Auflösung der Texturen"><option value="1k">1K (schnell)</option><option value="2k">2K (detailreich)</option></select>
    </div>
    <div class="chips lib-chips">${LIB_CHIPS.map(([l, q]) => `<button data-q="${q}">${l}</button>`).join('')}</div>
    <div id="libResults" class="lib-grid"></div>
    <div class="lib-more"><button class="btn" id="libMore" hidden>Weitere laden</button></div>
    <p class="hint">Alle Materialien sind CC0 (gemeinfrei). Beim Import werden Farbe, Relief (Normal Map) und Rauheit einmalig auf den Server geladen; die reale Größe wird übernommen.</p>`;
  const m = modal('Online-Bibliothek', body);
  m.el.querySelector('.modal')!.classList.add('wide');
  const el = m.el;
  const qIn = $<HTMLInputElement>('#libQ', el);
  const resSel = $<HTMLSelectElement>('#libRes', el);
  const results = $('#libResults', el);
  const more = $<HTMLButtonElement>('#libMore', el);
  qIn.value = libState.q;
  resSel.value = libState.res;
  let offset = 0;
  let total = 0;
  let seq = 0;

  const card = (h: LibraryHit) =>
    `<button class="lib-card" data-id="${esc(h.id)}" data-src="${h.source}" title="${esc(h.name)}">
      <img src="${esc(h.thumb)}" loading="lazy" alt="" />
      <span>${esc(h.name)}</span><small>${h.sizeCm ? `${h.sizeCm} cm` : '&nbsp;'}</small>
    </button>`;

  const load = async (append = false) => {
    const my = ++seq;
    if (!append) {
      offset = 0;
      results.innerHTML = '<p class="hint">Suche …</p>';
    }
    more.hidden = true;
    try {
      const r = await libApi<{ total: number; hits: LibraryHit[] }>(`/library/search?source=${libState.source}&q=${encodeURIComponent(libState.q)}&limit=48&offset=${offset}`);
      if (my !== seq) return;
      total = r.total;
      if (!append) results.innerHTML = '';
      if (!r.hits.length && !append) results.innerHTML = '<p class="hint">Keine Treffer. Tipp: englische Begriffe verwenden (wood, oak, marble, tiles, concrete …).</p>';
      results.insertAdjacentHTML('beforeend', r.hits.map(card).join(''));
      offset += r.hits.length;
      more.hidden = offset >= total;
    } catch (e) {
      if (my === seq) results.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
    }
  };

  const syncSrc = () => el.querySelectorAll<HTMLElement>('[data-src]').forEach((b) => b.classList.toggle('on', b.dataset.src === libState.source && b.tagName === 'BUTTON' && !b.classList.contains('lib-card')));
  el.querySelectorAll<HTMLElement>('.lib-src [data-src]').forEach((b) =>
    b.addEventListener('click', () => {
      libState.source = b.dataset.src as LibraryHit['source'];
      syncSrc();
      load();
    }),
  );
  el.querySelector('.lib-search')!.addEventListener('submit', (e) => {
    e.preventDefault();
    libState.q = qIn.value.trim();
    load();
  });
  el.querySelectorAll<HTMLElement>('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      libState.q = qIn.value = b.dataset.q!;
      load();
    }),
  );
  resSel.addEventListener('change', () => (libState.res = resSel.value));
  more.addEventListener('click', () => load(true));

  results.addEventListener('click', async (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.lib-card');
    if (!c || c.classList.contains('busy')) return;
    c.classList.add('busy');
    try {
      const t = await libApi<{
        source: string; id: string; res: string; name: string; image: string; normalImage?: string; roughnessImage?: string; thumb: string; sizeCm: number; categories: string[]; metal: boolean;
      }>('/library/import', { source: c.dataset.src, id: c.dataset.id, res: libState.res });
      const p = store.project;
      const id = `lib-${t.source}-${t.id}-${t.res}`;
      let def = p.customMaterials.find((x) => x.id === id);
      if (!def) {
        def = {
          id,
          name: t.name,
          category: 'eigene',
          color: '#ffffff',
          roughness: t.roughnessImage ? 1 : 0.5,
          metalness: t.metal ? 1 : 0,
          image: t.image,
          normalImage: t.normalImage,
          roughnessImage: t.roughnessImage,
          thumb: t.thumb,
          aspect: 1,
          tileSize: Math.max(5, t.sizeCm || 100),
          mapping: 'tile',
          bump: 1,
          source: t.source === 'polyhaven' ? 'Poly Haven' : 'ambientCG',
        };
        p.customMaterials.push(def);
        store.commit();
      }
      m.close();
      renderMaterialsTab();
      toast(`„${def.name}“ importiert (${def.source}, ${def.tileSize} cm).`);
      if (onPicked) onPicked(def.id);
      else {
        const slot = await askChoice(
          `„${def.name}“ verwenden für …`,
          '<p class="hint">Das Material ist unter „Eigene Oberflächen“ gespeichert. Wo soll es verwendet werden?</p>',
          SLOT_ORDER.map((sl) => ({ id: sl, label: SLOT_LABELS[sl] })),
        );
        if (slot) {
          store.project.slots[slot as MaterialSlot] = def.id;
          store.commit();
        }
      }
    } catch (err) {
      toast('Import fehlgeschlagen: ' + (err as Error).message);
    } finally {
      c.classList.remove('busy');
    }
  });

  syncSrc();
  load();
}

// ---------------------------------------------------------------------------
// Material farblich anpassen

/**
 * Passt das Material eines Bereichs an (Projekt oder ein Element).
 * Eingebaute Materialien werden dabei als „… (angepasst)“ kopiert, eigene direkt geändert.
 */
function openAdjustDialog(slot: MaterialSlot, item?: Item) {
  const p = store.project;
  const rawId = item?.materials?.[slot] ?? p.slots[slot];
  const base = slotMaterialDef(p, slot, item?.materials?.[slot], item?.materials?.front);
  const isCustom = p.customMaterials.some((m) => m.id === base.id);
  // Arbeitskopie bzw. Original sichern
  const backup = JSON.parse(JSON.stringify({ def: isCustom ? base : null, slots: p.slots, itemMats: item?.materials ?? null }));
  let def: MaterialDef;
  if (isCustom) def = base;
  else {
    def = { ...JSON.parse(JSON.stringify(base)), id: 'adj-' + uid(), name: `${base.name} (angepasst)`, category: 'eigene' };
    p.customMaterials.push(def);
    if (item) item.materials = { ...(item.materials ?? {}), [slot]: def.id };
    else p.slots[slot] = def.id;
    // „wie Fronten“ (Griffmulden) folgt automatisch, wenn die Front angepasst wird
    void rawId;
  }
  const a: ColorAdjust = { ...(def.adjust ?? {}) };
  const textured = isTextured(def);
  const body = `
    <p class="hint">${esc(base.name)} · ${item ? `nur ${esc(getEntry(item.type).name)}` : `Bereich „${SLOT_LABELS[slot]}“ im ganzen Projekt`}${isCustom ? '' : ' – es wird eine angepasste Kopie angelegt, das Original bleibt erhalten'}.</p>
    <div class="adj-layout">
      <canvas class="adj-preview" width="200" height="200"></canvas>
      <div>
        <label class="field"><span>Farbton <b data-v="hue"></b></span><input type="range" data-a="hue" min="-180" max="180" step="1" class="hue-range" /></label>
        <label class="field"><span>Sättigung <b data-v="saturation"></b></span><input type="range" data-a="saturation" min="-100" max="100" step="1" /></label>
        <label class="field"><span>Helligkeit <b data-v="brightness"></b></span><input type="range" data-a="brightness" min="-100" max="100" step="1" /></label>
        <label class="field"><span>Kontrast <b data-v="contrast"></b></span><input type="range" data-a="contrast" min="-100" max="100" step="1" /></label>
        <div class="field"><span>Einfärben (Farbe wählen) <b data-v="tintAmount"></b></span>
          <div class="rot-row"><input type="color" id="adjTint" style="width:44px;flex:none" /><input type="range" data-a="tintAmount" min="0" max="100" step="1" /></div>
        </div>
        <label class="field"><span>Oberfläche: matt ↔ glänzend <b id="adjGlossV"></b></span><input type="range" id="adjGloss" min="0" max="1" step="0.01" /></label>
      </div>
    </div>
    <p class="hint">Die Vorschau links reagiert sofort, die 3D-Ansicht beim Loslassen des Reglers.</p>`;
  const m = modal('Material anpassen', body, `<button class="btn" data-reset>Zurücksetzen</button><span class="spacer"></span><button class="btn" data-cancel>Abbrechen</button><button class="btn primary" data-ok>Übernehmen</button>`);
  m.el.classList.add('see-through');
  const el = m.el;
  const canvas = el.querySelector<HTMLCanvasElement>('.adj-preview')!;
  const ctx = canvas.getContext('2d')!;
  const tintIn = $<HTMLInputElement>('#adjTint', el);
  const gloss = $<HTMLInputElement>('#adjGloss', el);
  const origRough = def.roughness;

  // Vorschau-Quelle: Bild, prozedurale Textur oder Farbfläche
  let src: (CanvasImageSource & { width: number; height: number }) | null = null;
  if (def.image) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const side = Math.min(img.width, img.height);
      c.width = c.height = 200;
      c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 200, 200);
      src = c;
      draw();
    };
    img.src = def.thumb && !def.image.startsWith('data:') ? def.image : def.image;
  } else if (def.procedural) {
    const sw = document.createElement('div');
    sw.setAttribute('style', swatchStyle({ ...def, adjust: undefined }));
    const url = /url\((.*)\)/.exec(sw.style.backgroundImage)?.[1]?.replace(/"/g, '');
    if (url) {
      const img = new Image();
      img.onload = () => {
        src = img;
        draw();
      };
      img.src = url;
    }
  }
  function draw() {
    if (textured && src) ctx.drawImage(adjustCanvas(src, a, 200), 0, 0, 200, 200);
    else {
      ctx.fillStyle = adjustHex(def.color, a);
      ctx.fillRect(0, 0, 200, 200);
    }
    // Glanzeindruck
    const r = def.roughness;
    const grad = ctx.createLinearGradient(0, 0, 200, 200);
    grad.addColorStop(0, `rgba(255,255,255,${(1 - r) * 0.45})`);
    grad.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 200, 200);
  }
  const sync = () => {
    el.querySelectorAll<HTMLInputElement>('[data-a]').forEach((inp) => {
      const k = inp.dataset.a as keyof ColorAdjust;
      inp.value = String((a[k] as number) ?? 0);
      const v = (a[k] as number) ?? 0;
      el.querySelector(`[data-v="${k}"]`)!.textContent = k === 'hue' ? `${v}°` : `${v > 0 && k !== 'tintAmount' ? '+' : ''}${v} %`;
    });
    tintIn.value = a.tint ?? '#c8a46e';
    gloss.value = String(1 - def.roughness);
    $('#adjGlossV', el).textContent = def.roughness >= 0.55 ? 'matt' : def.roughness >= 0.2 ? 'seidenmatt' : 'glänzend';
    draw();
  };
  const apply3D = () => {
    def.adjust = hasAdjust(a) ? { ...a } : undefined;
    store.emit();
  };
  el.querySelectorAll<HTMLInputElement>('[data-a]').forEach((inp) => {
    inp.addEventListener('input', () => {
      (a as Record<string, number>)[inp.dataset.a!] = +inp.value;
      if (inp.dataset.a === 'tintAmount' && !a.tint) a.tint = tintIn.value;
      sync();
    });
    inp.addEventListener('change', apply3D);
  });
  tintIn.addEventListener('input', () => {
    a.tint = tintIn.value;
    if (!a.tintAmount) a.tintAmount = 100;
    sync();
  });
  tintIn.addEventListener('change', apply3D);
  gloss.addEventListener('input', () => {
    def.roughness = Math.round((1 - +gloss.value) * 100) / 100;
    if (def.roughnessImage) def.roughness = Math.max(0.05, def.roughness);
    sync();
  });
  gloss.addEventListener('change', apply3D);
  el.querySelector('[data-reset]')!.addEventListener('click', () => {
    for (const k of Object.keys(a) as (keyof ColorAdjust)[]) delete a[k];
    def.roughness = origRough;
    sync();
    apply3D();
  });
  let cancelled = false;
  el.querySelector('[data-cancel]')!.addEventListener('click', () => {
    cancelled = true;
    m.close();
  });
  el.querySelector('[data-ok]')!.addEventListener('click', () => m.close());
  new MutationObserver((_, obs) => {
    if (el.isConnected) return;
    obs.disconnect();
    const proj = store.project;
    if (cancelled) {
      if (isCustom) Object.assign(def, backup.def);
      else {
        proj.customMaterials = proj.customMaterials.filter((x) => x.id !== def.id);
        proj.slots = backup.slots;
        if (item) item.materials = backup.itemMats ?? undefined;
      }
      store.emit();
    } else {
      def.adjust = hasAdjust(a) ? { ...a } : undefined;
      store.commit();
      renderMaterialsTab();
    }
  }).observe(document.body, { childList: true });
  sync();
}

// ---------------------------------------------------------------------------
// Eigene Farbe (Farbrad)

const FINISHES = {
  matt: { label: 'Matt', roughness: 0.7, clearcoat: 0 },
  normal: { label: 'Normal (seidenmatt)', roughness: 0.4, clearcoat: 0 },
  gloss: { label: 'Hochglanz', roughness: 0.08, clearcoat: 1 },
} as const;
type Finish = keyof typeof FINISHES;

function finishOf(def: MaterialDef): Finish {
  if ((def.clearcoat ?? 0) > 0.5 || def.roughness < 0.2) return 'gloss';
  return def.roughness >= 0.55 ? 'matt' : 'normal';
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function openColorDialog(existing?: MaterialDef, onCreated?: (id: string) => void) {
  const def: MaterialDef = existing
    ? { ...existing }
    : { id: 'color-' + uid(), name: '', category: 'eigene', color: '#e9e2d2', roughness: 0.4, metalness: 0, clearcoat: 0, tileSize: 100 };
  let finish: Finish = finishOf(def);
  let hsv = hexToHsv(def.color);
  const SIZE = 220;
  const body = `
  <div class="color-layout">
    <div class="wheel-wrap">
      <canvas class="wheel" width="${SIZE * 2}" height="${SIZE * 2}" style="width:${SIZE}px;height:${SIZE}px"></canvas>
      <span class="wheel-dot"></span>
    </div>
    <div class="color-side">
      <label class="field"><span>Helligkeit</span><input type="range" id="cBright" min="0" max="1" step="0.005" /></label>
      <div class="grid2">
        <label class="field"><span>Hex-Code</span><input type="text" id="cHex" maxlength="7" spellcheck="false" /></label>
        <label class="field"><span>Farbwähler</span><input type="color" id="cNative" /></label>
      </div>
      <div class="field"><span>Oberfläche</span>
        <div class="seg finish-seg">${(Object.keys(FINISHES) as Finish[]).map((k) => `<button data-finish="${k}">${FINISHES[k].label}</button>`).join('')}</div>
      </div>
      <label class="field"><span>Name (optional, z. B. RAL 9001 Cremeweiß)</span><input type="text" id="cName" maxlength="80" value="${esc(existing?.name ?? '')}" /></label>
      <div class="color-preview"><span class="cp-swatch"></span><div><b id="cpTitle"></b><small id="cpSub"></small></div></div>
      ${existing ? '' : `<label class="field"><span>Direkt verwenden für</span><select id="cSlot"><option value="">– nur speichern –</option>${SLOT_ORDER.map((s) => `<option value="${s}" ${s === 'front' && !onCreated ? 'selected' : ''}>${SLOT_LABELS[s]}</option>`).join('')}</select></label>`}
    </div>
  </div>`;
  const m = modal(existing ? 'Eigene Farbe bearbeiten' : 'Eigene Farbe mischen', body, `<button class="btn" data-cancel>Abbrechen</button><button class="btn primary" data-ok>${existing ? 'Übernehmen' : 'Speichern'}</button>`);
  const el = m.el;
  const canvas = el.querySelector<HTMLCanvasElement>('.wheel')!;
  const dot = el.querySelector<HTMLElement>('.wheel-dot')!;
  const bright = $<HTMLInputElement>('#cBright', el);
  const hexIn = $<HTMLInputElement>('#cHex', el);
  const native = $<HTMLInputElement>('#cNative', el);
  const ctx = canvas.getContext('2d')!;

  const drawWheel = () => {
    const n = canvas.width;
    const img = ctx.createImageData(n, n);
    const r = n / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = x - r + 0.5, dy = y - r + 0.5;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * n + x) * 4;
        if (d > 1) continue;
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const c = parseInt(hsvToHex(h, d, hsv.v).slice(1), 16);
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = d > 0.99 ? Math.round((1 - d) * 100 * 255) : 255;
      }
    ctx.putImageData(img, 0, 0);
  };

  const update = (fromHex = false) => {
    def.color = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (!fromHex) hexIn.value = def.color;
    native.value = def.color;
    bright.value = String(hsv.v);
    bright.style.background = `linear-gradient(90deg, #000, ${hsvToHex(hsv.h, hsv.s, 1)})`;
    const a = (hsv.h * Math.PI) / 180;
    dot.style.left = `${SIZE / 2 + Math.cos(a) * hsv.s * (SIZE / 2)}px`;
    dot.style.top = `${SIZE / 2 + Math.sin(a) * hsv.s * (SIZE / 2)}px`;
    dot.style.background = def.color;
    const f = FINISHES[finish];
    const gloss = finish === 'gloss' ? 'linear-gradient(160deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 38%), ' : finish === 'normal' ? 'linear-gradient(160deg, rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 45%), ' : '';
    el.querySelector<HTMLElement>('.cp-swatch')!.style.background = `${gloss}${def.color}`;
    $('#cpTitle', el).textContent = $<HTMLInputElement>('#cName', el).value.trim() || `Eigene Farbe ${def.color.toUpperCase()}`;
    $('#cpSub', el).textContent = `${f.label} · ${def.color.toUpperCase()}`;
    el.querySelectorAll<HTMLElement>('[data-finish]').forEach((b) => b.classList.toggle('on', b.dataset.finish === finish));
  };

  // Farbrad bedienen
  const pick = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2;
    const dy = e.clientY - r.top - r.height / 2;
    hsv.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    hsv.s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    if (hsv.v < 0.05) hsv.v = 0.6;
    update();
  };
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && pick(e));
  canvas.addEventListener('pointerup', () => (dragging = false));
  bright.addEventListener('input', () => {
    hsv.v = +bright.value;
    drawWheel();
    update();
  });
  hexIn.addEventListener('input', () => {
    const v = hexIn.value.trim();
    const hex = /^#?[0-9a-f]{6}$/i.test(v) ? (v.startsWith('#') ? v : '#' + v).toLowerCase() : null;
    if (!hex) return;
    hsv = hexToHsv(hex);
    drawWheel();
    update(true);
  });
  native.addEventListener('input', () => {
    hsv = hexToHsv(native.value);
    drawWheel();
    update();
  });
  el.querySelectorAll<HTMLElement>('[data-finish]').forEach((b) =>
    b.addEventListener('click', () => {
      finish = b.dataset.finish as Finish;
      update();
    }),
  );
  $<HTMLInputElement>('#cName', el).addEventListener('input', () => update());
  drawWheel();
  update();

  el.querySelector('[data-cancel]')!.addEventListener('click', m.close);
  el.querySelector('[data-ok]')!.addEventListener('click', () => {
    const f = FINISHES[finish];
    def.roughness = f.roughness;
    def.clearcoat = f.clearcoat;
    def.metalness = 0;
    def.name = $<HTMLInputElement>('#cName', el).value.trim() || `Eigene Farbe ${def.color.toUpperCase()} ${f.label.split(' ')[0].toLowerCase()}`;
    delete def.image;
    delete def.procedural;
    const p = store.project;
    const idx = p.customMaterials.findIndex((x) => x.id === def.id);
    if (idx >= 0) p.customMaterials[idx] = def;
    else p.customMaterials.push(def);
    const slot = (el.querySelector('#cSlot') as HTMLSelectElement | null)?.value as MaterialSlot | '';
    if (slot) p.slots[slot] = def.id;
    store.commit();
    m.close();
    renderMaterialsTab();
    onCreated?.(def.id);
    toast(`„${def.name}“ gespeichert.`);
  });
}

function openUploadDialog(existing?: MaterialDef, onCreated?: (id: string) => void) {
  const def: MaterialDef = existing
    ? { ...existing }
    : { id: 'custom-' + uid(), name: 'Meine Oberfläche', category: 'eigene', color: '#ffffff', roughness: 0.5, metalness: 0, clearcoat: 0, tileSize: 60, bump: 1 };
  const fileRow = (key: string, label: string) =>
    `<div class="field"><span>${label}</span><div class="file-row"><button class="btn" data-pick="${key}">Datei wählen</button><span class="name" data-name="${key}">–</span><button class="btn icon" data-clear="${key}" title="Entfernen">✕</button></div></div>`;
  const body = `
  <div class="upload-layout">
    <div>
      <div class="upload-preview" id="upPreview">Foto / Textur hierher ziehen<br>oder „Datei wählen“</div>
      <p class="hint">Tipp: Frontal fotografierte, gleichmäßig ausgeleuchtete Muster wirken am besten. Gib unten die reale Kantenlänge des Bildausschnitts an, damit Maserung und Fugen maßstabsgetreu erscheinen.</p>
    </div>
    <div>
      <label class="field"><span>Name</span><input type="text" id="upName" value="${esc(def.name)}" /></label>
      ${fileRow('image', 'Farbtextur (Albedo) *')}
      ${fileRow('normalImage', 'Normal Map (optional, Relief)')}
      ${fileRow('roughnessImage', 'Roughness Map (optional)')}
      <div class="field"><span>Darstellung auf den Flächen</span>
        <div class="seg mode-seg">
          <button type="button" data-mapping="stretch">Einmal auf ganze Fläche strecken</button>
          <button type="button" data-mapping="tile">Wiederholen (Kacheln)</button>
        </div>
        <small class="hint" id="upMapHint"></small>
      </div>
      <div class="grid2" id="upSizeRow">
        <label class="field"><span>Bildbreite real</span><span class="unit" data-unit="cm"><input type="number" id="upTile" min="1" max="2000" step="0.5" value="${def.tileSize}" /></span></label>
        <label class="field"><span>Bildhöhe real <small id="upAspect"></small></span><span class="unit" data-unit="cm"><input type="number" id="upTileH" min="1" max="2000" step="0.5" /></span></label>
      </div>
      <label class="field"><span>Drehung (Grad, Standard für alle Flächen)</span><span class="unit" data-unit="°"><input type="number" id="upRotate" min="-360" max="360" step="1" value="${def.rotation ?? (def.rotate ? 90 : 0)}" /></span></label>
      <label class="field"><span>Rauheit (matt ↔ glänzend): <b id="upRoughV">${def.roughness}</b></span><input type="range" id="upRough" min="0" max="1" step="0.01" value="${def.roughness}" /></label>
      <label class="field"><span>Metallisch: <b id="upMetalV">${def.metalness}</b></span><input type="range" id="upMetal" min="0" max="1" step="0.01" value="${def.metalness}" /></label>
      <label class="field"><span>Klarlack (Hochglanz-Schicht): <b id="upCoatV">${def.clearcoat ?? 0}</b></span><input type="range" id="upCoat" min="0" max="1" step="0.01" value="${def.clearcoat ?? 0}" /></label>
      <label class="field"><span>Reliefstärke: <b id="upBumpV">${def.bump ?? 1}</b></span><input type="range" id="upBump" min="0" max="3" step="0.05" value="${def.bump ?? 1}" /></label>
      ${existing ? '' : `<label class="field"><span>Direkt verwenden für</span><select id="upSlot"><option value="">– nur speichern –</option>${SLOT_ORDER.map((s) => `<option value="${s}">${SLOT_LABELS[s]}</option>`).join('')}</select></label>`}
    </div>
  </div>
  <input type="file" accept="image/*" id="upFile" hidden />`;
  const m = modal(existing ? 'Eigene Oberfläche bearbeiten' : 'Eigene Oberfläche hochladen', body, `<button class="btn" data-cancel>Abbrechen</button><button class="btn primary" data-ok>${existing ? 'Übernehmen' : 'Speichern'}</button>`);
  const el = m.el;
  const fileInput = $<HTMLInputElement>('#upFile', el);
  let pickKey: 'image' | 'normalImage' | 'roughnessImage' = 'image';

  // Seitenverhältnis & Darstellungsmodus
  let mapping = def.mapping ?? (existing ? 'tile' : 'stretch');
  const tileW = $<HTMLInputElement>('#upTile', el);
  const tileH = $<HTMLInputElement>('#upTileH', el);
  const aspect = () => def.aspect ?? materialAspect(def);
  const syncH = () => (tileH.value = String(Math.round((+tileW.value / aspect()) * 10) / 10));
  tileW.addEventListener('input', syncH);
  tileH.addEventListener('input', () => (tileW.value = String(Math.round(+tileH.value * aspect() * 10) / 10)));
  const syncMapping = () => {
    el.querySelectorAll<HTMLElement>('[data-mapping]').forEach((b) => b.classList.toggle('on', b.dataset.mapping === mapping));
    $('#upSizeRow', el).style.opacity = mapping === 'tile' ? '1' : '0.5';
    $('#upMapHint', el).textContent =
      mapping === 'stretch'
        ? 'Das Bild wird ohne Wiederholung auf die ganze Fläche gezogen – bei der Arbeitsplatte über die gesamte zusammenhängende Platte. Ideal für ein Foto der kompletten Platte.'
        : 'Das Bild wird in der angegebenen realen Größe wiederholt – ideal für Muster, Fliesen und Dekore.';
  };
  el.querySelectorAll<HTMLElement>('[data-mapping]').forEach((b) =>
    b.addEventListener('click', () => {
      mapping = b.dataset.mapping as typeof mapping;
      syncMapping();
    }),
  );
  syncMapping();

  const refresh = () => {
    const pv = $('#upPreview', el);
    if (def.image) {
      pv.style.backgroundImage = `url(${def.image})`;
      pv.style.backgroundSize = 'contain';
      pv.style.backgroundRepeat = 'no-repeat';
      pv.textContent = '';
    }
    const a = aspect();
    $('#upAspect', el).textContent = def.image ? `(Verhältnis ${a >= 1 ? `${Math.round(a * 100) / 100} : 1` : `1 : ${Math.round((1 / a) * 100) / 100}`})` : '';
    syncH();
    for (const k of ['image', 'normalImage', 'roughnessImage'] as const) $(`[data-name="${k}"]`, el).textContent = def[k] ? 'geladen ✓' : '–';
  };
  refresh();
  const load = async (f: File, key: typeof pickKey) => {
    if (!f.type.startsWith('image/')) return toast('Bitte eine Bilddatei wählen.');
    def[key] = await readImageFile(f, 4096, key !== 'image');
    if (key === 'image') {
      // Seitenverhältnis des Bildes ermitteln
      await new Promise<void>((res) => {
        const img = new Image();
        img.onload = () => {
          def.aspect = img.width / img.height;
          res();
        };
        img.onerror = () => res();
        img.src = def.image!;
      });
    }
    if (key === 'image' && def.name === 'Meine Oberfläche') {
      def.name = f.name.replace(/\.[^.]+$/, '');
      $<HTMLInputElement>('#upName', el).value = def.name;
    }
    refresh();
  };
  el.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      pickKey = b.dataset.pick as typeof pickKey;
      fileInput.click();
    }),
  );
  el.querySelectorAll<HTMLElement>('[data-clear]').forEach((b) =>
    b.addEventListener('click', () => {
      delete def[b.dataset.clear as typeof pickKey];
      refresh();
    }),
  );
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) load(f, pickKey);
    fileInput.value = '';
  });
  const pv = $('#upPreview', el);
  pv.addEventListener('click', () => {
    pickKey = 'image';
    fileInput.click();
  });
  pv.addEventListener('dragover', (e) => e.preventDefault());
  pv.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) load(f, 'image');
  });
  for (const [id, label] of [['upRough', 'upRoughV'], ['upMetal', 'upMetalV'], ['upCoat', 'upCoatV'], ['upBump', 'upBumpV']]) {
    const r = $<HTMLInputElement>('#' + id, el);
    r.addEventListener('input', () => ($('#' + label, el).textContent = r.value));
  }
  el.querySelector('[data-cancel]')!.addEventListener('click', m.close);
  el.querySelector('[data-ok]')!.addEventListener('click', () => {
    if (!def.image) return toast('Bitte zuerst eine Farbtextur hochladen.');
    def.name = $<HTMLInputElement>('#upName', el).value || 'Eigene Oberfläche';
    def.tileSize = Math.max(1, +$<HTMLInputElement>('#upTile', el).value || 60);
    def.mapping = mapping;
    if (!def.aspect) def.aspect = aspect();
    def.rotation = +$<HTMLInputElement>('#upRotate', el).value || 0;
    delete def.rotate;
    def.roughness = +$<HTMLInputElement>('#upRough', el).value;
    def.metalness = +$<HTMLInputElement>('#upMetal', el).value;
    def.clearcoat = +$<HTMLInputElement>('#upCoat', el).value;
    def.bump = +$<HTMLInputElement>('#upBump', el).value;
    const p = store.project;
    const idx = p.customMaterials.findIndex((x) => x.id === def.id);
    if (idx >= 0) p.customMaterials[idx] = def;
    else p.customMaterials.push(def);
    const slot = (el.querySelector('#upSlot') as HTMLSelectElement | null)?.value as MaterialSlot | '';
    if (slot) p.slots[slot] = def.id;
    store.commit();
    m.close();
    renderMaterialsTab();
    onCreated?.(def.id);
    toast(`„${def.name}“ gespeichert.`);
  });
}

// ---------------------------------------------------------------------------
// Eigenschaften

function num(label: string, key: string, value: number, unit = 'cm', step = 1) {
  return `<div class="row"><label>${label}</label><span class="unit" data-unit="${unit}"><input type="number" data-key="${key}" value="${Math.round(value * 10) / 10}" step="${step}" /></span></div>`;
}

function renderProps() {
  const s = store.selection;
  const el = $('#props');
  const p = store.project;
  if (!s) {
    const h = store.house;
    const all = h.floors.flatMap((f) => f.items.map((it) => ({ f, it })));
    const withComps = all.filter(({ it }) => compartments(it, h.settings).length);
    const fachCount = withComps.reduce((n, { it }) => n + compartments(it, h.settings).length, 0);
    const filled = [...sync.storage.values()].filter((pl) => pl.items.length).length;
    el.innerHTML = `<h2>${esc(h.name || 'Haus')}</h2><div class="sub">Nichts ausgewählt</div>
      <div class="stats">
        <span>Etagen</span><span>${h.floors.length}</span>
        <span>Räume</span><span>${h.floors.reduce((n, f) => n + f.rooms.length, 0)}</span>
        <span>Möbel</span><span>${all.length}</span>
        <span>Möbel mit Fächern</span><span>${withComps.length}</span>
        <span>Fächer (Lagerplätze)</span><span>${fachCount}</span>
        ${sync.online ? `<span>davon belegt</span><span>${filled}</span>` : ''}
      </div>
      <h3>So geht's</h3>
      <p class="hint">1. Etage anlegen und Wände zeichnen (oder Grundriss hochladen und nachzeichnen).<br>2. Mit <b>Raum festlegen</b> die Räume benennen – jeder Raum wird ein Lager.<br>3. Im Katalog Schränke, Regale und Küchenmöbel setzen – ihre Fächer werden Lagerplätze (Buchstabe am Möbel = Spalte).<br>4. In 3D <b>Lager</b> einschalten: Fach anklicken, einbuchen, entnehmen. Oben „Wo liegt …?“ sucht im ganzen Haus.</p>
      <h3>Tastenkürzel</h3>
      <p class="hint"><kbd>Entf</kbd> löschen · <kbd>R</kbd> drehen · <kbd>L</kbd> sperren · <kbd>Strg</kbd>+<kbd>D</kbd> duplizieren · <kbd>Strg</kbd>+<kbd>Z</kbd> rückgängig · <kbd>Esc</kbd> Werkzeug beenden · <kbd>Alt</kbd> beim Ziehen: frei platzieren</p>`;
    return;
  }

  if (s.kind === 'room') {
    const r = store.room(s.id);
    if (!r) return;
    const f = store.floor;
    const area = r.polygon ? Math.abs(polygonArea(r.polygon)) / 10000 : 0;
    const furniture = f.items.filter((it) => it.storageCol && roomOf(f, it)?.id === r.id).sort((a, b) => (a.storageCol! < b.storageCol! ? -1 : 1));
    const floorDef = slotMaterialDef(p, 'floor', r.floorMaterial);
    el.innerHTML = `<h2>${esc(r.name)}</h2><div class="sub">Raum auf ${esc(f.name)} · ${area.toFixed(1).replace('.', ',')} m²</div>
      <div class="row"><label>Name</label><input type="text" data-rk="name" value="${esc(r.name)}" maxlength="40" style="width:160px" /></div>
      <div class="row"><label title="Kürzel des Lagers (1–4 Zeichen). Ändern benennt alle Plätze um – gedruckte Etiketten passen dann nicht mehr.">Lager-Kürzel</label><input type="text" data-rk="code" value="${esc(r.code)}" maxlength="4" style="width:80px;text-transform:uppercase" /></div>
      ${r.manual ? `<p class="hint">Fester Umriss (offener Grundriss bzw. übernommen) – folgt nicht den Wänden.${f.walls.length ? ' <button class="btn mini" data-rk="detect">Aus Wänden erkennen</button>' : ''}</p>` : ''}
      <h3>Bodenbelag</h3>
      <div class="mat-row" data-floormat><span class="sw" style="${swatchStyle(floorDef)}"></span><div><span>Boden</span><small>${esc(floorDef.name)}${r.floorMaterial ? '' : ' (wie im ganzen Haus)'}</small></div></div>
      <h3>Lager ${esc(r.code)}</h3>
      ${furniture.length ? `<div class="room-furniture">${furniture
        .map((it) => {
          const n = compartments(it, p.settings).length;
          const filled = Array.from({ length: n }, (_, i) => sync.fach(it.id, i)).filter((pl) => pl?.items.length).length;
          return `<button class="room-row" data-it="${it.id}"><code>${esc(r.code)}-${it.storageCol}</code><b>${esc(itemName(it))}</b><small>${n} Fächer${sync.online ? ` · ${filled} belegt` : ''}</small></button>`;
        })
        .join('')}</div>` : '<p class="hint">Noch keine Möbel mit Fächern in diesem Raum.</p>'}
      <div class="actions"><button class="btn" data-act="lock" title="Sperren (Taste L): danach im Editor nicht mehr auswählbar oder veränderbar – entsperren unter „Etage“">${ICON.lock}Sperren</button><button class="btn danger" data-act="del">${ICON.trash}Raum löschen</button></div>`;
    el.querySelector('button[data-rk="detect"]')?.addEventListener('click', () => {
      delete r.manual;
      store.commit();
      if (!r.polygon) toast('Kein geschlossener Bereich um den Raum – Umriss bleibt.');
    });
    el.querySelectorAll<HTMLInputElement>('input[data-rk]').forEach((inp) =>
      inp.addEventListener('change', () => {
        if (inp.dataset.rk === 'name') r.name = inp.value.trim().slice(0, 40) || r.name;
        else {
          const c = inp.value.trim().toUpperCase();
          if (!CODE_RE.test(c)) {
            toast('Kürzel: 1–4 Zeichen, A–Z und 0–9, beginnt mit einem Buchstaben.');
            inp.value = r.code;
            return;
          }
          r.code = c;
        }
        store.commit();
      }),
    );
    el.querySelector('[data-floormat]')!.addEventListener('click', () =>
      openMaterialPicker(`Boden – ${r.name}`, r.floorMaterial, true, (id) => {
        if (id) r.floorMaterial = id;
        else delete r.floorMaterial;
        store.commit();
      }, 'floor'),
    );
    el.querySelectorAll<HTMLElement>('[data-it]').forEach((b) => b.addEventListener('click', () => store.select({ kind: 'item', id: b.dataset.it! })));
    bindActions(el);
    return;
  }

  if (s.kind === 'item') {
    const it = store.item(s.id);
    if (!it) return;
    const e = getEntry(it.type);
    const tallKind = ['tall', 'tallFridge', 'tallOven'].includes(e.kind);
    const hasFront = (['base', 'wall', 'island'].includes(e.kind) && it.front) || tallKind;
    const frontOptions: [string, string][] =
      e.kind === 'wall'
        ? [['doors', 'Türen'], ['single', 'Eine Klappe / Tür'], ['open', 'Offen']]
        : e.kind === 'tallOven'
          ? [['drawers', 'Auszüge + Mikrowelle'], ['doors', 'Türen + Lifttür']]
          : tallKind
            ? [['doors', 'Zwei Türen'], ['single', 'Eine durchgehende Tür']]
            : [['doors', 'Türen'], ['single', 'Eine Tür'], ['drawers', 'Auszüge'], ['mixed', 'Schublade + Tür']];
    const curFront = it.front ?? (e.kind === 'tallOven' ? 'drawers' : 'doors');
    const matRow = (slot: MaterialSlot) => {
      const ov = it.materials?.[slot];
      const { m, name } = slotLabel(p, slot, ov, it.materials?.front);
      const uvSet = it.uv?.[slot] && Object.keys(it.uv[slot]!).length;
      return `<div class="mat-row" data-slot="${slot}"><span class="sw" style="${swatchStyle(m)}"></span><div><span>${SLOT_LABELS[slot]}</span><small>${esc(name)}${ov ? '' : ' (Standard)'}</small></div><button class="btn mini ${hasAdjust(m.adjust) ? 'on' : ''}" data-adj="${slot}" title="Farbe anpassen">${ICON.palette}</button>${isTextured(m) ? `<button class="btn mini ${uvSet ? 'on' : ''}" data-uv="${slot}" title="Textur ausrichten: strecken, skalieren, drehen, verschieben">${ICON.move}</button>` : ''}</div>`;
    };
    const grip: MaterialSlot = p.settings.handleless ? 'channel' : 'handle';
    const slots: MaterialSlot[] = e.kind === 'model' ? [] : e.kind === 'rack' ? ['carcass'] : e.kind === 'heavyRack' ? [] : ['cupboard', 'wardrobe', 'sideboard', 'dresser'].includes(e.kind) ? ['front', grip, 'carcass'] : ['table', 'stool', 'shelf', 'workbench'].includes(e.kind) ? ['countertop'] : e.kind === 'pendant' || e.kind === 'fridgeFree' || e.kind === 'hood' ? [] : e.kind === 'sink' ? ['front', 'countertop', 'sink', grip, 'carcass'] : e.countertop ? ['front', 'countertop', grip, 'carcass'] : ['front', grip, 'carcass'];
    const comps = compartments(it, p.settings);
    const lv = LEVEL_KINDS[e.kind];
    const code = storageCode(store.floor, it);
    const storageHtml = comps.length
      ? `<h3>Lager ${code && it.storageCol ? `<code>${esc(code)}-${it.storageCol}</code>` : ''}</h3>
        <div class="fach-list">${comps
          .map((c) => {
            const pl = sync.fach(it.id, c.row);
            const n = pl?.items.length ?? 0;
            return `<button class="fach-row ${n ? 'full' : ''}" data-fach="${c.row}"><code>${pl ? esc(pl.address) : `${esc(code)}-${it.storageCol ?? '?'}${c.row}`}</code><span>${esc(c.label)}</span><small>${sync.online ? (n ? `${n} ${n === 1 ? 'Gegenstand' : 'Gegenstände'}` : 'leer') : ''}</small></button>`;
          })
          .join('')}</div>
        <a class="btn" href="#/etiketten?moebel=${it.id}" style="margin-top:6px">${ic('tag')}Etiketten / QR-Schilder für die Fächer</a>
        ${roomOf(store.floor, it) ? '' : '<p class="hint">Steht in keinem Raum – die Plätze gehören zum Lager der Etage. Mit „Raum festlegen“ einen Raum anlegen.</p>'}`
      : '';
    // Möbelart aus der Objektbibliothek: Kopie im Haus; neuere Version in der Bibliothek nur auf Wunsch übernehmen
    const obj = e.object;
    const libObj = obj && libraryObject(obj.id);
    const newer = !!(obj && libObj && compareVersions(libObj.version, obj.version) > 0);
    const objInfo = obj
      ? `<div class="obj-info">${ic('box')}<div><b>${esc(obj.name)}</b><small>Objektbibliothek · Version ${esc(obj.version)}${obj.author ? ` · ${esc(obj.author)}` : ''}</small>
        ${newer ? `<button class="btn mini primary" data-act="objUpdate" title="Die Bibliothek hat eine neuere Version dieser Möbelart">Version ${esc(libObj!.version)} übernehmen</button>` : ''}</div></div>`
      : '';
    el.innerHTML = `<h2>${esc(it.label?.trim() || it.model?.name || e.name)}</h2><div class="sub">${e.kind === 'model' ? 'Möbel &amp; Deko (3D-Modell)' : e.group}${it.label?.trim() && e.kind !== 'model' ? ` · ${e.name}` : ''}</div>
      ${comps.length ? `<div class="row"><label title="Name im Lager, z. B. „Vorratsschrank“ oder „Besteckschublade“">Eigener Name</label><input type="text" data-key="label" value="${esc(it.label ?? '')}" placeholder="${esc(e.name)}" maxlength="40" style="width:160px" /></div>` : ''}
      ${lv ? `<div class="row"><label>${lv.label}</label><select data-key="levels" style="width:160px">${Array.from({ length: lv.max - lv.min + 1 }, (_, i) => lv.min + i).map((n) => `<option value="${n}" ${levelsOf(it, e.kind) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
      ${objInfo}
      ${e.kind === 'model' && it.model ? `<div class="model-info">${it.model.thumb ? `<img src="${esc(it.model.thumb)}" alt="" />` : ''}<div><b>${esc(it.model.name)}</b><small>${esc(it.model.license ?? '')}</small>${it.model.size ? `<button class="btn mini" data-act="modelSize" title="Auf die Originalmaße zurücksetzen">Originalmaße ${it.model.size.join(' × ')} cm</button>` : ''}</div></div>
        <div class="row"><label for="mprop">Seitenverhältnis beibehalten</label><input type="checkbox" id="mprop" checked /></div>` : ''}
      ${num('Breite', 'width', it.width)}
      ${e.widths ? `<div class="chips">${e.widths.map((w) => `<button data-w="${w}" class="${w === it.width ? 'on' : ''}">${w}</button>`).join('')}</div>` : ''}
      ${num('Tiefe', 'depth', it.depth)}
      ${num('Höhe', 'height', it.height)}
      ${num('Abstand Boden', 'elevation', it.elevation)}
      ${num('Drehung', 'rotation', ((((it.rotation * 180) / Math.PI) % 360) + 360) % 360, '°', 15)}
      ${hasFront ? `<div class="row"><label>Front</label><select data-key="front" style="width:160px">${frontOptions.map(([v, l]) => `<option value="${v}" ${curFront === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      ${e.kind === 'base' && it.front === 'drawers' ? `<div class="row"><label>Anzahl Auszüge</label><select data-key="drawers" style="width:160px">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(it.drawers ?? 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
      ${e.kind === 'sink' ? `<div class="row"><label>Becken-Modell</label><select data-key="sinkModel" style="width:160px"><option value="standard" ${it.sinkModel !== 'subline500u' ? 'selected' : ''}>Standard</option><option value="subline500u" ${it.sinkModel === 'subline500u' ? 'selected' : ''}>BLANCO SUBLINE 500-U</option></select></div>
        <div class="row"><label>Armatur</label><select data-key="faucet" style="width:160px"><option value="standard" ${it.faucet !== 'kano-s' ? 'selected' : ''}>Bogen (Standard)</option><option value="kano-s" ${it.faucet === 'kano-s' ? 'selected' : ''}>BLANCO KANO-S Vario</option></select></div>` : ''}
      ${tallKind || ['cupboard', 'wardrobe'].includes(e.kind) ? `<div class="row"><label for="psg" title="Tür in Schrankoptik, z. B. zu einem Raum dahinter: kein Korpus, keine Fächer, Öffnung in der Wand dahinter">Durchgang (Tür in Schrankoptik)</label><input type="checkbox" id="psg" data-key="passage" ${it.passage ? 'checked' : ''} /></div>` : ''}
      ${tallKind && p.settings.handleless ? `<div class="row"><label>Griffmulde</label><select data-key="grip" style="width:160px"><option value="horizontal" ${it.grip !== 'vertical' ? 'selected' : ''}>Waagerecht (in der Front)</option><option value="vertical" ${it.grip === 'vertical' ? 'selected' : ''}>Senkrechte Griffleiste daneben</option></select></div>` : ''}
      ${e.kind === 'island' ? `
        <div class="row"><label>Rückseite</label><select data-key="islandBack" style="width:150px"><option value="seating" ${it.islandBack !== 'doors' ? 'selected' : ''}>Theke (Sitzplatz)</option><option value="doors" ${it.islandBack === 'doors' ? 'selected' : ''}>Schranktüren</option></select></div>
        <div class="row"><label>Spaltenbreiten</label><input type="text" data-key="columnWidths" style="width:150px" placeholder="z. B. 90/100/90" value="${it.columnWidths?.join('/') ?? ''}" title="Breiten in cm, mit / getrennt – leer = gleich breite Spalten" /></div>
        <div class="row"><label>Spalten</label><select data-key="columns" style="width:150px" ${it.columnWidths?.length ? 'disabled title="durch Spaltenbreiten festgelegt"' : ''}><option value="">Automatisch (${Math.max(1, Math.round(it.width / 80))})</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${it.columns === n ? 'selected' : ''}>${n} × ${Math.round((it.width / n) * 10) / 10} cm</option>`).join('')}</select></div>
        <div class="row"><label>Auszüge je Spalte</label><select data-key="drawers" style="width:150px">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${(it.drawers ?? 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        ${it.islandBack === 'doors' ? `<div class="row"><label>Türen je Spalte (Rückseite)</label><select data-key="doorsPerColumn" style="width:150px"><option value="">Automatisch</option><option value="1" ${it.doorsPerColumn === 1 ? 'selected' : ''}>1 Tür</option><option value="2" ${it.doorsPerColumn === 2 ? 'selected' : ''}>2 Türen</option></select></div>` : ''}
        <div class="row"><label for="wf">Arbeitsplatte seitlich herunter</label><input type="checkbox" id="wf" data-key="waterfall" ${(it.waterfall ?? it.islandBack !== 'doors') ? 'checked' : ''} /></div>` : ''}
      ${storageHtml}
      ${slots.length ? `<h3>Material dieses Elements</h3>${slots.map(matRow).join('')}` : ''}
      <div class="actions">
        <button class="btn" data-act="rotate">${ICON.rotate}Drehen</button>
        <button class="btn" data-act="dup">${ICON.copy}Duplizieren</button>
        <button class="btn" data-act="lock" title="Sperren (Taste L): danach im Editor nicht mehr auswählbar oder veränderbar – entsperren unter „Etage“">${ICON.lock}Sperren</button>
        <button class="btn danger" data-act="del">${ICON.trash}Löschen</button>
      </div>`;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.key!;
        if (k === 'front') it.front = inp.value as FrontStyle;
        else if (k === 'islandBack') it.islandBack = inp.value as 'seating' | 'doors';
        else if (k === 'columns') {
          if (inp.value) it.columns = +inp.value;
          else delete it.columns;
        } else if (k === 'drawers') it.drawers = +inp.value;
        else if (k === 'grip') it.grip = inp.value as 'horizontal' | 'vertical';
        else if (k === 'sinkFinish') it.sinkFinish = inp.value as 'steel' | 'anthracite';
        else if (k === 'sinkModel') it.sinkModel = inp.value as 'standard' | 'subline500u';
        else if (k === 'faucet') it.faucet = inp.value as 'standard' | 'kano-s';
        else if (k === 'columnWidths') {
          const ws = inp.value.split(/[\/;, ]+/).map((v) => parseFloat(v.replace(',', '.'))).filter((v) => v > 0);
          if (ws.length) it.columnWidths = ws;
          else delete it.columnWidths;
        }
        else if (k === 'doorsPerColumn') {
          if (inp.value) it.doorsPerColumn = +inp.value;
          else delete it.doorsPerColumn;
        }
        else if (k === 'waterfall') it.waterfall = (inp as HTMLInputElement).checked;
        else if (k === 'levels') it.levels = +inp.value;
        else if (k === 'passage') setPassage(it, (inp as HTMLInputElement).checked);
        else if (k === 'label') {
          const v = inp.value.trim().slice(0, 40);
          if (v) it.label = v;
          else delete it.label;
        }
        else if (k === 'rotation') {
          it.rotation = (+inp.value * Math.PI) / 180;
          delete it.wallId;
        } else if (k !== 'levels' && k !== 'label') {
          const old = (it as any)[k];
          (it as any)[k] = Math.max(1, +inp.value || 0);
          // Modelle: proportional skalieren
          if (e.kind === 'model' && ['width', 'depth', 'height'].includes(k) && (el.querySelector<HTMLInputElement>('#mprop')?.checked ?? false) && old > 0) {
            const f = (it as any)[k] / old;
            for (const o of ['width', 'depth', 'height']) if (o !== k) (it as any)[o] = Math.round((it as any)[o] * f * 10) / 10;
          }
        }
        if (k === 'elevation') it.elevation = Math.max(0, +inp.value || 0);
        if (k === 'width' || k === 'depth') resnap(it);
        store.commit();
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-fach]').forEach((b) => b.addEventListener('click', () => openFach(it.id, +b.dataset.fach!)));
    el.querySelector('[data-act="objUpdate"]')?.addEventListener('click', () => {
      if (!obj || !libObj) return;
      const users = store.house.floors.flatMap((f) => f.items).filter((x) => x.type === OBJ_PREFIX + obj.id).length;
      const before = objectCompartmentCount(obj);
      const after = objectCompartmentCount(libObj);
      const warn = before !== after ? `\n\nAchtung: Die Fächerzahl ändert sich von ${before} auf ${after}. Gegenstände in wegfallenden Fächern müssen danach umgebucht werden.` : '';
      if (!confirm(`„${obj.name}“ auf Version ${libObj.version} bringen? Das betrifft ${users === 1 ? 'dieses Möbel' : `alle ${users} Möbel dieser Art`} im Haus.${warn}`)) return;
      store.house.objectTypes = { ...(store.house.objectTypes ?? {}), [obj.id]: structuredClone(libObj) };
      store.commit();
      toast(`Version ${libObj.version} übernommen.`);
    });
    el.querySelector('[data-act="modelSize"]')?.addEventListener('click', () => {
      const s = it.model!.size!;
      Object.assign(it, { width: s[0], depth: s[1], height: s[2] });
      store.commit();
    });
    el.querySelectorAll<HTMLElement>('[data-w]').forEach((b) =>
      b.addEventListener('click', () => {
        it.width = +b.dataset.w!;
        resnap(it);
        store.commit();
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-adj]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openAdjustDialog(b.dataset.adj as MaterialSlot, it);
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-uv]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openUVDialog(itemUVTarget(it, b.dataset.uv as MaterialSlot));
      }),
    );
    el.querySelectorAll<HTMLElement>('.mat-row').forEach((row) =>
      row.addEventListener('click', () => {
        const slot = row.dataset.slot as MaterialSlot;
        openMaterialPicker(`${SLOT_LABELS[slot]} – ${e.name}`, it.materials?.[slot], true, async (id) => {
          // Bei Fronten immer nachfragen: nur dieses Element oder alle Fronten?
          if (slot === 'front' && id) {
            const name = esc(findMaterialName(id));
            const choice = await askChoice(
              'Front ändern',
              `<p>Soll „${name}“ nur für <b>${esc(e.name)}</b> oder für <b>alle Fronten</b> der Küche verwendet werden?</p>`,
              [
                { id: 'one', label: 'Nur dieses Element' },
                { id: 'all', label: 'Alle Fronten', primary: true },
              ],
            );
            if (!choice) return;
            if (choice === 'all') {
              const proj = store.project;
              proj.slots.front = id;
              proj.items.forEach((i) => i.materials && delete i.materials.front);
              store.commit();
              return;
            }
          }
          it.materials = { ...(it.materials ?? {}) };
          if (id) it.materials[slot] = id;
          else delete it.materials[slot];
          store.commit();
        }, slot);
      }),
    );
    bindActions(el, it);
    return;
  }

  if (s.kind === 'wall') {
    const w = store.wall(s.id);
    if (!w) return;
    el.innerHTML = `<h2>Wand</h2><div class="sub">Endpunkte im Grundriss ziehen</div>
      ${num('Länge', 'length', wallLength(w))}
      ${num('Stärke', 'thickness', w.thickness)}
      ${num('Höhe', 'height', w.height)}
      <div class="actions"><button class="btn" data-act="allHeight">Höhe für alle Wände</button><button class="btn" data-act="lock" title="Sperren (Taste L): danach im Editor nicht mehr auswählbar oder veränderbar – entsperren unter „Etage“">${ICON.lock}Sperren</button><button class="btn danger" data-act="del">${ICON.trash}Löschen</button></div>`;
    el.querySelectorAll<HTMLInputElement>('[data-key]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const v = Math.max(1, +inp.value || 1);
        if (inp.dataset.key === 'length') setWallLength(w, v);
        else (w as any)[inp.dataset.key!] = v;
        store.commit();
      }),
    );
    el.querySelector('[data-act="allHeight"]')!.addEventListener('click', () => {
      store.project.walls.forEach((x) => (x.height = w.height));
      store.commit();
    });
    bindActions(el);
    return;
  }

  if (s.kind === 'opening') {
    const o = store.opening(s.id);
    if (!o) return;
    el.innerHTML = `<h2>${o.type === 'door' ? 'Tür' : o.type === 'passage' ? 'Durchgang' : 'Fenster'}</h2><div class="sub">Entlang der Wand ziehen</div>
      <div class="row"><label>Typ</label><select data-key="type" style="width:120px"><option value="window" ${o.type === 'window' ? 'selected' : ''}>Fenster</option><option value="door" ${o.type === 'door' ? 'selected' : ''}>Tür</option><option value="passage" ${o.type === 'passage' ? 'selected' : ''}>Durchgang</option></select></div>
      ${num('Breite', 'width', o.width)}
      ${num('Höhe', 'height', o.height)}
      ${num('Brüstung', 'sill', o.sill)}
      ${num('Abstand Mitte', 'offset', o.offset)}
      <div class="actions"><button class="btn" data-act="lock" title="Sperren (Taste L): danach im Editor nicht mehr auswählbar oder veränderbar – entsperren unter „Etage“">${ICON.lock}Sperren</button><button class="btn danger" data-act="del">${ICON.trash}Löschen</button></div>`;
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.key!;
        if (k === 'type') {
          o.type = inp.value as 'door' | 'window' | 'passage';
          if (o.type !== 'window') {
            o.sill = 0;
            o.height = 210;
          }
        } else (o as any)[k] = Math.max(0, +inp.value || 0);
        store.commit();
      }),
    );
    bindActions(el);
  }
}

/** Schrank als Durchgang: Öffnung in der Wand dahinter anlegen bzw. wieder entfernen */
function setPassage(it: Item, on: boolean) {
  const proj = store.project;
  if (it.passageOpening) {
    proj.openings = proj.openings.filter((o) => o.id !== it.passageOpening);
    delete it.passageOpening;
  }
  if (!on) {
    delete it.passage;
    return;
  }
  it.passage = true;
  // Wand dahinter: angedockte Wand, sonst die nächste Wand hinter der Rückseite
  const back = { x: it.x + Math.sin(it.rotation) * (it.depth / 2 + 5), y: it.y - Math.cos(it.rotation) * (it.depth / 2 + 5) };
  const w = (it.wallId && store.wall(it.wallId)) || [...proj.walls].map((x) => ({ x, pr: projectOnWall(x, back) })).filter((c) => c.pr.t > 0 && c.pr.t < c.pr.L && c.pr.distance < c.x.thickness / 2 + 30).sort((a, b) => a.pr.distance - b.pr.distance)[0]?.x;
  if (!w) {
    toast('Hinter dem Schrank ist keine Wand – die Öffnung bitte selbst als Durchgang setzen.');
    return;
  }
  const t = projectOnWall(w, { x: it.x, y: it.y }).t;
  const width = Math.max(50, it.width - 4);
  const o = { id: uid(), wallId: w.id, type: 'passage' as const, offset: Math.max(width / 2, Math.min(wallLength(w) - width / 2, t)), width, height: Math.min(it.height - 2, 210), sill: 0 };
  proj.openings.push(o);
  it.passageOpening = o.id;
}

function resnap(it: Item) {
  if (it.wallId) snapItem(store.project, it, { x: it.x, y: it.y });
}

function setWallLength(w: Wall, L: number) {
  const d = wallDir(w);
  const oldB = { ...w.b };
  w.b = { x: w.a.x + d.x * L, y: w.a.y + d.y * L };
  const delta = { x: w.b.x - oldB.x, y: w.b.y - oldB.y };
  for (const o of store.project.walls) {
    if (o === w) continue;
    for (const end of ['a', 'b'] as const) if (dist(o[end], oldB) < 0.5) o[end] = { x: o[end].x + delta.x, y: o[end].y + delta.y };
  }
}

function bindActions(el: HTMLElement, it?: Item) {
  el.querySelector('[data-act="del"]')?.addEventListener('click', () => store.deleteSelection());
  el.querySelector('[data-act="lock"]')?.addEventListener('click', () => {
    if (!store.selection) return;
    store.setLocked(store.selection, true);
    toast('Gesperrt – entsperren unter „Etage“ → „Gesperrt“.');
  });
  el.querySelector('[data-act="dup"]')?.addEventListener('click', () => duplicateSelection());
  el.querySelector('[data-act="rotate"]')?.addEventListener('click', () => {
    if (!it) return;
    it.rotation += Math.PI / 2;
    delete it.wallId;
    store.commit();
  });
}

function duplicateSelection() {
  const s = store.selection;
  if (s?.kind !== 'item') return;
  const it = store.item(s.id);
  if (!it) return;
  const c = Math.cos(it.rotation);
  const sn = Math.sin(it.rotation);
  const copy: Item = JSON.parse(JSON.stringify(it));
  copy.id = uid();
  copy.x += c * it.width;
  copy.y += sn * it.width;
  store.project.items.push(copy);
  store.select({ kind: 'item', id: copy.id });
  store.commit();
}

// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg: string, action?: { label: string; run: () => void }) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      t.remove();
      action.run();
    });
    t.appendChild(b);
  }
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), action ? 7000 : 4200);
}
document.addEventListener('kp-toast', (e) => toast((e as CustomEvent).detail));

let propsKey = '';
store.subscribe(() => {
  syncSettings();
  // Eigenschaften nur neu aufbauen, wenn sich nicht gerade ein Eingabefeld darin im Fokus befindet
  const key = JSON.stringify([store.selection, store.selection && selectedObject()]);
  if (key !== propsKey && !$('#props').contains(document.activeElement)) {
    propsKey = key;
    renderProps();
  }
  if ($('#tab-materials').classList.contains('on')) renderMaterialsTab();
  ($('#undo') as HTMLButtonElement).disabled = false;
});
store.onSelection(() => {
  propsKey = '';
  renderProps();
  view.updateSelection();
  const s = store.selection;
  if (viewFach && (s?.kind !== 'item' || s.id !== viewFach.itemId)) viewFach = null;
  if (s) viewHouse = false;
  renderViewPanel();
  // Handy: das Blatt deckt den unteren Teil ab – ausgewähltes Möbel in den sichtbaren Bereich holen
  if (s?.kind === 'item' && document.body.classList.contains('haus-view') && window.matchMedia('(max-width: 820px)').matches) {
    const it = store.item(s.id);
    // Höhe statt Lage messen: das Blatt fährt gerade erst herein
    if (it) requestAnimationFrame(() => plan.centerOn(it, Math.max(120, $('#plan').clientHeight - $('#viewPanel').offsetHeight)));
  }
});

function selectedObject() {
  const s = store.selection;
  if (!s) return null;
  if (s.kind === 'item') return store.item(s.id);
  if (s.kind === 'wall') return store.wall(s.id);
  if (s.kind === 'room') return store.room(s.id);
  return store.opening(s.id);
}

syncSettings();
renderProps();

// Geteilter Showroom (?ansicht=TOKEN): nur ansehen, nichts speichern
const shareToken = new URLSearchParams(location.search).get('ansicht');
if (shareToken) {
  store.readonly = true;
  store.reset(true); // eigene lokale Planung nicht kurz anzeigen
  document.body.classList.add('shared-view');
  setShowroom(true);
  fetch(`/api/shared/${encodeURIComponent(shareToken)}`)
    .then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `Fehler ${r.status}`);
      return d as { name: string; data: Project };
    })
    .then((d) => {
      store.replace(d.data);
      $('#sharedTitle').textContent = d.name;
      document.title = `${d.name} – Zuhause`;
      view.setView('perspective');
    })
    .catch((e) => {
      $('#sharedTitle').textContent = 'Link nicht verfügbar';
      toast((e as Error).message);
    });
}

// ---------------------------------------------------------------------------
// Haus: Server, Konto, Etagen, Räume, Lager

const account = new Account(shell.accountEl, {
  modal,
  toast,
  esc,
  onUser: async (u) => {
    if (shareToken) return;
    updatePlanButton();
    await sync.start(!!u || !!account.terminal);
    if (u || account.terminal) void loadLibrary().catch(() => {});
    lager.render();
  },
  importPlan,
});
// Lager-Seiten (Router: #/haus = Planer, alles andere = Lager)
const lager = initLager(
  {
    modal,
    toast,
    esc,
    sync,
    house: () => store.house,
    user: () => account.user,
    login: () => account.openLogin(),
    ensureUser: async () => {
      const u = await account.refresh();
      if ((u || account.terminal) && !sync.online) await sync.start(true);
      return u;
    },
    showInHouse: (it, row) => {
      location.hash = `#/haus?fach=${encodeURIComponent(`${it}:${row}`)}`;
    },
  },
  (params) => {
    // Etage aus der Übersicht (#/haus?etage=<id>)
    const etage = params.get('etage');
    if (etage) {
      if (store.house.floors.some((f) => f.id === etage)) store.setFloor(etage);
      history.replaceState(null, '', '#/haus');
      requestAnimationFrame(() => plan.fit());
    }
    // Heatmap aus der Auswertung (#/haus?heat=moves|stale)
    if (params.get('heat') !== null) {
      setView('3d');
      setStorageMode(true);
      view.mode = 'stack';
      document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.h === 'stack'));
      setHeat(params.get('heat') ?? '');
      history.replaceState(null, '', '#/haus');
      return;
    }
    // „Im Haus zeigen“: Etage wechseln, Fach(er) leuchten lassen, Kamera zum Möbel
    const fach = params.get('fach');
    if (!fach) return;
    const [itemId] = fach.split(':');
    const f = findItem(itemId);
    if (!f) return;
    let keys = [fach];
    try {
      keys = JSON.parse(sessionStorage.getItem('zh.highlight') ?? 'null') ?? keys;
      sessionStorage.removeItem('zh.highlight');
    } catch {
      /* egal */
    }
    setHighlight(keys);
    store.setFloor(f.floor.id);
    if (document.body.classList.contains('haus-plan')) {
      store.select({ kind: 'item', id: itemId });
      setStorageMode(true);
    } else showFach(itemId, Number(fach.split(':')[1]));
    requestAnimationFrame(() => {
      view.focusItem(f.item);
      plan.centerOn(f.item);
    });
    history.replaceState(null, '', '#/haus');
  },
  shell,
);
if (!shareToken)
  account.refresh().then(async (u) => {
    await sync.start(!!u || !!account.terminal);
    if (u || account.terminal) void loadLibrary().catch(() => {});
    lager.render();
  });
else lager.render();

const findItem = (id: string) => {
  for (const f of store.house.floors) {
    const it = f.items.find((i) => i.id === id);
    if (it) return { floor: f, item: it };
  }
  return null;
};
/** Lager-Kürzel, zu dem ein Möbel gehört (Raum oder Etage) */
const storageCode = (f: Floor, it: Item) => roomOf(f, it)?.code ?? f.code ?? '';
const wallFacesOf = (f: Floor) => wallFacesRaw(f.walls);
const roomColor = (i: number) => `hsl(${(i * 67 + 200) % 360}, 55%, 55%)`;

// --- Etagen-Reiter und Etagen-Panel ---
function renderFloorTabs() {
  const floors = store.house.floors;
  // Etagen mit Suchtreffern bekommen einen Punkt
  const hl = new Set([...view.highlight].map((k) => findItem(k.split(':')[0])?.floor.id));
  $('#floorTabs').innerHTML =
    floors.map((f) => `<button class="floor-tab ${f.id === store.floorId ? 'on' : ''}" data-f="${f.id}" role="tab" title="${esc(FLOOR_KINDS[f.kind])} · ${f.elevation >= 0 ? '+' : ''}${(f.elevation / 100).toFixed(2).replace('.', ',')} m">${esc(f.name)}${hl.has(f.id) && f.id !== store.floorId ? '<span class="hl-dot" title="Treffer auf dieser Etage"></span>' : ''}</button>`).join('') +
    `<button class="floor-tab add plan-only" data-add title="Etage hinzufügen">${ic('plus')}</button>`;
  $('#floorTabs').querySelectorAll<HTMLElement>('[data-f]').forEach((b) => b.addEventListener('click', () => store.setFloor(b.dataset.f!)));
  $('#floorTabs').querySelector('[data-add]')!.addEventListener('click', () => openAddFloor());
}

function renderFloorPanel() {
  const f = store.floor;
  const el = $('#floorPanel');
  el.innerHTML = `
    <label class="field"><span>Name</span><input type="text" data-fk="name" value="${esc(f.name)}" maxlength="40" /></label>
    <div class="grid2">
      <label class="field"><span>Art</span><select data-fk="kind">${(Object.keys(FLOOR_KINDS) as FloorKind[]).map((k) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${FLOOR_KINDS[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Höhenlage</span><span class="unit" data-unit="cm"><input type="number" data-fk="elevation" value="${f.elevation}" step="1" title="Fußbodenoberkante relativ zum Erdgeschoss (Keller negativ)" /></span></label>
      <label class="field"><span>Raumhöhe</span><span class="unit" data-unit="cm"><input type="number" data-fk="height" value="${f.height}" min="180" max="600" /></span></label>
      <label class="field"><span>&nbsp;</span><button class="btn" data-fk="heightAll" title="Raumhöhe auf alle Wände dieser Etage übertragen">Auf Wände</button></label>
    </div>
    <div id="lockedList"></div>
    ${store.house.floors.length > 1 ? `<details class="danger-zone"><summary>Etage entfernen …</summary><button class="btn danger" data-fk="delete" style="width:100%;justify-content:center;margin-top:8px">${ICON.trash}Etage „${esc(f.name)}“ löschen</button></details>` : ''}`;
  renderLockedList();
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-fk], select[data-fk]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const k = inp.dataset.fk!;
      if (k === 'name') f.name = inp.value.trim().slice(0, 40) || f.name;
      else if (k === 'kind') f.kind = inp.value as FloorKind;
      else if (k === 'elevation') f.elevation = Math.round(+inp.value || 0);
      else if (k === 'height') f.height = Math.max(180, Math.min(600, Math.round(+inp.value || 260)));
      store.floorChanged();
    }),
  );
  el.querySelector('[data-fk="heightAll"]')!.addEventListener('click', () => {
    f.walls.forEach((w) => (w.height = f.height));
    store.commit();
  });
  el.querySelector('[data-fk="delete"]')?.addEventListener('click', () => {
    const n = f.items.filter((i) => compartments(i, store.house.settings).length).length;
    if (!confirm(`Etage „${f.name}“ mit ${f.walls.length} Wänden und ${f.items.length} Möbeln löschen?${n ? `\n\n${n} Möbel mit Fächern verschwinden aus dem Lager (Plätze mit Inhalt bleiben erhalten).` : ''}`)) return;
    store.removeFloor(f.id);
  });
}

/** Gesperrte Objekte der Etage: anzeigen, einzeln oder alle entsperren; alle Wände auf einmal sperren */
function renderLockedList() {
  const el = document.getElementById('lockedList');
  if (!el) return;
  const f = store.floor;
  const locked = store.lockedObjects();
  const name = (s: NonNullable<PlanSelection>) => {
    if (s.kind === 'item') return itemName(store.item(s.id)!);
    if (s.kind === 'room') return `Raum ${store.room(s.id)!.name}`;
    if (s.kind === 'wall') return `Wand ${(wallLength(store.wall(s.id)!) / 100).toFixed(2).replace('.', ',')} m`;
    const o = store.opening(s.id)!;
    return `${o.type === 'window' ? 'Fenster' : o.type === 'door' ? 'Tür' : 'Durchgang'} ${o.width} cm`;
  };
  const openWalls = f.walls.filter((w) => !w.locked).length;
  el.innerHTML = `<h3 class="locked-h">${ICON.lock}Gesperrt${locked.length ? ` (${locked.length})` : ''}</h3>
    ${locked.length ? `<div class="locked-list">${locked.map((l, i) => `<div class="locked-row"><span>${esc(name(l.sel))}</span><button class="btn mini" data-unlock="${i}">Entsperren</button></div>`).join('')}</div>` : '<p class="hint">Nichts gesperrt. Ein ausgewähltes Objekt mit „Sperren“ oder Taste L sperren – es ist dann im Editor nicht mehr auswählbar oder veränderbar.</p>'}
    <div class="actions">${openWalls ? `<button class="btn mini" data-lockwalls>Alle Wände sperren</button>` : ''}${locked.length > 1 ? `<button class="btn mini" data-unlockall>Alle entsperren</button>` : ''}</div>`;
  el.querySelectorAll<HTMLElement>('[data-unlock]').forEach((b) => b.addEventListener('click', () => store.setLocked(locked[+b.dataset.unlock!].sel, false)));
  el.querySelector('[data-lockwalls]')?.addEventListener('click', () => {
    f.walls.forEach((w) => (w.locked = true));
    if (store.selection?.kind === 'wall') store.select(null);
    store.commit();
    toast(`${f.walls.length} Wände gesperrt.`);
  });
  el.querySelector('[data-unlockall]')?.addEventListener('click', () => {
    for (const l of locked) delete l.obj.locked;
    store.commit();
  });
}

function openAddFloor() {
  const h = store.house;
  const top = [...h.floors].sort((a, b) => b.elevation - a.elevation)[0];
  const low = [...h.floors].sort((a, b) => a.elevation - b.elevation)[0];
  const above = top.elevation + top.height + 30;
  const m = modal(
    'Etage hinzufügen',
    `<div class="choice-grid">
      <button class="choice" data-k="floor"><b>Etage darüber</b><span>Obergeschoss auf ${(above / 100).toFixed(2).replace('.', ',')} m</span></button>
      <button class="choice" data-k="attic"><b>Dachgeschoss</b><span>Ganz oben, mit Dachschräge</span></button>
      <button class="choice" data-k="basement"><b>Keller</b><span>Unter „${esc(low.name)}“</span></button>
      <button class="choice" data-k="outdoor"><b>Außenbereich</b><span>Garten, Garage, Carport, Gartenhaus</span></button>
    </div>
    <label class="row switch"><input type="checkbox" id="copyOutline" checked /><span><b>Außenwände von „${esc(store.floor.name)}“ übernehmen</b><small>Der Umriss der aktuellen Etage wird als Wände vorgegeben.</small></span></label>`,
  );
  m.el.querySelectorAll<HTMLElement>('[data-k]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = b.dataset.k as FloorKind;
      const names: Record<FloorKind, string> = { floor: h.floors.some((f) => f.name === 'Obergeschoss') ? 'Obergeschoss 2' : 'Obergeschoss', attic: 'Dachgeschoss', basement: 'Keller', outdoor: 'Außen' };
      const elevation = kind === 'basement' ? low.elevation - 280 : kind === 'outdoor' ? 0 : above;
      const copy = ($('#copyOutline', m.el) as HTMLInputElement).checked && kind !== 'outdoor';
      const walls = copy ? outlineWalls(store.floor) : [];
      m.close();
      store.addFloor({ name: names[kind], kind, elevation, height: kind === 'basement' ? 230 : 260, walls, underlay: undefined });
      afterLoad();
      toast(`„${names[kind]}“ angelegt. Die Etage darunter erscheint gestrichelt als Hilfe zum Zeichnen.`);
    }),
  );
}

/** Außenwände einer Etage (größte geschlossene Fläche) als neue Wände */
function outlineWalls(f: Floor): Wall[] {
  const outer = f.walls.length ? wallFacesOf(f).sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0] : null;
  if (!outer) return [];
  const t = Math.max(12, ...f.walls.map((w) => w.thickness));
  return outer.map((a, i) => ({ id: uid(), a: { ...a }, b: { ...outer[(i + 1) % outer.length] }, thickness: t, height: f.height }));
}

// --- Räume ---
function renderRoomList() {
  const f = store.floor;
  const sel = store.selection;
  const el = $('#roomList');
  if (!f.rooms.length) {
    el.innerHTML = `<p class="hint">Noch keine Räume. Mit <b>Raum festlegen</b> in eine von Wänden umschlossene Fläche klicken. Jeder Raum wird ein Lager.</p>`;
    return;
  }
  el.innerHTML = `<div class="room-list">${f.rooms
    .map((r, i) => {
      const area = r.polygon ? Math.abs(polygonArea(r.polygon)) / 10000 : 0;
      const n = f.items.filter((it) => it.storageCol && roomOf(f, it)?.id === r.id).length;
      return `<button class="room-row ${sel?.kind === 'room' && sel.id === r.id ? 'on' : ''}" data-r="${r.id}"><span class="dot" style="background:${roomColor(i)}"></span><b>${r.locked ? ic('lock') + ' ' : ''}${esc(r.name)}</b><code>${esc(r.code)}</code><small>${area.toFixed(1).replace('.', ',')} m²${n ? ` · ${n} Möbel` : ''}</small></button>`;
    })
    .join('')}</div>`;
  el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) =>
    b.addEventListener('click', () => {
      if (store.room(b.dataset.r!)?.locked) return toast('Der Raum ist gesperrt – entsperren unter „Etage“ → „Gesperrt“.');
      store.select({ kind: 'room', id: b.dataset.r! });
    }),
  );
}

const ROOM_NAMES = ['Küche', 'Wohnzimmer', 'Esszimmer', 'Schlafzimmer', 'Kinderzimmer', 'Arbeitszimmer', 'Bad', 'Gäste-WC', 'Flur', 'Diele', 'Abstellraum', 'Speisekammer', 'Hauswirtschaftsraum', 'Vorratskeller', 'Heizungsraum', 'Werkstatt', 'Garage', 'Dachboden', 'Gartenhaus'];

plan.onRoomRequest = (seed: Vec2) => {
  const m = modal(
    'Raum festlegen',
    `<form class="auth-form">
      <label class="field"><span>Name des Raums</span><input type="text" name="n" list="roomNames" maxlength="40" required /></label>
      <datalist id="roomNames">${ROOM_NAMES.map((n) => `<option value="${n}">`).join('')}</datalist>
      <p class="hint">Der Raum wird im Lager ein eigenes Lager mit Kürzel (z. B. „Küche“ → KU). Möbel mit Fächern darin bekommen automatisch Lagerplätze.</p>
    </form>`,
    '<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Raum anlegen</button>',
  );
  m.el.querySelector('.modal')!.classList.add('narrow');
  const input = m.el.querySelector<HTMLInputElement>('input')!;
  input.focus();
  const ok = () => {
    const name = input.value.trim();
    if (!name) return input.focus();
    const taken = new Set([...store.reservedCodes, ...store.house.floors.flatMap((f) => [...f.rooms.map((r) => r.code), f.code ?? ''])]);
    const r: Room = { id: uid(), name, code: suggestCode(name, taken), seed: { x: Math.round(seed.x), y: Math.round(seed.y) } };
    store.floor.rooms.push(r);
    m.close();
    store.commit();
    store.select({ kind: 'room', id: r.id });
    toast(`Raum „${name}“ angelegt – Lager ${r.code}.`);
  };
  m.el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    ok();
  });
  m.el.querySelector('[data-ok]')!.addEventListener('click', ok);
};

store.onFloor(() => {
  renderFloorTabs();
  renderFloorPanel();
  renderRoomList();
  plan.draw();
});
store.subscribe(() => {
  renderRoomList();
  renderLockedList();
  if (!$('#floorTabs').contains(document.activeElement)) renderFloorTabs();
});
renderFloorTabs();
renderFloorPanel();
renderRoomList();

// --- 3D: Etage / bis hier / Haus, Lager-Ansicht ---
document.querySelectorAll<HTMLElement>('#houseMode [data-h]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', x === b));
    view.mode = b.dataset.h as HouseMode;
    view.build();
    view.setView('perspective');
  }),
);
function setStorageMode(on: boolean) {
  view.storageMode = on;
  $('#storageBtn').classList.toggle('on', on);
  $('#heatSel').hidden = !on;
  if (!on) view.heatInfo = undefined;
  view.build();
}
/** Heatmap: Bewegungen der letzten 90 Tage oder Zeit seit der letzten Berührung je Fach */
async function setHeat(kind: string) {
  ($('#heatSel') as HTMLSelectElement).value = kind;
  if (!kind) {
    view.heatInfo = undefined;
    view.build();
    return;
  }
  const r = await fetch('/api/house/stats', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => ({ places: {} }));
  const st: Record<string, { moves_90: number; last_at: string | null }> = r.places ?? {};
  const max = Math.max(1, ...Object.values(st).map((x) => x.moves_90));
  view.heatInfo = (id, row) => {
    const s = st[`${id}:${row}`];
    if (kind === 'moves') return s ? s.moves_90 / max : 0;
    if (!s?.last_at) return null; // leeres Fach
    const days = (Date.now() - new Date(s.last_at.replace(' ', 'T') + 'Z').getTime()) / 86400000;
    return Math.min(1, days / 365);
  };
  view.build();
  toast(kind === 'moves' ? 'Bewegung: rot = oft gebucht (90 Tage), blau = selten.' : 'Lange unberührt: rot = seit einem Jahr nicht angefasst, blau = kürzlich, grau = leer.');
}
$('#heatSel').addEventListener('change', (e) => setHeat((e.target as HTMLSelectElement).value));
$('#storageBtn').addEventListener('click', () => {
  setStorageMode(!view.storageMode);
  if (view.storageMode && !sync.online) toast('Fächer werden angezeigt – Inhalte gibt es nach dem Anmelden.');
  else if (view.storageMode) toast('Lager: blau = leer, grün = belegt, orange = läuft bald ab, rot = abgelaufen. Fach anklicken zeigt den Inhalt.');
});
view.fachInfo = (id, row) => {
  const pl = sync.fach(id, row);
  if (!pl) return null;
  return {
    count: pl.items.length,
    expired: pl.items.some((i) => i.expires_in !== null && i.expires_in < 0),
    soon: pl.items.some((i) => i.expires_in !== null && i.expires_in >= 0 && i.expires_in <= 30),
  };
};
sync.onStorage(() => {
  if (view.storageMode) view.build();
  propsKey = '';
  renderProps();
});
view.onFach = (itemId, row, floorId) => {
  if (floorId !== store.floorId) store.setFloor(floorId);
  store.select({ kind: 'item', id: itemId });
  openFach(itemId, row);
};

// --- Fach: Inhalt, einbuchen, entnehmen, umlagern ---
/** Server-API (Buchungen ohne Verbindung werden vorgemerkt, siehe lager/outbox.ts) */
const lagerApi = <T = any>(method: string, url: string, body?: unknown, label?: string) => api<T>(method, url, body, label);

function expiryBadge(i: { expires_in: number | null; expires_on: string | null }) {
  if (i.expires_in === null || !i.expires_on) return '';
  const d = i.expires_on.split('-').reverse().join('.');
  if (i.expires_in < 0) return `<span class="pill bad">abgelaufen ${d}</span>`;
  if (i.expires_in <= 30) return `<span class="pill warn">bis ${d}</span>`;
  return `<span class="pill">bis ${d}</span>`;
}

function openFach(itemId: string, row: number) {
  // Ansehen: Inhalt in der Seitenleiste, der Plan bleibt sichtbar
  if (!document.body.classList.contains('haus-plan')) return showFach(itemId, row);
  if (!sync.online) {
    toast('Zum Ein- und Ausbuchen bitte anmelden.');
    return;
  }
  const m = modal('Fach', '<p class="hint">Lade …</p>');
  m.el.querySelector('.modal')!.classList.add('fach-modal');
  fachView(m.el.querySelector('header h2')!, m.el.querySelector('.body')!, itemId, row);
}

/** Inhalt eines Fachs: ansehen, einbuchen, entnehmen, umlagern – im Fenster (Planen) oder in der Seitenleiste (Ansehen) */
function fachView(head: Element, body: Element, itemId: string, row: number) {
  const found = findItem(itemId);
  if (!found) return;
  const comp = compartments(found.item, store.house.settings)[row];
  if (!comp) return;
  const draw = () => {
    if (!body.isConnected) return;
    const pl = sync.fach(itemId, row);
    const roomName = roomOf(found.floor, found.item)?.name ?? found.floor.name;
    if (!pl) {
      head.textContent = comp.label;
      body.innerHTML = `<p class="hint">Dieses Fach ist noch nicht im Lager angelegt – der Hausplan wird gerade gespeichert. ${sync.canEdit ? '' : 'Den Hausplan speichern nur Personen mit dem Recht „Haus planen“.'}</p>`;
      return;
    }
    head.textContent = `${pl.address} · ${comp.label}`;
    body.innerHTML = `
      <p class="hint">${esc(roomName)} · ${esc(itemName(found.item))} · <a class="link" href="#/platz?wh=${pl.warehouse_id}&p=${pl.col}${pl.row}">als Liste öffnen</a></p>
      ${pl.items.length ? `<div class="fach-items">${pl.items
        .map((i) => `<div class="fach-item" data-id="${i.id}">
          ${i.photo_at ? `<img src="/api/items/${i.id}/photo?size=thumb&v=${encodeURIComponent(i.photo_at)}" alt="">` : `<span class="ph">${ic(i.container ? 'box' : 'tag')}</span>`}
          <div><b>${esc(i.name)}</b><small>${i.quantity}× · ${esc(i.code)}${i.parent_id ? ' · im Behälter' : ''}</small>${expiryBadge(i)}</div>
          <button class="btn mini" data-out title="1 Stück entnehmen" ${i.quantity < 1 ? 'disabled' : ''}>${ic('minus')}1</button>
          <a class="btn mini icon" href="#/item/${i.id}" title="Gegenstand öffnen" aria-label="Gegenstand öffnen">${ic('chev')}</a>
        </div>`)
        .join('')}</div>` : '<p class="hint">Das Fach ist leer.</p>'}
      <h3>Hineinlegen</h3>
      <form class="fach-in">
        <input type="text" name="name" placeholder="Was kommt hinein?" required maxlength="80" autocomplete="off" />
        <div class="fach-sug"></div>
        <input type="number" name="qty" value="1" min="1" max="9999" title="Menge" />
        ${expiryField('exp')}
        <button class="btn primary" type="submit">${ic('in')}Einbuchen</button>
      </form>
      <h3>Vorhandenen Gegenstand hierher umlagern</h3>
      <input type="search" class="fach-search" placeholder="Gegenstand suchen …" />
      <div class="fach-results"></div>
      <p class="form-error" hidden></p>`;
    bindExpiry(body);
    const err = body.querySelector<HTMLElement>('.form-error')!;
    const run = async (fn: () => Promise<unknown>, msg?: string) => {
      err.hidden = true;
      try {
        await fn();
        await sync.loadStorage();
        if (msg) toast(msg);
        draw();
      } catch (e) {
        if (e instanceof QueuedError) return toast(e.message);
        err.textContent = (e as Error).message;
        err.hidden = false;
      }
    };
    body.querySelectorAll<HTMLElement>('.fach-item').forEach((row) =>
      row.querySelector('[data-out]')?.addEventListener('click', () => {
        const i = pl.items.find((x) => x.id === Number(row.dataset.id))!;
        run(() => lagerApi('POST', '/api/checkout', { item_id: i.id, quantity: 1, source: 'app' }, i.name), `1× ${i.name} entnommen.`);
      }),
    );
    // Vorschläge aus vorhandenen Gegenständen: gewählt → dieser Gegenstand wird hierher gebucht (kein Doppel)
    const form = body.querySelector<HTMLFormElement>('.fach-in')!;
    const nameIn = form.querySelector<HTMLInputElement>('[name="name"]')!;
    const sug = form.querySelector<HTMLElement>('.fach-sug')!;
    let chosen: { id: number; name: string } | null = null;
    let sugTimer = 0;
    nameIn.addEventListener('input', () => {
      chosen = null;
      clearTimeout(sugTimer);
      sugTimer = window.setTimeout(async () => {
        const q = nameIn.value.trim();
        if (q.length < 2) return void (sug.innerHTML = '');
        const list = await lagerApi<any[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=5`).catch(() => []);
        sug.innerHTML = list.map((i) => `<button type="button" data-id="${i.id}"><b>${esc(i.name)}</b><small>${i.quantity}× · ${esc(i.wh_code)}-${esc(i.col)}${i.row}</small></button>`).join('');
        sug.querySelectorAll<HTMLElement>('[data-id]').forEach((b) =>
          b.addEventListener('click', () => {
            const i = list.find((x) => x.id === Number(b.dataset.id));
            chosen = { id: i.id, name: i.name };
            nameIn.value = i.name;
            sug.innerHTML = `<p class="hint">Vorhandener Gegenstand – Zugang wird gebucht${i.warehouse_id === pl.warehouse_id && i.col === pl.col && i.row === pl.row ? '' : `, er liegt danach hier statt in <code>${esc(i.wh_code)}-${esc(i.col)}${i.row}</code>`}.</p>`;
          }),
        );
      }, 200);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      if (!name) return;
      const what = chosen && chosen.name === name ? { item_id: chosen.id } : { name };
      run(
        () => lagerApi('POST', '/api/checkin', { ...what, quantity: Number(fd.get('qty')) || 1, warehouse_id: pl.warehouse_id, col: pl.col, row: pl.row, container_id: null, expires_on: parseExpiry(fd.get('exp')) ?? undefined }, name),
        `${name} liegt jetzt in ${pl.address}.`,
      );
    });
    const search = body.querySelector<HTMLInputElement>('.fach-search')!;
    const results = body.querySelector<HTMLElement>('.fach-results')!;
    let t = 0;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = window.setTimeout(async () => {
        const q = search.value.trim();
        if (!q) return (results.innerHTML = '');
        const list = await lagerApi<any[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=8`).catch(() => []);
        results.innerHTML = list
          .filter((i) => !(i.warehouse_id === pl.warehouse_id && i.col === pl.col && i.row === pl.row))
          .map((i) => `<button class="fach-hit" data-id="${i.id}"><b>${esc(i.name)}</b><small>${i.quantity}× · ${esc(i.wh_code)}-${esc(i.col)}${i.row}${i.place_name ? ` · ${esc(i.place_name)}` : ''}</small></button>`)
          .join('') || '<p class="hint">Nichts gefunden.</p>';
        results.querySelectorAll<HTMLElement>('.fach-hit').forEach((b) =>
          b.addEventListener('click', () => {
            const i = list.find((x) => x.id === Number(b.dataset.id));
            run(() => lagerApi('PATCH', `/api/items/${i.id}`, { warehouse_id: pl.warehouse_id, col: pl.col, row: pl.row, container_id: null }), `${i.name} liegt jetzt in ${pl.address}.`);
            search.value = '';
          }),
        );
      }, 200);
    });
  };
  draw();
}

// --- Suche: „Wo liegt …?“ – Treffer im Haus aufleuchten lassen ---
const searchInput = $<HTMLInputElement>('#houseSearchInput');
const searchPop = $('#searchPop');
let searchTimer = 0;
async function runSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    searchPop.hidden = true;
    if (view.highlight.size) setHighlight([]);
    return;
  }
  if (!sync.online) {
    searchPop.innerHTML = '<p class="hint">Zum Suchen im Lager bitte anmelden.</p>';
    searchPop.hidden = false;
    return;
  }
  const list = await lagerApi<any[]>('GET', `/api/items?q=${encodeURIComponent(q)}&limit=30`).catch(() => []);
  const byLoc = new Map([...sync.storage.values()].map((p) => [`${p.warehouse_id}-${p.col}-${p.row}`, p]));
  const hits = list.map((i) => ({ i, pl: byLoc.get(`${i.warehouse_id}-${i.col}-${i.row}`) }));
  setHighlight(hits.filter((h) => h.pl).map((h) => `${h.pl!.plan_item}:${h.pl!.plan_slot}`));
  if (view.highlight.size && !view.storageMode) setStorageMode(true);
  searchPop.innerHTML = hits.length
    ? hits
        .map(({ i, pl }) => {
          const f = pl && findItem(pl.plan_item);
          const where = pl && f ? `${esc(f.floor.name)} · ${esc(roomOf(f.floor, f.item)?.name ?? '')} · ${esc(pl.name)}` : `${esc(i.wh_name ?? '')} – nicht im Hausplan`;
          return `<button class="search-hit" data-plan="${pl ? `${pl.plan_item}:${pl.plan_slot}` : ''}" data-id="${i.id}"><b>${esc(i.name)}</b> <code>${esc(i.wh_code)}-${esc(i.col)}${i.row}</code><small>${i.quantity}× · ${where}</small></button>`;
        })
        .join('')
    : '<p class="hint">Nichts gefunden.</p>';
  searchPop.hidden = false;
  searchPop.querySelectorAll<HTMLElement>('.search-hit').forEach((b) =>
    b.addEventListener('click', () => {
      if (!b.dataset.plan) {
        location.hash = `#/item/${b.dataset.id}`;
        return;
      }
      const [itemId, row] = b.dataset.plan.split(':');
      const f = findItem(itemId);
      if (!f) return;
      store.setFloor(f.floor.id);
      store.select({ kind: 'item', id: itemId });
      view.focusItem(f.item);
      plan.centerOn(f.item);
      searchPop.hidden = true;
      openFach(itemId, Number(row));
    }),
  );
}
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 250);
});
$('#houseSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim() && searchPop.innerHTML) searchPop.hidden = false;
});
document.addEventListener('click', (e) => {
  if (!$('#houseSearch').contains(e.target as Node)) searchPop.hidden = true;
});


// ---------------------------------------------------------------------------
// Haus: Ansehen (Normalfall für den ganzen Haushalt) und Planen (Werkzeuge; nur mit dem Recht „Haus planen“)

/** im Ansehen-Modus geöffnetes Fach (Seitenleiste) */
let viewFach: { itemId: string; row: number } | null = null;
/** Ansehen: oberste Ebene „Haus“ (alle Etagen) statt der Räume der aktuellen Etage */
let viewHouse = false;
function showHouse() {
  viewHouse = true;
  viewFach = null;
  store.select(null);
  if (view.mode !== 'house') {
    view.mode = 'house';
    view.build();
    view.setView('perspective');
    document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.h === 'house'));
  }
  renderViewPanel();
}
const mayPlan = () => !terminal() && (!account.user || !!account.user.canPlan);
function updatePlanButton() {
  $('#planStart').hidden = !mayPlan();
  if (!mayPlan() && document.body.classList.contains('haus-plan')) setPlanning(false);
}

function setView(v: '2d' | '3d' | 'split') {
  document.querySelectorAll<HTMLElement>('#viewMode button').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
  $('#main').className = 'v-' + v;
}

function setPlanning(on: boolean) {
  if (on && !mayPlan()) return;
  document.body.classList.toggle('haus-plan', on);
  document.body.classList.toggle('haus-view', !on);
  plan.viewOnly = !on;
  view.focusMode = !on;
  view.updateSelection();
  plan.setTool('select');
  viewFach = null;
  if (on) {
    let tab: string | null = 'room';
    try {
      tab = localStorage.getItem('zh.drawer') ?? 'room';
    } catch {
      /* egal */
    }
    setDrawer(tab || null, false);
    setHighlight([]);
    searchInput.value = '';
    setStorageMode(false);
  } else {
    document.body.classList.remove('drawer-open');
    setStorageMode(true);
    if ($('#main').className === 'v-split') setView(prefs().houseView);
  }
  propsKey = '';
  renderProps();
  renderViewPanel();
  plan.draw();
}
$('#planStart').addEventListener('click', () => setPlanning(true));
$('#planDone').addEventListener('click', () => setPlanning(false));

/** Linke Leiste (Etage, Möbel, Materialien) beim Planen ein- und ausklappen */
function setDrawer(tab: string | null, remember = true) {
  document.body.classList.toggle('drawer-open', !!tab);
  document.querySelectorAll<HTMLElement>('[data-drawer]').forEach((b) => b.classList.toggle('on', !!tab && b.dataset.drawer === tab));
  if (tab && !$(`.tabs button[data-tab="${tab}"]`).classList.contains('on')) $(`.tabs button[data-tab="${tab}"]`).click();
  if (remember) {
    try {
      localStorage.setItem('zh.drawer', tab ?? '');
    } catch {
      /* egal */
    }
  }
}
document.querySelectorAll<HTMLElement>('[data-drawer]').forEach((b) =>
  b.addEventListener('click', () => {
    const open = document.body.classList.contains('drawer-open') && b.classList.contains('on');
    setDrawer(open ? null : b.dataset.drawer!);
  }),
);
$('#drawerClose').addEventListener('click', () => setDrawer(null));

/** Suchtreffer (Schlüssel „Möbel-ID:Fach“) in 3D, im Grundriss und an den Etagen-Reitern zeigen */
function setHighlight(keys: string[]) {
  view.highlight = new Set(keys);
  plan.highlight = new Set(keys.map((k) => k.split(':')[0]));
  view.build();
  plan.draw();
  renderFloorTabs();
}

/** Füllstand: 0 leer, 1 teils, 2 voll */
const fillLevel = (used: number, all: number): 0 | 1 | 2 => (used === 0 ? 0 : used / all < 0.6 ? 1 : 2);
function itemFill(it: Item) {
  const all = compartments(it, store.house.settings).length;
  let used = 0;
  let count = 0;
  for (let r = 0; r < all; r++) {
    const n = sync.fach(it.id, r)?.items.length ?? 0;
    if (n) used++;
    count += n;
  }
  return { all, used, count };
}
plan.fillOf = (id) => {
  const f = findItem(id);
  if (!f) return null;
  const { all, used } = itemFill(f.item);
  return all ? fillLevel(used, all) : null;
};

function showFach(itemId: string, row: number) {
  const f = findItem(itemId);
  if (!f) return;
  if (f.floor.id !== store.floorId) store.setFloor(f.floor.id);
  store.select({ kind: 'item', id: itemId });
  viewFach = { itemId, row };
  renderViewPanel();
}

/** Seitenleiste im Ansehen-Modus: Räume der Etage → Möbel → Fächer → Inhalt (auf dem Handy als Blatt von unten) */
function renderViewPanel() {
  const el = $('#viewPanel');
  if (document.body.classList.contains('haus-plan')) return;
  const f = store.floor;
  const sel = store.selection;
  const S = store.house.settings;
  document.body.classList.toggle('sheet-open', !!viewFach || sel?.kind === 'item' || sel?.kind === 'room');
  const close = `<button class="vp-x" data-x aria-label="Schließen">${ic('x')}</button>`;
  const bind = () => {
    el.querySelector('[data-x]')?.addEventListener('click', () => {
      viewFach = null;
      store.select(null);
    });
  };
  if (viewFach) {
    const found = findItem(viewFach.itemId);
    if (!found) {
      viewFach = null;
      return renderViewPanel();
    }
    el.innerHTML = `<div class="vp-head"><button class="vp-back" data-back>${ic('back')}${esc(itemName(found.item))}</button>${close}</div><h2 class="vp-title"></h2><div class="vp-body"></div>`;
    bind();
    el.querySelector('[data-back]')!.addEventListener('click', () => {
      viewFach = null;
      renderViewPanel();
    });
    if (!sync.online) {
      el.querySelector('.vp-title')!.textContent = compartments(found.item, S)[viewFach.row]?.label ?? 'Fach';
      el.querySelector('.vp-body')!.innerHTML = '<p class="hint">Zum Ansehen des Inhalts, Ein- und Ausbuchen bitte anmelden.</p>';
      return;
    }
    fachView(el.querySelector('.vp-title')!, el.querySelector('.vp-body')!, viewFach.itemId, viewFach.row);
    return;
  }
  if (sel?.kind === 'item') {
    const it = store.item(sel.id);
    if (it) {
      const comps = compartments(it, S);
      const room = roomOf(f, it);
      const code = it.storageCol ? `${storageCode(f, it)}-${it.storageCol}` : '';
      el.innerHTML = `<div class="vp-head"><button class="vp-back" data-up>${ic('back')}${esc(room?.name ?? f.name)}</button>${close}</div>
        <h2 class="vp-title">${code ? `<code>${esc(code)}</code>` : ''}${esc(itemName(it))}</h2>
        <p class="vp-sub">${esc(room?.name ?? f.name)} · ${esc(f.name)}${comps.length ? ` · ${comps.length} Fächer` : ''}</p>
        ${comps.length
          ? `<div class="vp-list">${comps.map((c, r) => {
              const pl = sync.fach(it.id, r);
              const items = pl?.items ?? [];
              return `<button class="vp-row" data-r="${r}"><code>${esc(pl?.address ?? `${code}${r}`)}</code><span class="grow"><b>${esc(c.label)}</b><small>${items.length ? esc(items.slice(0, 3).map((i) => i.name).join(', ')) + (items.length > 3 ? ` und ${items.length - 3} weitere` : '') : 'leer'}</small></span><i class="lv lv${items.length ? (items.length < 3 ? 1 : 2) : 0}"></i></button>`;
            }).join('')}</div>`
          : '<p class="hint">Dieses Möbel hat keine Fächer.</p>'}`;
      bind();
      el.querySelector('[data-up]')!.addEventListener('click', () => store.select(room ? { kind: 'room', id: room.id } : null));
      el.querySelectorAll<HTMLElement>('[data-r]').forEach((b) => b.addEventListener('click', () => showFach(it.id, Number(b.dataset.r))));
      return;
    }
  }
  // Raum: Möbel mit Fächern; Etage: Räume mit Füllstand
  const roomItems = (rid: string) => f.items.filter((it) => roomOf(f, it)?.id === rid && compartments(it, S).length);
  const bar = (used: number, all: number) => `<span class="bar"><i style="width:${all ? Math.round((used / all) * 100) : 0}%"></i></span>`;
  if (sel?.kind === 'room') {
    const r = store.room(sel.id);
    if (r) {
      const list = roomItems(r.id);
      el.innerHTML = `<div class="vp-head"><button class="vp-back" data-up>${ic('back')}${esc(f.name)}</button>${close}</div>
        <h2 class="vp-title"><code>${esc(r.code)}</code>${esc(r.name)}</h2>
        <p class="vp-sub">${list.length ? `${list.length} Möbel mit Fächern` : 'Keine Möbel mit Fächern'}</p>
        <div class="vp-list">${list.map((it) => {
          const fl = itemFill(it);
          return `<button class="vp-row" data-it="${it.id}"><code>${esc(r.code)}-${esc(it.storageCol ?? '')}</code><span class="grow"><b>${esc(itemName(it))}</b><small>${fl.count} Gegenstände · ${fl.used} von ${fl.all} Fächern belegt</small></span>${bar(fl.used, fl.all)}</button>`;
        }).join('')}</div>`;
      bind();
      el.querySelector('[data-up]')!.addEventListener('click', () => store.select(null));
      el.querySelectorAll<HTMLElement>('[data-it]').forEach((b) => b.addEventListener('click', () => store.select({ kind: 'item', id: b.dataset.it! })));
      return;
    }
  }
  // Haus: alle Etagen mit Füllstand
  if (viewHouse) {
    const floors = [...store.house.floors].sort((a, b) => b.elevation - a.elevation).map((fl) => {
      let all = 0;
      let used = 0;
      let count = 0;
      for (const it of fl.items) {
        if (!compartments(it, S).length) continue;
        const x = itemFill(it);
        all += x.all;
        used += x.used;
        count += x.count;
      }
      return { fl, all, used, count };
    });
    el.innerHTML = `<h2 class="vp-title">${esc(store.house.name || 'Haus')}</h2><p class="vp-sub">Etage antippen, um ihre Räume zu sehen.</p>
      <div class="vp-list">${floors.map(({ fl, all, used, count }) => `<button class="vp-row" data-floor="${fl.id}">${ic('layers')}<span class="grow"><b>${esc(fl.name)}</b><small>${fl.rooms.length} Räume${all ? ` · ${count} Gegenstände` : ''}</small></span>${all ? bar(used, all) : ''}</button>`).join('')}</div>
      <p class="vp-legend"><span><i class="lv lv0"></i>leer</span><span><i class="lv lv1"></i>teils</span><span><i class="lv lv2"></i>voll</span></p>`;
    el.querySelectorAll<HTMLElement>('[data-floor]').forEach((b) =>
      b.addEventListener('click', () => {
        viewHouse = false;
        if (b.dataset.floor === store.floorId) {
          // gleiche Etage: trotzdem auf „Bis hier“ wechseln
          view.mode = 'stack';
          view.build();
          view.setView('perspective');
          document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.h === 'stack'));
          renderViewPanel();
        } else store.setFloor(b.dataset.floor!);
      }),
    );
    return;
  }
  const rows = f.rooms.map((r, i) => {
    const list = roomItems(r.id);
    let all = 0;
    let used = 0;
    let count = 0;
    for (const it of list) {
      const x = itemFill(it);
      all += x.all;
      used += x.used;
      count += x.count;
    }
    return { r, i, list, all, used, count };
  });
  el.innerHTML = `<div class="vp-head"><button class="vp-back" data-house>${ic('back')}Haus</button></div><h2 class="vp-title">${esc(f.name)}</h2><p class="vp-sub">Möbel antippen, um Fächer und Inhalt zu sehen.</p>
    ${rows.length ? `<div class="vp-list">${rows.map(({ r, i, list, all, used, count }) => `<button class="vp-row" data-room="${r.id}"><span class="dot" style="background:${roomColor(i)}"></span><span class="grow"><b>${esc(r.name)} <code>${esc(r.code)}</code></b><small>${list.length ? `${list.length} Möbel · ${count} Gegenstände` : 'keine Fächer'}</small></span>${all ? bar(used, all) : ''}</button>`).join('')}</div>` : '<p class="hint">Auf dieser Etage sind noch keine Räume festgelegt.</p>'}
    <p class="vp-legend"><span><i class="lv lv0"></i>leer</span><span><i class="lv lv1"></i>teils</span><span><i class="lv lv2"></i>voll</span></p>`;
  el.querySelectorAll<HTMLElement>('[data-room]').forEach((b) => b.addEventListener('click', () => store.select({ kind: 'room', id: b.dataset.room! })));
  el.querySelector('[data-house]')?.addEventListener('click', showHouse);
}
store.onFloor(() => {
  viewFach = null;
  viewHouse = false;
  renderViewPanel();
  // Ansehen: Etage gewählt, während das ganze Haus zu sehen ist → „Bis hier“ auf diese Etage
  if (document.body.classList.contains('haus-view') && !document.body.classList.contains('resting') && view.mode === 'house') {
    view.mode = 'stack';
    view.build();
    view.setView('perspective');
    document.querySelectorAll('#houseMode [data-h]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.h === 'stack'));
  }
});
store.subscribe(() => {
  if (!document.getElementById('viewPanel')?.contains(document.activeElement)) renderViewPanel();
});
sync.onStorage(() => {
  plan.draw();
  if (!viewFach) renderViewPanel();
});
onPrefs((p) => {
  if (!document.body.classList.contains('haus-plan') && !document.body.classList.contains('showroom')) setView(p.houseView);
});
// Nachgebuchte Buchungen (nach schlechtem WLAN): Ergebnis melden, Fehler einzeln zeigen
document.addEventListener('zh-outbox-flushed', (e) => {
  const { sent, failed } = (e as CustomEvent<{ sent: number; failed: number }>).detail;
  if (sent) toast(`${sent} vorgemerkte Buchung${sent === 1 ? '' : 'en'} nachgebucht.`);
  if (failed) {
    const m = modal('Nicht nachgebucht', `<p>Diese Buchungen hat der Server abgelehnt – bitte von Hand prüfen:</p><ul>${failures().map((f) => `<li><b>${esc(f.label)}</b>: ${esc(f.error)}</li>`).join('')}</ul>`, '<button class="btn primary" data-ok>Verstanden</button>');
    m.el.querySelector('[data-ok]')!.addEventListener('click', () => {
      clearFailures();
      m.close();
    });
  }
  sync.loadStorage().catch(() => {});
});
document.addEventListener('zh-outbox-flush', () => flush().then((r) => document.dispatchEvent(new CustomEvent('zh-outbox-flushed', { detail: r }))));
// Konto geändert (Anmeldung per Kachel, E-Mail, Abmelden): Planen-Knopf anpassen
document.addEventListener('zh-account-render', () => {
  updatePlanButton();
  // Wandterminal: nur ansehen, nichts im Browser speichern; Möbel ohne orangen Auswahlrahmen
  if (terminal()) store.readonly = true;
  view.hideSelectionBox = !!terminal();
  view.updateSelection();
});
// Start: Ansehen in der Lieblingsansicht der Person
setView(prefs().houseView);
setPlanning(false);
updatePlanButton();



// ---------------------------------------------------------------------------
// Lage des Hauses: Koordinaten und Nordrichtung – Sonne und Wetter wie draußen

function openLocation() {
  const cur = store.house.settings.location;
  const m = modal('Lage des Hauses', `<form class="l-form loc-form">
    <p class="hint">Mit der Lage stehen Sonne und Himmel im 3D so, wie es draußen gerade ist; das Wetter kommt vom Ort des Hauses.</p>
    <label>Adresse, Ort oder Postleitzahl suchen<span class="loc-search"><input id="locQ" placeholder="z. B. Königstraße 1, Stuttgart" autocomplete="off" /><button type="button" class="btn" id="locGo">${ic('search')}Suchen</button></span></label>
    <div class="loc-hits" id="locHits"></div>
    <div class="grid2"><label>Breitengrad<input id="locLat" type="number" step="0.00001" min="-90" max="90" value="${cur?.lat ?? ''}" /></label>
    <label>Längengrad<input id="locLon" type="number" step="0.00001" min="-180" max="180" value="${cur?.lon ?? ''}" /></label></div>
    <label>Nordrichtung im Grundriss: <b id="locNV">${cur?.north ?? 0}°</b><span class="loc-north"><input id="locN" type="range" min="0" max="359" step="1" value="${cur?.north ?? 0}" />
      <svg class="loc-compass" viewBox="-50 -50 100 100"><circle r="46" /><g id="locArrow"><path d="M0 -40 L9 0 L0 -6 L-9 0Z" /><text y="-28" text-anchor="middle">N</text></g></svg></span></label>
    <p class="hint">Der Pfeil zeigt, wohin im Grundriss Norden liegt (0° = oben). Tipp: Ausrichtung aus einer Karte übernehmen – die Straßenseite des Hauses im Plan mit der Karte vergleichen.</p>
    <p class="form-error" hidden></p>
  </form>`, `${cur ? '<button class="btn danger" data-del>Lage entfernen</button><span class="spacer"></span>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Übernehmen</button>`);
  const $m = <T extends HTMLElement>(s: string) => m.el.querySelector<T>(s)!;
  let label = cur?.label ?? '';
  const north = () => {
    const v = Number($m<HTMLInputElement>('#locN').value);
    $m('#locNV').textContent = `${v}°`;
    $m('#locArrow').setAttribute('transform', `rotate(${v})`);
  };
  north();
  $m('#locN').addEventListener('input', north);
  const search = async () => {
    const q = $m<HTMLInputElement>('#locQ').value.trim();
    const hits = $m('#locHits');
    hits.innerHTML = '<p class="hint">Suche …</p>';
    try {
      const list = await api<{ name: string; label: string; lat: number; lon: number }[]>('GET', `/api/geocode?q=${encodeURIComponent(q)}`);
      hits.innerHTML = list.length ? list.map((h, i) => `<button type="button" data-i="${i}"><b>${esc(h.name)}</b><small>${esc(h.label)}</small></button>`).join('') : '<p class="hint">Nichts gefunden.</p>';
      hits.querySelectorAll<HTMLElement>('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          const h = list[Number(b.dataset.i)];
          $m<HTMLInputElement>('#locLat').value = h.lat.toFixed(5);
          $m<HTMLInputElement>('#locLon').value = h.lon.toFixed(5);
          label = h.name;
          hits.innerHTML = `<p class="hint">Übernommen: ${esc(h.label)}</p>`;
        }),
      );
    } catch (e) {
      hits.innerHTML = `<p class="form-error">${esc((e as Error).message)}</p>`;
    }
  };
  $m('#locGo').addEventListener('click', search);
  $m('#locQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search();
    }
  });
  m.el.querySelector('[data-ok]')!.addEventListener('click', () => {
    const lat = Number($m<HTMLInputElement>('#locLat').value);
    const lon = Number($m<HTMLInputElement>('#locLon').value);
    const err = $m('.form-error');
    if (!$m<HTMLInputElement>('#locLat').value || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      err.textContent = 'Bitte einen Ort suchen oder Breiten- und Längengrad eingeben.';
      err.hidden = false;
      return;
    }
    store.house.settings.location = { lat, lon, north: Number($m<HTMLInputElement>('#locN').value), ...(label ? { label } : {}) };
    store.commit();
    m.close();
    plan.draw();
    toast('Lage gespeichert – Sonne und Wetter folgen jetzt dem Ort.');
    updateOutdoor(true);
  });
  m.el.querySelector('[data-del]')?.addEventListener('click', () => {
    delete store.house.settings.location;
    store.commit();
    m.close();
    plan.draw();
    updateOutdoor(true);
  });
}
$('#locationBtn').addEventListener('click', () => openLocation());
plan.north = () => store.house.settings.location?.north ?? null;

/** Draußen wie echt (Wandterminal): Sonne aus Ort und Uhrzeit, Bewölkung/Regen aus dem Wetter – jede Minute neu */
let outdoorWeather: { at: number; data: any; q: string } | null = null;
/** Testwetter zum Ausprobieren am Terminal: Adresse mit ?testwetter=schnee (siehe TEST_WEATHER) – nur dieses Fenster */
const TEST_WEATHER: Record<string, Record<string, unknown>> = {
  'schnee-hauch': { temperature: 0, code: 71, text: 'leichter Schneefall', kind: 'snow', cloud: 90, precipitation: 0.05, rain_rate: 0, snowfall: 0.05, snow_depth: 0.004, visibility: 10000, wind_speed: 5, wind_direction: 240 },
  'schnee-leicht': { temperature: -1, code: 71, text: 'leichter Schneefall', kind: 'snow', cloud: 90, precipitation: 0.1, rain_rate: 0, snowfall: 0.1, snow_depth: 0.03, visibility: 8000, wind_speed: 8, wind_direction: 240 },
  schnee: { temperature: -2, code: 73, text: 'Schneefall', kind: 'snow', cloud: 100, precipitation: 0.3, rain_rate: 0, snowfall: 0.4, snow_depth: 0.12, visibility: 3000, wind_speed: 15, wind_direction: 250 },
  schneesturm: { temperature: -6, code: 75, text: 'starker Schneefall', kind: 'snow', cloud: 100, precipitation: 0.8, rain_rate: 0, snowfall: 1.2, snow_depth: 0.35, visibility: 600, wind_speed: 45, wind_direction: 270 },
  niesel: { temperature: 9, code: 53, text: 'Nieselregen', kind: 'drizzle', cloud: 100, precipitation: 0.1, rain_rate: 0.4, snowfall: 0, snow_depth: 0, visibility: 9000, wind_speed: 10, wind_direction: 240 },
  regen: { temperature: 12, code: 63, text: 'Regen', kind: 'rain', cloud: 100, precipitation: 1, rain_rate: 4, snowfall: 0, snow_depth: 0, visibility: 10000, wind_speed: 20, wind_direction: 240 },
  wolkenbruch: { temperature: 18, code: 65, text: 'starker Regen', kind: 'rain', cloud: 100, precipitation: 6, rain_rate: 24, snowfall: 0, snow_depth: 0, visibility: 4000, wind_speed: 35, wind_direction: 250 },
  gewitter: { temperature: 21, code: 95, text: 'Gewitter', kind: 'thunder', cloud: 100, precipitation: 2.5, rain_rate: 10, snowfall: 0, snow_depth: 0, visibility: 7000, wind_speed: 30, wind_direction: 240 },
  nebel: { temperature: 6, code: 45, text: 'Nebel', kind: 'fog', cloud: 100, precipitation: 0, rain_rate: 0, snowfall: 0, snow_depth: 0, visibility: 250, wind_speed: 3, wind_direction: 0 },
  wolkig: { temperature: 15, code: 2, text: 'wolkig', kind: 'clouds', cloud: 55, precipitation: 0, rain_rate: 0, snowfall: 0, snow_depth: 0, visibility: 20000, wind_speed: 15, wind_direction: 240 },
  klar: { temperature: 20, code: 0, text: 'klar', kind: 'clear', cloud: 0, precipitation: 0, rain_rate: 0, snowfall: 0, snow_depth: 0, visibility: 30000, wind_speed: 5, wind_direction: 90 },
};
const testWeather = TEST_WEATHER[new URLSearchParams(location.search).get('testwetter') ?? ''] ?? null;
async function updateOutdoor(force = false) {
  const t = terminal();
  const loc = store.house.settings.location;
  view.lawn = !!t;
  if (!t) {
    if (view.outdoor) view.setOutdoor(null);
    return;
  }
  // neu abfragen: alle 15 Min., bei geänderter Lage sofort, nach einem Fehlschlag nach einer Minute
  const q = loc ? `?lat=${loc.lat}&lon=${loc.lon}&place=${encodeURIComponent(loc.label ?? '')}` : '';
  const due = !outdoorWeather || outdoorWeather.q !== q || Date.now() - outdoorWeather.at > (outdoorWeather.data ? 15 : 1) * 60000;
  if (testWeather) {
    if (outdoorWeather?.data?.place !== 'Testwetter') {
      outdoorWeather = { at: Date.now(), data: { ...testWeather, place: 'Testwetter' }, q };
      const d = outdoorWeather.data;
      setTermWeather(`Testwetter: ${d.temperature} °C · ${d.text}`);
    }
  } else if ((force || due) && (loc || t.settings.plz)) {
    // ohne Lage und ohne Postleitzahl gibt es kein Wetter (z. B. bevor der Hausplan geladen ist)
    const data = await fetch(`/api/weather${q}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    outdoorWeather = { at: Date.now(), data, q };
    setTermWeather(data ? `${data.temperature} °C · ${data.text}${data.rain_rate >= 0.1 ? ` · ${String(data.rain_rate).replace('.', ',')} mm/h` : ''}` : '');
  }
  const w = outdoorWeather?.data ?? null;
  const sun = loc ? sunPosition(new Date(), loc.lat, loc.lon) : null;
  const night = sun ? sun.altitude < -3 : (() => { const h = new Date().getHours(); return h < 7 || h >= 20; })();
  // Wetter über dem Bild (Regen, Schnee, Dunst, Gewitter) – auch ohne Lage des Hauses (Wetter dann per Postleitzahl)
  const look = lookFromWeather(w, night, loc?.north ?? 0);
  weatherFx().forEach((fx) => fx.set(look));
  if (loc && sun) {
    const kind = String(w?.kind ?? '');
    view.setOutdoor({
      ...sun, north: loc.north, cloud: w?.cloud ?? 20, rain: (w?.precipitation ?? 0) > 0 || ['rain', 'drizzle', 'thunder'].includes(kind),
      fog: look.fog,
      // Nässe nach Regenstärke (voll ab ~6 mm/h), Schnee nach Schneehöhe (1 cm: Flecken, ab 10 cm geschlossen)
      wet: Math.min(1, Math.sqrt(Math.max(Number(w?.rain_rate ?? 0), ['rain', 'drizzle', 'thunder'].includes(kind) ? 0.4 : 0) / 6)),
      snow: Math.min(1, Math.max(Math.sqrt(Number(w?.snow_depth ?? 0) / 0.1), kind === 'snow' && (w?.temperature ?? 5) <= 1 ? 0.25 : 0)),
      // Wolkenzug: langsam mit der Zeit, schneller bei Wind
      drift: ((Date.now() / 60000) % 100000) * 0.004 * (0.3 + Math.min(2, (w?.wind_speed ?? 10) / 20)),
    });
    // nachts brennen die Lampen
    const lamps = sun.altitude < 0 ? 1.8 : 0.6;
    if (store.house.settings.lampIntensity !== lamps) {
      store.house.settings.lampIntensity = lamps;
      view.build();
    }
  } else if (view.outdoor) view.setOutdoor(null);
}
/** Wetter-Animation über dem 3D und über dem Ruhezustand (nur Wandterminal) */
let fxView: WeatherFx | null = null;
let fxRest: WeatherFx | null = null;
function weatherFx() {
  if (!terminal()) return [];
  fxView ??= new WeatherFx($('#view'));
  const r = document.getElementById('rest');
  if (r) fxRest ??= new WeatherFx(r);
  return [fxView, fxRest].filter(Boolean) as WeatherFx[];
}
// jede Minute – nicht während das fotorealistische Bild gerechnet wird (würde es neu beginnen lassen)
window.setInterval(() => !painting && updateOutdoor(), 60000);
document.addEventListener('zh-account-render', () => {
  if (terminal()) {
    view.lawn = true;
    view.build();
    updateOutdoor(true);
  }
});
sync.onStorage(() => {
  if (terminal()) updateOutdoor();
});

// ---------------------------------------------------------------------------
// Wandterminal: ohne Bedienung zurück zum Haus, Ruhezustand mit gedimmtem Haus – Licht nach Tageszeit und Wetter

const rest = document.createElement('div');
rest.id = 'rest';
rest.className = 'rest';
rest.hidden = true;
rest.innerHTML = `<img class="rest-img" alt="" /><div class="rest-info"><b class="rest-clock"></b><span class="rest-date"></span><span class="rest-weather"></span><div class="rest-notes"></div></div><p class="rest-progress" hidden></p><div class="rest-storm" hidden><canvas class="rest-radar" width="360" height="360"></canvas><div><b class="storm-title"></b><span class="storm-text"></span><small class="storm-src">Blitzdaten: Blitzortung.org</small></div></div><p class="rest-hint">Zum Bedienen antippen</p>`;
document.body.appendChild(rest);
let restTimer = 0;
let restClock = 0;
let restPrev: { main: string; mode: HouseMode } | null = null;
const hoursOf = (iso: string | null | undefined, dflt: number) => {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : dflt;
};
/** Sonnenstand und Licht wie draußen: Tageszeit zwischen Auf- und Untergang, Bewölkung, Regen, nachts Lampen */
function lightLikeOutside(w: { cloud?: number; precipitation?: number; sunrise?: string | null; sunset?: string | null } | null) {
  const st = store.house.settings;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  const rise = hoursOf(w?.sunrise, 6.5);
  const set = hoursOf(w?.sunset, 19.5);
  const day = h >= rise && h <= set;
  st.timeOfDay = day ? 6 + ((h - rise) / Math.max(1, set - rise)) * 14 : 20;
  if (!day) Object.assign(st, { sunIntensity: 0.05, skyIntensity: 0.25, lampIntensity: 1.8, softness: 0.8 });
  else {
    const cloud = w?.cloud ?? 30;
    const rain = (w?.precipitation ?? 0) > 0;
    Object.assign(st, { sunIntensity: rain ? 0.15 : cloud < 30 ? 1.3 : cloud < 70 ? 0.7 : 0.25, skyIntensity: rain || cloud > 70 ? 1.4 : 1, lampIntensity: 0.6, softness: cloud > 50 ? 1 : 0.4 });
  }
}
const frames = (n: number) => new Promise<void>((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); f(); });
/** Bild des Hauses neu rechnen: erst schnell, dann fotorealistisch (höchstens 30 s, danach ruht die Grafik) */
/** Detailgrad des fotorealistischen Bildes: Proben, Zeitlimit, Rechenauflösung (Terminal-Einstellung) */
const QUALITY = {
  // Proben bis „fertig“, Zeitlimit, Rechenauflösung, Mindestproben – darunter bleibt das normale 3D-Bild (kein Rauschen)
  draft: { samples: 24, ms: 60000, scale: 0.5, min: 10 },
  normal: { samples: 64, ms: 120000, scale: 0.6, min: 24 },
  high: { samples: 256, ms: 300000, scale: 1, min: 64 },
} as const;
const REST_KEY = 'zh.rest';
let restKey = '';
let painting = false;
/** Was das Bild bestimmt: Sonnenstand (in 3°-Schritten, nachts fest) und Wetter – nur bei Änderung neu rechnen */
function restSceneKey() {
  const loc = store.house.settings.location;
  const w = outdoorWeather?.data;
  const now = new Date();
  let sun = `t${Math.floor((now.getHours() * 60 + now.getMinutes()) / 15)}`;
  if (loc) {
    const p = sunPosition(now, loc.lat, loc.lon);
    sun = p.altitude < -6 ? 'nacht' : `${Math.round(p.azimuth / 3)}:${Math.round(p.altitude / 3)}`;
  }
  return `${store.house.floors.length}|${sun}|${w?.code ?? '-'}|${Math.round((w?.cloud ?? 0) / 25)}|${(w?.precipitation ?? 0) > 0}|${(w?.snow_depth ?? 0) >= 0.02}|${Math.round((w?.visibility ?? 20000) / 2000)}`;
}
/** Bild klein (JPEG) merken – nach einem Neuladen ist der Ruhezustand sofort da */
function rememberRest(dataUrl: string, key: string) {
  const im = new Image();
  im.onload = () => {
    const sc = Math.min(1, 1600 / im.width);
    const c = document.createElement('canvas');
    c.width = Math.round(im.width * sc);
    c.height = Math.round(im.height * sc);
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    try {
      localStorage.setItem(REST_KEY, JSON.stringify({ key, img: c.toDataURL('image/jpeg', 0.85) }));
    } catch {
      /* zu groß oder gesperrt */
    }
  };
  im.src = dataUrl;
}
/** Nur rechnen, wenn sich Sonne oder Wetter geändert haben und der Bildschirm sichtbar ist */
async function checkRest() {
  if (rest.hidden || document.hidden || painting) return;
  await updateOutdoor();
  const key = restSceneKey();
  if (key === restKey) return;
  restKey = key;
  await paintRest(key);
}
document.addEventListener('visibilitychange', () => checkRest());

/** Bild des Hauses rechnen: erst schnell, dann fotorealistisch bis zum Detailgrad, dann ruht die Grafik */
async function paintRest(key: string) {
  if (rest.hidden) return;
  painting = true;
  const progress = rest.querySelector<HTMLElement>('.rest-progress')!;
  try {
    const loc = store.house.settings.location;
    const w = outdoorWeather?.data ?? null;
    rest.querySelector('.rest-weather')!.textContent = w ? `${w.place || loc?.label || ''}${w.place || loc?.label ? ' · ' : ''}${w.temperature} °C · ${w.text}` : '';
    // ohne Lage: Licht aus der Tageszeit zwischen Auf- und Untergang
    if (!loc) lightLikeOutside(w);
    setView('3d');
    await frames(4); // 3D-Bereich bekommt erst jetzt seine Größe
    view.mode = 'house';
    view.build();
    view.setView('perspective');
    view.tiltCamera(18); // flacher Blick aufs Haus
    await frames(12);
    const img = rest.querySelector<HTMLImageElement>('.rest-img')!;
    // mit gemerktem Bild nicht kurz auf das einfache 3D zurückfallen
    if (!img.getAttribute('src')) img.src = view.screenshot();
    // fotorealistisch nur mit echter Grafik (Software-Rendering würde das Gerät minutenlang blockieren)
    if (!/swiftshader|llvmpipe|software/i.test(view.gpuInfo().name)) {
      const q = QUALITY[terminal()?.settings.renderQuality ?? 'normal'];
      view.ptScale = q.scale;
      await view.setPathTracing(true);
      ptSamples = 0;
      const t0 = performance.now();
      progress.hidden = false;
      while (!rest.hidden && !document.hidden && ptSamples < q.samples && performance.now() - t0 < q.ms) {
        progress.textContent = `Bild wird fotorealistisch gerechnet … ${Math.min(100, Math.round(Math.max(ptSamples / q.samples, (performance.now() - t0) / q.ms) * 100))} %`;
        await frames(10);
      }
      progress.hidden = true;
      const done = !rest.hidden && !document.hidden;
      if (done && ptSamples >= q.min) {
        img.src = view.screenshot();
        rememberRest(img.src, key);
      } else if (done) {
        // Grafik zu langsam: sauberes normales 3D-Bild statt verrauschtem Zwischenstand
        await view.setPathTracing(false);
        await frames(3);
        img.src = view.screenshot();
        rememberRest(img.src, key);
        console.info(`Fotorealistisch: nur ${ptSamples} von mind. ${q.min} Proben in ${q.ms / 1000} s – normales Bild verwendet`);
      } else restKey = ''; // abgebrochen: beim nächsten Mal neu
      await view.setPathTracing(false);
      view.ptScale = 1;
    } else {
      img.src = view.screenshot();
      rememberRest(img.src, key);
    }
    // was zu tun ist: Einkaufsliste, bald ablaufend
    const [shop, exp] = await Promise.all([
      fetch('/api/shopping', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ open: [] })),
      fetch('/api/expiring?days=7', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => []),
    ]);
    rest.querySelector('.rest-notes')!.innerHTML = [
      shop.open?.length ? `${ic('cart')} ${shop.open.length} auf der Einkaufsliste` : '',
      exp.length ? `${ic('clock')} ${exp.length} läuft in 7 Tagen ab` : '',
    ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
  } finally {
    painting = false;
    progress.hidden = true;
  }
}
function startRest() {
  // zurück zum Haus, Auswahl und Suche zurücksetzen
  if (location.hash !== '#/haus') location.hash = '#/haus';
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  viewFach = null;
  store.select(null);
  searchInput.value = '';
  setHighlight([]);
  if (!terminal()?.settings.screensaver) return;
  restPrev = { main: $('#main').className, mode: view.mode };
  rest.hidden = false;
  document.body.classList.add('resting');
  const clock = () => {
    const d = new Date();
    rest.querySelector('.rest-clock')!.textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    rest.querySelector('.rest-date')!.textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  clock();
  restClock = window.setInterval(clock, 15000);
  // gemerktes Bild sofort zeigen; neu gerechnet wird nur, wenn sich Sonne oder Wetter seitdem geändert haben
  try {
    const saved = JSON.parse(localStorage.getItem(REST_KEY) ?? 'null');
    if (saved?.img) {
      rest.querySelector<HTMLImageElement>('.rest-img')!.src = saved.img;
      restKey = saved.key;
    }
  } catch {
    /* egal */
  }
  checkRest();
  updateLightning();
  restTimer = window.setInterval(checkRest, 2 * 60000);
}
function stopRest() {
  if (rest.hidden) return;
  rest.hidden = true;
  document.body.classList.remove('resting');
  clearInterval(restTimer);
  clearInterval(restClock);
  if (view.pathTracing) view.setPathTracing(false);
  if (restPrev) {
    $('#main').className = restPrev.main;
    setView(restPrev.main.replace('v-', '') as '2d' | '3d');
    view.mode = restPrev.mode;
    view.build();
    view.setView('perspective');
    restPrev = null;
  }
}
initIdle(startRest, stopRest);

// ---------------------------------------------------------------------------
// Gewitter: Blitze in Echtzeit rund ums Haus (Blitzortung.org) – Hinweis, Blitzkarte, Aufblitzen bei nahen Einschlägen

async function updateLightning() {
  const loc = store.house.settings.location;
  if (!terminal() || !loc || document.hidden) return;
  const r = await fetch(`/api/lightning?lat=${loc.lat}&lon=${loc.lon}`, { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (r) showLightning(r);
}
type StrikeInfo = { km: number; bearing: number; age_s: number; direction: string };
function showLightning(r: { strikes: { km: number; bearing: number; age_s: number }[]; count15: number; level: number; nearest: StrikeInfo | null; latest?: StrikeInfo | null }) {
  const loc = store.house.settings.location;
  if (!loc) return;
  // ohne Echtzeit-Verbindung: neue nahe Blitze seit der letzten Abfrage → Bildschirm blitzt (je näher, desto heller)
  const fresh = r.strikes.filter((s: any) => s.age_s < 25 && s.km <= 30);
  if (fresh.length && strikeStream?.readyState !== EventSource.OPEN) {
    const near = Math.min(...fresh.map((s: any) => s.km));
    weatherFx().forEach((fx) => fx.flash(Math.max(0.35, 1 - near / 30)));
  }
  const ago = (sec: number) => (sec < 10 ? 'gerade eben' : sec < 90 ? `vor ${sec} s` : `vor ${Math.round(sec / 60)} Min.`);
  const km = (x: number) => x.toLocaleString('de-DE');
  const n = r.nearest;
  const title = r.level >= 3 ? 'Gewitter direkt über uns' : r.level === 2 ? 'Gewitter in der Nähe' : r.level === 1 ? 'Gewitter in der Region' : '';
  // „Letzter Blitz“ = der neueste (den man gerade sieht), getrennt vom nächstgelegenen der letzten 15 Min.
  const l = r.latest ?? n;
  const text = l && n
    ? `Letzter Blitz ${km(l.km)} km im ${l.direction}, ${ago(l.age_s)}\n${r.count15} Blitze in 15 Min.${n !== l && (n.km < l.km - 0.5) ? ` · am nächsten ${km(n.km)} km im ${n.direction} (${ago(n.age_s)})` : ''}`
    : '';
  // Kopfzeile des Terminals: Warnung ab „in der Nähe“
  setTermStorm(r.level >= 2 && l ? `Gewitter · ${km(Math.round(l.km))} km ${l.direction}` : '', r.level);
  // Ruhezustand: Hinweis und Karte, sobald es in 100 km blitzt
  const box = document.querySelector<HTMLElement>('#rest .rest-storm');
  if (!box) return;
  // nur bei Blitzen in der Nähe (bis 50 km, letzte 15 Min.) – sonst ausgeblendet
  box.hidden = r.level === 0;
  box.dataset.level = String(r.level);
  box.querySelector('.storm-title')!.textContent = title || 'Blitze in der Ferne';
  box.querySelector('.storm-text')!.textContent = text;
  drawRadar(box.querySelector('canvas')!, r.strikes, loc.north);
}
/** Blitzkarte: Haus in der Mitte, Norden oben, Ringe 10/25/50 km, Punkte nach Alter */
function drawRadar(c: HTMLCanvasElement, strikes: { km: number; bearing: number; age_s: number }[], _north: number) {
  const g = c.getContext('2d')!;
  const S = c.width;
  const R = S / 2 - 14;
  const MAX = 50;
  g.clearRect(0, 0, S, S);
  g.save();
  g.translate(S / 2, S / 2);
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath();
  g.arc(0, 0, R + 10, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.25)';
  g.lineWidth = 2;
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = '600 18px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  for (const km of [10, 25, 50]) {
    g.beginPath();
    g.arc(0, 0, (km / MAX) * R, 0, Math.PI * 2);
    g.stroke();
    g.fillText(`${km}`, (km / MAX) * R * 0.71 + 14, -(km / MAX) * R * 0.71 + 2);
  }
  g.fillText('N', 0, -R + 22);
  for (const s of [...strikes].reverse()) {
    if (s.km > MAX) continue;
    const a = (s.bearing * Math.PI) / 180;
    const d = (s.km / MAX) * R;
    const fresh = s.age_s < 300;
    g.fillStyle = s.age_s < 60 ? '#fff36b' : fresh ? 'rgba(255,200,60,.95)' : s.age_s < 900 ? 'rgba(255,140,50,.75)' : 'rgba(200,200,210,.4)';
    g.beginPath();
    g.arc(Math.sin(a) * d, -Math.cos(a) * d, fresh ? 6 : 4, 0, Math.PI * 2);
    g.fill();
  }
  // Haus
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -10);
  g.lineTo(9, -2);
  g.lineTo(6, -2);
  g.lineTo(6, 8);
  g.lineTo(-6, 8);
  g.lineTo(-6, -2);
  g.lineTo(-9, -2);
  g.closePath();
  g.fill();
  g.restore();
}
// Echtzeit: der Server meldet jeden Blitz im Umkreis sofort (Server-Sent Events) – Aufblitzen ohne Verzögerung,
// Hinweis und Karte werden kurz danach aktualisiert. Die Abfrage jede Minute bleibt als Rückfall.
let strikeStream: EventSource | null = null;
let streamKey = '';
let strikeTimer = 0;
function connectStrikes() {
  const loc = store.house.settings.location;
  const key = terminal() && loc ? `${loc.lat},${loc.lon}` : '';
  if (key === streamKey) return;
  strikeStream?.close();
  strikeStream = null;
  streamKey = key;
  if (!loc || !key) return;
  strikeStream = new EventSource(`/api/lightning/stream?lat=${loc.lat}&lon=${loc.lon}&radius=100`, { withCredentials: true });
  strikeStream.addEventListener('strike', (e) => {
    const st = JSON.parse((e as MessageEvent).data) as { km: number; direction: string };
    if (st.km <= 30) weatherFx().forEach((fx) => fx.flash(Math.max(0.35, 1 - st.km / 30)));
    // höchstens alle 1,5 s aktualisieren – aber sicher (bei Dauerfeuer würde ein Verschieben nie fertig)
    if (!strikeTimer) strikeTimer = window.setTimeout(() => {
      strikeTimer = 0;
      updateLightning();
    }, 1500);
  });
}
// alle 15 s: Altersangaben („vor 40 s“) bleiben aktuell, auch wenn gerade kein neuer Blitz kommt
window.setInterval(() => updateLightning(), 15000);
document.addEventListener('zh-account-render', () => {
  connectStrikes();
  if (terminal()) updateLightning();
});
store.subscribe(() => connectStrikes());


// Projekt per URL laden, z. B. ?projekt=haus1-eg (Datei unter public/projekte/)
const projectParam = new URLSearchParams(location.search).get('projekt');
if (projectParam) {
  const file = projectParam.endsWith('.json') ? projectParam : `${projectParam}.kueche.json`;
  fetch(`${import.meta.env.BASE_URL}projekte/${encodeURIComponent(file)}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((p: Project) => {
      importPlan(p, p.name || file, 'new');
      history.replaceState(null, '', location.pathname);
    })
    .catch((err) => toast(`Projekt „${file}“ konnte nicht geladen werden: ${err.message}`));
}

// Nur in der Entwicklung: Zugriff für automatisierte Ansichtstests
// Zugriff für automatisierte Ansichtstests (Klicktests)
(window as any).__zuhause = {
  view, plan, store, sync, rest: () => idleNow(),
  // für Klicktests: Wetter und Blitze vorgeben
  weather: (w: any) => {
    outdoorWeather = { at: Date.now(), data: w, q: (() => { const l = store.house.settings.location; return l ? `?lat=${l.lat}&lon=${l.lon}&place=${encodeURIComponent(l.label ?? '')}` : ''; })() };
    return updateOutdoor();
  },
  lightning: showLightning,
};

// Showroom direkt öffnen: per Link (?showroom) oder nach Neuladen, wenn er aktiv war
{
  let resume = false;
  try {
    resume = sessionStorage.getItem('kp.showroom') === '1';
  } catch {
    /* ignorieren */
  }
  if (!new URLSearchParams(location.search).has('ansicht') && (new URLSearchParams(location.search).has('showroom') || resume)) setShowroom(true);
}
