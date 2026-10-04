/* Heimlager – QR-Code als 3D-Modell (STL / 3MF) erzeugen, ohne Abhängigkeiten */
(() => {
  'use strict';

  // ---------- Layout (mm, y nach unten wie im Bild) ----------

  // Zusammenhängende Felder eines Rasters zu möglichst wenigen Rechtecken zusammenfassen
  function mergeRects(w, h, get) {
    const out = [];
    let open = new Map();
    for (let y = 0; y <= h; y++) {
      const runs = new Map();
      if (y < h) {
        let x = 0;
        while (x < w) {
          if (!get(x, y)) { x++; continue; }
          const s = x;
          while (x < w && get(x, y)) x++;
          runs.set(`${s},${x}`, [s, x]);
        }
      }
      const next = new Map();
      for (const [k, r] of open) {
        if (runs.has(k)) { r.h++; next.set(k, r); runs.delete(k); } else out.push(r);
      }
      for (const [k, [s, e]] of runs) next.set(k, { x: s, y, w: e - s, h: 1 });
      open = next;
    }
    return out;
  }

  // Text über ein Canvas rastern (Raster 0,1 mm) → Rechtecke in mm
  function textRects(str, heightMm, maxWidthMm, pitch = 0.1) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = (px) => `700 ${px}px system-ui, "Segoe UI", Roboto, Arial, sans-serif`;
    g.font = font(100);
    let m = g.measureText(str);
    const w0 = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const h0 = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (!(w0 > 0 && h0 > 0)) return null;
    const mmPerPx = Math.min(heightMm / h0, maxWidthMm / w0); // mm je px bei Schriftgröße 100
    const px = (100 * mmPerPx) / pitch; // Schriftgröße, bei der 1 px = pitch mm
    const pad = 2;
    c.width = Math.ceil(w0 * px / 100) + 2 * pad;
    c.height = Math.ceil(h0 * px / 100) + 2 * pad;
    g.font = font(px);
    m = g.measureText(str);
    g.fillStyle = '#000';
    g.fillText(str, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
    const img = g.getImageData(0, 0, c.width, c.height).data;
    const rects = mergeRects(c.width, c.height, (x, y) => img[(y * c.width + x) * 4 + 3] > 127)
      .map((r) => ({ x: (r.x - pad) * pitch, y: (r.y - pad) * pitch, w: r.w * pitch, h: r.h * pitch }));
    return {
      rects,
      w: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * pitch,
      h: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * pitch,
    };
  }

  /**
   * Modell berechnen.
   * o: { width, margin, radius, base, relief, label, labelSize, eyelet, hole }
   */
  function build(content, o) {
    const q = window.qrcode(0, 'M');
    q.addData(content);
    q.make();
    const n = q.getModuleCount();
    const W = o.width;
    const mg = o.margin;
    const qrMm = W - 2 * mg;
    if (!(qrMm > 0)) throw new Error('Der Rand ist zu groß für diese Breite.');
    const mod = qrMm / n;

    const top = [];
    for (const r of mergeRects(n, n, (x, y) => q.isDark(y, x))) {
      top.push({ x: mg + r.x * mod, y: mg + r.y * mod, w: r.w * mod, h: r.h * mod });
    }

    let H = W;
    let textMm = 0;
    const label = String(o.label || '').trim();
    if (label && o.labelSize > 0) {
      const t = textRects(label, o.labelSize, qrMm);
      if (t) {
        const ty = mg + qrMm + Math.max(1, mg * 0.5);
        const tx = (W - t.w) / 2;
        const dy = (o.labelSize - t.h) / 2;
        for (const r of t.rects) top.push({ x: tx + r.x, y: ty + dy + r.y, w: r.w, h: r.h });
        H = ty + o.labelSize + mg;
        textMm = t.h;
      }
    }

    // Eckenradius so begrenzen, dass die Ecken den QR-Code nicht anschneiden
    const r = Math.max(0, Math.min(o.radius, W / 2, H / 2, mg * 3.4));

    let eyelet = null;
    if (o.eyelet) {
      const hr = o.hole / 2;
      const cy = -(hr + 0.8); // Loch liegt komplett außerhalb der Platte
      eyelet = { cx: W / 2, cy, R: hr + 2, r: hr };
    }
    const minY = eyelet ? eyelet.cy - eyelet.R : 0;

    return { W, H, r, n, mod, top, eyelet, minY, base: o.base, relief: o.relief, textMm };
  }

  // ---------- Dreiecksnetze ----------
  class Mesh {
    constructor() { this.v = []; this.t = []; }
    vert(x, y, z) { this.v.push(x, y, z); return this.v.length / 3 - 1; }
    tri(a, b, c) { this.t.push(a, b, c); }
    // Konvexes Polygon (gegen den Uhrzeigersinn, von oben gesehen) extrudieren
    prism(poly, z0, z1) {
      const n = poly.length;
      const b = poly.map(([x, y]) => this.vert(x, y, z0));
      const t = poly.map(([x, y]) => this.vert(x, y, z1));
      for (let i = 1; i < n - 1; i++) { this.tri(t[0], t[i], t[i + 1]); this.tri(b[0], b[i + 1], b[i]); }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(b[i], b[j], t[j]); this.tri(b[i], t[j], t[i]);
      }
    }
    box(x0, y0, x1, y1, z0, z1) { this.prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1); }
    ring(cx, cy, R, r, z0, z1, seg = 48) {
      const ob = [], ot = [], ib = [], it = [];
      for (let i = 0; i < seg; i++) {
        const a = (2 * Math.PI * i) / seg, c = Math.cos(a), s = Math.sin(a);
        ob.push(this.vert(cx + R * c, cy + R * s, z0)); ot.push(this.vert(cx + R * c, cy + R * s, z1));
        ib.push(this.vert(cx + r * c, cy + r * s, z0)); it.push(this.vert(cx + r * c, cy + r * s, z1));
      }
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.tri(ot[i], ot[j], it[j]); this.tri(ot[i], it[j], it[i]);
        this.tri(ob[i], ib[j], ob[j]); this.tri(ob[i], ib[i], ib[j]);
        this.tri(ob[i], ob[j], ot[j]); this.tri(ob[i], ot[j], ot[i]);
        this.tri(ib[j], ib[i], it[i]); this.tri(ib[j], it[i], it[j]);
      }
    }
    get triangles() { return this.t.length / 3; }
    // Kopie, um (dx, dy) verschoben
    moved(dx, dy) {
      const m = new Mesh();
      m.v = this.v.map((x, i) => (i % 3 === 0 ? x + dx : i % 3 === 1 ? x + dy : x));
      m.t = this.t.slice();
      return m;
    }
  }

  function roundedRect(W, H, r, seg = 8) {
    if (r <= 0) return [[0, 0], [W, 0], [W, H], [0, H]];
    const pts = [];
    const corners = [[W - r, r, -90], [W - r, H - r, 0], [r, H - r, 90], [r, r, 180]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    }
    return pts;
  }

  // Zwei Teile: Grundplatte (mit Öse) und QR-Code samt Text (erhaben)
  function meshes(model) {
    const { W, H, r, base, relief } = model;
    const Y = (y) => H - y; // Bild-Koordinaten → Y nach oben
    const plate = new Mesh();
    plate.prism(roundedRect(W, H, r), 0, base);
    if (model.eyelet) {
      const e = model.eyelet;
      plate.ring(e.cx, Y(e.cy), e.R, e.r, 0, base);
    }
    const code = new Mesh();
    for (const b of model.top) code.box(b.x, Y(b.y + b.h), b.x + b.w, Y(b.y), base, base + relief);
    return { plate, code };
  }

  // ---------- Dateiformate ----------
  function stl(list, name = 'Heimlager') {
    const count = list.reduce((s, m) => s + m.triangles, 0);
    const buf = new ArrayBuffer(84 + 50 * count);
    const dv = new DataView(buf);
    const head = new TextEncoder().encode(name.slice(0, 79));
    new Uint8Array(buf, 0, 80).set(head);
    dv.setUint32(80, count, true);
    let o = 84;
    for (const m of list) {
      const v = m.v;
      for (let i = 0; i < m.t.length; i += 3) {
        const a = m.t[i] * 3, b = m.t[i + 1] * 3, c = m.t[i + 2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (const f of [nx, ny, nz]) { dv.setFloat32(o, f, true); o += 4; }
        for (const k of [a, b, c]) for (let d = 0; d < 3; d++) { dv.setFloat32(o, v[k + d], true); o += 4; }
        dv.setUint16(o, 0, true); o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  const num = (x) => String(Math.round(x * 10000) / 10000);
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function meshXml(m) {
    const out = ['<mesh><vertices>'];
    for (let i = 0; i < m.v.length; i += 3) out.push(`<vertex x="${num(m.v[i])}" y="${num(m.v[i + 1])}" z="${num(m.v[i + 2])}"/>`);
    out.push('</vertices><triangles>');
    for (let i = 0; i < m.t.length; i += 3) out.push(`<triangle v1="${m.t[i]}" v2="${m.t[i + 1]}" v3="${m.t[i + 2]}"/>`);
    out.push('</triangles></mesh>');
    return out.join('');
  }

  // 3MF-Modelldatei: je Schild ein Objekt aus mehreren Teilen (jedes Teil mit eigener Farbe), an Position x/y.
  // Farben als <m:colorgroup> (Materials-Erweiterung) – Bambu Studio/Orca ordnen nur diese den Filamenten zu,
  // <basematerials> ignorieren sie.
  function modelXml(objects, title) {
    const color = (hex) => `${hex.toUpperCase()}FF`;
    const colors = [...new Set(objects.flatMap((o) => o.parts.map((p) => color(p.color))))];
    const res = [];
    const items = [];
    let id = 2;
    for (const o of objects) {
      const ids = o.parts.map((p) => {
        res.push(`<object id="${id}" type="model" name="${xmlEsc(p.name)}" pid="1" pindex="${colors.indexOf(color(p.color))}">${meshXml(p.mesh)}</object>`);
        return id++;
      });
      res.push(`<object id="${id}" type="model" name="${xmlEsc(o.name)}"><components>${ids.map((i) => `<component objectid="${i}"/>`).join('')}</components></object>`);
      const move = o.x || o.y ? ` transform="1 0 0 0 1 0 0 0 1 ${num(o.x || 0)} ${num(o.y || 0)} 0"` : '';
      items.push(`<item objectid="${id++}"${move}/>`);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<metadata name="Title">${xmlEsc(title)}</metadata>
<metadata name="Application">Heimlager</metadata>
<resources>
<m:colorgroup id="1">${colors.map((c) => `<m:color color="${c}"/>`).join('')}</m:colorgroup>
${res.join('\n')}
</resources>
<build>${items.join('')}</build>
</model>`;
  }

  function packageFiles(model) {
    const enc = new TextEncoder();
    return [
      { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
      { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
      { name: '3D/3dmodel.model', data: enc.encode(model) },
    ];
  }

  // 3MF: ein Objekt aus zwei Teilen, jedes mit eigener Farbe
  function threeMF(parts, title) {
    return zip(packageFiles(modelXml([{ name: title, parts }], title)));
  }

  // 3MF mit mehreren Schildern (komprimiert): objects = [{ name, parts, x, y }]
  function threeMFMulti(objects, title) {
    return zipDeflate(packageFiles(modelXml(objects, title)));
  }

  // ---------- Mehrere Schilder auf Druckplatten verteilen ----------
  // Zeilenweise von hinten links (so liest sich die Draufsicht wie ein Text), je Platte mittig ausgerichtet.
  // sizes = [{ w, h }] in mm, plate = { w, h, gap, edge }.
  // Ergebnis: je Schild { plate (0-basiert), x, y } – linke vordere Ecke wie im Slicer (Y nach hinten).
  function arrange(sizes, plate) {
    const { w: PW, h: PH, gap = 5, edge = 5 } = plate;
    const out = [];
    // zuerst von oben links mit y nach unten auslegen …
    let p = 0, x = 0, y = 0, rowH = 0;
    for (const s of sizes) {
      if (s.w > PW - 2 * edge || s.h > PH - 2 * edge) throw new Error('Ein Schild ist größer als die Druckplatte.');
      if (x > 0 && x + s.w > PW - 2 * edge) { x = 0; y += rowH + gap; rowH = 0; }
      if (y > 0 && y + s.h > PH - 2 * edge) { p++; x = 0; y = 0; rowH = 0; }
      out.push({ plate: p, x, y, w: s.w, h: s.h });
      x += s.w + gap;
      rowH = Math.max(rowH, s.h);
    }
    // … dann je Platte mittig setzen und Y umdrehen (Slicer: Y nach hinten)
    for (let i = 0; i <= p; i++) {
      const on = out.filter((o) => o.plate === i);
      const bw = Math.max(...on.map((o) => o.x + o.w));
      const bh = Math.max(...on.map((o) => o.y + o.h));
      const dx = (PW - bw) / 2, dy = (PH - bh) / 2;
      for (const o of on) { o.x += dx; o.y = PH - (o.y + dy) - o.h; }
    }
    return out.map(({ plate: pl, x: px, y: py }) => ({ plate: pl, x: px, y: py }));
  }

  // Grundfläche eines Modells in Mesh-Koordinaten (x 0…w, y 0…h, Öse eingeschlossen)
  const footprint = (model) => ({ w: model.W, h: model.H - model.minY });

  // ---------- ZIP (unkomprimiert) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const body = f.packed || f.data; // f.packed = mit Deflate komprimiert
      const method = f.packed ? 8 : 0;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // Dateinamen in UTF-8
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, f.data.length, true);
      local.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(local.buffer), name, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true);
      cd.setUint32(24, f.data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // Wie zip(), aber mit Deflate (CompressionStream) – 3MF-Dateien mit vielen Schildern werden sonst sehr groß
  async function zipDeflate(files) {
    if (typeof CompressionStream === 'undefined') return zip(files);
    const packed = await Promise.all(files.map(async (f) => {
      const stream = new Blob([f.data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return { ...f, packed: new Uint8Array(await new Response(stream).arrayBuffer()) };
    }));
    return zip(packed);
  }

  // ---------- Vorschau ----------
  function svg(model, colors) {
    const { W, H, r, minY, eyelet } = model;
    const vb = `-1 ${num(minY - 1)} ${num(W + 2)} ${num(H - minY + 2)}`;
    const stroke = 'stroke="rgba(0,0,0,.25)" stroke-width="0.25"';
    let ring = '';
    if (eyelet) {
      const { cx, cy, R, r: ri } = eyelet;
      const circ = (rad) => `M${num(cx - rad)} ${num(cy)}a${num(rad)} ${num(rad)} 0 1 0 ${num(2 * rad)} 0a${num(rad)} ${num(rad)} 0 1 0 ${num(-2 * rad)} 0z`;
      ring = `<path d="${circ(R)}${circ(ri)}" fill-rule="evenodd" fill="${colors.base}" ${stroke}/>`;
    }
    const d = model.top.map((b) => `M${num(b.x)} ${num(b.y)}h${num(b.w)}v${num(b.h)}h${num(-b.w)}z`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Vorschau">
      ${ring}<rect width="${num(W)}" height="${num(H)}" rx="${num(r)}" fill="${colors.base}" ${stroke}/>
      <path d="${d}" fill="${colors.code}" shape-rendering="crispEdges"/></svg>`;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.QR3D = { build, meshes, stl, threeMF, threeMFMulti, arrange, footprint, zip, zipDeflate, svg, download };
})();
