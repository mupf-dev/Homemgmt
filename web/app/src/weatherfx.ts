// Wetter über dem Bild (Wandterminal, Ruhezustand): Regen, Schnee, Dunst und Blitze als leichte 2D-Animation auf
// einer Leinwand über dem 3D bzw. dem fotorealistischen Standbild – kostet kaum Rechenzeit, muss nichts neu rechnen.

export interface WeatherLook {
  /** clear | clouds | fog | drizzle | rain | snow | thunder */
  kind: string;
  /** Stärke 0…1 (Niederschlag) */
  intensity: number;
  /** Dunst 0…1 */
  fog: number;
  /** Wind: Neigung der Tropfen −1…1 (links/rechts) */
  wind: number;
  /** Nacht: Blitze heller, Dunst dunkler */
  night: boolean;
}

type Drop = { x: number; y: number; v: number; l: number; s: number };

export class WeatherFx {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private look: WeatherLook = { kind: 'clear', intensity: 0, fog: 0, wind: 0, night: false };
  private drops: Drop[] = [];
  private flashA = 0;
  private nextFlash = 0;
  private raf = 0;
  private last = 0;
  private readonly still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private host: HTMLElement) {
    this.canvas.className = 'wfx';
    host.appendChild(this.canvas);
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.seed();
  }

  set(look: WeatherLook) {
    const changed = look.kind !== this.look.kind || Math.abs(look.intensity - this.look.intensity) > 0.1;
    this.look = look;
    if (changed) this.seed();
    this.kick();
  }

  /** Blitz zeigen (stark = nah) */
  flash(strength = 1) {
    this.flashA = Math.max(this.flashA, Math.min(1, strength));
    this.kick();
  }

  private particles() {
    const { kind, intensity } = this.look;
    const area = (this.canvas.width * this.canvas.height) / 1e6;
    if (kind === 'snow') return Math.round((30 + 220 * intensity) * area);
    if (kind === 'rain' || kind === 'thunder') return Math.round((15 + 330 * intensity) * area);
    if (kind === 'drizzle') return Math.round((20 + 90 * intensity) * area);
    return 0;
  }

  private seed() {
    const n = this.particles();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const snow = this.look.kind === 'snow';
    this.drops = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      v: snow ? 30 + Math.random() * 50 : (this.look.kind === 'drizzle' ? 450 : 650) + Math.random() * 450,
      // leichter Regen: kurze Striche; je stärker, desto länger
      l: snow ? 1.5 + Math.random() * 2.5 : this.look.kind === 'drizzle' ? 4 + Math.random() * 4 : (7 + Math.random() * 9) * (0.7 + this.look.intensity * 0.6),
      s: Math.random() * Math.PI * 2,
    }));
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number) {
    this.raf = 0;
    const dt = Math.min(0.05, this.last ? (t - this.last) / 1000 : 0.016);
    this.last = t;
    const { kind, fog, wind, night } = this.look;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = W / Math.max(1, this.host.clientWidth);
    ctx.clearRect(0, 0, W, H);
    // Dunst: von unten hell (bzw. nachts dunkel) nach oben ausblendend
    if (fog > 0.02) {
      const g = ctx.createLinearGradient(0, H, 0, 0);
      const c = night ? '30,34,44' : '226,229,233';
      g.addColorStop(0, `rgba(${c},${0.75 * fog})`);
      g.addColorStop(0.6, `rgba(${c},${0.45 * fog})`);
      g.addColorStop(1, `rgba(${c},${0.2 * fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // Niederschlag
    if (this.drops.length) {
      const snow = kind === 'snow';
      // dezent: Deckkraft wächst mit der Regenstärke
      const a = 0.18 + 0.32 * this.look.intensity;
      ctx.strokeStyle = night ? `rgba(170,185,210,${a})` : `rgba(225,232,242,${a})`;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      for (const d of this.drops) {
        if (!this.still) {
          d.y += d.v * dt * dpr;
          d.x += (wind * d.v * 0.25 + (snow ? Math.sin(t / 900 + d.s) * 12 : 0)) * dt * dpr;
          if (d.y > H) {
            d.y = -d.l * dpr;
            d.x = Math.random() * W;
          }
          if (d.x > W) d.x -= W;
          if (d.x < 0) d.x += W;
        }
        if (snow) {
          ctx.moveTo(d.x + d.l * dpr, d.y);
          ctx.arc(d.x, d.y, d.l * dpr, 0, Math.PI * 2);
        } else {
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + wind * d.l * 0.35 * dpr, d.y + d.l * dpr);
        }
      }
      if (snow) ctx.fill();
      else ctx.stroke();
    }
    // Gewitter: gelegentlich von selbst, sonst bei echten Blitzen in der Nähe (flash)
    if (kind === 'thunder' && !this.still && t > this.nextFlash) {
      this.nextFlash = t + 6000 + Math.random() * 14000;
      this.flash(0.5 + Math.random() * 0.4);
    }
    if (this.flashA > 0.01) {
      ctx.fillStyle = `rgba(235,240,255,${this.flashA * (night ? 0.75 : 0.5)})`;
      ctx.fillRect(0, 0, W, H);
      // kurzes Flackern
      this.flashA *= Math.random() < 0.15 ? 1.2 : 0.82;
      if (this.flashA > 1) this.flashA = 1;
    }
    const busy = this.drops.length > 0 || this.flashA > 0.01 || kind === 'thunder';
    if (busy && !this.still) this.kick();
  }
}

/** Wetterdaten (Open-Meteo, siehe /api/weather) → Darstellung */
export function lookFromWeather(w: any, night: boolean, northDeg = 0): WeatherLook {
  if (!w) return { kind: 'clear', intensity: 0, fog: 0, wind: 0, night };
  const kind = String(w.kind ?? 'clear');
  // Regenstärke in mm/h: < 0,5 Niesel, ~2,5 mäßig, ~8 stark, ab ~20 Wolkenbruch (Wurzel: kleine Mengen bleiben sichtbar)
  const rate = Number(w.rain_rate ?? Number(w.precipitation ?? 0) * 4);
  const snowCm = Number(w.snowfall ?? 0) * 4; // cm pro Stunde
  const intensity = kind === 'snow' ? Math.min(1, Math.sqrt(snowCm / 4)) : Math.min(1, Math.sqrt(Math.max(rate, kind === 'drizzle' ? 0.2 : kind === 'rain' || kind === 'thunder' ? 0.6 : 0) / 20));
  const vis = w.visibility == null ? 20000 : Number(w.visibility);
  const fog = kind === 'fog' ? Math.max(0.55, 1 - vis / 2000) : vis < 5000 ? (5000 - vis) / 8000 : 0;
  // Wind von links/rechts im Bild (grob: Windrichtung relativ zur Blickrichtung Süden)
  const wind = Math.max(-1, Math.min(1, Math.sin(((Number(w.wind_direction ?? 0) + northDeg) * Math.PI) / 180) * Math.min(1, Number(w.wind_speed ?? 0) / 40)));
  return { kind, intensity, fog, wind, night };
}
